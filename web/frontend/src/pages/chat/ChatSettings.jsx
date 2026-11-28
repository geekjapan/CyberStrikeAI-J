import { useEffect, useId, useRef, useState } from 'react';
import { Button, Dropdown, RadioGroup, Select, SideSheet, Slider, Spin, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconBolt, IconChevronRight, IconUndo } from '@douyinfe/semi-icons';
import { useResource } from '../../components/hooks';
import { ErrorBanner, toastError } from '../../components/ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { modelChannelName, modelChannelOptions, selectedModelChannelName } from '../../lib/model-channel';
import { REASONING_EFFORTS, REASONING_MODES, reasoningSummary } from './useModelPreferences';

const { Text } = Typography;
const HITL_MODES = ['off', 'approval', 'review_edit'];
const HITL_TIMEOUTS = [60, 300, 600, 0];
const DEFAULT_HITL_SESSION_TOOL_WHITELIST = 'tool_search, skill, task, write_todos, transfer_to_agent, exit, TaskCreate, TaskGet, TaskUpdate, TaskList, upsert_project_fact, get_project_fact';

function normalizeMode(mode, enabled) {
    if (enabled === false) return 'off';
    return HITL_MODES.includes(mode) ? mode : 'off';
}

function normalizeReviewer(reviewer) {
    return reviewer === 'audit_agent' ? 'audit_agent' : 'human';
}

function normalizeTimeout(value, fallback = 300) {
    if (value === undefined || value === null || value === '') return fallback;
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.max(0, Math.min(86400, Math.round(parsed)));
}

function splitTools(value) {
    const tools = Array.isArray(value) ? value : String(value || '').split(/[,\n\r]+/);
    return tools.map(tool => String(tool || '').trim()).filter(Boolean);
}

function sessionToolsForDisplay(value, globalTools) {
    const global = new Set(splitTools(globalTools).map(tool => tool.toLowerCase()));
    return splitTools(value).filter(tool => !global.has(tool.toLowerCase())).join(', ');
}

function formFromConfig(data, conversationId, draft) {
    if (draft) {
        return {
            mode: normalizeMode(draft.mode, draft.enabled),
            reviewer: normalizeReviewer(draft.reviewer),
            timeoutSeconds: normalizeTimeout(draft.timeoutSeconds),
            sensitiveTools: splitTools(draft.sensitiveTools).join(', ')
        };
    }
    const stored = conversationId ? data?.hitl : null;
    return {
        mode: conversationId
            ? normalizeMode(stored?.mode, stored?.enabled)
            : normalizeMode(data?.defaultMode),
        reviewer: normalizeReviewer(conversationId ? stored?.reviewer : data?.defaultReviewer),
        timeoutSeconds: normalizeTimeout(conversationId
            ? stored?.timeoutSeconds ?? data?.defaultTimeoutSeconds
            : data?.defaultTimeoutSeconds),
        sensitiveTools: conversationId
            ? sessionToolsForDisplay(stored?.sensitiveTools, data?.hitlGlobalToolWhitelist)
            : DEFAULT_HITL_SESSION_TOOL_WHITELIST
    };
}

function requestFromForm(form) {
    return {
        enabled: form.mode !== 'off',
        mode: form.mode,
        reviewer: form.reviewer,
        sensitiveTools: splitTools(form.sensitiveTools),
        timeoutSeconds: form.timeoutSeconds
    };
}

function SettingSelect({ label, ...props }) {
    const id = useId();
    return (
        <div className="chat-setting-field">
            <Text id={id} strong>{label}</Text>
            <Select aria-labelledby={id} {...props} />
        </div>
    );
}

export function ModelSettings({ model, busy, canReadConfig }) {
    const t = useT();
    const channelLabelId = useId();
    const pickerRef = useRef(null);
    const defaultId = model.config.data?.default_channel;
    const defaultName = defaultId ? modelChannelName(defaultId, model.config.data?.channels?.[defaultId]) : '';
    const defaultLabel = t('chat.aiChannelDefault', null, 'Use default channel');
    const channelOptions = [
        { value: '', label: defaultName ? `${defaultLabel} · ${defaultName}` : defaultLabel },
        ...modelChannelOptions(model.channels)
    ];
    const reasoningLabels = Object.fromEntries(REASONING_MODES.map(mode => [mode, reasoningSummary(t, mode, '')]));
    const reasoningDisabled = busy || model.overrideBlocked;
    const levels = ['', ...REASONING_EFFORTS];
    const marks = Object.fromEntries(levels.map((effort, index) => [
        index, reasoningSummary(t, effort ? 'on' : 'default', effort)
    ]));
    const resetReasoning = () => {
        model.setMode('default');
        model.setEffort('');
    };
    return (
        <div className={`chat-reasoning-picker${!model.overrideBlocked && model.mode !== 'off' && model.effort === 'max' ? ' is-max' : ''}${reasoningDisabled ? ' is-disabled' : ''}`} ref={pickerRef}>
            <div className="chat-reasoning-heading">
                <Dropdown
                    trigger="click"
                    position="bottomLeft"
                    className="chat-reasoning-mode-menu"
                    getPopupContainer={() => pickerRef.current}
                    showTick
                    menu={REASONING_MODES.map(mode => ({
                        node: 'item',
                        name: reasoningLabels[mode],
                        active: model.mode === mode,
                        disabled: reasoningDisabled,
                        onClick: () => mode === 'default' ? resetReasoning() : model.setMode(mode)
                    }))}
                >
                    <Button
                        theme="borderless"
                        type="tertiary"
                        icon={<IconBolt />}
                        className="chat-reasoning-mode"
                        aria-label={t('chat.reasoningModeLabel', null, 'Model reasoning')}
                        title={`${t('chat.reasoningModeLabel', null, 'Model reasoning')} · ${reasoningLabels[model.overrideBlocked ? 'default' : model.mode]}`}
                        disabled={reasoningDisabled}
                    />
                </Dropdown>
                <Text strong className="chat-reasoning-value" role="status">
                    {model.overrideBlocked ? reasoningLabels.default : reasoningSummary(t, model.mode, model.effort)}
                </Text>
                <Button
                    theme="borderless"
                    type="tertiary"
                    icon={<IconUndo />}
                    aria-label={t('chat.reasoningReset', null, 'Reset reasoning settings')}
                    title={t('chat.reasoningReset', null, 'Reset reasoning settings')}
                    disabled={reasoningDisabled}
                    onClick={resetReasoning}
                />
            </div>
            {canReadConfig ? (
                <>
                    <span id={channelLabelId} hidden>{t('chat.aiChannelLabel', null, 'AI channel')}</span>
                    <Select
                        className="chat-reasoning-channel"
                        aria-labelledby={channelLabelId}
                        value={model.channel}
                        optionList={channelOptions}
                        renderSelectedItem={option => option.value === ''
                            ? defaultName || t('chat.aiChannelDefaultShort', null, 'Default channel')
                            : selectedModelChannelName(option)}
                        arrowIcon={<IconChevronRight size="small" />}
                        borderless
                        onSelect={model.setChannel}
                        dropdownMatchSelectWidth={false}
                        dropdownStyle={{ maxWidth: 'calc(100vw - 32px)' }}
                        loading={model.config.loading}
                        disabled={busy || model.config.loading || Boolean(model.config.error)}
                    />
                    <ErrorBanner error={model.config.error} onRetry={() => model.config.reload()} />
                </>
            ) : <Text type="tertiary" className="chat-reasoning-channel-label">{defaultLabel}</Text>}
            <Slider
                className="chat-reasoning-slider"
                aria-label={t('chat.reasoningEffortLabel', null, 'Reasoning effort')}
                min={0}
                max={levels.length - 1}
                step={1}
                marks={marks}
                showMarkLabel={false}
                tipFormatter={value => marks[value]}
                getAriaValueText={value => model.mode === 'off' && !model.overrideBlocked ? reasoningLabels.off : marks[value]}
                value={model.overrideBlocked ? 0 : levels.indexOf(model.effort)}
                disabled={reasoningDisabled || model.mode === 'off'}
                onChange={value => {
                    model.setEffort(levels[value]);
                    model.setMode(value === 0 ? 'default' : model.mode === 'auto' ? 'auto' : 'on');
                }}
            />
            {model.overrideBlocked && (
                <Text type="tertiary" size="small" className="chat-reasoning-hint">
                    {t('chat.reasoningOverrideBlocked', null, 'This channel uses the reasoning effort from system settings.')}
                </Text>
            )}
        </div>
    );
}

export default function ChatSettings({
    onClose, narrow, canEnableHitl, conversationId, draftHitl, onDraftHitlChange
}) {
    const t = useT();
    const title = t('chat.hitlTitle', null, 'Human-in-the-loop');
    const [saving, setSaving] = useState(false);
    const [saved, setSaved] = useState(false);
    const [form, setForm] = useState(null);
    const [toolsDirty, setToolsDirty] = useState(false);
    const saveSequence = useRef(0);
    const draftRef = useRef(draftHitl);
    const reviewerId = useId();
    const toolsId = useId();
    draftRef.current = draftHitl;

    const approvals = useResource(
        () => api.get(conversationId ? `/hitl/config/${encodeURIComponent(conversationId)}` : '/hitl/default-config'),
        [conversationId]
    );

    useEffect(() => {
        if (!approvals.data) return;
        setForm(formFromConfig(approvals.data, conversationId, draftRef.current));
        setToolsDirty(false);
    }, [approvals.data, conversationId]);

    const modeLabels = {
        off: t('chat.hitlModeOff', null, 'Off'),
        approval: t('chat.hitlModeApproval', null, 'Approval'),
        review_edit: t('chat.hitlModeReviewEdit', null, 'Review & Edit')
    };
    const timeoutLabels = {
        60: t('chat.hitlTimeoutOneMinute', null, '1 minute'),
        300: t('chat.hitlTimeoutFiveMinutes', null, '5 minutes'),
        600: t('chat.hitlTimeoutTenMinutes', null, '10 minutes'),
        0: t('chat.hitlTimeoutUnlimited', null, 'No limit')
    };
    const timeoutOptions = HITL_TIMEOUTS.map(value => ({ value, label: timeoutLabels[value] }));
    if (form && !HITL_TIMEOUTS.includes(form.timeoutSeconds)) {
        timeoutOptions.unshift({ value: form.timeoutSeconds, label: `${form.timeoutSeconds}s` });
    }
    const hitlDisabled = !canEnableHitl || saving;

    const persist = async next => {
        const sequence = ++saveSequence.current;
        const hitl = requestFromForm(next);
        setSaving(true);
        setSaved(false);
        try {
            await api.put('/hitl/config', { conversationId, ...hitl });
            if (sequence !== saveSequence.current) return;
            approvals.setData(current => ({ ...current, hitl }));
            setSaved(true);
        } catch (error) {
            if (sequence === saveSequence.current) {
                toastError(error, t('chat.hitlApplyFail', null, 'Failed to sync to server'));
                approvals.reload({ silent: true });
            }
        } finally {
            if (sequence === saveSequence.current) setSaving(false);
        }
    };

    const updateConfig = patch => {
        const next = { ...form, ...patch };
        setForm(next);
        setToolsDirty(false);
        setSaved(false);
        if (conversationId) {
            void persist(next);
        } else {
            onDraftHitlChange(requestFromForm(next));
        }
    };

    const updateTools = value => {
        const next = { ...form, sensitiveTools: value };
        setForm(next);
        setToolsDirty(true);
        setSaved(false);
        if (!conversationId) onDraftHitlChange(requestFromForm(next));
    };

    const saveTools = () => {
        if (!toolsDirty || !conversationId || hitlDisabled) return;
        setToolsDirty(false);
        void persist(form);
    };

    return (
        <SideSheet
            visible
            title={title}
            aria-label={title}
            width={narrow ? '100%' : 420}
            closable={!saving}
            maskClosable={!saving}
            closeOnEsc={!saving}
            onCancel={onClose}
        >
            <div className="chat-settings-fields">
                <section className="chat-setting-field chat-setting-hitl">
                    <Text type="tertiary" size="small">
                        {t('chat.sessionSettingsHint', null, 'Human-in-the-loop settings only affect future messages.')}
                    </Text>
                    {(saving || saved) && (
                        <Text type="tertiary" size="small" role="status">
                            {saving
                                ? t('chat.systemModelSaving', null, 'Saving…')
                                : t('chat.hitlApplyOkSync', null, 'HITL settings saved and synced to the server.')}
                        </Text>
                    )}
                    <ErrorBanner error={approvals.error} onRetry={() => approvals.reload()} />
                    {approvals.loading && <Spin />}
                    {form && approvals.data && !approvals.error && (
                        <>
                            <SettingSelect
                                label={t('chat.hitlModeLabel', null, 'Mode')}
                                value={form.mode}
                                optionList={HITL_MODES.map(value => ({ value, label: modeLabels[value] }))}
                                onSelect={value => updateConfig({ mode: value })}
                                disabled={hitlDisabled}
                            />
                            <div className="chat-setting-field">
                                <Text id={reviewerId} strong>{t('chat.hitlReviewerLabel', null, 'Reviewer')}</Text>
                                <RadioGroup
                                    aria-labelledby={reviewerId}
                                    type="button"
                                    className="chat-setting-reviewer"
                                    value={form.reviewer}
                                    options={[
                                        { value: 'human', label: t('chat.hitlReviewerHuman', null, 'Human approval') },
                                        { value: 'audit_agent', label: t('chat.hitlReviewerAgent', null, 'Audit Agent') }
                                    ]}
                                    onChange={event => updateConfig({ reviewer: event.target.value })}
                                    disabled={hitlDisabled}
                                />
                                <Text type="tertiary" size="small">
                                    {t('chat.hitlReviewerHint', null, 'Switch between human and Audit Agent anytime; rules and whitelist stay the same. You can pre-select even when HITL is off.')}
                                </Text>
                            </div>
                            <SettingSelect
                                label={t('chat.hitlTimeoutLabel', null, 'Approval wait limit')}
                                value={form.timeoutSeconds}
                                optionList={timeoutOptions}
                                onSelect={value => updateConfig({ timeoutSeconds: Number(value) })}
                                disabled={hitlDisabled}
                            />
                            <div className="chat-setting-field">
                                <Text id={toolsId} strong>
                                    {t('chat.hitlWhitelistTools', null, 'Whitelisted tools (skip approval, comma-separated)')}
                                </Text>
                                <TextArea
                                    aria-labelledby={toolsId}
                                    value={form.sensitiveTools}
                                    placeholder={t('chat.hitlWhitelistPlaceholder', null, 'e.g. read_file, grep or one tool per line (merged with global allowlist in config)')}
                                    rows={5}
                                    disabled={hitlDisabled}
                                    onChange={updateTools}
                                    onBlur={saveTools}
                                />
                                <Text type="tertiary" size="small">
                                    {t('chat.hitlWhitelistHint', null, 'Separate with commas or new lines; shown merged with the global allowlist in config.')}
                                </Text>
                            </div>
                        </>
                    )}
                </section>
            </div>
        </SideSheet>
    );
}
