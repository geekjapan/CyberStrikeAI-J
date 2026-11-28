/**
 * Call interception (tool-guard): GET /tool-guard (ETag version) reads rules, PUT /tool-guard saves,
 * POST /tool-guard/test tries a match. Saving must carry If-Match; 409 means someone else changed it and a reload is needed.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Button, Collapse, Space, Switch, Tag, Typography
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconTick } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import {
    ErrorBanner, PageHeader, SectionCard, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import RuleCard from './RuleCard';
import TestPanel from './TestPanel';
import {
    MAX_RULES, clone, isDirty, newRuleId, normalizeConfig, requestConfig, validateRules
} from './utils';
import './page.css';

const { Text } = Typography;

export default function ToolGuardPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('config:read');
    const canWrite = hasPermission('config:write');

    const [config, setConfig] = useState(null);
    const [saved, setSaved] = useState(null);
    const [etag, setEtag] = useState('');
    const [loading, setLoading] = useState(canRead);
    const [loadError, setLoadError] = useState(null);
    const [actionError, setActionError] = useState(null);
    const [saving, setSaving] = useState(false);
    const [conflict, setConflict] = useState(false);
    const [openIds, setOpenIds] = useState([]);

    const load = useCallback(async () => {
        if (!canRead) return;
        setLoading(true);
        setLoadError(null);
        setConflict(false);
        try {
            const response = await api.raw('/tool-guard');
            const nextEtag = response.headers.get('ETag') || '';
            const payload = await response.json();
            const normalized = normalizeConfig(payload);
            setConfig(normalized);
            setSaved(clone(normalized));
            setEtag(nextEtag);
        } catch (error) {
            setLoadError(error);
        } finally {
            setLoading(false);
        }
    }, [canRead]);

    useEffect(() => { load(); }, [load]);

    const dirty = useMemo(() => isDirty(config, saved), [config, saved]);
    const ruleCount = config?.rules?.length || 0;
    const enabledCount = config?.rules?.filter(rule => rule.enabled).length || 0;

    const reloadSafely = () => {
        if (!dirty) { load(); return; }
        confirmAction({
            title: t('toolGuard.reloadTitle', null, 'Reload guard configuration'),
            content: t('toolGuard.reloadConfirm', null, 'There are unsaved changes; reloading discards them. Continue?'),
            okText: t('common.confirm', null, 'Confirm'),
            onOk: load
        });
    };

    const updateRule = (index, patch) => {
        if (!canWrite) return;
        setConfig(current => ({
            ...current,
            rules: current.rules.map((rule, currentIndex) => (currentIndex === index ? { ...rule, ...patch } : rule))
        }));
        setActionError(null);
    };

    const addRule = () => {
        if (!canWrite || !config) return;
        if (config.rules.length >= MAX_RULES) {
            toastError(t('toolGuard.tooManyRules', null, 'You can configure up to 100 blocking rules.'));
            return;
        }
        const id = newRuleId();
        setConfig(current => ({
            ...current,
            rules: [
                ...current.rules,
                {
                    id,
                    name: '',
                    enabled: true,
                    pattern: '',
                    message: t('toolGuard.defaultMessage', null, 'Detected {match}. Rule “{rule}” blocked this call. Review the target and operation before trying again.')
                }
            ]
        }));
        setOpenIds(current => [...current, id]);
        setActionError(null);
    };

    const deleteRule = index => {
        if (!canWrite || !config) return;
        setConfig(current => ({ ...current, rules: current.rules.filter((_, i) => i !== index) }));
        setActionError(null);
    };

    const moveRule = (index, delta) => {
        if (!canWrite || !config) return;
        const target = index + delta;
        if (target < 0 || target >= config.rules.length) return;
        setConfig(current => {
            const rules = [...current.rules];
            const [item] = rules.splice(index, 1);
            rules.splice(target, 0, item);
            return { ...current, rules };
        });
        setActionError(null);
    };

    const save = async () => {
        if (!canWrite || !config || !dirty) return;
        const invalid = validateRules(config);
        if (invalid) {
            setActionError(new Error(invalid.message));
            if (invalid.index >= 0) {
                const rule = config.rules[invalid.index];
                if (rule) setOpenIds(current => (current.includes(rule.id) ? current : [...current, rule.id]));
            }
            return;
        }
        if (!etag) {
            setActionError(new Error(t('toolGuard.versionRequired', null, 'The call interception configuration version is missing. Refresh the page and try again.')));
            return;
        }
        setSaving(true);
        setActionError(null);
        setConflict(false);
        try {
            const response = await api.raw('/tool-guard', {
                method: 'PUT',
                body: requestConfig(config),
                headers: { 'If-Match': etag }
            });
            const nextEtag = response.headers.get('ETag') || etag;
            const payload = await response.json();
            const normalized = normalizeConfig(payload);
            setConfig(normalized);
            setSaved(clone(normalized));
            setEtag(nextEtag);
            toastSuccess(t('toolGuard.saveSuccess', null, 'Call blocking configuration saved. Subsequent tool calls will use the new configuration.'));
        } catch (error) {
            const code = error?.payload?.code;
            if (code === 'tool_guard_conflict' || code === 'tool_guard_version_required') {
                setConflict(true);
                setActionError(new Error(error.message));
            } else {
                setActionError(error);
            }
            toastError(error, t('toolGuard.saveFailed', null, 'Save failed'));
        } finally {
            setSaving(false);
        }
    };

    const reset = () => {
        if (!canWrite || !saved) return;
        setConfig(clone(saved));
        setActionError(null);
        setConflict(false);
    };

    if (!canRead) {
        return (
            <div className="tool-guard-page">
                <PageHeader title={t('toolGuard.title', null, 'Call blocking')} />
                <ErrorBanner error={new Error(t('toolGuard.noPermission', null, 'The current account lacks the config:read permission and cannot read the guard configuration.'))} />
            </div>
        );
    }

    return (
        <div className="tool-guard-page">
            <PageHeader
                title={t('toolGuard.title', null, 'Call blocking')}
                description={t('toolGuard.description', null, 'Check MCP tool names and arguments before execution and stop matching calls. Human-in-the-loop approvals and tool whitelists do not bypass these checks.')}
                extra={(
                    <Space>
                        <Tag size="small" color={dirty ? 'amber' : 'green'}>
                            {saving
                                ? t('toolGuard.loading', null, 'Processing…')
                                : dirty
                                    ? t('toolGuard.unsaved', null, 'Unsaved changes')
                                    : t('toolGuard.savedState', null, 'Synced with server')}
                        </Tag>
                        <Button onClick={reset} disabled={!canWrite || !dirty || saving}>
                            {t('toolGuard.reset', null, 'Discard changes')}
                        </Button>
                        <Button icon={<IconRefresh />} onClick={reloadSafely} loading={loading} disabled={saving}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button
                            theme="solid"
                            type="primary"
                            icon={<IconTick />}
                            loading={saving}
                            disabled={!canWrite || !dirty}
                            onClick={save}
                        >
                            {t('toolGuard.save', null, 'Save and apply')}
                        </Button>
                    </Space>
                )}
            />

            {loading && !config && <SectionCard title={t('toolGuard.loading', null, 'Processing…')}><Text type="tertiary">…</Text></SectionCard>}
            <ErrorBanner error={loadError} onRetry={load} />
            <ErrorBanner error={actionError} onRetry={conflict ? reloadSafely : undefined} />

            {config && (
                <>
                    <SectionCard
                        title={t('toolGuard.policyTitle', null, 'Blocking policy')}
                        description={t('toolGuard.enableHint', null, 'Checks for risks before tool execution. Save to apply changes.')}
                    >
                        <div className="tool-guard-policy">
                            <Space spacing={10} align="center">
                                <Switch
                                    checked={config.enabled}
                                    disabled={!canWrite || saving}
                                    onChange={next => { setConfig(current => ({ ...current, enabled: next })); setActionError(null); }}
                                    aria-label={t('toolGuard.enabled', null, 'Enable call blocking')}
                                />
                                <Text strong>{t('toolGuard.enabled', null, 'Enable call blocking')}</Text>
                                <Tag size="small" color={config.enabled ? 'green' : 'grey'}>
                                    {config.enabled
                                        ? t('toolGuard.protectionOn', null, 'Call blocking is on')
                                        : t('toolGuard.protectionOff', null, 'Call blocking is off')}
                                </Tag>
                                <Tag size="small" color="blue">
                                    {t('toolGuard.ruleCount', { enabled: enabledCount, total: ruleCount }, '{{enabled}} of {{total}} rules enabled')}
                                </Tag>
                            </Space>
                            <Text type="tertiary" size="small">{t('toolGuard.scopeHint', null, 'Rules inspect visible call text only. They do not resolve IP ownership, redirect destinations, or file contents read by tools. Domain rules cannot cover every indirect access.')}</Text>
                        </div>
                    </SectionCard>

                    <SectionCard
                        title={t('toolGuard.rulesTitle', null, 'Blocking rules')}
                        description={t('toolGuard.rulesHint', null, 'Enabled rules are checked in order; the first match supplies the blocking message. Patterns use RE2 syntax and are validated by the server when saved or tested.')}
                        extra={(
                            <Button
                                icon={<IconPlus />}
                                disabled={!canWrite || saving || ruleCount >= MAX_RULES}
                                onClick={addRule}
                            >
                                {t('toolGuard.addRule', null, 'Add rule')}
                            </Button>
                        )}
                    >
                        {ruleCount === 0 && (
                            <Text type="tertiary">{t('toolGuard.emptyRules', null, 'No rules yet. Add and save a rule to enable its checks.')}</Text>
                        )}
                        {ruleCount > 0 && (
                            <Collapse
                                activeKey={openIds}
                                onChange={keys => setOpenIds([].concat(keys))}
                                keepDOM={false}
                            >
                                {config.rules.map((rule, index) => (
                                    <Collapse.Panel
                                        key={rule.id}
                                        itemKey={rule.id}
                                        header={(
                                            <Space spacing={8} align="center">
                                                <span className="tool-guard-rule-number">{String(index + 1).padStart(2, '0')}</span>
                                                <Text strong>{rule.name.trim() || t('toolGuard.unnamedRule', null, 'Untitled rule')}</Text>
                                                <Tag size="small" color={rule.enabled ? 'green' : 'grey'}>
                                                    {rule.enabled ? t('toolGuard.ruleOn', null, 'Enabled') : t('toolGuard.ruleOff', null, 'Disabled')}
                                                </Tag>
                                                {(() => {
                                                    const savedRule = saved?.rules?.find(item => item.id === rule.id);
                                                    if (!savedRule) return <Tag size="small" color="blue">{t('toolGuard.ruleNew', null, 'New')}</Tag>;
                                                    if (JSON.stringify(savedRule) !== JSON.stringify(rule)) {
                                                        return <Tag size="small" color="amber">{t('toolGuard.ruleModified', null, 'Modified')}</Tag>;
                                                    }
                                                    return null;
                                                })()}
                                            </Space>
                                        )}
                                    >
                                        <RuleCard
                                            rule={rule}
                                            index={index}
                                            total={ruleCount}
                                            canWrite={canWrite && !saving}
                                            canTest={!saving}
                                            onChange={patch => updateRule(index, patch)}
                                            onDelete={() => deleteRule(index)}
                                            onMove={delta => moveRule(index, delta)}
                                        />
                                    </Collapse.Panel>
                                ))}
                            </Collapse>
                        )}
                        <Text type="tertiary" size="small">{t('toolGuard.listHint', null, 'Select a rule to view or edit. Rules are checked in list order.')}</Text>
                    </SectionCard>

                    <SectionCard
                        title={t('toolGuard.testTitle', null, 'Test all rules')}
                        description={t('toolGuard.testHint', null, 'Check the current page configuration, including unsaved changes. This test does not execute any tools.')}
                    >
                        <TestPanel config={config} disabled={saving} />
                    </SectionCard>
                </>
            )}
        </div>
    );
}
