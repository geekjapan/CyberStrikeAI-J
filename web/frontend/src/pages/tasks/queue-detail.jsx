/** Queue detail drawer: progress, subtask table, start/pause/rerun, single execution and result view. */
import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
    Button, Progress, SideSheet, Space, Tag, TextArea, Typography
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { translate, useT } from '../../lib/i18n';
import { useInterval, useResource } from '../../components/hooks';
import {
    Drawer, DataTable, ErrorBanner, KeyValueList, MarkdownView, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import {
    AGENT_MODES, HITL_POLICIES, TASK_STATUS, durationText, errorProp, errText,
    queueStats, queueStatusView
} from './helpers';

const { Text } = Typography;

function TaskStatusTag({ status }) {
    const meta = TASK_STATUS[String(status || '')] || { label: status || '—', color: 'grey' };
    return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
}

export default function QueueDetailDrawer({ queueId, visible, canWrite, canDelete, onClose, onChanged }) {
    const t = useT();
    const navigate = useNavigate();
    const [rev, setRev] = useState(0);
    const [taskModal, setTaskModal] = useState({ visible: false, taskId: '', message: '' });
    const [resultModal, setResultModal] = useState({ visible: false, task: null });

    const detail = useResource(
        () => (queueId ? api.get(`/batch-tasks/${queueId}`) : Promise.resolve(null)),
        [queueId, rev]
    );
    const queue = detail.data?.queue || null;
    const stats = useMemo(() => queueStats(queue), [queue]);

    useInterval(() => {
        if (visible && queue?.status === 'running') detail.reload({ silent: true });
    }, visible && queue?.status === 'running' ? 4000 : 0);

    useEffect(() => {
        if (visible && queueId) detail.reload({ silent: true });
    }, [visible, queueId]); // eslint-disable-line react-hooks/exhaustive-deps

    useEffect(() => {
        if (!visible) {
            setTaskModal({ visible: false, taskId: '', message: '' });
            setResultModal({ visible: false, task: null });
        }
    }, [visible]);

    const refresh = () => {
        setRev(value => value + 1);
        onChanged?.();
    };

    const act = async (action, label) => {
        try {
            await api.post(`/batch-tasks/${queueId}/${action}`);
            toastSuccess(label);
            refresh();
        } catch (error) {
            toastError(errText(error, translate('ui.tasksQueueDetail.actionFailed', { label }, '{{label}} failed')));
        }
    };

    const start = () => act('start', translate('ui.tasksQueueDetail.started', null, 'Started'));
    const pause = () => confirmAction({
        title: t('tasks.statusPaused', null, 'Paused'),
        content: t('tasks.pauseQueueConfirm', null, 'Pause this batch queue? The current task will be stopped; remaining tasks will stay pending.'),
        okText: t('common.confirm', null, 'Confirm'),
        onOk: async () => {
            try {
                await api.post(`/batch-tasks/${queueId}/pause`);
                toastSuccess(t('tasks.statusPaused', null, 'Paused'));
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.pauseQueueFailed', null, 'Failed to pause queue')));
            }
        }
    });
    const rerun = () => confirmAction({
        title: t('tasks.retry', null, 'Retry'),
        content: t('tasks.rerunQueueConfirm', null, 'Rerun this batch queue? All tasks will be reset to pending and re-executed.'),
        okText: t('common.confirm', null, 'Confirm'),
        onOk: async () => {
            try {
                await api.post(`/batch-tasks/${queueId}/rerun`);
                toastSuccess(t('tasks.statusRunning', null, 'Running'));
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.rerunQueueFailed', null, 'Failed to rerun batch queue')));
            }
        }
    });
    const removeQueue = () => confirmAction({
        title: t('tasks.deleteQueue', null, 'Delete queue'),
        content: t('tasks.deleteQueueConfirm', null, 'Delete this batch queue? This cannot be undone.'),
        okText: t('common.delete', null, 'Delete'),
        onOk: async () => {
            try {
                await api.del(`/batch-tasks/${queueId}`);
                toastSuccess(t('tasks.deleteQueue', null, 'Delete queue'));
                onChanged?.();
                onClose?.();
            } catch (error) {
                toastError(errText(error, t('tasks.deleteQueueFailed', null, 'Failed to delete batch queue')));
            }
        }
    });

    const openTaskModal = (record) => setTaskModal({
        visible: true,
        taskId: record?.id || '',
        message: record?.message || ''
    });

    const saveTask = async () => {
        const message = taskModal.message.trim();
        if (!message) {
            toastError(t('tasks.taskMessageRequired', null, 'Task message is required'));
            return;
        }
        try {
            if (taskModal.taskId) {
                await api.put(`/batch-tasks/${queueId}/tasks/${taskModal.taskId}`, { message });
            } else {
                await api.post(`/batch-tasks/${queueId}/tasks`, { message });
            }
            toastSuccess(t('common.save', null, 'Save'));
            setTaskModal({ visible: false, taskId: '', message: '' });
            refresh();
        } catch (error) {
            toastError(errText(error, taskModal.taskId
                ? t('tasks.saveTaskFailed', null, 'Failed to save task')
                : t('tasks.addTaskFailed', null, 'Failed to add task')));
        }
    };

    const runSingle = (record) => confirmAction({
        title: t('tasks.runSingleTask', null, 'Run task'),
        content: t('tasks.confirmRunSingleTask', null, 'Run this task only? The queue will pause when it finishes and will not continue other pending items.'),
        okText: t('common.confirm', null, 'Confirm'),
        danger: false,
        onOk: async () => {
            try {
                await api.post(`/batch-tasks/${queueId}/tasks/${record.id}/run`);
                toastSuccess(t('tasks.runSingleTask', null, 'Run task'));
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.runSingleTaskFailed', null, 'Failed to run task')));
            }
        }
    });

    const removeTask = (record) => confirmAction({
        title: t('common.delete', null, 'Delete'),
        content: t('tasks.confirmDeleteTask', null, 'Delete this task?\n\nTask: {{message}}\n\nThis cannot be undone.'),
        okText: t('common.delete', null, 'Delete'),
        onOk: async () => {
            try {
                await api.del(`/batch-tasks/${queueId}/tasks/${record.id}`);
                toastSuccess(t('common.delete', null, 'Delete'));
                refresh();
            } catch (error) {
                toastError(errText(error, t('tasks.deleteTaskFailed', null, 'Failed to delete task')));
            }
        }
    });

    const canRunSingle = (record) => Boolean(
        canWrite
        && queue
        && record.status !== 'running'
        && queue.status !== 'running'
        && ['pending', 'paused', 'completed', 'cancelled'].includes(queue.status)
    );

    const columns = [
        {
            title: '#',
            dataIndex: 'id',
            width: 58,
            render: (value, record) => {
                const index = (queue?.tasks || []).findIndex(item => item.id === record.id);
                return <Text type="tertiary" size="small">{index + 1}</Text>;
            }
        },
        {
            title: t('tasks.title', null, 'Task Management'),
            dataIndex: 'message',
            render: (value, record) => (
                <span className="task-cell-message" title={value}>{value || t('tasks.taskIncomplete', null, 'Task information incomplete')}</span>
            )
        },
        {
            title: t('projects.status', null, 'Status'),
            dataIndex: 'status',
            width: 96,
            render: value => <TaskStatusTag status={value} />
        },
        {
            title: t('tasks.duration', null, 'Duration'),
            dataIndex: 'startedAt',
            width: 110,
            render: (value, record) => (
                <Text size="small">{value ? durationText(value, record.completedAt) : '—'}</Text>
            )
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 210,
            render: (value, record) => (
                <Space spacing={2} wrap>
                    <Button
                        size="small"
                        theme="borderless"
                        onClick={() => setResultModal({ visible: true, task: record })}
                    >
                        {t('ui.tasksQueueDetail.result', null, 'Result')}
                    </Button>
                    <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => openTaskModal(record)}>
                        {t('common.edit', null, 'Edit')}
                    </Button>
                    <Button
                        size="small"
                        theme="borderless"
                        disabled={!canRunSingle(record)}
                        title={t('tasks.runSingleTaskUnavailable', null, 'Unavailable while the queue or a task is running')}
                        onClick={() => runSingle(record)}
                    >
                        {t('tasks.runSingleTask', null, 'Run task')}
                    </Button>
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => removeTask(record)}>
                        {t('common.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    const statusView = queueStatusView(queue);
    const cronOn = queue?.scheduleMode === 'cron' && queue?.scheduleEnabled !== false;

    return (
        <SideSheet
            visible={visible}
            width={900}
            title={queue ? (queue.title || queue.id) : t('tasks.batchQueueTitle', null, 'Batch task queue')}
            onCancel={onClose}
        >
            <ErrorBanner error={errorProp(detail.error)} onRetry={() => detail.reload()} />
            {queue ? (
                <div className="task-detail-stack">
                    <div className="task-detail-actions">
                        <Space wrap>
                            <Button
                                type="primary"
                                disabled={!canWrite || queue.status === 'running'}
                                onClick={start}
                            >
                                {t('ui.tasksQueueDetail.start', null, 'Start')}
                            </Button>
                            <Button disabled={!canWrite || queue.status !== 'running'} onClick={pause}>
                                {t('ui.tasksQueueDetail.pause', null, 'Pause')}
                            </Button>
                            <Button
                                disabled={!canWrite || !['completed', 'cancelled'].includes(queue.status)}
                                onClick={rerun}
                            >
                                {t('tasks.retry', null, 'Retry')}
                            </Button>
                            <Button icon={<IconRefresh />} theme="borderless" onClick={() => detail.reload()} />
                        </Space>
                        <Space>
                            <Button icon={<IconPlus />} disabled={!canWrite} onClick={() => openTaskModal(null)}>
                                {t('ui.tasksQueueDetail.addTask', null, 'Add task')}
                            </Button>
                            <Button type="danger" disabled={!canDelete} onClick={removeQueue}>
                                {t('tasks.deleteQueue', null, 'Delete queue')}
                            </Button>
                        </Space>
                    </div>

                    <div className="task-progress-block">
                        <div className="task-progress-head">
                            <Tag size="small" color={statusView.color}>{statusView.label}</Tag>
                            {statusView.sublabel ? <Text type="tertiary" size="small">{statusView.sublabel}</Text> : null}
                        </div>
                        <Progress percent={stats.percent} showInfo stroke="var(--semi-color-primary)" />
                        <div className="task-progress-legend">
                            <span>{t('tasks.totalLabel', null, 'Total')} {stats.total}</span>
                            <span>{t('tasks.pendingLabel', null, 'Pending')} {stats.pending}</span>
                            <span>{t('tasks.runningLabel', null, 'Running')} {stats.running}</span>
                            <span>{t('tasks.completedLabel', null, 'Completed')} {stats.completed}</span>
                            <span>{t('tasks.failedLabel', null, 'Failed')} {stats.failed}</span>
                            <span>{t('tasks.cancelledLabel', null, 'Cancelled')} {stats.cancelled}</span>
                            <span>{t('ui.tasksQueueDetail.blocked', null, 'Blocked')} {stats.blocked}</span>
                        </div>
                        <Text type="tertiary" size="small">
                            {cronOn
                                ? t('tasks.cronRunningProgressHint', null, 'This round is running; the next full cycle follows Cron / next run time')
                                : t('tasks.finishedProgressHint', null, 'Progress counts finished tasks, including failures and cancellations; it is not the success rate.')}
                        </Text>
                    </div>

                    <KeyValueList
                        columns={3}
                        items={[
                            { label: t('tasks.queueIdLabel', null, 'Queue ID'), value: <code>{queue.id}</code> },
                            { label: t('tasks.createdTimeLabel', null, 'Created at'), value: formatDateTime(queue.createdAt) },
                            { label: t('ui.tasksQueueDetail.agentMode', null, 'Agent mode'), value: (AGENT_MODES.find(item => item.value === queue.agentMode) || AGENT_MODES[0]).label },
                            { label: t('ui.tasksQueueDetail.role', null, 'Role'), value: queue.role || t('batchImportModal.defaultRole', null, 'Default') },
                            { label: t('ui.tasksQueueDetail.project', null, 'Project'), value: queue.projectId || '—' },
                            {
                                label: t('batchImportModal.hitlPolicy', null, 'Tool approval'),
                                value: (HITL_POLICIES.find(item => item.value === (queue.hitlPolicy || '')) || HITL_POLICIES[0]).label
                            },
                            { label: t('batchImportModal.concurrency', null, 'Concurrency'), value: queue.concurrency || 1 },
                            {
                                label: t('batchImportModal.scheduleMode', null, 'Schedule mode'),
                                value: queue.scheduleMode === 'cron'
                                    ? `Cron ${queue.cronExpr || ''}${cronOn ? '' : t('ui.tasksQueueDetail.cronOff', null, ' (off)')}`
                                    : t('batchImportModal.scheduleModeManual', null, 'Manual')
                            },
                            { label: t('ui.tasksQueueDetail.nextRun', null, 'Next run'), value: queue.nextRunAt ? formatDateTime(queue.nextRunAt) : '—' },
                            queue.lastRunError ? { label: t('ui.tasksQueueDetail.lastError', null, 'Last error'), value: <Text type="danger" size="small">{queue.lastRunError}</Text> } : null
                        ]}
                    />

                    <DataTable
                        columns={columns}
                        dataSource={queue.tasks || []}
                        rowKey="id"
                        size="small"
                        pagination={{ pageSize: 10 }}
                        emptyText={t('tasks.noValidTask', null, 'No valid tasks')}
                    />
                </div>
            ) : null}

            <Drawer
                visible={taskModal.visible}
                title={taskModal.taskId ? t('common.edit', null, 'Edit') : t('ui.tasksQueueDetail.addTask', null, 'Add task')}
                onCancel={() => setTaskModal({ visible: false, taskId: '', message: '' })}
                onOk={saveTask}
                okText={t('common.save', null, 'Save')}
                cancelText={t('common.cancel', null, 'Cancel')}
                width={620}
            >
                <TextArea
                    value={taskModal.message}
                    rows={5}
                    placeholder={t('batchImportModal.tasksListPlaceholder', null, 'Enter task list, one per line')}
                    onChange={value => setTaskModal(prev => ({ ...prev, message: value }))}
                />
            </Drawer>

            <Drawer
                visible={resultModal.visible}
                title={resultModal.task ? resultModal.task.message : t('ui.tasksQueueDetail.result', null, 'Result')}
                onCancel={() => setResultModal({ visible: false, task: null })}
                footer={(
                    <Space>
                        {resultModal.task?.conversationId ? (
                            <Button
                                onClick={() => {
                                    const id = resultModal.task.conversationId;
                                    setResultModal({ visible: false, task: null });
                                    onClose?.();
                                    navigate(`/chat?conversation=${encodeURIComponent(id)}`);
                                }}
                            >
                                {t('tasks.viewConversation', null, 'View conversation')}
                            </Button>
                        ) : null}
                        <Button onClick={() => setResultModal({ visible: false, task: null })}>
                            {t('common.close', null, 'Close')}
                        </Button>
                    </Space>
                )}
                width={720}
            >
                <div className="task-detail-stack">
                    <KeyValueList
                        columns={2}
                        items={[
                            { label: t('projects.status', null, 'Status'), value: <TaskStatusTag status={resultModal.task?.status} /> },
                            { label: t('tasks.startedAt', null, 'Started at'), value: formatDateTime(resultModal.task?.startedAt) },
                            { label: t('tasks.completedAt', null, 'Completed at'), value: formatDateTime(resultModal.task?.completedAt) },
                            { label: t('tasks.duration', null, 'Duration'), value: durationText(resultModal.task?.startedAt, resultModal.task?.completedAt) },
                            resultModal.task?.conversationId
                                ? { label: t('tasks.conversationIdLabel', null, 'Conversation ID'), value: <code>{resultModal.task.conversationId}</code> }
                                : null
                        ]}
                    />
                    {resultModal.task?.error ? (
                        <div>
                            <Text strong type="danger">
                                {resultModal.task.status === 'blocked' ? t('ui.tasksQueueDetail.blockedReason', null, 'Blocked reason') : t('tasks.statusFailed', null, 'Failed')}
                            </Text>
                            <pre className="task-result-pre">{resultModal.task.error}</pre>
                        </div>
                    ) : null}
                    {resultModal.task?.result
                        ? <MarkdownView content={resultModal.task.result} />
                        : <Text type="tertiary">{t('ui.tasksQueueDetail.noResult', null, 'No result yet')}</Text>}
                </div>
            </Drawer>
        </SideSheet>
    );
}
