/**
 * Basic configuration: a YAML editor for the whole editable configuration.
 *
 * Reads GET /config (secrets are masked as ********); saving takes two steps:
 *   PUT  /config       writes config.yaml (the backend updates incrementally by the fields present)
 *   POST /config/apply reloads and restarts the related services
 * YAML was chosen over a per-field form: GET /config exposes 18 sections, and a per-field form would inevitably miss fields.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Banner, Button, Collapse, Space, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconRefresh, IconTick } from '@douyinfe/semi-icons';
import { api, errorMessage } from '../../../lib/http';
import { useAuth } from '../../../lib/auth';
import { translate, useT } from '../../../lib/i18n';
import { modelChannelName } from '../../../lib/model-channel';
import { useResource } from '../../../components/hooks';
import {
    CopyButton, ErrorBanner, JsonViewer, KeyValueList, SectionCard, confirmAction, toastError, toastSuccess, toastWarning
} from '../../../components/ui';
import { formatNumber } from '../../../lib/format';
import { dumpYaml, parseYaml, setYamlTranslator } from '../lib/yaml';
import { Hint, LoadingBlock, PermissionBanner } from './common';

const { Paragraph } = Typography;

/** Top-level sections accepted by UpdateConfigRequest (internal/handler/config.go). */
const WRITABLE_SECTIONS = ['ai', 'openai', 'vision', 'knowledge', 'storage'];

setYamlTranslator(translate);

function editorHeader() {
    return [
        translate('ui.settingsBasic.headerTitle', null, 'System settings · Raw configuration (generated from GET /config)'),
        '',
        translate('ui.settingsBasic.headerSecrets', null, '· Secret fields are shown as ********: saving them unchanged keeps the stored credentials; enter a new value to replace them.'),
        translate('ui.settingsBasic.headerSave', null, '· Save = PUT /config (writes config.yaml) + POST /config/apply (reloads).'),
        translate('ui.settingsBasic.headerChanged', null, '· Only the sections you changed are submitted; omitted sections keep the server configuration.'),
        translate('ui.settingsBasic.headerStorage', null, '· storage (cleanup policy) is not part of GET /config; edit it in the "Storage and updates" section.'),
        translate('ui.settingsBasic.headerScope', null, '· This editor can save the model, vision, knowledge base and storage configuration. For other settings, see config.yaml.')
    ].join('\n');
}

export default function BasicSection() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('config:read');
    const canWrite = hasPermission('config:write');
    const loader = useCallback(() => api.get('/config'), []);
    const config = useResource(loader, [canRead], { skip: !canRead });

    const [text, setText] = useState('');
    const [baseline, setBaseline] = useState('');
    const [parseError, setParseError] = useState('');
    const [saveError, setSaveError] = useState(null);
    const [notice, setNotice] = useState('');
    const [phase, setPhase] = useState('idle');

    useEffect(() => {
        if (!config.data) return;
        const { context_window_defaults: _defaults, ...configuration } = config.data;
        const next = dumpYaml(configuration, { header: editorHeader() });
        setText(next);
        setBaseline(next);
        setParseError('');
    }, [config.data]);

    const dirty = baseline !== '' && text !== baseline;
    const busy = phase !== 'idle';

    const summary = useMemo(() => {
        const data = config.data;
        if (!data) return [];
        const channels = data.ai?.channels || {};
        const channelNames = Object.entries(channels).map(([id, channel]) => modelChannelName(id, channel));
        const defaultId = data.ai?.default_channel;
        const tools = Array.isArray(data.tools) ? data.tools : [];
        const enabledTools = tools.filter(tool => tool.enabled).length;
        return [
            { label: t('settings.defaultChannel', null, 'Default AI channel'), value: defaultId ? modelChannelName(defaultId, channels[defaultId]) : '—' },
            {
                label: t('settingsBasic.aiChannelSavedList', null, 'Saved channels'),
                value: `${formatNumber(channelNames.length)}${channelNames.length ? ` (${channelNames.slice(0, 4).join(', ')})` : ''}`
            },
            {
                label: t('settings.toolsEnabled', null, 'Enabled tools'),
                value: `${formatNumber(enabledTools)} / ${formatNumber(tools.length)}`
            },
            {
                label: t('settings.visionLabel', null, 'Vision model'),
                value: data.vision?.enabled ? (data.vision.model || t('ui.settingsBasic.enabled', null, 'Enabled')) : t('ui.settingsBasic.disabled', null, 'Disabled')
            },
            { label: t('settings.knowledge.title', null, 'Knowledge base'), value: data.knowledge?.enabled ? t('ui.settingsBasic.enabled', null, 'Enabled') : t('ui.settingsBasic.disabled', null, 'Disabled') },
            { label: 'C2', value: data.c2?.enabled ? t('ui.settingsBasic.enabled', null, 'Enabled') : t('ui.settingsBasic.disabled', null, 'Disabled') }
        ];
    }, [config.data, t]);

    const doReload = useCallback(async () => {
        setSaveError(null);
        setNotice('');
        await config.reload();
    }, [config.reload]);

    const reload = useCallback(() => {
        if (dirty) {
            confirmAction({
                title: t('ui.settingsBasic.reloadTitle', null, 'Reload configuration'),
                content: t('ui.settingsBasic.reloadConfirm', null, 'You have unsaved changes, and reloading will discard them. Continue?'),
                okText: t('ui.settingsBasic.ok', null, 'OK'),
                onOk: doReload
            });
            return;
        }
        doReload();
    }, [doReload, dirty, t]);

    const formatEditor = () => {
        try {
            const value = parseYaml(text);
            if (!value || typeof value !== 'object' || Array.isArray(value)) {
                setParseError(t('ui.settingsBasic.topLevelMapping', null, 'The top level must be a key-value mapping (key: value), not a list or a scalar.'));
                return;
            }
            setText(dumpYaml(value, { header: editorHeader() }));
            setParseError('');
        } catch (error) {
            setParseError(errorMessage(error, t('ui.settingsBasic.yamlParseFailed', null, 'Failed to parse YAML')));
        }
    };

    const save = async () => {
        let parsed;
        try {
            parsed = parseYaml(text);
        } catch (error) {
            setParseError(errorMessage(error, t('ui.settingsBasic.yamlParseFailed', null, 'Failed to parse YAML')));
            return;
        }
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
            setParseError(t('ui.settingsBasic.topLevelMapping', null, 'The top level must be a key-value mapping (key: value), not a list or a scalar.'));
            return;
        }
        setParseError('');
        setSaveError(null);
        setNotice('');

        const ignored = Object.keys(parsed).filter(key => !WRITABLE_SECTIONS.includes(key));
        const payload = {};
        for (const key of WRITABLE_SECTIONS) {
            if (parsed[key] !== undefined && JSON.stringify(parsed[key]) !== JSON.stringify(config.data?.[key])) {
                payload[key] = parsed[key];
            }
        }
        if (!Object.keys(payload).length) {
            setNotice(t('ui.settingsBasic.nothingToSave', null, 'There are no configuration changes to save.'));
            if (ignored.length) toastWarning(t('ui.settingsBasic.ignoredFields', { list: ignored.join(', ') }, 'Ignored unsupported fields: {{list}}'));
            return;
        }

        setPhase('saving');
        try {
            await api.put('/config', payload);
        } catch (error) {
            setPhase('idle');
            setSaveError(error);
            toastError(error, t('settings.apply.applyFailed', null, 'Failed to apply configuration'));
            return;
        }

        let applyError = null;
        setPhase('applying');
        try {
            await api.post('/config/apply');
        } catch (error) {
            applyError = error;
        }
        setPhase('idle');

        if (applyError) {
            setSaveError(applyError);
            setNotice(t('settings.apply.appliedWithError', null, 'The configuration was written to config.yaml, but applying it failed; some changes take effect only after a restart.'));
            toastWarning(t('settings.apply.appliedWithError', null, 'The configuration was written to config.yaml, but applying it failed; some changes take effect only after a restart.'));
        } else {
            toastSuccess(t('settings.apply.applySuccess', null, 'Configuration applied successfully!'));
        }
        if (ignored.length) {
            toastWarning(t('settings.apply.ignoredSections', { list: ignored.join(', ') }, 'Ignored fields the backend does not accept: {{list}}'));
        }
        await config.reload();
    };

    if (!canRead) {
        return <PermissionBanner permission="config:read" label={t('settings.nav.basic', null, 'Basic')} />;
    }
    if (config.loading && !config.data) return <LoadingBlock rows={8} />;

    return (
        <>
            <ErrorBanner error={config.error} onRetry={reload} />
            {config.data && (
                <>
                    <SectionCard title={t('settings.overviewTitle', null, 'Current configuration overview')}>
                        <KeyValueList items={summary} columns={3} />
                    </SectionCard>

                    <SectionCard
                        title={t('settings.rawTitle', null, 'Raw YAML configuration')}
                        description={t('settingsDisplay.rawYamlHelp', null, 'Generated from the current server configuration for viewing or bulk editing advanced options. Format and validate checks syntax; Save and apply writes supported changes and attempts to apply them.')}
                        extra={(
                            <Space>
                                <Tag color={dirty ? 'amber' : 'green'} size="small">
                                    {dirty ? t('settings.unsaved', null, 'Unsaved changes') : t('settings.savedState', null, 'In sync with the server')}
                                </Tag>
                                <CopyButton text={text} label={t('common.copy', null, 'Copy')} />
                            </Space>
                        )}
                    >
                        {notice && (
                            <Banner type="warning" bordered closeIcon={null} className="settings-yaml-notice" description={notice} />
                        )}
                        {parseError && <ErrorBanner error={parseError} />}
                        <ErrorBanner error={saveError} onRetry={reload} />
                        <div className="settings-yaml-toolbar">
                            <Space>
                                <Button
                                    theme="solid"
                                    type="primary"
                                    icon={<IconTick />}
                                    loading={busy}
                                    disabled={!canWrite || !dirty}
                                    onClick={save}
                                >
                                    {phase === 'applying'
                                        ? t('settings.applying', null, 'Applying…')
                                        : t('settings.saveAndApply', null, 'Save and apply')}
                                </Button>
                                <Button onClick={formatEditor} disabled={busy}>
                                    {t('settings.formatAndValidate', null, 'Format and validate')}
                                </Button>
                                <Button
                                    onClick={() => { setText(baseline); setParseError(''); setNotice(''); }}
                                    disabled={!dirty || busy}
                                >
                                    {t('toolGuard.reset', null, 'Discard changes')}
                                </Button>
                                <Button icon={<IconRefresh />} onClick={reload} loading={config.loading} disabled={busy}>
                                    {t('common.refresh', null, 'Refresh')}
                                </Button>
                            </Space>
                            <Hint>{t('settings.lineCount', { count: text.split('\n').length }, '{{count}} lines')}</Hint>
                        </div>
                        {!canWrite && (
                            <Paragraph type="tertiary" size="small" className="settings-hint">
                                {t('settings.readOnlyHint', null, 'The current account lacks the config:write permission: the configuration can be viewed but not saved.')}
                            </Paragraph>
                        )}
                        <TextArea
                            className="settings-yaml-input"
                            value={text}
                            onChange={value => { setText(value); setNotice(''); }}
                            readOnly={!canWrite || busy}
                            spellCheck={false}
                            autosize={false}
                            rows={24}
                        />
                    </SectionCard>

                    <SectionCard title={t('settings.jsonTitle', null, 'Read-only reference')}>
                        <Collapse>
                            <Collapse.Panel
                                header={t('settings.jsonPanel', null, 'Raw GET /config response (JSON, for checking field names)')}
                                itemKey="json"
                            >
                                <JsonViewer value={config.data} collapsed title="GET /config" />
                            </Collapse.Panel>
                        </Collapse>
                    </SectionCard>
                </>
            )}
        </>
    );
}
