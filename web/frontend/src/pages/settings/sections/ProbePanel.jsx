/**
 * Edit the selected model channel, and test the connection or probe model capabilities with the values in the form.
 */
import { useEffect, useId, useState } from 'react';
import { Banner, Button, Collapse, Input, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { api } from '../../../lib/http';
import { useT } from '../../../lib/i18n';
import { modelChannelOptions, selectedModelChannelName } from '../../../lib/model-channel';
import { ErrorBanner, KeyValueList, SectionCard, toastSuccess } from '../../../components/ui';
import { Hint } from './common';

const { Text } = Typography;

const MAIN_CHANNEL = '__main__';
const NO_CHANNELS = {};
const DEFAULT_FORM_CONTEXT_WINDOW = 1048576;
const PROVIDERS = [
    { value: 'openai_compatible', key: 'settingsProbe.compatible', fallback: 'OpenAI-compatible API' },
    { value: 'claude', key: 'settingsBasic.providerClaude', fallback: 'Claude（Anthropic Messages）' }
];
const CONTEXT_PROFILES = ['', 'auto', 'local_auto', 'local', 'economy', 'custom'];
const TOKEN_LIMITS = [
    ['context_window', 'settingsBasic.contextWindow', 'Model Context Window (tokens)'],
    ['max_total_tokens', 'settingsBasic.maxTotalTokens', 'Max Context Tokens'],
    ['max_completion_tokens', 'settingsBasic.maxCompletionTokens', 'Max Output Tokens']
];
const EMPTY_PROBE = { key: '', payload: null, error: null };
const CONTEXT_WARNING_KEYS = {
    context_window_unknown: 'contextWarnUnknown',
    context_runtime_unknown: 'contextWarnRuntimeUnknown',
    local_context_window_unknown: 'contextWarnWindowUnknown',
    local_context_window_small: 'contextWarnWindowSmall',
    max_total_tokens_clamped: 'contextWarnBudgetClamped',
    max_completion_tokens_clamped: 'contextWarnCompletionClamped',
    configured_budget_exceeds_context_window: 'contextWarnBudgetExceedsWindow',
    ollama_v1_ignores_num_ctx: 'contextWarnOllamaV1',
    ollama_runtime_context_unknown: 'contextWarnOllamaRuntime',
    llamacpp_parallel_slots: 'contextWarnLlamaCppSlots'
};
const BACKEND_NAMES = { ollama: 'Ollama', llamacpp: 'llama.cpp', lmstudio: 'LM Studio', omlx: 'oMLX', vllm: 'vLLM' };

function profileLabel(t, value) {
    return t('settingsProbe.profiles.' + (value || 'default'), null, value || 'Use defaults');
}

function numberValue(raw) {
    const value = Number(raw);
    return Number.isSafeInteger(value) && value >= 0 ? value : 0;
}

function channelValues(channel) {
    let provider = channel.provider || 'openai_compatible';
    if (provider === 'openai') provider = 'openai_compatible';
    if (provider === 'anthropic') provider = 'claude';
    return {
        name: channel.name || '',
        provider,
        base_url: channel.base_url || '',
        api_key: channel.api_key || '',
        model: channel.model || '',
        image_input: channel.image_input || '',
        context_profile: channel.context_profile || '',
        context_window: channel.context_window > 0 ? String(channel.context_window) : '',
        max_total_tokens: channel.max_total_tokens || 0,
        max_completion_tokens: channel.max_completion_tokens || 0,
        headers: channel.headers || undefined
    };
}

function summarizeTest(t, payload) {
    return [
        { label: t('settingsProbe.result', null, 'Test result'), value: <Tag color="green">{t('settingsBasic.testSuccess', null, 'Connection successful')}</Tag> },
        { label: t('settingsBasic.model', null, 'Model'), value: payload.model || '—' },
        {
            label: t('settingsProbe.latency', null, 'Response latency'),
            value: payload.latency_ms != null
                ? t('settingsProbe.milliseconds', { value: payload.latency_ms }, '{{value}} ms')
                : '—'
        }
    ];
}

function summarizeContext(t, payload, fallbackWindow) {
    const source = payload.context_source;
    const sourceKey = source?.replace(/^omlx_models_(?=max_model_len|context_length|max_context_length|context_window)/, 'openai_models_');
    const backend = payload.context_backend;
    return [
        ...summarizeTest(t, payload),
        { label: t('settingsProbe.window', null, 'Context window'), value: payload.context_window || fallbackWindow || '—' },
        {
            label: t('settingsProbe.backend', null, 'Model API type'),
            value: backend === 'openai_compatible'
                ? t('settingsProbe.compatible', null, 'OpenAI-compatible API')
                : BACKEND_NAMES[backend] || backend || '—'
        },
        {
            label: t('settingsProbe.source', null, 'Context window source'),
            value: fallbackWindow ? t('settingsProbe.windowDefault', null, 'Default') : (source ? t('settingsProbe.sources.' + sourceKey, null, source) : '—')
        },
        { label: t('settingsProbe.profile', null, 'Context profile'), value: profileLabel(t, payload.context_profile) },
        { label: t('settingsProbe.effectiveBudget', null, 'Effective context token budget'), value: payload.effective_max_total_tokens ?? '—' }
    ];
}

function ProbeOutput({ state, defaultWindow, model, onModelChange, disabled }) {
    const t = useT();
    const pickerLabelId = useId();
    const { key, payload, error } = state;
    if (error) return <ErrorBanner error={error} />;
    if (!payload) return null;

    if (key === 'list') {
        if (!payload.success) {
            return (
                <Banner
                    type={payload.supported === false ? 'info' : 'danger'}
                    bordered
                    closeIcon={null}
                    description={payload.error || t('settingsBasic.modelsListFailed', null, 'Failed to fetch model list')}
                />
            );
        }
        const models = Array.isArray(payload.models) ? payload.models : [];
        const selectLabel = t('settingsBasic.modelsListSelectPlaceholder', null, 'Select a model');
        return (
            <div className="settings-probe-result">
                <Space wrap spacing={8}>
                    <Text>{t('settingsBasic.modelsListSuccess', { count: payload.count ?? models.length }, 'Retrieved {{count}} models')}</Text>
                    <span id={pickerLabelId} hidden>{selectLabel}</span>
                    {models.length > 0 && (
                        <Select
                            filter
                            aria-labelledby={pickerLabelId}
                            placeholder={selectLabel}
                            value={models.includes(model) ? model : undefined}
                            optionList={models.map(id => ({ value: id, label: id }))}
                            onChange={onModelChange}
                            disabled={disabled}
                            className="settings-model-picker"
                        />
                    )}
                </Space>
            </div>
        );
    }

    if (key === 'audit' || key === 'image') {
        return (
            <div className="settings-probe-result">
                {payload.success ? (
                    <KeyValueList
                        columns={3}
                        items={summarizeTest(t, payload).map((item, index) => key === 'image' && index === 0
                            ? { ...item, value: <Tag color="green">{t('settingsProbe.imageReadSuccess', null, 'Image read successfully')}</Tag> }
                            : item)}
                    />
                ) : (
                    <Banner type="danger" bordered closeIcon={null} description={payload.error || t('settingsBasic.testFailed', null, 'Connection failed')} />
                )}
            </div>
        );
    }

    if (!payload.success) {
        return <Banner type="danger" bordered closeIcon={null} description={payload.error || t('settingsBasic.testFailed', null, 'Connection failed')} />;
    }
    const fallbackWindow = !payload.context_window && !payload.context_runtime_unknown ? defaultWindow : 0;
    const warnings = (Array.isArray(payload.context_warnings) ? payload.context_warnings : [])
        .filter(code => !fallbackWindow || code !== 'context_window_unknown');
    return (
        <div className="settings-probe-result">
            <KeyValueList columns={3} items={summarizeContext(t, payload, fallbackWindow)} />
            {warnings.length > 0 && (
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    description={(
                        <div>
                            <Text strong>{t('settingsProbe.warnings', null, 'Context notices')}</Text>
                            <ul>
                                {[...new Set(warnings)].map(code => (
                                    <li key={code}>
                                        {Object.hasOwn(CONTEXT_WARNING_KEYS, code)
                                            ? t('settingsBasic.' + CONTEXT_WARNING_KEYS[code], null, code)
                                            : t('settingsProbe.unknownWarning', { code }, 'Unrecognized context notice ({{code}})')}
                                    </li>
                                ))}
                            </ul>
                        </div>
                    )}
                />
            )}
        </div>
    );
}

export default function ProbePanel({ config, canWrite, reloadConfig }) {
    const t = useT();
    const channelLabelId = useId();
    const channels = config.ai?.channels || NO_CHANNELS;
    const channelIds = Object.keys(channels);
    const defaultId = config.ai?.default_channel;
    const [selectedId, setSelectedId] = useState('');
    const channelId = [selectedId, defaultId].find(id => Object.hasOwn(channels, id)) || channelIds[0] || MAIN_CHANNEL;
    const legacy = channelId === MAIN_CHANNEL;
    const baseline = channelValues((legacy ? config.openai : channels[channelId]) || {});
    const [drafts, setDrafts] = useState({});
    const draft = drafts[channelId] || {};
    const form = { ...baseline, ...draft };
    const [listedDefaults, setListedDefaults] = useState(null);
    const listedModel = listedDefaults && Object.hasOwn(listedDefaults, form.model) ? listedDefaults[form.model] : undefined;
    const sameModelEndpoint = ['model', 'base_url', 'provider'].every(field => form[field] === baseline[field]);
    const imageMode = draft.image_input ?? (sameModelEndpoint ? baseline.image_input : '');
    const imageDefault = sameModelEndpoint ? config.image_input_defaults?.[legacy ? '' : channelId] : listedModel?.image_input;
    const imageEnabled = imageMode === 'enabled' || (imageMode !== 'disabled' && imageDefault === true);
    const defaultWindow = sameModelEndpoint && form.context_profile === baseline.context_profile
        ? config.context_window_defaults?.[legacy ? '' : channelId]
        : listedModel?.context_window;
    const needsDefaultWindow = Boolean(form.model.trim()) && !form.context_window;
    const useDefaultWindow = needsDefaultWindow && !Object.hasOwn(draft, 'context_window');
    const matchesServerDefault = defaultWindow === DEFAULT_FORM_CONTEXT_WINDOW;
    const dirty = Object.keys(draft).length > 0;
    const [busy, setBusy] = useState('');
    const [state, setState] = useState(EMPTY_PROBE);
    const [saving, setSaving] = useState(false);
    const [saveError, setSaveError] = useState(null);
    const [applyPending, setApplyPending] = useState(false);
    const locked = !canWrite || saving || busy === 'image' || busy === 'list';
    const channelOptions = legacy
        ? [{ value: MAIN_CHANNEL, label: t('settingsProbe.mainChannel', null, 'Primary model channel') }]
        : modelChannelOptions(Object.entries(channels));
    const providerOptions = PROVIDERS.map(({ value, key, fallback }) => ({ value, label: t(key, null, fallback) }));
    if (!providerOptions.some(option => option.value === form.provider)) {
        providerOptions.push({ value: form.provider, label: form.provider });
    }

    const clearDraft = () => {
        setDrafts(current => {
            const next = { ...current };
            delete next[channelId];
            return next;
        });
    };
    const update = (key, value) => {
        const listChanged = ['provider', 'base_url', 'api_key', 'context_profile'].includes(key);
        if (listChanged) setListedDefaults(null);
        if (state.key !== 'list' || !state.payload?.success || listChanged) {
            setState(EMPTY_PROBE);
        }
        setDrafts(current => {
            const next = { ...current[channelId] };
            const modelFields = ['model', 'base_url', 'provider'];
            if (modelFields.includes(key) && value !== form[key]) delete next.image_input;
            const baselineValue = key === 'image_input' && !sameModelEndpoint ? '' : baseline[key];
            if (value === String(baselineValue)) delete next[key];
            else next[key] = value;
            return { ...current, [channelId]: next };
        });
    };
    const selectChannel = id => {
        setListedDefaults(null);
        setSelectedId(id);
        setState(EMPTY_PROBE);
        if (!applyPending) setSaveError(null);
    };

    const discardDraft = () => {
        setListedDefaults(null);
        clearDraft();
        setState(EMPTY_PROBE);
        if (!applyPending) setSaveError(null);
    };

    const apply = async message => {
        try {
            await api.post('/config/apply');
            setApplyPending(false);
            toastSuccess(message);
        } catch (error) {
            setApplyPending(true);
            setSaveError(error);
        }
    };

    const save = async (makeDefault = false) => {
        if (locked || busy || (!dirty && !makeDefault)) return;
        setSaveError(null);
        const invalidLimit = TOKEN_LIMITS.find(([key]) => !/^\d*$/.test(String(form[key]).trim())
            || !Number.isSafeInteger(Number(form[key])));
        if (invalidLimit) {
            const [, key, fallback] = invalidLimit;
            setSaveError(new Error(t('settingsProbe.invalidLimit', { field: t(key, null, fallback) }, 'Enter a non-negative integer for {{field}}.')));
            return;
        }
        const changes = { ...draft };
        for (const [key] of TOKEN_LIMITS) {
            if (Object.hasOwn(changes, key)) changes[key] = numberValue(form[key]);
        }

        if (dirty && needsDefaultWindow && !matchesServerDefault) {
            changes.context_window = DEFAULT_FORM_CONTEXT_WINDOW;
        }

        setSaving(true);
        try {
            await api.put('/config', { ai_channel: { channel_id: legacy ? '' : channelId, make_default: makeDefault, ...changes } });
            clearDraft();
            await apply(makeDefault
                ? t('settingsBasic.aiChannelDefaultSaved', null, 'Default channel saved')
                : t('settingsBasic.aiChannelSaved', null, 'Channel saved'));
            await reloadConfig({ silent: true });
        } catch (error) {
            setSaveError(error);
        } finally {
            setSaving(false);
        }
    };

    const retryApply = async () => {
        if (locked || !applyPending) return;
        setSaving(true);
        setSaveError(null);
        try {
            await apply(t('settings.apply.applySuccess', null, 'Configuration applied successfully!'));
        } finally {
            setSaving(false);
        }
    };

    const run = async (key, path, body) => {
        if (locked || busy) return;
        setBusy(key);
        if (key === 'list') setListedDefaults(null);
        setState(EMPTY_PROBE);
        try {
            const payload = await api.post(path, body);
            if (key === 'list' && payload.success) setListedDefaults(payload.model_defaults || null);
            const detectedWindow = payload.context_window;
            const fillWindow = key === 'context' || (key === 'test' && ['', '0'].includes(form.context_window.trim()));
            if (fillWindow && payload.success && Number.isSafeInteger(detectedWindow) && detectedWindow > 0
                && !payload.context_runtime_unknown && !(useDefaultWindow && matchesServerDefault && detectedWindow === defaultWindow)) {
                const value = String(detectedWindow);
                setDrafts(current => {
                    const next = { ...current[channelId] };
                    // The response may arrive after the user has changed the model or window.
                    if (['provider', 'base_url', 'api_key', 'model', 'context_window'].some(field => next[field] !== draft[field])) {
                        return current;
                    }
                    if (value === baseline.context_window) delete next.context_window;
                    else next.context_window = value;
                    return { ...current, [channelId]: next };
                });
            }
            setState({ key, payload, error: null });
        } catch (error) {
            setState({ key, payload: null, error });
        } finally {
            setBusy('');
        }
    };

    const probeBody = () => ({
        provider: form.provider,
        channel_id: legacy ? undefined : channelId,
        credential_scope: legacy ? 'openai' : undefined,
        base_url: form.base_url,
        api_key: form.api_key,
        model: form.model,
        headers: form.headers,
        max_total_tokens: numberValue(form.max_total_tokens),
        max_completion_tokens: numberValue(form.max_completion_tokens),
        context_profile: form.context_profile
    });

    // The server selects the configured audit backend and resolves inherited fields.
    const auditModel = config.hitl?.audit_model || {};
    const auditBackend = (config.hitl?.audit_backend || '').trim().toLowerCase();
    const auditTypeSafe = ['typesafe', 'jev', 'type-safe', 'typesafe-ai'].includes(auditBackend);
    const auditProvider = auditModel.provider?.trim() || config.openai?.provider || 'openai';
    const auditClaude = ['claude', 'anthropic'].includes(auditProvider.toLowerCase());
    const auditProtocol = auditTypeSafe ? 'TypeSafe / Jev'
        : auditClaude ? 'Claude (Anthropic Messages)'
            : t('settingsProbe.compatible', null, 'OpenAI-compatible API');
    const auditSource = auditTypeSafe || ['provider', 'base_url', 'api_key', 'model'].some(key => auditModel[key])
        ? auditModel.model || auditProtocol
        : t('settingsProbe.auditInherit', null, 'Inherits primary model');
    const auditURLPlaceholder = auditTypeSafe ? 'https://api.typesafe.ai'
        : config.openai?.base_url || (auditClaude ? 'https://api.anthropic.com' : 'https://api.openai.com/v1');
    const [auditDraft, setAuditDraft] = useState({});
    const auditForm = {
        base_url: auditModel.base_url || '', api_key: auditModel.api_key || '', model: auditModel.model || '',
        ...auditDraft
    };
    const [auditState, setAuditState] = useState(EMPTY_PROBE);
    const [auditBusy, setAuditBusy] = useState(false);
    useEffect(() => {
        setAuditDraft({});
        setAuditState(EMPTY_PROBE);
    }, [auditBackend, auditProvider, auditModel.base_url, auditModel.api_key, auditModel.model]);
    const testAuditModel = async () => {
        if (!canWrite) return;
        setAuditBusy(true);
        setAuditState({ key: 'audit', payload: null, error: null });
        try {
            const payload = await api.post('/config/test-audit-model', auditForm);
            setAuditState({ key: 'audit', payload, error: null });
        } catch (error) {
            setAuditState({ key: 'audit', payload: null, error });
        } finally {
            setAuditBusy(false);
        }
    };

    return (
        <SectionCard
            title={t('settingsProbe.channelTitle', null, 'Model Channels and Connection Tests')}
            description={t('settingsProbe.channelHelp', null, 'Connection tests use the values in the form. Save Channel applies your changes. A key shown as ******** uses the saved credential.')}
            className="settings-channel-panel"
            extra={canWrite ? (
                <Space wrap>
                    {dirty && (
                        <Button disabled={saving || !!busy} onClick={discardDraft}>
                            {t('toolGuard.reset', null, 'Discard changes')}
                        </Button>
                    )}
                    {!legacy && channelId !== defaultId && (
                        <Button disabled={saving || !!busy} onClick={() => save(true)}>
                            {t('settingsBasic.aiChannelSetDefault', null, 'Set default')}
                        </Button>
                    )}
                    <Button theme="solid" type="primary" loading={saving} disabled={!dirty || !!busy} onClick={() => save()}>
                        {t('settingsProbe.saveChannel', null, 'Save Channel')}
                    </Button>
                </Space>
            ) : (
                <Tag color="grey" size="small">{t('settingsProbe.channelReadOnly', null, 'Read-only')}</Tag>
            )}
        >
            <div className="settings-probe-form">
                <div className="settings-field">
                    <Text id={channelLabelId} type="tertiary" size="small">{t('settings.checkChannel', null, 'Channel')}</Text>
                    <Select
                        value={channelId}
                        onChange={selectChannel}
                        optionList={channelOptions}
                        renderSelectedItem={selectedModelChannelName}
                        aria-labelledby={channelLabelId}
                        disabled={saving || !!busy}
                        style={{ width: '100%' }}
                    />
                </div>
                <label className="settings-field">
                    <Text type="tertiary" size="small">{t('settingsBasic.apiProvider', null, 'API Provider')}</Text>
                    <Select
                        value={form.provider}
                        onChange={value => update('provider', value)}
                        optionList={providerOptions}
                        disabled={locked}
                        style={{ width: '100%' }}
                    />
                </label>
                <label className="settings-field settings-field-wide">
                    <Text type="tertiary" size="small">{t('settingsBasic.baseUrl', null, 'Base URL')}</Text>
                    <Input value={form.base_url} onChange={value => update('base_url', value)} readOnly={locked} placeholder="https://api.openai.com/v1" />
                </label>
                <label className="settings-field">
                    <Space spacing={6}>
                        <Text type="tertiary" size="small">{t('settingsBasic.model', null, 'Model')}</Text>
                        {(imageEnabled || state.key === 'image' && state.payload?.success) && (
                            <Tag size="small" color="green">{t('settingsProbe.imageInputSupported', null, 'Image input')}</Tag>
                        )}
                    </Space>
                    <Input value={form.model} onChange={value => update('model', value)} readOnly={locked} placeholder="gpt-4o-mini" />
                </label>
                <label className="settings-field">
                    <Text type="tertiary" size="small">{t('settingsBasic.aiChannelName', null, 'Channel name')}</Text>
                    <Input value={form.name} onChange={value => update('name', value)} readOnly={locked} placeholder={legacy ? '' : channelId} />
                </label>
                <label className="settings-field">
                    <Text type="tertiary" size="small">{t('settingsBasic.apiKey', null, 'API Key')}</Text>
                    <Input mode="password" autoComplete="new-password" value={form.api_key} onChange={value => update('api_key', value)} readOnly={locked} />
                </label>
                <label className="settings-field">
                    <Text type="tertiary" size="small">{t('settingsProbe.profile', null, 'Context profile')}</Text>
                    <Select
                        value={form.context_profile || ''}
                        onChange={value => update('context_profile', value)}
                        disabled={locked}
                        optionList={[...new Set([...CONTEXT_PROFILES, form.context_profile || ''])].map(value => ({
                            value, label: profileLabel(t, value)
                        }))}
                        style={{ width: '100%' }}
                    />
                </label>
                {TOKEN_LIMITS.map(([field, key, fallback]) => {
                    const isWindow = field === 'context_window';
                    const showDefault = isWindow && useDefaultWindow;
                    const labelId = `${channelLabelId}-${field}`;
                    return (
                        <label className="settings-field" key={field}>
                            <Text id={labelId} type="tertiary" size="small">{t(key, null, fallback)}</Text>
                            <Input
                                aria-labelledby={labelId}
                                value={String(showDefault ? DEFAULT_FORM_CONTEXT_WINDOW : form[field])}
                                onChange={value => update(field, value)}
                                inputMode="numeric"
                                readOnly={locked}
                                placeholder={isWindow
                                    ? t('settingsProbe.windowExample', { value: t('settingsBasic.contextWindowPlaceholder', null, '131072') }, 'e.g. {{value}}')
                                    : '0'}
                            />
                        </label>
                    );
                })}
            </div>

            {(applyPending || saveError) && (
                <div className="settings-channel-notices">
                    {applyPending && (
                        <Banner type="warning" bordered closeIcon={null} description={(
                            <Space wrap>
                                {t('settingsProbe.savedApplyFailed', null, 'The channel was saved, but applying the configuration failed.')}
                                <Button size="small" disabled={locked || !!busy} onClick={retryApply}>
                                    {t('settingsProbe.retryApply', null, 'Retry Apply')}
                                </Button>
                            </Space>
                        )} />
                    )}
                    <ErrorBanner error={saveError} />
                </div>
            )}

            <Space wrap className="settings-probe-actions">
                <Button
                    loading={busy === 'test'}
                    disabled={locked || !!busy}
                    onClick={() => run('test', '/config/test-openai', probeBody())}
                >
                    {t('settingsBasic.test', null, 'Test connection')}
                </Button>
                <Button
                    loading={busy === 'image'}
                    disabled={locked || !!busy}
                    onClick={() => run('image', '/config/test-openai', { ...probeBody(), test_image: true })}
                >
                    {t('settingsProbe.testImage', null, 'Test image')}
                </Button>
                {!imageEnabled && state.key === 'image' && state.payload?.success && (
                    <Button type="tertiary" disabled={locked || !!busy} onClick={() => update('image_input', 'enabled')}>
                        {t('settingsProbe.enableImageInput', null, 'Enable images for this channel')}
                    </Button>
                )}
                <Button
                    loading={busy === 'context'}
                    disabled={locked || !!busy}
                    onClick={() => run('context', '/config/detect-context', probeBody())}
                >
                    {t('settingsBasic.detectContext', null, 'Auto-detect')}
                </Button>
                <Button
                    loading={busy === 'list'}
                    disabled={locked || !!busy}
                    onClick={() => run('list', '/config/list-models', {
                        context_profile: form.context_profile,
                        provider: form.provider,
                        channel_id: legacy ? undefined : channelId,
                        credential_scope: legacy ? 'openai' : undefined,
                        base_url: form.base_url,
                        api_key: form.api_key
                    })}
                >
                    {t('settingsBasic.modelsList', null, 'Fetch model list')}
                </Button>
            </Space>
            <ProbeOutput
                state={state}
                defaultWindow={useDefaultWindow ? defaultWindow : 0}
                model={form.model}
                onModelChange={value => update('model', value)}
                disabled={locked}
            />

            <Collapse className="settings-audit-model">
                <Collapse.Panel itemKey="audit-model" header={(
                    <Space wrap spacing={8}>
                        <Text strong>{t('settingsProbe.auditModelTitle', null, 'Audit model')}</Text>
                        <Text type="tertiary" size="small">{auditSource}</Text>
                    </Space>
                )}>
                    <div className="settings-probe-card">
                        <div><Tag size="small">{auditProtocol}</Tag></div>
                        <Hint>
                            {auditTypeSafe
                                ? t('settingsProbe.auditTypeSafeHint', null, 'Tests the configured TypeSafe / Jev backend. Blank URL and model use Jev defaults. A blank or masked key uses the saved audit key; the main model key is never inherited.')
                                : t('settingsProbe.auditChatHint', null, 'Tests the configured audit model protocol. Blank URL and model inherit the main model. A blank or masked key uses the saved audit key, or inherits the main model key if none is configured.')}
                        </Hint>
                        <div className="settings-probe-inline">
                            {[
                                ['base_url', 'baseUrl', 'Base URL', auditURLPlaceholder],
                                ['api_key', 'apiKey', 'API Key', '********'],
                                ['model', 'model', 'Model', auditTypeSafe ? 'jev-latest' : config.openai?.model || '']
                            ].map(([field, key, fallback, placeholder]) => (
                                <label key={field} className="settings-field">
                                    <Text type="tertiary" size="small">{t('settingsBasic.' + key, null, fallback)}</Text>
                                    <Input
                                        value={auditForm[field]}
                                        onChange={value => {
                                            setAuditDraft(current => ({ ...current, [field]: value }));
                                            setAuditState(EMPTY_PROBE);
                                        }}
                                        placeholder={placeholder}
                                        readOnly={!canWrite || auditBusy}
                                        mode={field === 'api_key' ? 'password' : undefined}
                                        autoComplete={field === 'api_key' ? 'new-password' : undefined}
                                    />
                                </label>
                            ))}
                        </div>
                        <Space>
                            <Button size="small" loading={auditBusy} disabled={!canWrite} onClick={testAuditModel}>
                                {t('settingsProbe.testAuditModel', null, 'Test audit model')}
                            </Button>
                        </Space>
                        <ProbeOutput state={auditState} />
                    </div>
                </Collapse.Panel>
            </Collapse>
        </SectionCard>
    );
}
