/** Project management: project list (with dashboard stats), project detail, deep link ?id=. */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Empty, Input, Pagination, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useDebounced, useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard, StatGrid, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import ProjectFormModal from './project-form';
import ProjectDetail from './detail';
import { errorProp, errText } from './helpers';
import './page.css';

const { Text } = Typography;
const PROJECT_PAGE_SIZE = 10;

async function loadProjects() {
    const [list, summary] = await Promise.all([
        api.get('/projects', { limit: 500 }),
        api.get('/projects/dashboard-summary', { fact_limit: 6 }).catch(() => null)
    ]);
    return {
        projects: Array.isArray(list?.projects) ? list.projects : [],
        total: list?.total ?? 0,
        summary
    };
}

export default function ProjectsPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('project:write');
    const canDelete = hasPermission('project:delete');

    const [searchParams, setSearchParams] = useSearchParams();
    const selectedId = searchParams.get('id') || '';
    const activeTab = searchParams.get('tab') || 'facts';

    const [search, setSearch] = useState('');
    const debounced = useDebounced(search, 250);
    const [statusFilter, setStatusFilter] = useState('all');
    const [listPage, setListPage] = useState(1);
    const [modal, setModal] = useState({ visible: false, project: null });
    const [detailRev, setDetailRev] = useState(0);

    const overview = useResource(loadProjects, []);
    const projects = overview.data?.projects || [];
    const summary = overview.data?.summary;

    const navigate = useCallback((id, tab) => {
        const next = new URLSearchParams(searchParams);
        if (id) next.set('id', id);
        else next.delete('id');
        if (tab) next.set('tab', tab);
        else next.delete('tab');
        setSearchParams(next, { replace: Boolean(id) });
    }, [searchParams, setSearchParams]);

    const filtered = useMemo(() => {
        const keyword = debounced.trim().toLowerCase();
        return projects.filter(item => {
            const status = item.status || 'active';
            if (statusFilter !== 'all' && status !== statusFilter) return false;
            if (!keyword) return true;
            return [item.name, item.description, item.id].join(' ').toLowerCase().includes(keyword);
        });
    }, [projects, debounced, statusFilter]);
    const currentPage = Math.min(listPage, Math.max(1, Math.ceil(filtered.length / PROJECT_PAGE_SIZE)));
    const pageProjects = filtered.slice((currentPage - 1) * PROJECT_PAGE_SIZE, currentPage * PROJECT_PAGE_SIZE);

    // On first entry without a specified project, select the first visible project by default so the right panel is not blank.
    useEffect(() => {
        if (selectedId || !filtered.length) return;
        navigate(filtered[0].id, activeTab);
    }, [selectedId, filtered, activeTab, navigate]);

    const archivedCount = useMemo(
        () => projects.filter(item => (item.status || 'active') === 'archived').length,
        [projects]
    );

    const metrics = [
        {
            id: 'active',
            label: t('projects.statusActive', null, 'Active'),
            value: summary?.totals?.active_projects ?? projects.filter(item => (item.status || 'active') === 'active').length,
            loading: overview.loading
        },
        {
            id: 'facts',
            label: t('projects.facts', null, 'Facts'),
            value: summary?.totals?.total_facts ?? '—',
            detail: t('projects.sharedFactBoard', null, 'Shared fact board'),
            loading: overview.loading
        },
        { id: 'total', label: t('projects.projectList', null, 'Project list'), value: overview.data?.total ?? projects.length, loading: overview.loading },
        { id: 'archived', label: t('projects.statusArchived', null, 'Archived'), value: archivedCount, loading: overview.loading }
    ];

    const removeProject = (record) => {
        confirmAction({
            title: t('projects.deleteProject', null, 'Delete project'),
            content: t('projects.confirmDeleteProject', null, 'Delete this project? Facts will be deleted and conversations unbound.'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del(`/projects/${record.id}`);
                    toastSuccess(t('projects.deleteProject', null, 'Delete project'));
                    if (selectedId === record.id) navigate('');
                    overview.reload({ silent: true });
                    setDetailRev(value => value + 1);
                } catch (error) {
                    toastError(errText(error, t('projects.deleteFailed', null, 'Delete failed')));
                }
            }
        });
    };

    const toggleArchive = (record) => {
        const archived = (record.status || 'active') === 'archived';
        confirmAction({
            title: archived ? t('projects.restoreProjectActive', null, 'Restore to active') : t('projects.archiveProject', null, 'Archive'),
            content: archived
                ? t('projects.confirmRestoreProjectActive', null, 'Restore to active?')
                : t('projects.confirmArchiveProject', null, 'After archiving, this project is hidden from active list by default. Continue?'),
            okText: t('common.confirm', null, 'Confirm'),
            danger: !archived,
            onOk: async () => {
                try {
                    await api.put(`/projects/${record.id}`, { status: archived ? 'active' : 'archived' });
                    toastSuccess(t('projects.saved', null, 'Saved'));
                    overview.reload({ silent: true });
                    setDetailRev(value => value + 1);
                } catch (error) {
                    toastError(errText(error, t('projects.operationFailed', null, 'Operation failed')));
                }
            }
        });
    };

    const columns = [
        {
            title: t('projects.projectName', null, 'Project name'),
            dataIndex: 'name',
            render: (value, record) => (
                <div className="project-list-name">
                    <div className="project-list-name-row">
                        <span className={`project-list-name-text${record.id === selectedId ? ' is-active' : ''}`}>{value || record.id}</span>
                        {record.pinned ? <Tag size="small" color="blue" type="light">{t('projects.pinned', null, 'Pinned')}</Tag> : null}
                    </div>
                    {record.description
                        ? <Text type="tertiary" size="small" className="project-list-desc">{record.description}</Text>
                        : null}
                </div>
            )
        },
        {
            title: t('projects.status', null, 'Status'),
            dataIndex: 'status',
            width: 92,
            render: value => {
                const archived = (value || 'active') === 'archived';
                return (
                    <Tag size="small" color={archived ? 'grey' : 'green'}>
                        {archived ? t('projects.statusArchived', null, 'Archived') : t('projects.statusActive', null, 'Active')}
                    </Tag>
                );
            }
        },
        {
            title: t('projects.updated', null, 'Updated'),
            dataIndex: 'updated_at',
            width: 150,
            render: value => <Text type="tertiary" size="small">{formatDateTime(value)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 176,
            render: (value, record) => (
                <Space spacing={2} onClick={event => event.stopPropagation()}>
                    <Button size="small" theme="borderless" onClick={() => setModal({ visible: true, project: record })} disabled={!canWrite}>
                        {t('common.edit', null, 'Edit')}
                    </Button>
                    <Button size="small" theme="borderless" onClick={() => toggleArchive(record)} disabled={!canWrite}>
                        {(record.status || 'active') === 'archived'
                            ? t('projects.restore', null, 'Restore')
                            : t('projects.archiveProject', null, 'Archive')}
                    </Button>
                    <Button size="small" theme="borderless" type="danger" onClick={() => removeProject(record)} disabled={!canDelete}>
                        {t('common.delete', null, 'Delete')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <div className="project-page">
            <PageHeader
                title={t('projects.title', null, 'Projects')}
                description={t('projects.selectOrCreateHint', null, 'Projects share a cross-chat fact board; target, environment, auth and other facts are auto-injected in bound conversations.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} theme="borderless" loading={overview.loading} onClick={() => overview.reload()}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={() => setModal({ visible: true, project: null })}>
                            {t('projects.newProjectCta', null, '+ New project')}
                        </Button>
                    </Space>
                )}
            />

            <ErrorBanner error={errorProp(overview.error)} onRetry={overview.reload} />
            <StatGrid metrics={metrics} columns={4} />

            <div className={`project-layout${selectedId && activeTab === 'graph' ? ' project-layout--graph' : ''}`}>
                <SectionCard
                    title={t('projects.projectList', null, 'Project list')}
                    className="project-list-card"
                    bodyClassName="project-list-body"
                    extra={<Text type="tertiary" size="small">{filtered.length} / {projects.length}</Text>}
                >
                    <div className="project-toolbar project-toolbar--stack">
                        <Input
                            prefix={<IconSearch />}
                            value={search}
                            showClear
                            placeholder={t('projects.searchProjectsPlaceholder', null, 'Search projects…')}
                            onChange={value => { setSearch(value); setListPage(1); }}
                            style={{ width: '100%' }}
                        />
                        <Select
                            value={statusFilter}
                            onChange={value => { setStatusFilter(value); setListPage(1); }}
                            style={{ width: '100%' }}
                            optionList={[
                                { value: 'all', label: t('projects.all', null, 'All') },
                                { value: 'active', label: t('projects.statusActive', null, 'Active') },
                                { value: 'archived', label: t('projects.statusArchived', null, 'Archived') }
                            ]}
                        />
                    </div>
                    <DataTable
                        columns={columns}
                        dataSource={pageProjects}
                        rowKey="id"
                        loading={overview.loading}
                        pagination={false}
                        emptyText={search || statusFilter !== 'all'
                            ? t('projects.noMatchingProjects', null, 'No matching projects')
                            : t('projects.noProjects', null, 'No projects')}
                        onRow={record => ({
                            onClick: () => navigate(record.id, activeTab),
                            style: { cursor: 'pointer' }
                        })}
                    />
                    {filtered.length > 0 && (
                        <div className="project-list-pagination">
                            <Pagination
                                size="small"
                                currentPage={currentPage}
                                pageSize={PROJECT_PAGE_SIZE}
                                total={filtered.length}
                                onPageChange={setListPage}
                            />
                        </div>
                    )}
                </SectionCard>

                <div className="project-detail-col">
                    {selectedId ? (
                        <ProjectDetail
                            key={selectedId}
                            projectId={selectedId}
                            tab={activeTab}
                            refreshToken={detailRev}
                            onTabChange={tab => navigate(selectedId, tab)}
                            onChanged={() => overview.reload({ silent: true })}
                            onDeleted={() => {
                                navigate('');
                                overview.reload({ silent: true });
                            }}
                        />
                    ) : (
                        <>
                            <SectionCard
                                title={t('projects.selectOrCreateTitle', null, 'Select or create a project')}
                                extra={canWrite ? null : <Text type="tertiary" size="small">{t('projects.writePermissionDenied', null, 'This account is read-only and cannot create or edit projects')}</Text>}
                            >
                                <div className="project-empty-state">
                                    <Empty
                                        title={t('projects.noProjectsClickCreate', null, 'No projects yet, click New project below')}
                                        description={t('projects.selectOrCreateHint', null, 'Projects share a cross-chat fact board; target, environment, auth and other facts are auto-injected in bound conversations.')}
                                        style={{ padding: 24 }}
                                    >
                                        <Button type="primary" disabled={!canWrite} onClick={() => setModal({ visible: true, project: null })}>
                                            {t('projects.createFirstProject', null, 'Create first project')}
                                        </Button>
                                    </Empty>
                                </div>
                            </SectionCard>

                            <SectionCard
                                title={t('projects.sharedFactBoard', null, 'Shared fact board')}
                                description={t('projects.factToolbarHint', null, 'Index includes key and summary only (must include what + where + how to verify); put attack chain / POC in body, and reproduce via get_project_fact.')}
                            >
                                {(summary?.recent_facts || []).length ? (
                                    <ul className="project-recent-facts">
                                        {summary.recent_facts.map(fact => (
                                            <li key={fact.id}>
                                                <button
                                                    type="button"
                                                    className="project-recent-fact"
                                                    onClick={() => navigate(fact.project_id, 'facts')}
                                                >
                                                    <span className="project-recent-fact-key">
                                                        <code>{fact.fact_key}</code>
                                                        <Tag size="small" color="cyan" type="light">{fact.project_name || fact.project_id}</Tag>
                                                    </span>
                                                    <span className="project-recent-fact-summary" title={fact.summary}>{fact.summary}</span>
                                                    <span className="project-recent-fact-time">{formatDateTime(fact.updated_at)}</span>
                                                </button>
                                            </li>
                                        ))}
                                    </ul>
                                ) : (
                                    <Text type="tertiary">{t('projects.noFacts', null, 'No facts yet. Click Add fact or let Agent write facts automatically')}</Text>
                                )}
                            </SectionCard>
                        </>
                    )}
                </div>
            </div>

            <ProjectFormModal
                visible={modal.visible}
                project={modal.project}
                onCancel={() => setModal({ visible: false, project: null })}
                onSaved={saved => {
                    const wasEditing = Boolean(modal.project);
                    setModal({ visible: false, project: null });
                    overview.reload({ silent: true });
                    setDetailRev(value => value + 1);
                    if (saved?.id && !wasEditing) navigate(saved.id, 'facts');
                }}
            />
        </div>
    );
}
