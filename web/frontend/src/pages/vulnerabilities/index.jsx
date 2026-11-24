/**
 * Vulnerability management: stats dashboard + server-paginated list + detail drawer + create/edit + delete/bulk delete/export.
 * API and fields follow internal/handler/vulnerability*.go; filter/deep-link state lives in the hash query string.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, RadioGroup, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh } from '@douyinfe/semi-icons';
import { api, downloadFile } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    ErrorBanner, PageHeader, SectionCard, StatGrid,
    confirmAction, toastError, toastSuccess, toastWarning
} from '../../components/ui';
import FilterBar from './FilterBar';
import { GroupNavigator, GroupOverview } from './GroupNavigator';
import VulnTable from './List';
import DetailDrawer from './DetailDrawer';
import EditModal from './EditModal';
import {
    DEFAULT_PAGE_SIZE, FILTER_KEYS, PAGE_SIZE_OPTIONS, SEVERITY_CODES,
    filterQuery, hasActiveFilters, percentOf, saveTextFile, severityText, statsQuery
} from './shared';
import './page.css';

const { Text } = Typography;

const VIEWS = { none: 'viewList', host: 'viewHost', task: 'viewTask' };
const EMPTY_GROUPS = [];

export default function VulnerabilitiesPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const [params, setParams] = useSearchParams();

    const filters = useMemo(() => ({
        q: params.get('q') || '',
        severity: params.get('severity') || '',
        status: params.get('status') || '',
        project_id: params.get('project_id') || '',
        conversation_tag: params.get('conversation_tag') || '',
        task_tag: params.get('task_tag') || '',
        // The handler only accepts severity / latest / oldest; an invalid value makes the list return 400.
        sort: ['severity', 'latest', 'oldest'].includes(params.get('sort')) ? params.get('sort') : ''
    }), [params]);

    const page = Math.max(1, Number.parseInt(params.get('page') || '1', 10) || 1);
    const pageSize = PAGE_SIZE_OPTIONS.includes(Number(params.get('page_size')))
        ? Number(params.get('page_size'))
        : DEFAULT_PAGE_SIZE;
    const detailId = (params.get('id') || '').trim();
    const viewParam = params.get('group_by');
    const groupView = viewParam === 'host' || viewParam === 'task' ? viewParam : '';
    const groupSelection = groupView ? params.get('selection') || '' : '';
    const groupSearchKey = groupView === 'task' ? 'task_q' : 'host_q';
    const groupSearch = groupView ? params.get(groupSearchKey) || '' : '';
    const groupSearchQuery = groupSearch ? { [groupSearchKey]: groupSearch } : {};

    const canWrite = hasPermission('vulnerability:write');
    const canDelete = hasPermission('vulnerability:delete') || canWrite;

    const patchParams = useCallback((patch, options = {}) => {
        setParams(previous => {
            const next = new URLSearchParams(previous);
            Object.entries(patch).forEach(([key, value]) => {
                if (value === undefined || value === null || value === '') next.delete(key);
                else next.set(key, String(value));
            });
            if (options.resetPage) next.delete('page');
            return next.toString() === previous.toString() ? previous : next;
        }, { replace: true });
    }, [setParams]);

    const applyFilter = useCallback((key, value) => {
        patchParams({ [key]: value }, { resetPage: true });
    }, [patchParams]);

    const resetFilters = useCallback(() => {
        const patch = { sort: undefined, selection: undefined, host_q: undefined, task_q: undefined };
        FILTER_KEYS.forEach(key => { patch[key] = undefined; });
        patchParams(patch, { resetPage: true });
    }, [patchParams]);

    const changeGroupView = useCallback(view => {
        patchParams({
            group_by: view === 'none' ? undefined : view,
            selection: undefined,
            host_q: undefined,
            task_q: undefined
        }, { resetPage: true });
    }, [patchParams]);
    const selectGroup = useCallback(value => {
        patchParams({ selection: value }, { resetPage: true });
    }, [patchParams]);
    const searchGroups = useCallback(value => {
        patchParams({ [groupSearchKey]: value, selection: undefined }, { resetPage: true });
    }, [groupSearchKey, patchParams]);

    const openDetail = useCallback(id => patchParams({ id }), [patchParams]);
    const closeDetail = useCallback(() => patchParams({ id: undefined }), [patchParams]);

    // The list only needs summary fields (the handler's summary=true); details/edit fetch the full record by id separately.
    const listQuery = {
        ...filterQuery(filters),
        ...groupSearchQuery,
        ...(groupView ? { group_by: groupView, pagination: 'records', selection: groupSelection } : {}),
        ...(filters.sort ? { sort: filters.sort } : {}),
        summary: 'true',
        page,
        limit: pageSize
    };
    const listKey = JSON.stringify(listQuery);
    // Carry the request key back with the response, so a response for the previous filter does not correct the address-bar page.
    const list = useResource(async () => {
        const payload = await api.get('/vulnerabilities', listQuery);
        return { ...(payload || {}), __requestKey: listKey, __groupView: groupView };
    }, [listKey]);
    const listData = list.data?.__requestKey === listKey ? list.data : null;
    const groups = list.data?.__groupView === groupView ? list.data?.navigation || EMPTY_GROUPS : EMPTY_GROUPS;
    const selectedGroup = listData?.selection
        ? groups.flatMap(group => [group, ...(group.children || [])]).find(group => group.key === listData.selection)
        : null;

    const statQuery = useMemo(() => statsQuery(filters), [filters]);
    const statKey = JSON.stringify(statQuery);
    const stats = useResource(() => api.get('/vulnerabilities/stats', statQuery), [statKey]);

    const [optionsVersion, setOptionsVersion] = useState(0);
    const options = useResource(() => api.get('/vulnerabilities/filter-options'), [optionsVersion]);

    const projects = useResource(async () => {
        try {
            const payload = await api.get('/projects', { limit: 500 });
            return Array.isArray(payload?.projects) ? payload.projects : [];
        } catch (error) {
            return []; // Project names are display-only; without permission fall back to showing the project ID
        }
    }, []);

    const projectNames = useMemo(() => {
        const map = {};
        (projects.data || []).forEach(project => {
            if (project?.id) map[project.id] = project.name || project.id;
        });
        return map;
    }, [projects.data]);

    const projectOptions = useMemo(() => {
        const seen = new Map();
        (options.data?.project_ids || []).forEach(id => {
            if (id) seen.set(id, projectNames[id] || id);
        });
        if (filters.project_id && !seen.has(filters.project_id)) {
            seen.set(filters.project_id, projectNames[filters.project_id] || filters.project_id);
        }
        return [...seen.entries()].map(([value, label]) => ({ value, label }));
    }, [options.data, projectNames, filters.project_id]);

    const formProjectOptions = useMemo(() => {
        const seen = new Map();
        (projects.data || []).forEach(project => {
            if (project?.id) seen.set(project.id, project.name || project.id);
        });
        return [...seen.entries()].map(([value, label]) => ({ value, label }));
    }, [projects.data]);

    const [selection, setSelection] = useState([]);
    const [editor, setEditor] = useState({ visible: false, id: '' });
    const [detailVersion, setDetailVersion] = useState(0);
    const [exporting, setExporting] = useState(false);

    useEffect(() => { setSelection([]); }, [listKey]);

    // The server clamps an out-of-range page to the last page; sync it back to the address bar so a refresh restores it.
    useEffect(() => {
        if (!listData) return;
        const patch = {};
        const serverPage = Number(listData.page);
        if (serverPage && serverPage !== page) patch.page = serverPage;
        if (groupSelection && !listData.selection) patch.selection = undefined;
        if (Object.keys(patch).length) patchParams(patch);
    }, [listData, groupSelection, page, patchParams]);

    const reloadList = list.reload;
    const reloadStats = stats.reload;
    const reloadOptions = options.reload;

    const refreshAll = useCallback(() => {
        reloadList();
        reloadStats();
        reloadOptions({ silent: true });
    }, [reloadList, reloadStats, reloadOptions]);

    const openEditor = useCallback(record => {
        setEditor({ visible: true, id: record?.id || '' });
    }, []);

    const handleSaved = useCallback(() => {
        setEditor({ visible: false, id: '' });
        toastSuccess(t('vulnerabilityPage.saveSuccess', null, 'Saved'));
        setDetailVersion(value => value + 1);
        setOptionsVersion(value => value + 1);
        reloadList({ silent: true });
        reloadStats({ silent: true });
    }, [reloadList, reloadStats, t]);

    const handleDelete = useCallback(record => {
        if (!record?.id) return;
        confirmAction({
            title: t('vulnerabilityPage.deleteTitle', null, 'Delete vulnerability'),
            content: `${t('vulnerability.deleteConfirm', null, 'Delete this vulnerability?')}${record.title ? ` ${record.title}` : ''}`,
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del(`/vulnerabilities/${encodeURIComponent(record.id)}`);
                    toastSuccess(t('vulnerabilityPage.deleteSuccess', null, 'Deleted'));
                    if (detailId === record.id) closeDetail();
                    setDetailVersion(value => value + 1);
                    setOptionsVersion(value => value + 1);
                    await Promise.all([reloadList({ silent: true }), reloadStats({ silent: true })]);
                } catch (error) {
                    toastError(error, t('vulnerabilityPage.deleteFailed', null, 'Delete failed'));
                }
            }
        });
    }, [detailId, closeDetail, reloadList, reloadStats, t]);

    const handleBatchDelete = useCallback(() => {
        if (!selection.length) return;
        const ids = [...selection];
        confirmAction({
            title: t('vulnerabilityPage.batchDelete', null, 'Batch delete'),
            content: t(
                'vulnerabilityPage.batchDeleteConfirm',
                { count: ids.length },
                'Delete {{count}} vulnerability record(s) matching the current filters? This cannot be undone.'
            ),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                let deleted = 0;
                let failed = 0;
                for (const id of ids) {
                    try {
                        await api.del(`/vulnerabilities/${encodeURIComponent(id)}`);
                        deleted += 1;
                    } catch (error) {
                        failed += 1;
                    }
                }
                if (failed) {
                    toastWarning(t(
                        'vulnerabilityPage.batchDeletePartial',
                        { deleted, failed },
                        'Deleted {{deleted}}, {{failed}} failed'
                    ));
                } else {
                    toastSuccess(t('vulnerabilityPage.batchDeleteSuccess', { count: deleted }, 'Successfully deleted {{count}} vulnerability record(s)'));
                }
                setSelection([]);
                if (ids.includes(detailId)) closeDetail();
                setDetailVersion(value => value + 1);
                setOptionsVersion(value => value + 1);
                await Promise.all([reloadList({ silent: true }), reloadStats({ silent: true })]);
            }
        });
    }, [selection, detailId, closeDetail, reloadList, reloadStats, t]);

    // DELETE /vulnerabilities/batch deletes by filter (server semantics), complementing per-row multi-select deletion.
    const handleDeleteFiltered = useCallback(async () => {
        const query = filterQuery(filters);
        try {
            const head = await api.get('/vulnerabilities', { ...query, page: 1, limit: 1 });
            const total = Number(head?.total) || 0;
            if (!total) {
                toastWarning(t('vulnerabilityPage.batchDeleteNoResults', null, 'No vulnerabilities match the current filters to delete'));
                return;
            }
            confirmAction({
                title: t('vulnerabilityPage.deleteFilteredTitle', null, 'Delete the current filtered results'),
                content: t(
                    'vulnerabilityPage.batchDeleteConfirm',
                    { count: total },
                    'Delete {{count}} vulnerability record(s) matching the current filters? This cannot be undone.'
                ),
                okText: t('common.delete', null, 'Delete'),
                onOk: async () => {
                    try {
                        const result = await api.del('/vulnerabilities/batch', { query });
                        const deleted = Number(result?.deleted) || total;
                        toastSuccess(t('vulnerabilityPage.batchDeleteSuccess', { count: deleted }, 'Successfully deleted {{count}} vulnerability record(s)'));
                        setSelection([]);
                        setDetailVersion(value => value + 1);
                        setOptionsVersion(value => value + 1);
                        await Promise.all([reloadList({ silent: true }), reloadStats({ silent: true })]);
                    } catch (error) {
                        toastError(error, t('vulnerabilityPage.batchDeleteFailed', null, 'Batch delete failed'));
                    }
                }
            });
        } catch (error) {
            toastError(error, t('vulnerabilityPage.fetchFailed', null, 'Failed to fetch vulnerability'));
        }
    }, [filters, reloadList, reloadStats, t]);

    // Export: GET /vulnerabilities/export returns {files:[{filename,content}]}; save each file in turn.
    const handleExport = useCallback(async () => {
        if (exporting) return;
        setExporting(true);
        try {
            const payload = await api.get('/vulnerabilities/export', {
                ...filterQuery(filters),
                ...groupSearchQuery,
                mode: 'summary',
                group_by: 'conversation'
            });
            const files = Array.isArray(payload?.files) ? payload.files : [];
            if (!files.length) {
                toastWarning(t('vulnerabilityPage.exportNoResults', null, 'No vulnerabilities match the current filters'));
                return;
            }
            files.forEach((file, index) => {
                setTimeout(
                    () => saveTextFile(file.filename || `vulnerability-export-${index + 1}.md`, file.content || ''),
                    index * 120
                );
            });
            toastSuccess(files.length > 1
                ? t('vulnerabilityPage.exportStarted', { count: files.length }, 'Started downloading {{count}} file(s)')
                : t('vulnerabilityPage.exportSuccess', null, 'Report download started'));
        } catch (error) {
            toastError(error, t('vulnerabilityPage.exportFailed', null, 'Export failed'));
        } finally {
            setExporting(false);
        }
    }, [exporting, filters, groupSearchQuery, t]);

    const handleDownload = useCallback(async record => {
        try {
            const name = await downloadFile(`/vulnerabilities/${encodeURIComponent(record.id)}/download`, {
                query: { format: 'docx' }
            });
            toastSuccess(`${t('vulnerabilityPage.downloadOkTitle', null, 'Downloaded')}${name ? ` · ${name}` : ''}`);
        } catch (error) {
            toastError(error, t('vulnerabilityPage.downloadFailed', null, 'Download failed'));
        }
    }, [t]);

    const handlePageChange = useCallback(nextPage => {
        patchParams({ page: String(nextPage) });
    }, [patchParams]);

    // Same as the legacy page: keep the current data position when the page size changes (Semi converts with the same formula internally).
    const handlePageSizeChange = useCallback(nextSize => {
        if (!nextSize || nextSize === pageSize) return;
        const nextPage = Math.max(1, Math.floor(((page - 1) * pageSize) / nextSize) + 1);
        patchParams({ page_size: String(nextSize), page: String(nextPage) });
    }, [page, pageSize, patchParams]);

    const statsPayload = stats.data || {};
    const bySeverity = statsPayload.by_severity || {};
    const statTotal = Number(statsPayload.total) || 0;
    const distinctCount = Number(statsPayload.distinct) || 0;

    const metrics = useMemo(() => {
        const totalMetric = {
            id: 'total',
            label: t('vulnerabilityPage.statTotal', null, 'Total'),
            value: statTotal,
            detail: distinctCount && distinctCount !== statTotal
                ? t('vulnerabilityPage.distinctCount', { count: distinctCount }, '{{count}} distinct findings')
                : undefined,
            loading: stats.loading,
            onClick: () => applyFilter('severity', '')
        };
        const severityMetrics = SEVERITY_CODES.map(code => {
            const count = Number(bySeverity[code]) || 0;
            const pct = percentOf(count, statTotal);
            const active = filters.severity === code;
            return {
                id: code,
                label: severityText(t, code),
                value: count,
                severity: code,
                pressed: active,
                detail: active
                    ? `${t('vulnerabilityPage.filterActive', null, 'Filtered')} · ${pct}%`
                    : `${pct}%`,
                loading: stats.loading,
                onClick: () => applyFilter('severity', active ? '' : code)
            };
        });
        return [totalMetric, ...severityMetrics];
    }, [t, statTotal, distinctCount, bySeverity, stats.loading, filters.severity, applyFilter]);

    const totalRecords = Number(listData?.total) || 0;
    const rangeStart = totalRecords ? (page - 1) * pageSize + 1 : 0;
    const rangeEnd = totalRecords ? Math.min(page * pageSize, totalRecords) : 0;
    const summaryText = totalRecords
        ? t('vulnerabilityPage.recordPagination', { start: rangeStart, end: rangeEnd, total: totalRecords }, 'Showing {{start}}–{{end}} of {{total}} findings')
        : t('vulnerabilityPage.noRecords', null, 'No vulnerability records');

    const pageError = list.error || stats.error || options.error;

    const toolbar = (
        <div className="vulnerability-toolbar-left">
            <Text type="tertiary">
                {listData && selection.length
                    ? t('vulnerabilityPage.selectedCount', { count: selection.length }, '{{count}} selected')
                    : summaryText}
            </Text>
            {canDelete && (
                <Button
                    size="small"
                    type="danger"
                    theme="light"
                    disabled={!listData || !selection.length}
                    onClick={handleBatchDelete}
                >
                    {t('vulnerabilityPage.batchDelete', null, 'Batch delete')}
                </Button>
            )}
            {canDelete && !groupSelection && !groupSearch && hasActiveFilters(filters) && (
                <Button size="small" type="danger" theme="borderless" onClick={handleDeleteFiltered}>
                    {t('vulnerabilityPage.deleteFiltered', null, 'Delete filtered results')}
                </Button>
            )}
        </div>
    );

    return (
        <div className="vulnerability-page">
            <PageHeader
                title={t('vulnerability.title', null, 'Vulnerability Management')}
                description={t('vulnerabilityPage.workspaceSubtitle', null, 'Assets, reports and remediation')}
                extra={(
                    <>
                        <Button icon={<IconRefresh />} onClick={refreshAll} loading={list.loading}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button onClick={handleExport} loading={exporting}>
                            {t(groupSelection ? 'vulnerabilityPage.exportAllGroups' : 'vulnerabilityPage.batchExport')}
                        </Button>
                        {canWrite && (
                            <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => openEditor(null)}>
                                {t('vulnerability.addVuln', null, 'Add vulnerability')}
                            </Button>
                        )}
                    </>
                )}
            />

            <StatGrid metrics={metrics} columns={6} />

            <ErrorBanner error={pageError} onRetry={refreshAll} />

            <SectionCard
                className="vulnerability-list-card"
                title={t('vulnerabilityPage.listTitle', null, 'Vulnerability records')}
                extra={(
                    <RadioGroup
                        aria-label={t('vulnerabilityPage.viewLabel')}
                        type="button"
                        value={groupView || 'none'}
                        options={Object.entries(VIEWS).map(([value, key]) => ({ value, label: t(`vulnerabilityPage.${key}`) }))}
                        onChange={event => changeGroupView(event.target.value)}
                    />
                )}
            >
                <FilterBar
                    t={t}
                    filters={filters}
                    options={options.data}
                    projectOptions={projectOptions}
                    hasGroupFilters={Boolean(groupSelection || groupSearch)}
                    onChange={applyFilter}
                    onReset={resetFilters}
                />
                <div className={groupView ? 'vulnerability-group-layout' : undefined}>
                    {groupView && (
                        <GroupNavigator
                            key={groupView}
                            t={t}
                            mode={groupView}
                            groups={groups}
                            selection={groupSelection}
                            search={groupSearch}
                            loading={list.loading}
                            onSearch={searchGroups}
                            onSelect={selectGroup}
                        />
                    )}
                    <div className="vulnerability-group-results">
                        {selectedGroup && <GroupOverview t={t} group={selectedGroup} />}
                        <VulnTable
                            t={t}
                            data={listData?.vulnerabilities}
                            loading={list.loading}
                            page={page}
                            pageSize={pageSize}
                            total={totalRecords}
                            selection={listData ? selection : []}
                            onSelectionChange={setSelection}
                            onOpen={openDetail}
                            onEdit={openEditor}
                            onDelete={handleDelete}
                            onDownload={handleDownload}
                            sort={filters.sort}
                            onSort={value => applyFilter('sort', value)}
                            canWrite={canWrite}
                            canDelete={canDelete}
                            onPageChange={handlePageChange}
                            onPageSizeChange={handlePageSizeChange}
                            toolbar={toolbar}
                            onRefresh={refreshAll}
                        />
                    </div>
                </div>
            </SectionCard>

            <DetailDrawer
                visible={Boolean(detailId)}
                vulnId={detailId}
                refreshKey={detailVersion}
                onClose={closeDetail}
                onOpenVuln={openDetail}
                onEdit={openEditor}
                onDelete={handleDelete}
                canWrite={canWrite}
                canDelete={canDelete}
                t={t}
                projectNames={projectNames}
            />

            <EditModal
                visible={editor.visible}
                vulnId={editor.id}
                t={t}
                projectOptions={formProjectOptions}
                onClose={() => setEditor({ visible: false, id: '' })}
                onSaved={handleSaved}
            />
        </div>
    );
}
