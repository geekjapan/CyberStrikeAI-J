/** Workflows: list, stats, create/edit/delete, detail drawer, run history and package import/export. */
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Input, Space, Switch, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api, downloadFile } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useDebounced, useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard, StatGrid, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import WorkflowFormModal from './workflow-form';
import WorkflowDetailDrawer from './workflow-detail';
import RunsPanel from './runs-panel';
import PackageImportModal from './package-import';
import { graphSummary, errText, errorProp } from './helpers';
import './page.css';

const { Text } = Typography;

async function loadWorkflows() {
    const [list, pending] = await Promise.all([
        api.get('/workflows', { includeDisabled: 'true' }),
        api.get('/workflows/runs/pending').catch(() => null)
    ]);
    return {
        workflows: Array.isArray(list?.workflows) ? list.workflows : [],
        pendingRuns: Array.isArray(pending?.runs) ? pending.runs : []
    };
}

export default function WorkflowsPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('workflow:write');
    const canDelete = hasPermission('workflow:delete');
    const canExecute = hasPermission('workflow:execute');

    const [params, setParams] = useSearchParams();
    const selectedId = params.get('id') || '';
    const tab = params.get('tab') || 'list';

    const [search, setSearch] = useState('');
    const debounced = useDebounced(search, 250);
    const [includeDisabled, setIncludeDisabled] = useState(true);
    const [formState, setFormState] = useState({ visible: false, workflow: null });
    const [importVisible, setImportVisible] = useState(false);
    const [rev, setRev] = useState(0);

    const overview = useResource(loadWorkflows, [rev]);
    const workflows = overview.data?.workflows || [];
    const pendingRuns = overview.data?.pendingRuns || [];

    const navigate = useCallback((nextId, nextTab) => {
        const next = new URLSearchParams(params);
        if (nextId) next.set('id', nextId);
        else next.delete('id');
        if (nextTab) next.set('tab', nextTab);
        else next.delete('tab');
        if (nextTab && nextTab !== 'runs') next.delete('run');
        setParams(next, { replace: Boolean(nextId) });
    }, [params, setParams]);

    const refresh = () => setRev(value => value + 1);

    const filtered = useMemo(() => {
        const keyword = debounced.trim().toLowerCase();
        return workflows.filter(item => {
            if (!includeDisabled && item.enabled === false) return false;
            if (!keyword) return true;
            return [item.id, item.name, item.description].join(' ').toLowerCase().includes(keyword);
        });
    }, [workflows, debounced, includeDisabled]);

    const invalidCount = workflows.filter(item => Boolean(item.validation_error)).length;
    const enabledCount = workflows.filter(item => item.enabled).length;

    const metrics = [
        { id: 'total', label: t('workflows.processLibrary', null, 'Workflows'), value: workflows.length, loading: overview.loading },
        { id: 'enabled', label: t('workflows.statusEnabled', null, 'Enabled'), value: enabledCount, tone: 'success', loading: overview.loading },
        {
            id: 'invalid',
            label: t('workflows.statusInvalid', null, 'Invalid workflow'),
            value: invalidCount,
            tone: invalidCount ? 'danger' : undefined,
            loading: overview.loading
        },
        {
            id: 'pending',
            label: t('workflows.runsPending', null, 'Runs pending approval'),
            value: pendingRuns.length,
            tone: pendingRuns.length ? 'warning' : undefined,
            loading: overview.loading
        }
    ];

    const exportPackage = async (record) => {
        try {
            await downloadFile(`/workflows/${encodeURIComponent(record.id)}/package`, { filename: `${record.id}.csapkg.zip` });
            toastSuccess(t('workflows.package.export', null, 'Export'));
        } catch (error) {
            toastError(errText(error, t('workflows.package.errors.exportFailed', null, 'Export failed. Try again later.')));
        }
    };

    const removeWorkflow = (record) => confirmAction({
        title: t('workflows.deleteWorkflow', null, 'Delete workflow'),
        content: t('workflows.confirmDelete', { id: record.id }, 'Delete workflow {{id}}?'),
        okText: t('common.delete', null, 'Delete'),
        onOk: async () => {
            try {
                await api.del(`/workflows/${encodeURIComponent(record.id)}`);
                toastSuccess(t('workflows.deleted', null, 'Workflow deleted'));
                if (selectedId === record.id) navigate(undefined, tab);
                refresh();
            } catch (error) {
                toastError(errText(error, t('workflows.deleteFailed', null, 'Failed to delete workflow')));
            }
        }
    });

    const columns = [
        {
            title: t('workflows.metaName', null, 'Name'),
            dataIndex: 'name',
            render: (value, record) => {
                const summary = graphSummary(record.graph_json);
                return (
                    <button
                        type="button"
                        className="workflow-name-button"
                        onClick={() => navigate(record.id, 'list')}
                        title={record.id}
                    >
                        <span className="workflow-name-text">{value || t('workflows.untitled', null, 'Untitled workflow')}</span>
                        <span className="workflow-name-sub">
                            <code>{record.id}</code>
                            {' · '}
                            {summary.error
                                ? t('ui.workflowsIndex.graphParseFailed', null, 'Graph parse failed')
                                : t('ui.workflowsIndex.nodeEdgeCount', { nodes: summary.nodes.length, edges: summary.edges.length }, '{{nodes}} nodes / {{edges}} edges')}
                        </span>
                    </button>
                );
            }
        },
        {
            title: t('projects.status', null, 'Status'),
            dataIndex: 'enabled',
            width: 150,
            render: (value, record) => (
                <Space spacing={4} wrap>
                    <Tag size="small" color={value ? 'green' : 'grey'}>
                        {value ? t('workflows.statusEnabled', null, 'Enabled') : t('workflows.statusDisabled', null, 'Disabled')}
                    </Tag>
                    {record.validation_error
                        ? <Tag size="small" color="red">{t('workflows.statusInvalid', null, 'Invalid workflow')}</Tag>
                        : null}
                </Space>
            )
        },
        {
            title: t('ui.workflowsIndex.version', null, 'Version'),
            dataIndex: 'version',
            width: 80,
            render: value => <Text size="small">v{value ?? 0}</Text>
        },
        {
            title: t('projects.updated', null, 'Updated'),
            dataIndex: 'updated_at',
            width: 165,
            render: value => <Text type="tertiary" size="small">{formatDateTime(value)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 260,
            render: (value, record) => (
                <Space spacing={2} wrap>
                    <Button size="small" theme="borderless" onClick={() => navigate(record.id, 'list')}>
                        {t('projects.details', null, 'Details')}
                    </Button>
                    <Button
                        size="small"
                        theme="borderless"
                        disabled={!canWrite}
                        onClick={() => setFormState({ visible: true, workflow: record })}
                    >
                        {t('common.edit', null, 'Edit')}
                    </Button>
                    <Button size="small" theme="borderless" onClick={() => exportPackage(record)}>
                        {t('workflows.package.export', null, 'Export')}
                    </Button>
                    <Button size="small" theme="borderless" type="danger" disabled={!canDelete} onClick={() => removeWorkflow(record)}>
                        {t('common.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <div className="workflow-page">
            <PageHeader
                title={t('workflows.title', null, 'Workflows')}
                description={t('workflows.processLibraryHint', null, 'A workflow definition is made of nodes and edges and can be triggered on demand by a role or a conversation.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} theme="borderless" loading={overview.loading} onClick={refresh}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button disabled={!canWrite} onClick={() => setImportVisible(true)}>
                            {t('workflows.package.importLocal', null, 'Import local package')}
                        </Button>
                        <Button type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={() => setFormState({ visible: true, workflow: null })}>
                            {t('workflows.newGraph', null, 'New workflow')}
                        </Button>
                    </Space>
                )}
            />

            <ErrorBanner error={errorProp(overview.error)} onRetry={refresh} />
            <StatGrid metrics={metrics} columns={4} />

            <Tabs
                type="line"
                activeKey={tab}
                onChange={key => navigate(undefined, key)}
                tabList={[
                    { itemKey: 'list', tab: t('workflows.processLibrary', null, 'Workflows') },
                    { itemKey: 'runs', tab: t('workflows.runsHistory', null, 'Run history') }
                ]}
                className="workflow-tabs"
            />

            {tab === 'runs' ? (
                <RunsPanel canExecute={canExecute} />
            ) : (
                <SectionCard
                    title={t('workflows.processLibrary', null, 'Workflows')}
                    description={t('workflows.metaIdHint', null, 'Cannot be changed after creation; used for API and role binding')}
                    extra={<Text type="tertiary" size="small">{filtered.length} / {workflows.length}</Text>}
                >
                    <div className="workflow-toolbar">
                        <Input
                            prefix={<IconSearch />}
                            value={search}
                            showClear
                            placeholder={t('workflows.searchPlaceholder', null, 'Search workflows…')}
                            onChange={value => setSearch(value)}
                            style={{ width: 260 }}
                        />
                        <Space spacing={6}>
                            <Switch checked={includeDisabled} onChange={setIncludeDisabled} size="small" />
                            <Text size="small">{t('ui.workflowsIndex.showDisabled', null, 'Show disabled')}</Text>
                        </Space>
                    </div>
                    <DataTable
                        columns={columns}
                        dataSource={filtered}
                        rowKey="id"
                        loading={overview.loading}
                        pagination={{ pageSize: 10 }}
                        emptyText={t('workflows.emptyList', null, 'No workflows yet')}
                    />
                </SectionCard>
            )}

            <WorkflowFormModal
                visible={formState.visible}
                workflow={formState.workflow}
                onCancel={() => setFormState({ visible: false, workflow: null })}
                onSaved={saved => {
                    setFormState({ visible: false, workflow: null });
                    refresh();
                    if (saved?.id) navigate(saved.id, 'list');
                }}
            />

            <WorkflowDetailDrawer
                workflowId={selectedId}
                visible={Boolean(selectedId)}
                canWrite={canWrite}
                canDelete={canDelete}
                onClose={() => navigate(undefined, tab)}
                onEdit={workflow => {
                    if (!workflow) return;
                    navigate(undefined, tab);
                    setFormState({ visible: true, workflow });
                }}
                onDeleted={() => {
                    navigate(undefined, tab);
                    refresh();
                }}
            />

            <PackageImportModal
                visible={importVisible}
                onCancel={() => setImportVisible(false)}
                onImported={() => refresh()}
            />
        </div>
    );
}
