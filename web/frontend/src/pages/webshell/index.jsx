/**
 * WebShell management: connection list on the left; terminal, files, command history and AI conversations per connection on the right.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Empty, Input, Space, Spin, Tabs, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useDebounced, useResource } from '../../components/hooks';
import {
    PageHeader, ErrorBanner, confirmAction, toastError, toastSuccess, toastWarning
} from '../../components/ui';
import * as shellApi from './api';
import ConnectionForm from './ConnectionForm';
import FilesTab from './FilesTab';
import TerminalTab from './TerminalTab';
import HistoryTab from './HistoryTab';
import AiTab from './AiTab';
import './page.css';

const { Text } = Typography;

const encodingLabel = { auto: 'Auto', 'utf-8': 'UTF-8', gbk: 'GBK', gb18030: 'GB18030' };

function statusColor(state) {
    if (state === 'online') return 'green';
    if (state === 'probing') return 'amber';
    if (state === 'offline') return 'red';
    return 'grey';
}

export default function WebshellPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('webshell:write');
    const canDelete = hasPermission('webshell:delete') || canWrite;
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedId = searchParams.get('id') || '';

    const [keyword, setKeyword] = useState('');
    const debouncedKeyword = useDebounced(keyword, 250);
    const [probeState, setProbeState] = useState({});
    const [probingAll, setProbingAll] = useState(false);
    const [form, setForm] = useState({ visible: false, record: null });
    const [submitting, setSubmitting] = useState(false);
    const [projects, setProjects] = useState([]);
    const [memo, setMemo] = useState('');
    const [history, setHistory] = useState([]);
    const persistTimer = useRef(null);

    const { data, loading, error, reload } = useResource(() => shellApi.listConnections(), []);
    const connections = useMemo(() => (Array.isArray(data) ? data : []), [data]);

    useEffect(() => {
        shellApi.listProjects().then(setProjects);
    }, []);

    const selected = useMemo(
        () => connections.find(item => item.id === selectedId) || null,
        [connections, selectedId]
    );

    const select = id => {
        const next = new URLSearchParams(searchParams);
        if (id) next.set('id', id);
        else next.delete('id');
        setSearchParams(next, { replace: true });
    };

    /** State persistence (memo + command history), written back only after client-side changes. */
    const persist = useCallback(payload => {
        if (!canWrite || !selectedId) return;
        if (persistTimer.current) clearTimeout(persistTimer.current);
        persistTimer.current = setTimeout(() => {
            shellApi.saveConnectionState(selectedId, payload).catch(() => {});
        }, 700);
    }, [canWrite, selectedId]);

    useEffect(() => {
        let cancelled = false;
        setMemo('');
        setHistory([]);
        if (!selectedId) return () => { cancelled = true; };
        shellApi.getConnectionState(selectedId)
            .then(payload => {
                if (cancelled) return;
                const state = payload?.state || {};
                setMemo(typeof state.memo === 'string' ? state.memo : '');
                setHistory(Array.isArray(state.commands) ? state.commands : []);
            })
            .catch(() => { /* A failed state read does not affect the main flow */ });
        return () => { cancelled = true; };
    }, [selectedId]);

    const updateMemo = value => {
        setMemo(value);
        persist({ memo: value, commands: history });
    };

    const recordCommand = command => {
        const next = [...history, { command, at: new Date().toISOString() }].slice(-200);
        setHistory(next);
        persist({ memo, commands: next });
    };

    const removeHistory = rowId => {
        const next = history.filter((item, index) => `${index}-${item.at}` !== rowId);
        setHistory(next);
        persist({ memo, commands: next });
    };

    const clearHistory = () => {
        confirmAction({
            title: t('webshell.clearHistory', null, 'Clear history'),
            content: t('webshell.clearHistoryConfirm', null, 'Clear the command history of this connection?'),
            onOk: () => {
                setHistory([]);
                persist({ memo, commands: [] });
            }
        });
    };

    const probe = async connection => {
        setProbeState(current => ({ ...current, [connection.id]: 'probing' }));
        try {
            const result = await shellApi.probeConnection(connection);
            setProbeState(current => ({ ...current, [connection.id]: result.ok ? 'online' : 'offline' }));
            return result.ok;
        } catch (err) {
            setProbeState(current => ({ ...current, [connection.id]: 'offline' }));
            return false;
        }
    };

    const probeAll = async () => {
        if (!connections.length) {
            toastWarning(t('webshell.probeNoConnections', null, 'No connections to probe'));
            return;
        }
        setProbingAll(true);
        for (const connection of connections) {
            // Probe one by one to avoid saturating the target shell at once
            await probe(connection);
        }
        setProbingAll(false);
    };

    const submitForm = async values => {
        setSubmitting(true);
        try {
            if (form.record?.id) {
                await shellApi.updateConnection(form.record.id, values);
                toastSuccess(t('webshell.toastUpdated', null, 'Connection updated'));
            } else {
                const created = await shellApi.createConnection(values);
                toastSuccess(t('webshell.toastCreated', null, 'Connection created'));
                if (created?.id) select(created.id);
            }
            setForm({ visible: false, record: null });
            reload();
        } catch (err) {
            toastError(err, t('webshell.saveFailed', null, 'Save failed'));
        } finally {
            setSubmitting(false);
        }
    };

    const remove = connection => {
        confirmAction({
            title: t('webshell.deleteConfirm', null, 'Delete this connection?'),
            content: connection.url,
            onOk: async () => {
                try {
                    await shellApi.deleteConnection(connection.id);
                    toastSuccess(t('webshell.toastDeleted', null, 'Connection deleted'));
                    if (connection.id === selectedId) select('');
                    reload();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    const filtered = useMemo(() => {
        const value = debouncedKeyword.trim().toLowerCase();
        if (!value) return connections;
        return connections.filter(item => [item.url, item.remark, item.type, item.id]
            .filter(Boolean)
            .some(field => String(field).toLowerCase().includes(value)));
    }, [connections, debouncedKeyword]);

    const tabs = [
        {
            tab: t('webshell.tabTerminal', null, 'Virtual terminal'),
            itemKey: 'terminal',
            children: selected
                ? <TerminalTab connection={selected} canWrite={canWrite} onRecordCommand={recordCommand} />
                : null
        },
        {
            tab: t('webshell.tabFileManager', null, 'File manager'),
            itemKey: 'files',
            children: selected ? <FilesTab connection={selected} canWrite={canWrite} /> : null
        },
        {
            tab: t('webshell.tabHistory', null, 'Command history'),
            itemKey: 'history',
            children: (
                <HistoryTab
                    history={history}
                    onRemove={removeHistory}
                    onClear={canWrite ? clearHistory : null}
                    onRun={command => (selected ? recordCommand(command) : null)}
                />
            )
        },
        {
            tab: t('webshell.tabAiSessions', null, 'AI conversations'),
            itemKey: 'ai',
            children: selected ? <AiTab connection={selected} /> : null
        },
        {
            tab: t('webshell.tabMemo', null, 'Memo'),
            itemKey: 'memo',
            children: (
                <TextArea
                    value={memo}
                    onChange={updateMemo}
                    autosize={{ minRows: 10, maxRows: 20 }}
                    placeholder={t('webshell.aiMemoPlaceholder', null, 'Save key commands, testing ideas, and repro steps...')}
                    disabled={!canWrite}
                />
            )
        }
    ];

    return (
        <div className="webshell-page" id="page-webshell">
            <PageHeader
                title={t('webshell.title', null, 'WebShell Management')}
                description={t('webshell.pageDesc', null, 'Manage WebShell connections in one place, run commands through the proxy, and browse target files')}
                extra={[
                    <Button key="refresh" icon={<IconRefresh />} onClick={reload} loading={loading}>
                        {t('webshell.refresh', null, 'Refresh')}
                    </Button>,
                    <Button key="add" theme="solid" type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={() => setForm({ visible: true, record: null })}>
                        {t('webshell.addConnection', null, 'Add connection')}
                    </Button>
                ]}
            />

            <ErrorBanner error={error} onRetry={reload} />

            <div className="webshell-layout">
                <aside className="webshell-sidebar">
                    <div className="webshell-sidebar-head">
                        <Text strong>{t('webshell.connections', null, 'Connections')}</Text>
                        <Tag size="small">{connections.length}</Tag>
                    </div>
                    <Input
                        value={keyword}
                        onChange={setKeyword}
                        prefix={<IconSearch />}
                        placeholder={t('webshell.searchPlaceholder', null, 'Search connections...')}
                        size="small"
                    />
                    <Button size="small" theme="borderless" loading={probingAll} onClick={probeAll} disabled={!connections.length}>
                        {t('webshell.batchProbe', null, 'Batch probe')}
                    </Button>
                    <div className="webshell-conn-list">
                        {loading && !connections.length && <div className="webshell-conn-loading"><Spin /></div>}
                        {!loading && filtered.length === 0 && (
                            <Text type="tertiary" className="webshell-conn-empty">
                                {connections.length ? t('webshell.noMatchConnections', null, 'No matching connections') : t('webshell.noConnections', null, 'No connections. Click "Add connection" to add one.')}
                            </Text>
                        )}
                        {filtered.map(item => (
                            <button
                                type="button"
                                key={item.id}
                                className={`webshell-conn-item ${item.id === selectedId ? 'is-active' : ''}`}
                                onClick={() => select(item.id)}
                            >
                                <span className="webshell-conn-url" title={item.url}>{item.remark || item.url}</span>
                                <span className="webshell-conn-meta">
                                    <Tag size="small" color="blue">{String(item.type || 'php').toUpperCase()}</Tag>
                                    {probeState[item.id] && (
                                        <Tag size="small" color={statusColor(probeState[item.id])}>
                                            {probeState[item.id] === 'online'
                                                ? t('webshell.probeOnline', null, 'Online')
                                                : probeState[item.id] === 'probing'
                                                    ? t('webshell.probeRunning', null, 'Probing')
                                                    : t('webshell.probeOffline', null, 'Offline')}
                                        </Tag>
                                    )}
                                </span>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="webshell-main">
                    {!selected ? (
                        <Empty
                            title={t('webshell.selectOrAdd', null, 'Select a connection from the list or add a new WebShell connection.')}
                            description={null}
                            style={{ padding: 64 }}
                        />
                    ) : (
                        <div className="webshell-workspace">
                            <div className="webshell-workspace-head">
                                <div className="webshell-workspace-title">
                                    <Text strong ellipsis={{ showTooltip: true }} className="webshell-workspace-url">{selected.url}</Text>
                                    <Space spacing={6} wrap>
                                        <Tag size="small" color="blue">{String(selected.type || 'php').toUpperCase()}</Tag>
                                        <Tag size="small">{String(selected.method || 'post').toUpperCase()}</Tag>
                                        <Tag size="small">{selected.encoding && selected.encoding !== 'auto' && encodingLabel[selected.encoding] || t('ui.webshell.encodingAuto', null, 'Auto')}</Tag>
                                        <Tag size="small">{selected.os === 'windows' ? 'Windows' : selected.os === 'linux' ? 'Linux' : t('ui.webshell.osAuto', null, 'OS auto')}</Tag>
                                        {selected.remark && <Text type="tertiary" size="small">{selected.remark}</Text>}
                                    </Space>
                                </div>
                                <Space spacing={8}>
                                    <Button size="small" loading={probeState[selected.id] === 'probing'} onClick={() => probe(selected)}>
                                        {t('webshell.testConnectivity', null, 'Test connectivity')}
                                    </Button>
                                    <Button size="small" disabled={!canWrite} onClick={() => setForm({ visible: true, record: selected })}>
                                        {t('webshell.editConnection', null, 'Edit')}
                                    </Button>
                                    <Button size="small" type="danger" disabled={!canDelete} onClick={() => remove(selected)}>
                                        {t('webshell.deleteFile', null, 'Delete')}
                                    </Button>
                                </Space>
                            </div>
                            <Tabs
                                key={selected.id}
                                type="line"
                                defaultActiveKey="terminal"
                                className="webshell-tabs"
                                items={tabs}
                            />
                        </div>
                    )}
                </section>
            </div>

            <ConnectionForm
                visible={form.visible}
                record={form.record}
                projects={projects}
                submitting={submitting}
                onCancel={() => setForm({ visible: false, record: null })}
                onSubmit={submitForm}
            />
        </div>
    );
}
