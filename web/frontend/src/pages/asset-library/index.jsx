/** Asset library: filters, pagination, row actions, details, create/edit, bulk edit, import, merge, project binding, export. */
import { useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useSearchParams } from 'react-router-dom';
import { Banner, Button, Space, Typography } from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconCloudUploadStroked } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useDebounced, useResource } from '../../components/hooks';
import {
    ErrorBanner, PageHeader, SectionCard, confirmAction, toastError, toastSuccess, toastWarning
} from '../../components/ui';
import AssetFilterBar, { emptyAssetFilters } from './components/AssetFilterBar';
import AssetTable from './components/AssetTable';
import AssetDetailDrawer from './components/AssetDetailDrawer';
import AssetEditorModal from './components/AssetEditorModal';
import AssetImportModal from './components/AssetImportModal';
import AssetMergeModal from './components/AssetMergeModal';
import AssetProjectModal from './components/AssetProjectModal';
import AssetBulkEditModal from './components/AssetBulkEditModal';
import { useAssetProjects } from './components/useAssetProjects';
import { applyScanStateParam } from './components/assetConstants';
import { assetsToCsv, downloadTextFile } from './components/assetCsv';
import './page.css';

const { Text } = Typography;

export function buildAssetQuery(filters, page, pageSize) {
    let query = {
        page,
        page_size: pageSize,
        q: filters.q,
        protocol: filters.protocol,
        source: filters.source,
        tag: filters.tag,
        status: filters.status,
        risk_level: filters.risk_level,
        environment: filters.environment,
        criticality: filters.criticality,
        ip: filters.ip,
        domain: filters.domain,
        port: filters.port
    };
    query = applyScanStateParam(query, filters.scan);
    const [sortBy, sortOrder] = String(filters.sort || 'last_seen_at:desc').split(':');
    query.sort_by = sortBy;
    query.sort_order = sortOrder || 'desc';
    return query;
}

export default function AssetLibraryPage() {
    const [searchParams, setSearchParams] = useSearchParams();
    const projectResource = useAssetProjects();
    const linkedAsset = useLocation().state?.asset;
    const projectId = searchParams.get('project_id') || '';
    const scope = projectId ? `project:${projectId}` : 'all';
    return (
        <AssetLibraryWorkspace
            key={scope}
            projectId={projectId}
            scope={scope}
            projectResource={projectResource}
            linkedAsset={linkedAsset}
            searchParams={searchParams}
            setSearchParams={setSearchParams}
        />
    );
}

function AssetLibraryWorkspace({ projectId, scope, projectResource, linkedAsset, searchParams, setSearchParams }) {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('asset:read');
    const canWrite = hasPermission('asset:write');
    const canDelete = hasPermission('asset:delete');

    const deepId = searchParams.get('id') || '';
    const scopeQuery = useMemo(() => ({ project_id: projectId || undefined }), [projectId]);

    const [filters, setFilters] = useState(() => ({
        ...emptyAssetFilters(),
        q: searchParams.get('q') || ''
    }));
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [selection, setSelection] = useState({ keys: [], rows: [] });
    const selectionRevision = useRef(0);
    const [detailAsset, setDetailAsset] = useState(null);
    const [editorOpen, setEditorOpen] = useState(false);
    const [editorAsset, setEditorAsset] = useState(null);
    const [importOpen, setImportOpen] = useState(false);
    const [mergeOpen, setMergeOpen] = useState(false);
    const [projectOpen, setProjectOpen] = useState(false);
    const [bulkOpen, setBulkOpen] = useState(false);
    const [exporting, setExporting] = useState(false);

    const debouncedFilters = useDebounced(filters, 300);
    const query = useMemo(
        () => ({ ...buildAssetQuery(debouncedFilters, page, pageSize), ...scopeQuery }),
        [debouncedFilters, page, pageSize, scopeQuery]
    );
    const { data, loading, error, reload } = useResource(
        () => api.get('/assets', query),
        [query, canRead],
        { skip: !canRead }
    );
    const { projects, loading: projectsLoading, error: projectError, reload: reloadProjects } = projectResource;

    const assets = useMemo(() => (Array.isArray(data?.assets) ? data.assets : []), [data]);
    const total = error ? 0 : Number(data?.total || 0);
    const queryPending = loading || debouncedFilters !== filters;
    const scopeOptions = [
        { value: 'all', label: t('assets.scopeAll', null, 'All assets') },
        ...projects.map(project => ({ value: `project:${project.id}`, label: project.name || project.id }))
    ];
    if (projectId && !scopeOptions.some(option => option.value === scope)) {
        scopeOptions.push({ value: scope, label: projectId });
    }
    const scopeName = scopeOptions.find(option => option.value === scope)?.label;

    const resolvedDeep = useRef('');

    useEffect(() => () => { selectionRevision.current += 1; }, []);

    useEffect(() => {
        if (!deepId) {
            resolvedDeep.current = '';
            setDetailAsset(null);
            return undefined;
        }
        if (!canRead || deepId === resolvedDeep.current) return undefined;
        const inPage = assets.find(asset => asset.id === deepId);
        if (inPage || linkedAsset?.id === deepId) {
            resolvedDeep.current = deepId;
            setDetailAsset(inPage || linkedAsset);
            return undefined;
        }
        let cancelled = false;
        (async () => {
            for (let page = 1; page <= 5 && !cancelled; page += 1) {
                const payload = await api.get('/assets', { ...scopeQuery, page, page_size: 100 });
                if (cancelled) return;
                const asset = payload?.assets?.find(item => item.id === deepId);
                if (asset) {
                    setDetailAsset(asset);
                    break;
                }
                if (page >= Number(payload?.total_pages || 1)) break;
            }
            if (!cancelled) resolvedDeep.current = deepId;
        })().catch(detailError => {
            if (!cancelled) toastError(detailError, t('assets.loadFailed', null, 'Failed to load assets'));
        });
        return () => { cancelled = true; };
    }, [assets, canRead, deepId, linkedAsset, scopeQuery, t]);

    const changeScope = value => {
        if (value === scope) return;
        const next = new URLSearchParams();
        if (value?.startsWith('project:')) next.set('project_id', value.slice('project:'.length));
        setSearchParams(next);
    };

    const clearSelection = () => {
        selectionRevision.current += 1;
        setSelection({ keys: [], rows: [] });
    };

    const changeFilters = patch => {
        setFilters(prev => ({ ...prev, ...patch }));
        setPage(1);
        clearSelection();
    };

    const resetFilters = () => {
        setFilters(emptyAssetFilters());
        setPage(1);
        clearSelection();
    };

    const refresh = () => {
        clearSelection();
        reload();
        reloadProjects();
    };

    const writeDeepLink = assetId => {
        const next = new URLSearchParams(searchParams);
        if (assetId) next.set('id', assetId);
        else next.delete('id');
        setSearchParams(next, { replace: true });
    };

    const openDetail = asset => {
        resolvedDeep.current = asset.id;
        setDetailAsset(asset);
        if (asset?.id) writeDeepLink(asset.id);
    };

    const closeDetail = () => {
        setDetailAsset(null);
        if (deepId) {
            resolvedDeep.current = '';
            writeDeepLink('');
        }
    };

    const openEditor = asset => {
        setEditorAsset(asset || null);
        setEditorOpen(true);
        if (canWrite) reloadProjects();
    };

    const afterWrite = async () => {
        clearSelection();
        await reload();
    };

    const deleteAsset = async asset => {
        await api.del(`/assets/${encodeURIComponent(asset.id)}`);
        toastSuccess(t('assets.deleted', null, 'Asset deleted'));
        if (detailAsset?.id === asset.id) closeDetail();
        await afterWrite();
    };

    const batchDelete = () => {
        const ids = selection.keys;
        if (!ids.length) return;
        confirmAction({
            title: t('assets.deleteConfirm', null, 'Delete this asset?'),
            content: t('assets.scopedDeleteConfirm', {
                count: ids.length,
                project: selection.rows[0]?.project_name || selection.rows[0]?.project_id || t('assets.scopeUnassigned', null, 'Unassigned assets')
            }, 'Permanently delete {{count}} selected assets from “{{project}}”?'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    const result = await api.post('/assets/batch-delete', { asset_ids: ids });
                    const deleted = Number(result?.deleted || ids.length);
                    toastSuccess(t('ui.assetLibrary.deleted', { count: deleted }, 'Deleted {{count}} assets'));
                    await afterWrite();
                } catch (deleteError) {
                    toastError(deleteError, t('ui.assetLibrary.batchDeleteFailed', null, 'Bulk delete failed'));
                }
            }
        });
    };

    const selectionQuery = useMemo(() => {
        const { page: _page, page_size: _size, ...rest } = query;
        return rest;
    }, [query]);

    const selectAllMatching = async () => {
        const revision = ++selectionRevision.current;
        try {
            const payload = await api.get('/assets/selection', selectionQuery);
            if (revision !== selectionRevision.current) return;
            const rows = Array.isArray(payload?.assets) ? payload.assets : [];
            setSelection({ keys: rows.map(item => item.id), rows });
            toastSuccess(t('assets.allResultsSelected', { count: rows.length }, 'All {{count}} matching assets selected'));
        } catch (selectionError) {
            if (revision === selectionRevision.current) toastError(selectionError, t('ui.assetLibrary.selectAllFailed', null, 'Failed to select all results'));
        }
    };

    const exportCsv = async all => {
        if (exporting) return;
        setExporting(true);
        try {
            let rows = selection.rows;
            if (all) {
                const payload = await api.get('/assets/selection', selectionQuery);
                rows = Array.isArray(payload?.assets) ? payload.assets : [];
            } else if (!rows.length) {
                rows = assets;
            }
            if (!rows.length) {
                toastWarning(t('ui.assetLibrary.nothingToExport', null, 'No assets to export'));
                return;
            }
            const stamp = new Date().toISOString().slice(0, 10);
            downloadTextFile(`assets-${stamp}.csv`, assetsToCsv(rows));
            toastSuccess(t('ui.assetLibrary.exported', { count: rows.length }, 'Exported {{count}} assets'));
        } catch (exportError) {
            toastError(exportError, t('ui.assetLibrary.exportFailed', null, 'Export failed'));
        } finally {
            setExporting(false);
        }
    };

    const onSelectionChange = (keys, rows) => {
        selectionRevision.current += 1;
        setSelection({ keys: keys || [], rows: rows || [] });
    };

    const selectedCount = selection.keys.length;
    const mixedProjects = new Set(selection.rows.map(asset => asset.project_id || '')).size > 1;
    const canChangeSelection = selectedCount > 0 && !queryPending && !mixedProjects;

    if (!canRead) {
        return (
            <div className="asset-library-page">
                <PageHeader title={t('assets.libraryTitle', null, 'Asset Library')} description={t('ui.assetLibrary.readHint', null, 'The asset list, bulk actions, and import require asset read permission.')} />
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    description={t('assets.readDenied', null, 'The current account lacks the asset:read permission and cannot read asset data. Contact an administrator for access.')}
                />
            </div>
        );
    }

    return (
        <div className="asset-library-page">
            <PageHeader
                title={t('assets.libraryTitle', null, 'Asset Library')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={refresh} loading={loading}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        {canWrite && (
                            <Button icon={<IconCloudUploadStroked />} onClick={() => setImportOpen(true)}>
                                {t('assets.bulkImport', null, 'Bulk import')}
                            </Button>
                        )}
                        {canWrite && (
                            <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => openEditor(null)}>
                                {t('assets.addAsset', null, 'Add asset')}
                            </Button>
                        )}
                    </Space>
                )}
            />
            <SectionCard title={t('assets.filterTitle', null, 'Filters')}>
                <AssetFilterBar
                    scope={{ value: scope, options: scopeOptions, loading: projectsLoading, onChange: changeScope }}
                    filters={filters}
                    onChange={changeFilters}
                    onReset={resetFilters}
                />
                <ErrorBanner error={projectError} onRetry={reloadProjects} />
            </SectionCard>
            <ErrorBanner error={error} onRetry={refresh} />

            <SectionCard
                title={`${scopeName}（${total}）`}
                extra={(
                    <Space>
                        <Button
                            theme="borderless"
                            disabled={!selectedCount}
                            onClick={clearSelection}
                        >
                            {t('assets.clearSelection', null, 'Clear selection')}
                        </Button>
                        <Button theme="borderless" disabled={queryPending || !total} onClick={() => exportCsv(false)} loading={exporting}>
                            {t('assets.exportCsv', null, 'Export CSV')}
                        </Button>
                        <Button theme="borderless" disabled={queryPending || !total} onClick={() => exportCsv(true)} loading={exporting}>
                            {t('assets.exportAll', null, 'Export all filtered results')}
                        </Button>
                    </Space>
                )}
            >
                <div className="asset-library-toolbar">
                    <Space>
                        <Text type="tertiary">
                            {selectedCount
                                ? t('assets.selectedCount', { count: selectedCount }, '{{count}} selected')
                                : t('assets.selectedCount', { count: 0 }, '{{count}} selected')}
                        </Text>
                        <Button theme="borderless" size="small" disabled={queryPending || !total} onClick={selectAllMatching}>
                            {t('assets.selectAllResults', { count: total }, 'Select all {{count}}')}
                        </Button>
                    </Space>
                    <Space>
                        {canWrite && (
                            <Button size="small" disabled={!canChangeSelection || selectedCount < 2 || !canDelete} onClick={() => setMergeOpen(true)}>
                                {t('assets.mergeDuplicates', null, 'Merge duplicates')}
                            </Button>
                        )}
                        {canWrite && (
                            <Button size="small" disabled={!canChangeSelection} onClick={() => setProjectOpen(true)}>
                                {t('assets.bindProject', null, 'Bind project')}
                            </Button>
                        )}
                        {canWrite && (
                            <Button size="small" disabled={!canChangeSelection} onClick={() => setBulkOpen(true)}>
                                {t('assets.bulkEdit', null, 'Bulk edit')}
                            </Button>
                        )}
                        {canDelete && (
                            <Button size="small" type="danger" disabled={!canChangeSelection} onClick={batchDelete}>
                                {t('assets.batchDelete', null, 'Bulk delete…')}
                            </Button>
                        )}
                    </Space>
                </div>
                {mixedProjects && (canWrite || canDelete) && (
                    <Text type="tertiary" size="small">
                        {t('assets.mixedProjectSelection', null, 'Select assets from one project or only unassigned assets to make bulk changes.')}
                    </Text>
                )}

                <AssetTable
                    assets={queryPending || error ? [] : assets}
                    loading={queryPending}
                    total={total}
                    page={page}
                    pageSize={pageSize}
                    onPageChange={next => { setPage(next); clearSelection(); }}
                    onPageSizeChange={next => { setPageSize(next); setPage(1); clearSelection(); }}
                    selectedRowKeys={selection.keys}
                    onSelectionChange={onSelectionChange}
                    onView={openDetail}
                    onEdit={openEditor}
                    onDelete={deleteAsset}
                    onRefresh={refresh}
                    canWrite={canWrite}
                    canDelete={canDelete}
                />
            </SectionCard>

            <AssetDetailDrawer
                asset={detailAsset}
                visible={Boolean(detailAsset)}
                onClose={closeDetail}
                onEdit={asset => { closeDetail(); openEditor(asset); }}
                onDelete={asset => {
                    confirmAction({
                        title: t('assets.deleteConfirm', null, 'Delete this asset?'),
                        content: asset.host || asset.domain || asset.ip,
                        okText: t('common.delete', null, 'Delete'),
                        onOk: () => deleteAsset(asset).catch(deleteError => toastError(deleteError, t('assets.deleteFailed', null, 'Failed to delete asset')))
                    });
                }}
                canWrite={canWrite}
                canDelete={canDelete}
            />

            <AssetEditorModal
                visible={editorOpen}
                asset={editorAsset}
                defaultProjectId={projectId}
                projects={projects}
                onClose={() => setEditorOpen(false)}
                onSaved={afterWrite}
            />
            <AssetImportModal
                visible={importOpen}
                defaultProjectId={scope === 'all' ? undefined : projectId}
                projects={projects}
                onClose={() => setImportOpen(false)}
                onDone={afterWrite}
            />
            <AssetMergeModal
                visible={mergeOpen}
                assets={selection.rows}
                onClose={() => setMergeOpen(false)}
                onDone={afterWrite}
            />
            <AssetProjectModal
                visible={projectOpen}
                projects={projects}
                assetIds={selection.keys}
                onClose={() => setProjectOpen(false)}
                onDone={afterWrite}
            />
            <AssetBulkEditModal
                visible={bulkOpen}
                assetIds={selection.keys}
                onClose={() => setBulkOpen(false)}
                onDone={afterWrite}
            />
        </div>
    );
}
