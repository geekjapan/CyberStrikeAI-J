/** External MCP config: list, enable/disable, JSON form add/edit, delete. */
import { useCallback, useMemo, useState } from 'react';
import { Banner, Button, Space, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import {
    Drawer, SectionCard, ErrorBanner, CopyButton, toastSuccess, toastError, confirmAction
} from '../../components/ui';
import { useInterval, useResource } from '../../components/hooks';
import { api, errorMessage } from '../../lib/http';
import { translate, useT } from '../../lib/i18n';
import { connectionMeta, transportOf } from './utils';

const { Text } = Typography;

const EXAMPLE_CONFIG = {
    'my-stdio-server': {
        command: 'python3',
        args: ['${HOME}/mcp-servers/main.py', '--port', '${MCP_PORT:-3000}'],
        env: { API_KEY: '${API_KEY}', LOG_LEVEL: '${LOG_LEVEL:-INFO}' },
        timeout: 300
    },
    'my-http-server': {
        type: 'http',
        url: 'https://mcp.example.com/mcp',
        headers: { Authorization: 'Bearer ${MCP_TOKEN}' }
    },
    'my-sse-server': {
        type: 'sse',
        url: 'http://127.0.0.1:8081/mcp/sse'
    }
};

function validateConfigMap(raw, { editingName }) {
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return { error: translate('ui.externalMcp.configMustBeObject', null, 'Configuration must be a JSON object') };
    const names = Object.keys(raw);
    if (!names.length) return { error: translate('ui.externalMcp.needOneConfig', null, 'At least one MCP configuration is required') };
    if (editingName && !raw[editingName]) return { error: translate('ui.externalMcp.mustIncludeName', { name: editingName }, 'In edit mode the JSON must include the configuration name "{{name}}"') };
    for (const name of names) {
        if (!name.trim()) return { error: translate('ui.externalMcp.nameEmpty', null, 'Configuration name cannot be empty') };
        const config = raw[name];
        if (config === null || typeof config !== 'object' || Array.isArray(config)) {
            return { error: translate('ui.externalMcp.entryMustBeObject', { name }, 'The configuration for "{{name}}" must be an object') };
        }
        delete config.external_mcp_enable;
        const transport = config.type || config.transport || (config.command ? 'stdio' : (config.url ? 'http' : ''));
        if (!transport) return { error: translate('ui.externalMcp.needTransport', { name }, '"{{name}}" must specify command (stdio) or url + type (http/sse)') };
        if (transport === 'stdio' && !config.command) return { error: translate('ui.externalMcp.stdioNeedsCommand', { name }, '"{{name}}" in stdio mode requires command') };
        if ((transport === 'http' || transport === 'sse') && !config.url) return { error: translate('ui.externalMcp.transportNeedsUrl', { name, transport }, '"{{name}}" in {{transport}} mode requires url') };
    }
    return { error: '', names };
}

export default function ExternalMcpPanel({ canWrite, onChanged, refreshKey = 0 }) {
    const t = useT();
    const list = useResource(() => api.get('/external-mcp'), [refreshKey]);
    const [busy, setBusy] = useState('');
    const [modalOpen, setModalOpen] = useState(false);
    const [editingName, setEditingName] = useState(null);
    const [json, setJson] = useState('');
    const [jsonError, setJsonError] = useState('');
    const [saving, setSaving] = useState(false);

    const servers = useMemo(() => {
        const raw = list.data?.servers || {};
        return Object.entries(raw).sort(([a], [b]) => a.localeCompare(b));
    }, [list.data]);

    const reload = useCallback(options => list.reload(options), [list.reload]); // eslint-disable-line react-hooks/exhaustive-deps

    useInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        reload({ silent: true });
    }, 8000);

    const openAdd = useCallback(() => {
        setEditingName(null);
        setJson('');
        setJsonError('');
        setModalOpen(true);
    }, []);

    const openEdit = useCallback(async name => {
        setEditingName(name);
        setJson('');
        setJsonError('');
        setModalOpen(true);
        try {
            const payload = await api.get(`/external-mcp/${encodeURIComponent(name)}`);
            const config = { ...(payload?.config || {}) };
            delete config.tool_count;
            delete config.external_mcp_enable;
            setJson(JSON.stringify({ [name]: config }, null, 2));
        } catch (error) {
            setModalOpen(false);
            toastError(error, t('mcp.getConfigFailed', null, 'Failed to get config'));
        }
    }, [t]);

    const closeModal = useCallback(() => {
        setModalOpen(false);
        setEditingName(null);
        setJsonError('');
    }, []);

    const toggle = useCallback(async (name, status) => {
        const action = status === 'connected' ? 'stop' : 'start';
        setBusy(name);
        try {
            await api.post(`/external-mcp/${encodeURIComponent(name)}/${action}`, {});
            toastSuccess(action === 'start'
                ? t('ui.externalMcp.startSubmitted', null, 'Start request submitted. Connecting in the background.')
                : t('ui.externalMcp.stopped', null, 'External MCP stopped'));
            reload({ silent: true });
            onChanged?.();
        } catch (error) {
            toastError(error, t('mcp.operationFailed', null, 'Operation failed'));
        } finally {
            setBusy('');
        }
    }, [onChanged, reload, t]);

    const remove = useCallback(name => {
        confirmAction({
            title: t('mcp.deleteExternalConfirm', { name }, 'Delete external MCP "{{name}}"?'),
            content: t('ui.externalMcp.deleteContent', null, 'After deletion, this MCP\'s tools will be removed from conversations.'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del(`/external-mcp/${encodeURIComponent(name)}`);
                    toastSuccess(t('mcp.deleteSuccess', null, 'Deleted'));
                    reload();
                    onChanged?.();
                } catch (error) {
                    toastError(error, t('mcp.operationFailed', null, 'Operation failed'));
                }
            }
        });
    }, [onChanged, reload, t]);

    const submit = useCallback(async () => {
        const text = json.trim();
        if (!text) {
            setJsonError(t('mcp.jsonEmpty', null, 'JSON cannot be empty'));
            return;
        }
        let parsed;
        try {
            parsed = JSON.parse(text);
        } catch (error) {
            setJsonError(`${t('mcp.jsonError', null, 'JSON format error')}: ${error.message}`);
            return;
        }
        const { error, names } = validateConfigMap(parsed, { editingName });
        if (error) {
            setJsonError(error);
            return;
        }
        setJsonError('');
        setSaving(true);
        try {
            const targets = editingName ? [editingName] : names;
            for (const name of targets) {
                await api.put(`/external-mcp/${encodeURIComponent(name)}`, { config: parsed[name] });
            }
            toastSuccess(t('mcp.saveSuccess', null, 'Saved'));
            closeModal();
            reload();
            onChanged?.();
        } catch (err) {
            setJsonError(`${t('mcp.operationFailed', null, 'Operation failed')}: ${errorMessage(err)}`);
        } finally {
            setSaving(false);
        }
    }, [closeModal, editingName, json, onChanged, reload, t]);

    const extra = (
        <Space spacing={8}>
            <Button size="small" icon={<IconRefresh />} theme="borderless" onClick={() => reload()} loading={list.loading}>
                {t('common.refresh', null, 'Refresh')}
            </Button>
            <Button size="small" icon={<IconPlus />} disabled={!canWrite} onClick={openAdd}>
                {t('mcp.addExternalMCP', null, 'Add external MCP')}
            </Button>
        </Space>
    );

    return (
        <SectionCard
            title={t('mcp.externalConfig', null, 'External MCP config')}
            description={t('ui.externalMcp.description', null, 'Use command/args/env for stdio and url/headers for http and sse. Status refreshes every 8 seconds.')}
            extra={extra}
        >
            <ErrorBanner error={list.error} onRetry={() => reload()} />
            {!servers.length && !list.loading && (
                <div className="mcp-management-empty">
                    <p>{t('mcp.noExternalMCP', null, 'No external MCP configured')}</p>
                    <Button size="small" disabled={!canWrite} onClick={openAdd}>
                        {t('mcp.clickToAddExternal', null, 'Click "Add external MCP" to configure')}
                    </Button>
                </div>
            )}
            <div className="mcp-management-mcp-grid">
                {servers.map(([name, server]) => {
                    const config = server?.config || {};
                    const status = String(server?.status || 'disconnected');
                    const meta = connectionMeta(status);
                    const transport = transportOf(config);
                    const connected = status === 'connected';
                    return (
                        <div className="mcp-management-mcp-card" key={name}>
                            <div className="mcp-management-mcp-head">
                                <div className="mcp-management-mcp-title">
                                    <Text strong>{name}</Text>
                                    <Tag size="small" color={meta.color}>{meta.label}</Tag>
                                    <Tag size="small" color="grey">{transport.toUpperCase()}</Tag>
                                    {Number(server?.tool_count) > 0 && (
                                        <Tag size="small" color="blue">{t('ui.externalMcp.toolCount', { count: server.tool_count }, '{{count}} tools')}</Tag>
                                    )}
                                </div>
                                <Space spacing={4} wrap>
                                    <Button
                                        size="small"
                                        theme="borderless"
                                        disabled={!canWrite || busy === name || status === 'connecting'}
                                        loading={busy === name}
                                        onClick={() => toggle(name, status)}
                                    >
                                        {status === 'connecting'
                                            ? t('mcp.connecting', null, 'Connecting...')
                                            : (connected ? t('mcp.stop', null, 'Stop') : t('mcp.start', null, 'Start'))}
                                    </Button>
                                    <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => openEdit(name)}>
                                        {t('common.edit', null, 'Edit')}
                                    </Button>
                                    <Button size="small" type="danger" theme="borderless" disabled={!canWrite} onClick={() => remove(name)}>
                                        {t('common.delete', null, 'Delete')}
                                    </Button>
                                </Space>
                            </div>

                            {(status === 'error' || status === 'disconnected') && server?.error && (
                                <Banner
                                    type={status === 'error' ? 'danger' : 'warning'}
                                    className="mcp-management-mcp-error"
                                    description={<span className="mcp-management-mono">{server.error}</span>}
                                />
                            )}

                            <div className="mcp-management-mcp-meta">
                                <div>
                                    <span className="mcp-management-meta-label">{t('mcp.transportMode', null, 'Transport')}</span>
                                    <span>{transport.toUpperCase()}</span>
                                </div>
                                {config.description && (
                                    <div>
                                        <span className="mcp-management-meta-label">{t('mcp.description', null, 'Description')}</span>
                                        <span>{config.description}</span>
                                    </div>
                                )}
                                {transport === 'stdio' && config.command && (
                                    <div>
                                        <span className="mcp-management-meta-label">{t('mcp.command', null, 'Command')}</span>
                                        <span className="mcp-management-mono">{config.command}</span>
                                    </div>
                                )}
                                {transport !== 'stdio' && config.url && (
                                    <div>
                                        <span className="mcp-management-meta-label">URL</span>
                                        <span className="mcp-management-mono">{config.url}</span>
                                    </div>
                                )}
                                {Number(config.timeout) > 0 && (
                                    <div>
                                        <span className="mcp-management-meta-label">{t('mcp.timeout', null, 'Timeout')}</span>
                                        <span>{config.timeout} {t('mcp.secondsUnit', null, 's')}</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    );
                })}
            </div>

            <Drawer
                title={editingName
                    ? `${t('mcp.editExternalMCP', null, 'Edit external MCP')} · ${editingName}`
                    : t('mcp.addExternalMCP', null, 'Add external MCP')}
                visible={modalOpen}
                onCancel={closeModal}
                onOk={submit}
                confirmLoading={saving}
                width={760}
                okText={t('common.save', null, 'Save')}
                cancelText={t('common.cancel', null, 'Cancel')}
            >
                <div className="mcp-management-form">
                    <div className="mcp-management-form-head">
                        <Text type="tertiary">
                            {editingName
                                ? t('ui.externalMcp.editHint', null, 'In edit mode only the configuration with the current name is submitted. external_mcp_enable is managed by the start/stop button.')
                                : t('ui.externalMcp.addHint', null, 'You can paste several MCPs at once: {"name": {...}}. They are written to config.yaml one by one on save.')}
                        </Text>
                        {!editingName && (
                            <Button size="small" theme="borderless" onClick={() => setJson(JSON.stringify(EXAMPLE_CONFIG, null, 2))}>
                                {t('ui.externalMcp.loadExample', null, 'Load example')}
                            </Button>
                        )}
                        {json && <CopyButton text={json} size="small" />}
                    </div>
                    <TextArea
                        className="mcp-management-json"
                        rows={16}
                        value={json}
                        spellCheck={false}
                        placeholder='{"my-http-server": {"type": "http", "url": "https://mcp.example.com/mcp"}}'
                        onChange={value => { setJson(value); if (jsonError) setJsonError(''); }}
                    />
                    {jsonError && <div className="mcp-management-form-error">{jsonError}</div>}
                </div>
            </Drawer>
        </SectionCard>
    );
}
