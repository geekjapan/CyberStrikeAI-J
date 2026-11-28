/**
 * C2 session management: filtered session list on the left, session workspace (terminal/files/tasks/info) on the right.
 */
import { useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Checkbox, Empty, Input, Select, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useDebounced, useInterval, useResource } from '../../components/hooks';
import { PageHeader, ErrorBanner, confirmAction, toastError, toastSuccess } from '../../components/ui';
import * as c2 from './components/c2-api';
import { SESSION_STATUS_COLOR, SESSION_STATUS_OPTIONS, TimeText } from './components/c2-shared';
import SessionDetail from './SessionDetail';
import './page.css';

const { Text } = Typography;

export default function C2SessionsPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('c2:write');
    const canDelete = hasPermission('c2:delete') || canWrite;
    const [searchParams, setSearchParams] = useSearchParams();
    const selectedId = searchParams.get('id') || '';

    const [status, setStatus] = useState('');
    const [listenerId, setListenerId] = useState('');
    const [suspicious, setSuspicious] = useState(false);
    const [keyword, setKeyword] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const search = useDebounced(keyword, 300);

    const query = useMemo(() => ({
        status: status || undefined,
        listener_id: listenerId || undefined,
        search: search || undefined,
        suspicious: suspicious ? '1' : undefined,
        limit: 200
    }), [status, listenerId, search, suspicious]);

    const { data, loading, error, reload } = useResource(
        () => Promise.all([c2.listSessions(query), c2.listListeners().catch(() => ({ listeners: [] }))]),
        [query]
    );
    const sessions = Array.isArray(data?.[0]?.sessions) ? data[0].sessions : [];
    const listeners = Array.isArray(data?.[1]?.listeners) ? data[1].listeners : [];

    useInterval(() => { if (autoRefresh) reload({ silent: true }); }, autoRefresh ? 10000 : 0);

    const selected = useMemo(() => sessions.find(item => item.id === selectedId) || null, [sessions, selectedId]);

    const select = id => {
        const next = new URLSearchParams(searchParams);
        if (id) next.set('id', id);
        else next.delete('id');
        setSearchParams(next, { replace: true });
    };

    const removeFiltered = () => {
        if (!sessions.length) {
            toastError(t('c2.sessions.toastSelectFirst', null, 'Select at least one session to delete'));
            return;
        }
        confirmAction({
            title: t('c2.sessions.deleteFiltered', null, 'Delete filtered'),
            content: t('c2.sessions.confirmDeleteFiltered', null, 'Delete all {{n}} session(s) in the current filter results?').replace('{{n}}', String(sessions.length)),
            onOk: async () => {
                try {
                    const result = await c2.deleteSessions(sessions.map(item => item.id));
                    toastSuccess(t('c2.sessions.toastBatchDeleted', null, 'Deleted {{n}} session(s)').replace('{{n}}', String(result?.deleted ?? sessions.length)));
                    select('');
                    reload();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    return (
        <div className="c2-page" id="page-c2-sessions">
            <PageHeader
                title={t('c2.sessions.title', null, 'Session Management')}
                description={t('c2.sessions.pageDesc', null, 'View checked-in sessions, send commands, browse files, and manage task history')}
                extra={[
                    <Button key="refresh" icon={<IconRefresh />} onClick={reload} loading={loading}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>,
                    <Button key="delete" type="danger" disabled={!canDelete || !sessions.length} onClick={removeFiltered}>
                        {t('c2.sessions.deleteFiltered', null, 'Delete filtered')}
                    </Button>
                ]}
            />

            <ErrorBanner error={error} onRetry={reload} />

            <div className="c2-session-layout">
                <aside className="c2-session-sidebar">
                    <div className="c2-session-filters">
                        <Select
                            size="small"
                            value={status}
                            onChange={value => setStatus(value || '')}
                            style={{ width: '100%' }}
                            optionList={[{ value: '', label: t('c2.sessions.filterAllStatus', null, 'All statuses') },
                                ...SESSION_STATUS_OPTIONS]}
                        />
                        <Select
                            size="small"
                            value={listenerId}
                            onChange={value => setListenerId(value || '')}
                            style={{ width: '100%' }}
                            optionList={[{ value: '', label: t('c2.sessions.filterAllListeners', null, 'All listeners') },
                                ...listeners.map(item => ({ value: item.id, label: item.name || item.id }))]}
                        />
                        <Input
                            size="small"
                            value={keyword}
                            onChange={setKeyword}
                            prefix={<IconSearch />}
                            placeholder={t('c2.sessions.filterSearchPlaceholder', null, 'Search hostname / user / IP')}
                        />
                        <div className="c2-session-filter-foot">
                            <Checkbox checked={suspicious} onChange={event => setSuspicious(Boolean(event.target.checked))}>
                                <Text size="small">{t('c2.sessions.filterSuspicious', null, 'Likely false positives')}</Text>
                            </Checkbox>
                            <Checkbox checked={autoRefresh} onChange={event => setAutoRefresh(Boolean(event.target.checked))}>
                                <Text size="small">{t('c2.sessions.autoRefresh', null, 'Auto refresh')}</Text>
                            </Checkbox>
                        </div>
                        <Text type="tertiary" size="small">
                            {t('c2.sessions.listCount', null, '{{n}} total').replace('{{n}}', String(sessions.length))}
                        </Text>
                    </div>

                    <div className="c2-session-list">
                        {loading && !sessions.length && <div className="c2-session-loading"><Spin /></div>}
                        {!loading && sessions.length === 0 && (
                            <Empty
                                title={keyword || status || listenerId ? t('c2.sessions.emptyFilter', null, 'No sessions match the current filters') : t('c2.sessions.listEmpty', null, 'No sessions')}
                                description={null}
                                style={{ padding: 24 }}
                            />
                        )}
                        {sessions.map(session => (
                            <button
                                type="button"
                                key={session.id}
                                className={`c2-session-item ${session.id === selectedId ? 'is-active' : ''}`}
                                onClick={() => select(session.id)}
                            >
                                <div className="c2-session-item-head">
                                    <span className="c2-session-host">{session.hostname || t('c2.sessions.unknownHost', null, 'unknown')}</span>
                                    <Tag size="small" color={SESSION_STATUS_COLOR[session.status] || 'grey'}>
                                        {t(`c2.sessions.${session.status || 'active'}`, null, session.status || '—')}
                                    </Tag>
                                </div>
                                <div className="c2-session-item-meta">
                                    <span>{session.username || '—'}</span>
                                    <span>{session.os || '—'}/{session.arch || '—'}</span>
                                    {session.isAdmin && <Tag size="small" color="red">ROOT</Tag>}
                                </div>
                                <div className="c2-session-item-foot">
                                    <span className="c2-mono">{session.internalIp || session.externalIp || '—'}</span>
                                    <TimeText value={session.lastCheckIn} />
                                </div>
                            </button>
                        ))}
                    </div>
                </aside>

                <section className="c2-session-main">
                    {selected ? (
                        <SessionDetail
                            key={selected.id}
                            session={selected}
                            canWrite={canWrite}
                            canDelete={canDelete}
                            onChanged={reload}
                            onDeleted={() => { select(''); reload(); }}
                        />
                    ) : (
                        <Empty
                            title={t('c2.sessions.selectPromptTitle', null, 'Select a session')}
                            description={t('c2.sessions.selectPromptHint', null, 'Click a session in the list on the left to view terminal, files, and tasks.')}
                            style={{ padding: 64 }}
                        />
                    )}
                </section>
            </div>
        </div>
    );
}
