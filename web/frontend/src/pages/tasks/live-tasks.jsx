/** Running tasks (Agent Loop): read-only view + auto refresh + jump to conversation. */
import { useNavigate } from 'react-router-dom';
import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { translate, useT } from '../../lib/i18n';
import { useInterval, useResource } from '../../components/hooks';
import { DataTable, ErrorBanner, SectionCard } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { durationText, errorProp } from './helpers';

const { Text } = Typography;

const RUN_STATUS = {
    running: { get label() { return translate('ui.tasksLive.running', null, 'Running'); }, color: 'blue' },
    cancelling: { get label() { return translate('ui.tasksLive.cancelling', null, 'Cancelling'); }, color: 'amber' },
    cleaning: { get label() { return translate('ui.tasksLive.cleaning', null, 'Cleaning up'); }, color: 'amber' }
};

export default function LiveTasks() {
    const t = useT();
    const navigate = useNavigate();
    const tasks = useResource(() => api.get('/agent-loop/tasks'), []);

    useInterval(() => tasks.reload({ silent: true }), 6000);

    const rows = Array.isArray(tasks.data?.tasks) ? tasks.data.tasks : [];

    const columns = [
        {
            title: t('tasks.title', null, 'Task Management'),
            dataIndex: 'title',
            render: (value, record) => (
                <div className="task-live-title">
                    <span className="task-cell-message" title={value || record.message}>
                        {value || record.message || t('tasks.unnamedTask', null, 'Unnamed task')}
                    </span>
                    <Text type="tertiary" size="small"><code>{record.runId || '—'}</code></Text>
                </div>
            )
        },
        {
            title: t('projects.status', null, 'Status'),
            dataIndex: 'status',
            width: 110,
            render: value => {
                const meta = RUN_STATUS[String(value || '')] || { label: value || '—', color: 'blue' };
                return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
            }
        },
        {
            title: t('tasks.conversationIdLabel', null, 'Conversation ID'),
            dataIndex: 'conversationId',
            width: 230,
            render: value => <Text type="tertiary" size="small"><code>{value || '—'}</code></Text>
        },
        {
            title: t('tasks.startedAt', null, 'Started at'),
            dataIndex: 'startedAt',
            width: 165,
            render: value => <Text size="small">{formatDateTime(value)}</Text>
        },
        {
            title: t('tasks.duration', null, 'Duration'),
            dataIndex: 'startedAt',
            width: 110,
            render: value => <Text size="small">{durationText(value)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'conversationId',
            width: 110,
            render: value => (
                <Space>
                    <Button
                        size="small"
                        theme="borderless"
                        disabled={!value}
                        onClick={() => navigate(`/chat?conversation=${encodeURIComponent(value)}`)}
                    >
                        {t('tasks.viewConversation', null, 'View conversation')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <SectionCard
            title={t('ui.tasksLive.title', null, 'Running tasks (Agent Loop)')}
            description={t('ui.tasksLive.description', null, 'Agent tasks currently running in this process. Refreshes automatically every 6 seconds.')}
            extra={(
                <Button icon={<IconRefresh />} theme="borderless" loading={tasks.loading} onClick={() => tasks.reload()}>
                    {t('common.refresh', null, 'Refresh')}
                </Button>
            )}
        >
            <ErrorBanner error={errorProp(tasks.error)} onRetry={() => tasks.reload()} />
            <DataTable
                columns={columns}
                dataSource={rows}
                rowKey={record => record.runId || record.conversationId || 'unknown-task'}
                loading={tasks.loading}
                pagination={{ pageSize: 10 }}
                emptyText={t('tasks.noMatchingTasks', null, 'No matching tasks')}
            />
        </SectionCard>
    );
}
