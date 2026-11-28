/** Review strategy: global default config, audit Agent strategy, session config lookup. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Button, Input, Radio, RadioGroup, Select, Space, Tag, TextArea, Typography
} from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import {
    ErrorBanner, KeyValueList, SectionCard, toastError, toastSuccess
} from '../../components/ui';
import { useResource } from '../../components/hooks';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { HITL_MODES, modeLabel, normalizeMode, reviewerLabel } from './utils';

const { Text } = Typography;

export default function StrategyPanel({ canWrite, initialConversationId = '', refreshKey = 0 }) {
    const t = useT();
    const config = useResource(() => api.get('/hitl/default-config'), [refreshKey]);
    const reviewerRes = useResource(() => api.get('/hitl/default-reviewer'), [refreshKey]);
    const strategy = useResource(() => api.get('/hitl/audit-strategy'), [refreshKey]);

    const [mode, setMode] = useState('off');
    const [reviewer, setReviewer] = useState('human');
    const [timeoutText, setTimeoutText] = useState('0');
    const [savingConfig, setSavingConfig] = useState(false);
    const [savingReviewer, setSavingReviewer] = useState(false);

    const [approvalPrompt, setApprovalPrompt] = useState('');
    const [reviewPrompt, setReviewPrompt] = useState('');
    const [savingStrategy, setSavingStrategy] = useState(false);

    const [convId, setConvId] = useState(initialConversationId || '');
    const [convData, setConvData] = useState(null);
    const [convError, setConvError] = useState(null);
    const [convLoading, setConvLoading] = useState(false);

    useEffect(() => {
        if (!config.data) return;
        setMode(normalizeMode(config.data.defaultMode));
        setTimeoutText(String(config.data.defaultTimeoutSeconds ?? 0));
    }, [config.data]);

    useEffect(() => {
        const source = reviewerRes.data?.defaultReviewer ?? config.data?.defaultReviewer;
        if (source) setReviewer(source === 'audit_agent' ? 'audit_agent' : 'human');
    }, [config.data, reviewerRes.data]);

    useEffect(() => {
        if (!strategy.data) return;
        setApprovalPrompt(strategy.data.auditAgentPrompt || '');
        setReviewPrompt(strategy.data.auditAgentPromptReviewEdit || '');
    }, [strategy.data]);

    const engineLabel = useMemo(() => {
        const backend = config.data?.auditBackend;
        const model = config.data?.auditModel;
        if (!backend && !model) return '';
        return [backend, model].filter(Boolean).join(' · ');
    }, [config.data]);

    const saveConfig = useCallback(async () => {
        setSavingConfig(true);
        try {
            const payload = await api.put('/hitl/default-config', {
                mode: normalizeMode(mode),
                reviewer,
                timeoutSeconds: Math.max(0, Number.parseInt(timeoutText, 10) || 0)
            });
            toastSuccess(t('hitl.pageReviewerSaved', null, 'Reviewer saved.'));
            config.reload({ silent: true });
            if (payload) {
                setMode(normalizeMode(payload.defaultMode));
                setReviewer(payload.defaultReviewer === 'audit_agent' ? 'audit_agent' : 'human');
                setTimeoutText(String(payload.defaultTimeoutSeconds ?? 0));
            }
        } catch (error) {
            toastError(error, t('ui.hitlStrategy.saveConfigFailed', null, 'Failed to save default configuration'));
        } finally {
            setSavingConfig(false);
        }
    }, [config.reload, mode, reviewer, t, timeoutText]); // eslint-disable-line react-hooks/exhaustive-deps

    const saveReviewer = useCallback(async () => {
        setSavingReviewer(true);
        try {
            await api.put('/hitl/default-reviewer', { reviewer });
            toastSuccess(t('hitl.pageReviewerSaved', null, 'Reviewer saved.'));
            reviewerRes.reload({ silent: true });
            config.reload({ silent: true });
        } catch (error) {
            toastError(error, t('ui.hitlStrategy.saveReviewerFailed', null, 'Failed to save default reviewer'));
        } finally {
            setSavingReviewer(false);
        }
    }, [config.reload, reviewer, reviewerRes.reload, t]); // eslint-disable-line react-hooks/exhaustive-deps

    const saveStrategy = useCallback(async () => {
        setSavingStrategy(true);
        try {
            await api.put('/hitl/audit-strategy', {
                auditAgentPrompt: approvalPrompt,
                auditAgentPromptReviewEdit: reviewPrompt
            });
            toastSuccess(t('hitl.strategySaved', null, 'Audit strategy saved.'));
            strategy.reload({ silent: true });
        } catch (error) {
            toastError(error, t('hitl.strategySaveFailed', null, 'Failed to save audit strategy'));
        } finally {
            setSavingStrategy(false);
        }
    }, [approvalPrompt, reviewPrompt, strategy.reload, t]); // eslint-disable-line react-hooks/exhaustive-deps

    const resetPrompts = useCallback(() => {
        setApprovalPrompt(strategy.data?.defaultAuditAgentPrompt || '');
        setReviewPrompt(strategy.data?.defaultAuditAgentPromptReviewEdit || '');
    }, [strategy.data]);

    const loadConversation = useCallback(async id => {
        const target = String(id || '').trim();
        if (!target) return;
        setConvLoading(true);
        setConvError(null);
        try {
            const data = await api.get(`/hitl/config/${encodeURIComponent(target)}`);
            setConvData(data);
        } catch (error) {
            setConvData(null);
            setConvError(error);
        } finally {
            setConvLoading(false);
        }
    }, []);

    useEffect(() => {
        if (initialConversationId) {
            setConvId(initialConversationId);
            loadConversation(initialConversationId);
        }
    }, [initialConversationId, loadConversation]);

    const hitlConfig = convData?.hitl || null;

    return (
        <div className="hitl-strategy-panel">
            <SectionCard
                title={t('hitl.strategyLabel', null, 'Audit strategy (prompt)')}
                description={t('ui.hitlStrategy.globalDescription', null, 'Applies to the global default configuration. Conversation-level settings in the chat sidebar override these choices.')}
                extra={(
                    <Space spacing={8}>
                        <Button size="small" icon={<IconRefresh />} theme="borderless" onClick={() => config.reload()} loading={config.loading}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button size="small" disabled={!canWrite} loading={savingConfig} onClick={saveConfig}>
                            {t('common.save', null, 'Save')}
                        </Button>
                    </Space>
                )}
            >
                <ErrorBanner error={config.error} onRetry={() => config.reload()} />
                <div className="hitl-strategy-form">
                    <label className="hitl-field">
                        <span className="hitl-field-label">{t('ui.hitlStrategy.defaultMode', null, 'Default mode')}</span>
                        <Select
                            value={mode}
                            style={{ width: 220 }}
                            disabled={!canWrite}
                            optionList={HITL_MODES.map(item => ({ value: item.value, label: item.label }))}
                            onChange={value => setMode(value)}
                        />
                        <Text type="tertiary" size="small">
                            {HITL_MODES.find(item => item.value === mode)?.hint || ''}
                        </Text>
                    </label>
                    <div className="hitl-field hitl-field-wide">
                        <span className="hitl-field-label">{t('ui.hitlStrategy.defaultReviewer', null, 'Default reviewer')}</span>
                        <Space spacing={10} wrap>
                            <RadioGroup
                                value={reviewer}
                                disabled={!canWrite}
                                onChange={event => setReviewer(event.target.value)}
                            >
                                <Radio value="human">{t('ui.hitlStrategy.reviewerHuman', null, 'Human approval')}</Radio>
                                <Radio value="audit_agent">{t('ui.hitlStrategy.reviewerAuditAgent', null, 'Audit Agent')}</Radio>
                            </RadioGroup>
                            <Button size="small" theme="light" disabled={!canWrite} loading={savingReviewer} onClick={saveReviewer}>
                                {t('ui.hitlStrategy.saveReviewer', null, 'Save reviewer')}
                            </Button>
                        </Space>
                        <Text type="tertiary" size="small">{t('ui.hitlStrategy.currentReviewer', { reviewer: reviewerLabel(reviewer) }, 'Current: {{reviewer}} (PUT /hitl/default-reviewer)')}</Text>
                    </div>
                    <label className="hitl-field">
                        <span className="hitl-field-label">{t('ui.hitlStrategy.timeoutLabel', null, 'Approval timeout (seconds, 0 = wait indefinitely)')}</span>
                        <Input
                            value={timeoutText}
                            style={{ width: 160 }}
                            disabled={!canWrite}
                            onChange={value => setTimeoutText(value.replace(/[^\d]/g, ''))}
                        />
                    </label>
                    {engineLabel && (
                        <div className="hitl-field">
                            <span className="hitl-field-label">{t('ui.hitlStrategy.auditEngine', null, 'Audit engine')}</span>
                            <Tag size="small" color="blue">{engineLabel}</Tag>
                        </div>
                    )}
                </div>
                {Array.isArray(config.data?.hitlGlobalToolWhitelist) && (
                    <p className="hitl-strategy-hint">
                        {t('ui.hitlStrategy.globalWhitelistHint', { count: config.data.hitlGlobalToolWhitelist.length }, '{{count}} tools are exempt from approval globally. Manage the allowlist on the "Allowlist" tab.')}
                    </p>
                )}
            </SectionCard>

            <SectionCard
                title={t('ui.hitlStrategy.promptTitle', null, 'Audit Agent prompts')}
                description={t('hitl.strategyHintApproval', null, 'Whitelisted tools skip approval. In approval mode the Audit Agent only approves or rejects.')}
                extra={(
                    <Space spacing={8}>
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={resetPrompts}>
                            {t('hitl.strategyReset', null, 'Reset to default')}
                        </Button>
                        <Button size="small" disabled={!canWrite} loading={savingStrategy} onClick={saveStrategy}>
                            {t('common.save', null, 'Save')}
                        </Button>
                    </Space>
                )}
            >
                <ErrorBanner error={strategy.error} onRetry={() => strategy.reload()} />
                <div className="hitl-prompt-grid">
                    <div className="hitl-prompt-field">
                        <div className="hitl-prompt-head">
                            <Text strong>{t('hitl.strategyTabApproval', null, 'Approval mode')}</Text>
                            {strategy.data?.auditAgentPromptCustom && <Tag size="small" color="amber">{t('ui.hitlStrategy.custom', null, 'Custom')}</Tag>}
                        </div>
                        <TextArea
                            rows={12}
                            value={approvalPrompt}
                            disabled={!canWrite}
                            spellCheck={false}
                            className="hitl-prompt-textarea"
                            onChange={value => setApprovalPrompt(value)}
                        />
                    </div>
                    <div className="hitl-prompt-field">
                        <div className="hitl-prompt-head">
                            <Text strong>{t('hitl.strategyTabReviewEdit', null, 'Review & edit mode')}</Text>
                            {strategy.data?.auditAgentPromptReviewEditCustom && <Tag size="small" color="amber">{t('ui.hitlStrategy.custom', null, 'Custom')}</Tag>}
                        </div>
                        <TextArea
                            rows={12}
                            value={reviewPrompt}
                            disabled={!canWrite}
                            spellCheck={false}
                            className="hitl-prompt-textarea"
                            onChange={value => setReviewPrompt(value)}
                        />
                    </div>
                </div>
                <p className="hitl-strategy-hint">
                    {t('hitl.strategyHintReviewEdit', null, 'In review & edit mode the Audit Agent may narrow parameters via editedArguments before approve; reject if parameters cannot be safely adjusted.')}
                </p>
            </SectionCard>

            <SectionCard
                title={t('ui.hitlStrategy.convQueryTitle', null, 'Conversation configuration lookup')}
                description={t('ui.hitlStrategy.convQueryDescription', { mode: modeLabel(mode), reviewer: reviewerLabel(reviewer) }, 'GET /hitl/config/:conversationId · Current default {{mode}} / {{reviewer}}')}
            >
                <div className="hitl-conv-query">
                    <Input
                        prefix={<IconSearch />}
                        value={convId}
                        style={{ width: 360 }}
                        placeholder={t('ui.hitlStrategy.convQueryPlaceholder', null, 'Enter a conversation ID to look up its HITL configuration')}
                        onChange={value => setConvId(value)}
                        onEnterPress={() => loadConversation(convId)}
                    />
                    <Button size="small" loading={convLoading} onClick={() => loadConversation(convId)}>
                        {t('ui.hitlStrategy.query', null, 'Search')}
                    </Button>
                </div>
                <ErrorBanner error={convError} onRetry={() => loadConversation(convId)} />
                {hitlConfig && (
                    <div className="hitl-conv-result">
                        <KeyValueList
                            columns={2}
                            items={[
                                { label: t('ui.hitlStrategy.fieldConvId', null, 'Conversation ID'), value: <span className="hitl-mono">{convData.conversationId}</span> },
                                { label: t('ui.hitlStrategy.fieldEnabled', null, 'Enabled'), value: hitlConfig.enabled ? t('ui.hitlStrategy.yes', null, 'Yes') : t('ui.hitlStrategy.no', null, 'No') },
                                { label: t('ui.hitlStrategy.fieldMode', null, 'Mode'), value: modeLabel(hitlConfig.mode) },
                                { label: t('ui.hitlStrategy.fieldReviewer', null, 'Reviewer'), value: reviewerLabel(hitlConfig.reviewer) },
                                { label: t('ui.hitlStrategy.fieldTimeout', null, 'Timeout (seconds)'), value: String(hitlConfig.timeoutSeconds ?? 0) },
                                {
                                    label: t('ui.hitlStrategy.fieldConvWhitelist', null, 'Conversation allowlist'),
                                    value: Array.isArray(hitlConfig.sensitiveTools) && hitlConfig.sensitiveTools.length
                                        ? hitlConfig.sensitiveTools.join(', ')
                                        : '—'
                                },
                                { label: t('ui.hitlStrategy.fieldGlobalMode', null, 'Global default mode'), value: modeLabel(convData.defaultMode) },
                                { label: t('ui.hitlStrategy.fieldGlobalReviewer', null, 'Global default reviewer'), value: reviewerLabel(convData.defaultReviewer) }
                            ]}
                        />
                    </div>
                )}
            </SectionCard>
        </div>
    );
}
