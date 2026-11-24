/**
 * C2 session task list: view results, cancel and delete single tasks.
 */
import { useState } from 'react';
import { Button, Space, Tag } from '@douyinfe/semi-ui';
import { useT } from '../../lib/i18n';
import { useInterval, useResource } from '../../components/hooks';
import { Drawer, DataTable, ErrorBanner, JsonViewer, confirmAction, toastError, toastSuccess } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import * as c2 from './components/c2-api';
import { TASK_STATUS_COLOR, TimeText, formatDurationMs } from './components/c2-shared';

export default function SessionTasks({ session, canDelete, onChanged }) {
    const t = useT();
    const [detail, setDetail] = useState(null);
    const { data, loading, error, reload } = useResource(
        () => c2.listTasks({ session_id: session.id, limit: 100 }),
        [session.id]
    );
    const tasks = Array.isArray(data?.tasks) ? data.tasks : [];

    useInterval(() => reload({ silent: true }), 5000);

    const cancel = async task => {
        try {
            await c2.cancelTask(task.id);
            toastSuccess(t('c2.tasks.toastCancelled', null, 'Task cancelled'));
            reload({ silent: true });
            onChanged?.();
        } catch (err) {
            toastError(err);
        }
    };

    const remove = task => {
        confirmAction({
            title: t('c2.tasks.deleteOne', null, 'Delete task'),
            content: t('c2.tasks.confirmDeleteOne', null, 'Delete this task record from the server? This cannot be undone.'),
            onOk: async () => {
                try {
                    await c2.deleteTasks([task.id]);
                    toastSuccess(t('c2.tasks.toastDeleted', null, 'Deleted {{n}} task(s)').replace('{{n}}', '1'));
                    reload({ silent: true });
                    onChanged?.();
                } catch (err) {
                    toastError(err);
                }
            }
        });
    };

    const columns = [
        { title: t('c2.tasks.colType', null, 'Type'), dataIndex: 'taskType', width: 120 },
        {
            title: t('c2.tasks.colCommand', null, 'Command'),
            dataIndex: 'payload',
            render: value => {
                const command = value?.command || value?.path || '';
                return <span className="c2-mono">{command || '—'}</span>;
            }
        },
        {
            title: t('c2.tasks.colStatus', null, 'Status'),
            dataIndex: 'status',
            width: 110,
            render: status => <Tag size="small" color={TASK_STATUS_COLOR[status] || 'grey'}>{t(`c2.tasks.${status || 'queued'}`, null, status || '—')}</Tag>
        },
        {
            title: t('c2.tasks.colDuration', null, 'Duration'),
            dataIndex: 'durationMs',
            width: 100,
            render: value => formatDurationMs(value)
        },
        { title: t('c2.tasks.colCreated', null, 'Created'), dataIndex: 'createdAt', width: 140, render: value => <TimeText value={value} /> },
        {
            title: t('c2.tasks.colActions', null, 'Actions'),
            dataIndex: 'actions',
            width: 200,
            render: (_, task) => (
                <Space spacing={4} wrap>
                    <Button size="small" theme="borderless" onClick={() => setDetail(task)}>{t('c2.tasks.view', null, 'View')}</Button>
                    {['queued', 'sent', 'running'].includes(task.status) && (
                        <Button size="small" theme="borderless" onClick={() => cancel(task)}>{t('c2.tasks.cancelBtn', null, 'Cancel')}</Button>
                    )}
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => remove(task)}>
                        {t('c2.tasks.deleteBtn', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <div className="c2-session-tasks">
            <ErrorBanner error={error} onRetry={() => reload()} />
            <DataTable
                columns={columns}
                dataSource={tasks}
                rowKey="id"
                loading={loading}
                onRefresh={() => reload()}
                pagination={{ pageSize: 10 }}
                emptyText={t('c2.tasks.emptySession', null, 'No tasks for this session')}
            />

            <Drawer
                visible={Boolean(detail)}
                title={t('c2.tasks.modalTitle', null, 'Task details')}
                width={720}
                onCancel={() => setDetail(null)}
                footer={<Button onClick={() => setDetail(null)}>{t('c2.tasks.close', null, 'Close')}</Button>}
            >
                {detail && (
                    <div className="c2-task-detail">
                        <div className="c2-task-detail-meta">
                            <span className="c2-mono">{detail.id}</span>
                            <Tag size="small" color={TASK_STATUS_COLOR[detail.status] || 'grey'}>{detail.status}</Tag>
                            <span className="c2-muted">{formatDateTime(detail.createdAt)}</span>
                        </div>
                        {detail.payload && <JsonViewer title={t('c2.tasks.labelPayload', null, 'Payload')} value={detail.payload} collapsed />}
                        {detail.resultText && (
                            <>
                                <div className="c2-field-label">{t('c2.tasks.labelResult', null, 'Output')}</div>
                                <pre className="c2-pre">{detail.resultText}</pre>
                            </>
                        )}
                        {detail.error && (
                            <>
                                <div className="c2-field-label">{t('c2.tasks.labelError', null, 'Error')}</div>
                                <pre className="c2-pre c2-pre-error">{detail.error}</pre>
                            </>
                        )}
                    </div>
                )}
            </Drawer>
        </div>
    );
}
