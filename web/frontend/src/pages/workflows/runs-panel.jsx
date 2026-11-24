/** Run history: pending-approval run list + run detail (replay) drawer. */
import { useSearchParams } from 'react-router-dom';
import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useInterval, useResource } from '../../components/hooks';
import { DataTable, ErrorBanner, SectionCard } from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { RUN_STATUS, errorProp, shortHash } from './helpers';
import RunDetailDrawer from './run-detail';

const { Text } = Typography;

export default function RunsPanel({ canExecute }) {
    const t = useT();
    const [params, setParams] = useSearchParams();
    const runId = params.get('run') || '';

    const pending = useResource(() => api.get('/workflows/runs/pending'), []);
    useInterval(() => pending.reload({ silent: true }), 15000);

    const runs = Array.isArray(pending.data?.runs) ? pending.data.runs : [];

    const openRun = (id) => {
        const next = new URLSearchParams(params);
        if (id) next.set('run', id);
        else next.delete('run');
        setParams(next, { replace: true });
    };

    const columns = [
        {
            title: t('ui.workflowsRunsPanel.run', null, 'Run'),
            dataIndex: 'id',
            width: 190,
            render: value => (
                <Button size="small" theme="borderless" onClick={() => openRun(value)}>
                    <code>{shortHash(value, 14)}</code>
                </Button>
            )
        },
        {
            title: t('ui.workflowsRunsPanel.workflow', null, 'Workflow'),
            dataIndex: 'workflow_id',
            width: 200,
            render: value => <Text size="small"><code>{value}</code></Text>
        },
        {
            title: t('ui.workflowsRunsPanel.conversation', null, 'Conversation'),
            dataIndex: 'conversation_id',
            width: 220,
            render: value => <Text type="tertiary" size="small"><code>{value || '—'}</code></Text>
        },
        {
            title: t('projects.status', null, 'Status'),
            dataIndex: 'status',
            width: 110,
            render: value => {
                const meta = RUN_STATUS[String(value || '')] || { label: value || '—', color: 'grey' };
                return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
            }
        },
        {
            title: t('ui.workflowsRunsPanel.pendingNode', null, 'Pending approval node'),
            dataIndex: 'pending_hitl_node_id',
            width: 160,
            render: value => (value ? <code>{value}</code> : <Text type="tertiary">—</Text>)
        },
        {
            title: t('ui.workflowsRunsPanel.startedAt', null, 'Started at'),
            dataIndex: 'started_at',
            width: 165,
            render: value => <Text size="small">{formatDateTime(value)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 120,
            render: value => (
                <Space>
                    <Button size="small" theme="borderless" onClick={() => openRun(value)}>
                        {t('projects.details', null, 'Details')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <>
            <SectionCard
                title={t('workflows.runsPending', null, 'Runs pending approval')}
                description={canExecute
                    ? t('ui.workflowsRunsPanel.descriptionExecute', null, 'Workflow runs awaiting approval (awaiting_hitl), refreshed every 15 seconds. You can approve or reject them here.')
                    : t('ui.workflowsRunsPanel.descriptionReadonly', null, 'Workflow runs awaiting approval (awaiting_hitl), refreshed every 15 seconds.')}
                extra={(
                    <Button icon={<IconRefresh />} theme="borderless" loading={pending.loading} onClick={() => pending.reload()}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>
                )}
            >
                <ErrorBanner error={errorProp(pending.error)} onRetry={() => pending.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={runs}
                    rowKey="id"
                    loading={pending.loading}
                    pagination={{ pageSize: 10 }}
                    emptyText={t('ui.workflowsRunsPanel.empty', null, 'No workflow runs are awaiting approval')}
                />
            </SectionCard>

            <RunDetailDrawer
                runId={runId}
                visible={Boolean(runId)}
                canExecute={canExecute}
                onClose={() => openRun('')}
                onChanged={() => pending.reload({ silent: true })}
            />
        </>
    );
}
