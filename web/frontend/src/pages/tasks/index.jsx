/** Task management: batch task queue list, stats, creation and queue detail drawer, deep link ?id=. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
    Button, Input, Progress, Select, Space, Tabs, Tag, Typography
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useDebounced, useInterval, useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard, StatGrid, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import QueueFormModal from './queue-form';
import QueueDetailDrawer from './queue-detail';
import LiveTasks from './live-tasks';
import {
    QUEUE_STATUS_FILTERS, agentModeLabel, errText, errorProp, queueStats, queueStatusView
} from './helpers';
import './page.css';

const { Text } = Typography;

export default function TasksPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('tasks:write');
    const canDelete = hasPermission('tasks:delete');

    const [params, setParams] = useSearchParams();
    const selectedId = params.get('id') || '';
    const tab = params.get('tab') || 'queues';

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(10);
    const [statusFilter, setStatusFilter] = useState('all');
    const [keyword, setKeyword] = useState('');
    const debounced = useDebounced(keyword, 300);
    const [createVisible, setCreateVisible] = useState(false);
    const [rev, setRev] = useState(0);

    const overview = useResource(() => api.get('/batch-tasks', { limit: 100, page: 1 }), [rev]);

    const list = useResource(() => api.get('/batch-tasks', {
        limit: pageSize,
        page,
        status: statusFilter === 'all' ? undefined : statusFilter,
        keyword: debounced.trim() || undefined
    }), [page, pageSize, statusFilter, debounced, rev]);

    const queues = Array.isArray(list.data?.queues) ? list.data.queues : [];
    const total = list.data?.total ?? 0;
    const anyRunning = useMemo(
        () => (overview.data?.queues || []).some(queue => queue.status === 'running'),
        [overview.data]
    );

    useInterval(() => {
        if (anyRunning) {
            overview.reload({ silent: true });
            list.reload({ silent: true });
        }
    }, anyRunning ? 5000 : 0);

    const navigate = useCallback((nextId, nextTab) => {
        const next = new URLSearchParams(params);
        if (nextId) next.set('id', nextId);
        else next.delete('id');
        if (nextTab) next.set('tab', nextTab);
        else next.delete('tab');
        setParams(next, { replace: Boolean(nextId) });
    }, [params, setParams]);

    useEffect(() => {
        if (tab !== 'queues' && tab !== 'live') navigate(undefined, 'queues');
    }, [tab, navigate]);

    const refresh = () => setRev(value => value + 1);

    const overviewQueues = overview.data?.queues || [];
    const overviewTotals = useMemo(() => {
        const stats = overviewQueues.map(queueStats);
        return {
            queues: overview.data?.total ?? overviewQueues.length,
            running: overviewQueues.filter(queue => queue.status === 'running').length,
            pendingTasks: stats.reduce((sum, item) => sum + item.pending, 0),
            failedTasks: stats.reduce((sum, item) => sum + item.failed, 0)
        };
    }, [overviewQueues, overview.data]);

    const startQueue = async (record) => {
        try {
            await api.post(`/batch-tasks/${record.id}/start`);
            toastSuccess(t('ui.tasksIndex.started', null, 'Started'));
            refresh();
        } catch (error) {
            toastError(errText(error, t('tasks.startBatchQueueFailed', null, 'Failed to start batch queue')));
        }
    };

    const pauseQueue = (record) => confirmAction({
        title: t('tasks.statusPaused', null, 'Paused'),
        content: t('tasks.pauseQueueConfirm', null, 'Pause this batch queue? The current task will be stopped; remaining tasks will stay pending.'),
        okText: t('common.confirm', null, 'Confirm'),
        onOk: async () => {
            try {
                await api.post(`/batch-tasks/${record.id}/pause`);
                toastSuccess(t('tasks.statusPaused', null, 'Paused'));
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.pauseQueueFailed', null, 'Failed to pause queue')));
            }
        }
    });

    const rerunQueue = (record) => confirmAction({
        title: t('tasks.retry', null, 'Retry'),
        content: t('tasks.rerunQueueConfirm', null, 'Rerun this batch queue? All tasks will be reset to pending and re-executed.'),
        okText: t('common.confirm', null, 'Confirm'),
        onOk: async () => {
            try {
                await api.post(`/batch-tasks/${record.id}/rerun`);
                toastSuccess(t('ui.tasksIndex.rerunStarted', null, 'Rerun started'));
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.rerunQueueFailed', null, 'Failed to rerun batch queue')));
            }
        }
    });

    const deleteQueue = (record) => confirmAction({
        title: t('tasks.deleteQueue', null, 'Delete queue'),
        content: t('tasks.deleteQueueConfirm', null, 'Delete this batch queue? This cannot be undone.'),
        okText: t('common.delete', null, 'Delete'),
        onOk: async () => {
            try {
                await api.del(`/batch-tasks/${record.id}`);
                toastSuccess(t('tasks.deleteQueue', null, 'Delete queue'));
                if (selectedId === record.id) navigate(undefined, tab);
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.deleteQueueFailed', null, 'Failed to delete batch queue')));
            }
        }
    });

    const metrics = [
        { id: 'queues', label: t('tasks.batchQueueTitle', null, 'Batch task queue'), value: overviewTotals.queues, loading: overview.loading },
        {
            id: 'running',
            label: t('tasks.runningLabel', null, 'Running'),
            value: overviewTotals.running,
            tone: overviewTotals.running ? 'success' : undefined,
            loading: overview.loading
        },
        { id: 'pending', label: t('tasks.pendingLabel', null, 'Pending'), value: overviewTotals.pendingTasks, loading: overview.loading },
        {
            id: 'failed',
            label: t('tasks.failedLabel', null, 'Failed'),
            value: overviewTotals.failedTasks,
            tone: overviewTotals.failedTasks ? 'danger' : undefined,
            loading: overview.loading
        }
    ];

    const columns = [
        {
            title: t('batchImportModal.queueTitle', null, 'Queue title'),
            dataIndex: 'title',
            render: (value, record) => {
                const view = queueStatusView(record);
                return (
                    <button
                        type="button"
                        className="task-queue-name"
                        onClick={() => navigate(record.id, 'queues')}
                        title={record.id}
                    >
                        <span className="task-queue-title">{value || t('tasks.batchQueueUntitled', null, 'Untitled queue')}</span>
                        {view.sublabel ? <span className="task-queue-sub">{view.sublabel}</span> : null}
                    </button>
                );
            }
        },
        {
            title: t('projects.status', null, 'Status'),
            dataIndex: 'status',
            width: 170,
            render: (value, record) => {
                const view = queueStatusView(record);
                return <Tag size="small" color={view.color}>{view.label}</Tag>;
            }
        },
        {
            title: t('ui.tasksIndex.progress', null, 'Progress'),
            dataIndex: 'progress',
            width: 190,
            render: (value, record) => {
                const stats = queueStats(record);
                return (
                    <div className="task-queue-progress">
                        <Progress percent={stats.percent} showInfo={false} size="small" />
                        <Text type="tertiary" size="small">{stats.percent}%（{stats.done}/{stats.total}）</Text>
                    </div>
                );
            }
        },
        {
            title: t('batchImportModal.agentMode', null, 'Agent mode'),
            dataIndex: 'agentMode',
            width: 150,
            render: value => <Text size="small">{agentModeLabel(value)}</Text>
        },
        {
            title: t('batchImportModal.scheduleMode', null, 'Schedule mode'),
            dataIndex: 'scheduleMode',
            width: 128,
            render: (value, record) => (
                <Text size="small">
                    {value === 'cron'
                        ? `Cron · ${record.cronExpr || ''}`
                        : t('batchImportModal.scheduleModeManual', null, 'Manual')}
                </Text>
            )
        },
        {
            title: t('tasks.createdTimeLabel', null, 'Created at'),
            dataIndex: 'createdAt',
            width: 160,
            render: value => <Text type="tertiary" size="small">{formatDateTime(value)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 250,
            render: (value, record) => (
                <Space spacing={2} wrap>
                    <Button size="small" theme="borderless" onClick={() => navigate(record.id, 'queues')}>
                        {t('projects.details', null, 'Details')}
                    </Button>
                    {record.status === 'running' ? (
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => pauseQueue(record)}>
                            {t('tasks.statusPaused', null, 'Paused')}
                        </Button>
                    ) : (
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => startQueue(record)}>
                            {t('ui.tasksIndex.start', null, 'Start')}
                        </Button>
                    )}
                    <Button
                        size="small"
                        theme="borderless"
                        disabled={!canWrite || !['completed', 'cancelled'].includes(record.status)}
                        onClick={() => rerunQueue(record)}
                    >
                        {t('tasks.retry', null, 'Retry')}
                    </Button>
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => deleteQueue(record)}>
                        {t('common.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <div className="task-page">
            <PageHeader
                title={t('tasks.title', null, 'Task Management')}
                description={t('tasks.pageDesc', null, 'Batch task queues run subtasks through a concurrency pool; open a queue to see progress, run single items, and view results.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} theme="borderless" loading={list.loading} onClick={refresh}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={() => setCreateVisible(true)}>
                            {t('batchImportModal.title', null, 'New task')}
                        </Button>
                    </Space>
                )}
            />

            <ErrorBanner error={errorProp(overview.error || list.error)} onRetry={refresh} />
            <StatGrid metrics={metrics} columns={4} />

            <Tabs
                type="line"
                activeKey={tab}
                onChange={key => navigate(undefined, key)}
                tabList={[
                    { itemKey: 'queues', tab: t('tasks.batchQueueTitle', null, 'Batch task queue') },
                    { itemKey: 'live', tab: t('ui.tasksIndex.liveTab', null, 'Running tasks') }
                ]}
                className="task-tabs"
            />

            {tab === 'live' ? (
                <LiveTasks />
            ) : (
                <SectionCard
                    title={t('tasks.batchQueueTitle', null, 'Batch task queue')}
                    description={t('tasks.finishedProgressHint', null, 'Progress counts finished tasks, including failures and cancellations; it is not the success rate.')}
                    extra={<Text type="tertiary" size="small">{t('tasks.taskCount', { count: total }, '{{count}} task(s)')}</Text>}
                >
                    <div className="task-toolbar">
                        <Input
                            prefix={<IconSearch />}
                            value={keyword}
                            showClear
                            placeholder={t('batchImportModal.queueTitlePlaceholder', null, 'Enter queue title (optional, for identification and filtering)')}
                            onChange={value => { setKeyword(value); setPage(1); }}
                            style={{ width: 280 }}
                        />
                        <Select
                            value={statusFilter}
                            onChange={value => { setStatusFilter(value); setPage(1); }}
                            style={{ width: 150 }}
                            optionList={QUEUE_STATUS_FILTERS}
                        />
                    </div>
                    <DataTable
                        columns={columns}
                        dataSource={queues}
                        rowKey="id"
                        loading={list.loading}
                        emptyText={statusFilter !== 'all' || keyword
                            ? t('tasks.noMatchingTasks', null, 'No matching tasks')
                            : t('tasks.noBatchQueues', null, 'Currently there are no batch task queues')}
                        pagination={{
                            currentPage: page,
                            pageSize,
                            total,
                            onPageChange: nextPage => setPage(nextPage),
                            onPageSizeChange: nextSize => { setPageSize(nextSize); setPage(1); }
                        }}
                    />
                </SectionCard>
            )}

            <QueueFormModal
                visible={createVisible}
                onCancel={() => setCreateVisible(false)}
                onCreated={payload => {
                    setCreateVisible(false);
                    refresh();
                    if (payload?.queueId) navigate(payload.queueId, 'queues');
                }}
            />

            <QueueDetailDrawer
                queueId={selectedId}
                visible={Boolean(selectedId)}
                canWrite={canWrite}
                canDelete={canDelete}
                onClose={() => navigate(undefined, tab)}
                onChanged={refresh}
            />
        </div>
    );
}
