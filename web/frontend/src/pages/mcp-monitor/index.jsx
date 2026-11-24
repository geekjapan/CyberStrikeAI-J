/** MCP status monitor: stat cards, call trend, tool ranking, execution records and details. */
import { useCallback, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Button, Modal, Space, TextArea } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { PageHeader, SectionCard, toastError, toastSuccess, toastWarning, confirmAction } from '../../components/ui';
import { useDebounced, useInterval, useLocalStorage, useResource } from '../../components/hooks';
import { useAuth } from '../../lib/auth';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { MonitorStats, ToolRankCard } from './stats';
import { CallsTimeline } from './timeline';
import ExecutionTable from './executions';
import ExecutionDetail from './detail';
import { averageDurationMs, executionDurationMs, toolDisplayName } from './utils';
import './page.css';

export default function McpMonitorPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const [searchParams, setSearchParams] = useSearchParams();
    // Cancelling goes through POST /monitor/execution/:id/cancel, RBAC requires monitor:write; mcp:write grants are also accepted.
    const canWrite = hasPermission('monitor:write') || hasPermission('mcp:write');
    const canDelete = hasPermission('monitor:delete');

    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [status, setStatus] = useState('all');
    const [toolInput, setToolInput] = useState('');
    const tool = useDebounced(toolInput, 350);
    const [selected, setSelected] = useState([]);
    const [timelineRange, setTimelineRange] = useLocalStorage('mcp-monitor-timeline-range', '7d');
    const [cancelTarget, setCancelTarget] = useState(null);
    const [cancelNote, setCancelNote] = useState('');
    const [cancelling, setCancelling] = useState(false);

    const detailId = searchParams.get('id') || '';
    const range = ['24h', '7d', '30d'].includes(timelineRange) ? timelineRange : '7d';

    const list = useResource(
        () => api.get('/monitor', {
            page,
            page_size: pageSize,
            status: status === 'all' ? '' : status,
            tool
        }),
        [page, pageSize, status, tool]
    );
    const stats = useResource(() => api.get('/monitor/stats', { top: 12 }), []);
    const timeline = useResource(
        () => api.get('/monitor/calls-timeline', { range }),
        [range]
    );

    const executions = list.data?.executions || [];
    const summary = stats.data?.summary || list.data?.summary || null;
    const topTools = stats.data?.topTools || list.data?.topTools || [];
    const retentionDays = Number(list.data?.retentionDays) || 0;

    const durationSamples = useMemo(
        () => executions.filter(exec => executionDurationMs(exec) !== null).length,
        [executions]
    );
    const avgMs = useMemo(() => averageDurationMs(executions), [executions]);

    // The monitor page refreshes periodically like the old implementation; skip while the tab is hidden to avoid pointless requests.
    useInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        list.reload({ silent: true });
        timeline.reload({ silent: true });
    }, 5000);
    useInterval(() => {
        if (typeof document !== 'undefined' && document.hidden) return;
        stats.reload({ silent: true });
    }, 20000);

    const reloadAll = useCallback(() => {
        list.reload();
        stats.reload({ silent: true });
        timeline.reload({ silent: true });
    }, [list.reload, stats.reload, timeline.reload]); // eslint-disable-line react-hooks/exhaustive-deps

    const openDetail = useCallback(id => {
        const next = new URLSearchParams(searchParams);
        next.set('id', id);
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    const closeDetail = useCallback(() => {
        const next = new URLSearchParams(searchParams);
        next.delete('id');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);

    const handleQuery = useCallback(patch => {
        if (Object.prototype.hasOwnProperty.call(patch, 'toolInput')) setToolInput(patch.toolInput);
        if (patch.status !== undefined) setStatus(patch.status);
        setPage(1);
        setSelected([]);
    }, []);

    const handlePageChange = useCallback((nextPage, nextSize) => {
        setPage(nextPage);
        if (nextSize && nextSize !== pageSize) setPageSize(nextSize);
    }, [pageSize]);

    const filterByTool = useCallback(toolName => {
        setToolInput(toolDisplayName(toolName));
        setPage(1);
        setSelected([]);
    }, []);

    const requestDelete = useCallback(record => {
        confirmAction({
            title: t('mcpMonitor.deleteExecTitle', null, 'Delete this execution record'),
            content: t('ui.mcpIndex.confirmDeleteOne', {
                name: toolDisplayName(record.toolName) || t('ui.mcpIndex.thisTool', null, 'this tool')
            }, 'Delete the execution record of {{name}}? This action cannot be undone.'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del(`/monitor/execution/${encodeURIComponent(record.id)}`);
                    setSelected(prev => prev.filter(id => id !== record.id));
                    toastSuccess(t('mcpMonitor.execDeleted', null, 'Execution record deleted'));
                    reloadAll();
                } catch (error) {
                    toastError(error, t('mcpMonitor.deleteExecFailed', null, 'Failed to delete execution record'));
                }
            }
        });
    }, [reloadAll, t]);

    const batchDelete = useCallback(async () => {
        if (!selected.length) {
            toastWarning(t('mcpMonitor.selectExecFirst', null, 'Please select execution record(s) to delete first'));
            return;
        }
        let names = [];
        try {
            const result = await api.post('/monitor/executions/names', { ids: selected });
            names = [...new Set(Object.values(result || {}).map(item => toolDisplayName(item?.toolName)).filter(Boolean))];
        } catch (error) {
            names = [];
        }
        const contentText = names.length
            ? t('ui.mcpIndex.confirmDeleteNamed', {
                names: names.slice(0, 3).join(t('ui.mcpIndex.listSeparator', null, ', ')),
                more: names.length > 3 ? t('ui.mcpIndex.moreSuffix', null, ' and more') : ''
            }, 'Tools involved: {{names}}{{more}}. This action cannot be undone.')
            : t('ui.mcpIndex.irreversible', null, 'This action cannot be undone.');
        confirmAction({
            title: t('mcpMonitor.batchDeleteConfirm', { count: selected.length }, 'Are you sure you want to delete the selected {{count}} execution record(s)? This cannot be undone.'),
            content: contentText,
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del('/monitor/executions', { body: { ids: selected } });
                    toastSuccess(t('ui.mcpIndex.deletedCount', { count: selected.length }, 'Deleted {{count}} execution records'));
                    setSelected([]);
                    reloadAll();
                } catch (error) {
                    toastError(error, t('mcp.batchDeleteFailed', null, 'Batch delete failed'));
                }
            }
        });
    }, [reloadAll, selected, t]);

    const openCancel = useCallback(record => {
        setCancelTarget(record);
        setCancelNote('');
    }, []);

    const submitCancel = useCallback(async () => {
        if (!cancelTarget?.id) return;
        setCancelling(true);
        try {
            await api.post(`/monitor/execution/${encodeURIComponent(cancelTarget.id)}/cancel`, {
                note: cancelNote.trim()
            });
            toastSuccess(t('mcpDetailModal.abortSuccess', null, 'Cancellation requested; status will update when the tool returns.'));
            setCancelTarget(null);
            reloadAll();
        } catch (error) {
            toastError(error, t('mcpDetailModal.abortFailed', null, 'Failed to stop tool'));
        } finally {
            setCancelling(false);
        }
    }, [cancelNote, cancelTarget, reloadAll, t]);

    const description = retentionDays > 0
        ? t('mcpMonitor.retentionHint', { days: retentionDays }, 'Execution records are kept for {{days}} days, then purged automatically.')
        : t('ui.mcpIndex.statsAllCalls', null, 'Counts all MCP tool calls; failed and blocked calls are marked separately.');

    return (
        <div className="mcp-monitor-page">
            <PageHeader
                title={t('mcp.monitorTitle', null, 'MCP Status Monitor')}
                description={description}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={reloadAll} loading={list.loading || stats.loading}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                    </Space>
                )}
            />

            <MonitorStats
                summary={summary}
                loading={stats.loading && !summary}
                avgMs={avgMs}
                avgSamples={durationSamples}
            />

            <CallsTimeline
                data={timeline.data}
                loading={timeline.loading}
                error={timeline.error}
                range={range}
                onRangeChange={nextRange => { if (nextRange) setTimelineRange(nextRange); }}
                onRetry={() => timeline.reload()}
            />

            <ToolRankCard
                topTools={topTools}
                loading={stats.loading && !topTools.length}
                onFilterTool={filterByTool}
                activeTool={tool}
            />

            <SectionCard
                title={t('mcp.latestExecutions', null, 'Latest executions')}
                description={t('mcpMonitor.emptyHint', null, 'Execution records will appear here after you invoke MCP tools in chat or tasks')}
                extra={selected.length > 0 ? (
                    <Space spacing={8}>
                        <span className="mcp-monitor-selected">{t('mcp.selectedCount', { count: selected.length }, '{{count}} selected')}</span>
                        <Button size="small" disabled={!canDelete} type="danger" onClick={batchDelete}>
                            {t('mcp.deleteSelected', null, 'Batch delete')}
                        </Button>
                        <Button size="small" theme="borderless" onClick={() => setSelected([])}>
                            {t('mcpMonitor.deselectAll', null, 'Deselect all')}
                        </Button>
                    </Space>
                ) : null}
            >
                <ExecutionTable
                    data={list.data}
                    loading={list.loading}
                    error={list.error}
                    page={page}
                    pageSize={pageSize}
                    status={status}
                    toolInput={toolInput}
                    selected={selected}
                    onQuery={handleQuery}
                    onPageChange={handlePageChange}
                    onRefresh={() => list.reload()}
                    onOpenDetail={openDetail}
                    onCancel={openCancel}
                    onDelete={requestDelete}
                    onSelectionChange={setSelected}
                    canWrite={canWrite}
                    canDelete={canDelete}
                />
            </SectionCard>

            <ExecutionDetail
                executionId={detailId}
                onClose={closeDetail}
                canWrite={canWrite}
                onCancelRequest={record => { closeDetail(); openCancel(record); }}
            />

            <Modal
                title={t('mcpMonitor.terminateExecution', null, 'Stop')}
                visible={Boolean(cancelTarget)}
                confirmLoading={cancelling}
                maskClosable={!cancelling}
                okText={t('mcpMonitor.terminateExecution', null, 'Stop')}
                cancelText={t('common.cancel', null, 'Cancel')}
                onCancel={() => setCancelTarget(null)}
                onOk={submitCancel}
            >
                <p className="mcp-monitor-cancel-hint">
                    {t('mcpDetailModal.abortHint', null, 'Stops only this tool call. The conversation / multi-step task continues (unlike stopping the whole task).')}
                </p>
                <TextArea
                    rows={4}
                    value={cancelNote}
                    placeholder={t('mcpDetailModal.abortNotePlaceholder', null, 'e.g. Output is enough—skip waiting and continue…')}
                    onChange={value => setCancelNote(value)}
                />
            </Modal>
        </div>
    );
}
