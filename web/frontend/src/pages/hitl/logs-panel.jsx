/** Approval logs: GET /hitl/logs, GET /hitl/logs/:id, DELETE /hitl/logs (batch/clear). */
import { useCallback, useMemo, useState } from 'react';
import {
    Button, Input, Select, SideSheet, Space, Spin, Tag, Typography
} from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import {
    CopyButton, DataTable, ErrorBanner, JsonViewer, KeyValueList, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { useDebounced, useResource } from '../../components/hooks';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import ContextBlocks from './blocks';
import {
    decidedByLabel, decisionColor, decisionLabel, decisionStatusLabel, formatHitlTime,
    parsePayload, reviewerLabel, summarizePayload
} from './utils';

const { Text } = Typography;

function LogDetail({ logId, onClose }) {
    const t = useT();
    const { data, loading, error, reload } = useResource(
        () => api.get(`/hitl/logs/${encodeURIComponent(logId)}`),
        [logId],
        { skip: !logId }
    );
    const payload = useMemo(() => parsePayload(data?.payload), [data?.payload]);
    const engineLabel = [data?.auditBackend, data?.auditModel].filter(Boolean).join(' · ');

    return (
        <SideSheet
            visible={Boolean(logId)}
            onCancel={onClose}
            width={720}
            title={t('hitl.logModalView', null, 'Audit log detail')}
            footer={<Button onClick={onClose}>{t('common.close', null, 'Close')}</Button>}
        >
            <ErrorBanner error={error} onRetry={reload} />
            {loading && !data && <div className="hitl-panel-loading"><Spin /></div>}
            {data && (
                <div className="hitl-log-detail">
                    <KeyValueList
                        columns={2}
                        items={[
                            { label: t('hitl.colTool', null, 'Tool'), value: <Text strong>{data.toolName || '—'}</Text> },
                            {
                                label: t('hitl.colDecision', null, 'Decision'),
                                value: <Tag size="small" color={decisionColor(data.decision)}>{decisionLabel(data.decision)}</Tag>
                            },
                            { label: t('ui.hitlLogs.fieldStatus', null, 'Status'), value: decisionStatusLabel(data.status) },
                            { label: t('hitl.colDecidedBy', null, 'Reviewer'), value: decidedByLabel(data.decidedBy) },
                            { label: t('ui.hitlLogs.fieldReviewerType', null, 'Reviewer type'), value: reviewerLabel(data.reviewer) },
                            {
                                label: t('ui.hitlLogs.fieldEngine', null, 'Approval engine'),
                                value: engineLabel || '—'
                            },
                            {
                                label: t('hitl.colConversation', null, 'Conversation'),
                                value: data.conversationId
                                    ? (
                                        <Space spacing={4}>
                                            <span className="hitl-mono">{data.conversationId}</span>
                                            <CopyButton text={data.conversationId} size="small" />
                                        </Space>
                                    )
                                    : '—'
                            },
                            { label: t('ui.hitlLogs.fieldMode', null, 'Mode'), value: data.mode || '—' },
                            { label: t('ui.hitlLogs.fieldCreatedAt', null, 'Created at'), value: formatHitlTime(data.createdAt) },
                            { label: t('ui.hitlLogs.fieldDecidedAt', null, 'Decided at'), value: formatHitlTime(data.decidedAt) },
                            { label: 'ID', value: <span className="hitl-mono">{data.id}</span> },
                            { label: t('hitl.fieldComment', null, 'Comment'), value: data.comment || '—' }
                        ]}
                    />
                    <ContextBlocks payload={payload} />
                    <JsonViewer title={t('hitl.fieldPayload', null, 'Payload (JSON)')} value={payload} collapsed />
                </div>
            )}
        </SideSheet>
    );
}

export default function LogsPanel({ canWrite, detailId, onOpenDetail, onCloseDetail, refreshKey = 0 }) {
    const t = useT();
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [searchInput, setSearchInput] = useState('');
    const q = useDebounced(searchInput, 350);
    const [decision, setDecision] = useState('all');
    const [decidedBy, setDecidedBy] = useState('all');
    const [selected, setSelected] = useState([]);

    const query = useMemo(() => ({
        q,
        decision: decision === 'all' ? '' : decision,
        decidedBy: decidedBy === 'all' ? '' : decidedBy
    }), [q, decision, decidedBy]);

    const list = useResource(
        () => api.get('/hitl/logs', { page, pageSize, ...query }),
        [page, pageSize, query, refreshKey]
    );

    const items = list.data?.items || [];
    const total = Number(list.data?.total) || 0;
    const retentionDays = Number(list.data?.retentionDays) || 0;

    const reload = useCallback(() => list.reload(), [list.reload]); // eslint-disable-line react-hooks/exhaustive-deps

    const deleteSelected = useCallback(() => {
        if (!selected.length) return;
        confirmAction({
            title: t('ui.hitlLogs.batchDeleteTitle', null, 'Delete approval logs'),
            content: t('ui.hitlLogs.batchDeleteConfirm', { count: selected.length }, 'Delete the {{count}} selected approval logs? This cannot be undone.'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del('/hitl/logs', { body: { ids: selected } });
                    toastSuccess(t('ui.hitlLogs.batchDeleted', { count: selected.length }, 'Deleted {{count}} approval logs'));
                    setSelected([]);
                    reload();
                } catch (error) {
                    toastError(error, t('ui.hitlLogs.batchDeleteFailed', null, 'Failed to delete approval logs'));
                }
            }
        });
    }, [reload, selected, t]);

    const clearAll = useCallback(() => {
        confirmAction({
            title: t('hitl.clearAll', null, 'Clear all'),
            content: q || decision !== 'all' || decidedBy !== 'all'
                ? t('ui.hitlLogs.clearFilteredConfirm', null, 'This clears all decided logs that match the current filters (pending items are not deleted).')
                : t('ui.hitlLogs.clearAllConfirm', null, 'This clears all decided approval logs (pending items are not deleted).'),
            okText: t('hitl.clearAll', null, 'Clear all'),
            onOk: async () => {
                try {
                    await api.del('/hitl/logs', { query, body: { all: true } });
                    toastSuccess(t('ui.hitlLogs.cleared', null, 'Approval logs cleared'));
                    setSelected([]);
                    setPage(1);
                    reload();
                } catch (error) {
                    toastError(error, t('ui.hitlLogs.clearFailed', null, 'Failed to clear approval logs'));
                }
            }
        });
    }, [decidedBy, decision, q, query, reload, t]);

    const columns = [
        {
            title: t('hitl.colTool', null, 'Tool'),
            dataIndex: 'toolName',
            render: value => <span className="hitl-mono">{value || '—'}</span>
        },
        {
            title: t('hitl.colConversation', null, 'Conversation'),
            dataIndex: 'conversationId',
            width: 200,
            render: value => <span className="hitl-mono hitl-ellipsis" title={value || ''}>{value || '—'}</span>
        },
        {
            title: t('hitl.colDecision', null, 'Decision'),
            dataIndex: 'decision',
            width: 100,
            render: value => <Tag size="small" color={decisionColor(value)}>{decisionLabel(value)}</Tag>
        },
        {
            title: t('hitl.colDecidedBy', null, 'Reviewer'),
            dataIndex: 'decidedBy',
            width: 140,
            render: (value, record) => (
                <div className="hitl-log-by">
                    <span>{decidedByLabel(value)}</span>
                    {record.auditBackend && (
                        <span className="hitl-log-engine">{[record.auditBackend, record.auditModel].filter(Boolean).join(' · ')}</span>
                    )}
                </div>
            )
        },
        {
            title: t('ui.hitlLogs.colComment', null, 'Comment'),
            dataIndex: 'comment',
            render: (value, record) => (
                <span title={value || ''}>{value || summarizePayload(parsePayload(record.payload))}</span>
            )
        },
        {
            title: t('hitl.colTime', null, 'Time'),
            dataIndex: 'decidedAt',
            width: 180,
            render: (value, record) => formatHitlTime(value || record.createdAt)
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 90,
            render: id => (
                <Button size="small" theme="borderless" onClick={() => onOpenDetail(id)}>
                    {t('common.view', null, 'View')}
                </Button>
            )
        }
    ];

    const pagination = {
        currentPage: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOpts: [20, 50, 100],
        showTotal: true,
        onPageChange: next => setPage(next),
        onPageSizeChange: size => { setPageSize(size); setPage(1); }
    };

    return (
        <div className="hitl-logs-panel">
            {retentionDays > 0 && (
                <p className="hitl-retention-hint">
                    {t('hitl.retentionHint', { days: retentionDays }, 'Audit logs are kept for {{days}} days, then purged automatically.')}
                </p>
            )}
            <ErrorBanner error={list.error} onRetry={reload} />
            <DataTable
                columns={columns}
                dataSource={items}
                rowKey="id"
                loading={list.loading}
                pagination={pagination}
                size="small"
                emptyText={t('hitl.logsEmpty', null, 'No audit logs')}
                rowSelection={{
                    selectedRowKeys: selected,
                    onChange: keys => setSelected(keys || [])
                }}
                toolbar={(
                    <Space spacing={8} wrap>
                        <Input
                            showClear
                            style={{ width: 220 }}
                            value={searchInput}
                            placeholder={t('hitl.searchPlaceholder', null, 'Tool, conversation, payload, comment…')}
                            onChange={value => { setSearchInput(value); setPage(1); }}
                        />
                        <Select
                            value={decision}
                            style={{ width: 120 }}
                            optionList={[
                                { value: 'all', label: t('hitl.filterAll', null, 'All') },
                                { value: 'approve', label: t('hitl.decisionApprove', null, 'Approve') },
                                { value: 'reject', label: t('hitl.decisionReject', null, 'Reject') }
                            ]}
                            onChange={value => { setDecision(value); setPage(1); }}
                        />
                        <Select
                            value={decidedBy}
                            style={{ width: 150 }}
                            optionList={[
                                { value: 'all', label: t('hitl.filterAll', null, 'All') },
                                { value: 'human', label: t('hitl.reviewerHuman', null, 'Human') },
                                { value: 'audit_agent', label: t('hitl.reviewerAgent', null, 'Audit Agent') },
                                { value: 'system', label: t('hitl.reviewerSystem', null, 'System') },
                                { value: 'manual', label: t('hitl.reviewerManual', null, 'Manual entry') }
                            ]}
                            onChange={value => { setDecidedBy(value); setPage(1); }}
                        />
                        <Button icon={<IconRefresh />} theme="borderless" size="small" onClick={reload} loading={list.loading}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button
                            size="small"
                            type="danger"
                            theme="borderless"
                            disabled={!canWrite || !selected.length}
                            onClick={deleteSelected}
                        >
                            {selected.length
                                ? t('ui.hitlLogs.batchDeleteCount', { count: selected.length }, 'Delete selected ({{count}})')
                                : t('ui.hitlLogs.batchDelete', null, 'Delete selected')}
                        </Button>
                        <Button size="small" type="danger" theme="borderless" disabled={!canWrite || !total} onClick={clearAll}>
                            {t('hitl.clearAll', null, 'Clear all')}
                        </Button>
                    </Space>
                )}
            />
            <LogDetail logId={detailId} onClose={onCloseDetail} />
        </div>
    );
}
