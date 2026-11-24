/**
 * Audit log: GET /audit/logs (pagination/filters), GET /audit/logs/:id, GET /audit/logs/export,
 * GET /audit/summary, GET /audit/meta. Table + detail SideSheet + JSON/CSV export.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import {
    Banner, Button, DatePicker, Input, Select, SideSheet, Space, Tag, Tooltip, Typography
} from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api, downloadFile } from '../../../lib/http';
import { useAuth } from '../../../lib/auth';
import { useT } from '../../../lib/i18n';
import { useResource } from '../../../components/hooks';
import {
    DataTable, ErrorBanner, JsonViewer, KeyValueList, SectionCard, StatGrid, toastError, toastSuccess
} from '../../../components/ui';
import { formatDateTime, formatNumber, truncate } from '../../../lib/format';
import { LoadingBlock, Mono, PermissionBanner } from './common';

const { Text } = Typography;

/** Matches web/static/js/audit.js and the backend category/action values. */
const ACTIONS_BY_CATEGORY = {
    auth: ['login', 'logout', 'change_password'],
    config: ['apply', 'update'],
    c2: ['listener_create', 'listener_delete', 'listener_start', 'listener_stop',
        'session_delete', 'task_create', 'task_cancel', 'task_delete'],
    webshell: ['connection_create', 'connection_delete'],
    knowledge: ['item_delete', 'index_build', 'index_rebuild_full'],
    conversation: ['create', 'delete', 'delete_turn'],
    vulnerability: ['create', 'update', 'delete'],
    external_mcp: ['upsert', 'delete'],
    task: ['create_queue', 'start_queue', 'delete_queue', 'pause_queue', 'rerun_queue', 'delete_batch_task'],
    tool: ['execution_delete', 'execution_delete_batch'],
    file: ['upload', 'delete'],
    hitl: ['decision', 'audit_strategy_update'],
    role: ['create', 'update', 'delete'],
    skill: ['create', 'update', 'delete'],
    agent: ['markdown_create', 'markdown_update', 'markdown_delete']
};

const EMPTY_FILTERS = { category: '', action: '', result: '', q: '', since: null, until: null };

function categoryI18nKey(category) {
    return category === 'external_mcp' ? 'externalMcp' : category;
}

function buildQuery(filters) {
    const query = {};
    if (filters.category) query.category = filters.category;
    if (filters.action) query.action = filters.action;
    if (filters.result) query.result = filters.result;
    if (filters.q) query.q = filters.q;
    if (filters.since) query.since = filters.since.toISOString();
    if (filters.until) query.until = filters.until.toISOString();
    return query;
}

function ResultTag({ result, label }) {
    const key = String(result || '').toLowerCase();
    const color = key === 'failure' || key === 'failed' || key === 'error' ? 'red' : key === 'success' ? 'green' : 'grey';
    return <Tag size="small" color={color}>{label || result || '—'}</Tag>;
}

export default function AuditSection() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canRead = hasPermission('audit:read');

    const meta = useResource(() => api.get('/audit/meta'), [canRead], { skip: !canRead });

    const [draft, setDraft] = useState(EMPTY_FILTERS);
    const [applied, setApplied] = useState(EMPTY_FILTERS);
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [detailId, setDetailId] = useState('');
    const [exporting, setExporting] = useState('');

    const query = useMemo(() => buildQuery(applied), [applied]);
    const summaryLoader = useCallback(() => api.get('/audit/summary', query), [query]);
    const summary = useResource(summaryLoader, [query, canRead], { skip: !canRead });

    const logsLoader = useCallback(
        () => api.get('/audit/logs', { ...query, page, page_size: pageSize }),
        [query, page, pageSize]
    );
    const logs = useResource(logsLoader, [query, page, pageSize, canRead], { skip: !canRead });

    const categoryLabel = useCallback(category => (
        category ? t(`settingsAudit.cat.${categoryI18nKey(category)}`, null, category) : '—'
    ), [t]);
    const actionLabel = useCallback(action => (
        action ? t(`settingsAudit.act.${action}`, null, action) : '—'
    ), [t]);
    const resultLabel = useCallback(result => (
        result ? t(`settingsAudit.result.${result}`, null, result) : '—'
    ), [t]);

    const categories = useMemo(() => [
        { value: '', label: t('settingsAudit.filterAllCategories', null, 'All categories') },
        ...Object.keys(ACTIONS_BY_CATEGORY).map(key => ({ value: key, label: categoryLabel(key) }))
    ], [categoryLabel, t]);

    const actions = useMemo(() => {
        const list = draft.category ? (ACTIONS_BY_CATEGORY[draft.category] || []) : [];
        return [
            { value: '', label: t('settingsAudit.filterAllActions', null, 'All actions') },
            ...list.map(key => ({ value: key, label: actionLabel(key) }))
        ];
    }, [actionLabel, draft.category, t]);

    const applyFilters = () => {
        const next = { ...draft };
        if (!next.category) next.action = '';
        setApplied(next);
        setPage(1);
    };

    const resetFilters = () => {
        setDraft(EMPTY_FILTERS);
        setApplied(EMPTY_FILTERS);
        setPage(1);
    };

    const refreshAll = () => {
        summary.reload();
        logs.reload();
    };

    const exportLogs = async format => {
        if (!canRead) return;
        setExporting(format);
        try {
            const date = new Date().toISOString().slice(0, 10);
            const filename = `audit-logs-${date}.${format === 'csv' ? 'csv' : 'json'}`;
            await downloadFile('/audit/logs/export', {
                query: { ...query, format: format === 'csv' ? 'csv' : undefined },
                filename
            });
            toastSuccess(t('settingsAudit.exportDone', null, 'Export complete'));
        } catch (error) {
            toastError(error, t('common.downloadFailed', null, 'Export failed'));
        } finally {
            setExporting('');
        }
    };

    if (!canRead) {
        return <PermissionBanner permission="audit:read" label={t('settings.nav.audit', null, 'Audit logs')} />;
    }
    if (meta.loading && !meta.data) return <LoadingBlock rows={6} />;

    const total = Number(summary.data?.total) || 0;
    const failures = Number(summary.data?.failures) || 0;
    const recent7d = Number(summary.data?.recent_7d) || 0;

    const columns = [
        {
            title: t('settingsAudit.colTime', null, 'Time'),
            dataIndex: 'createdAt',
            width: 180,
            render: value => formatDateTime(value)
        },
        {
            title: t('settingsAudit.colMessage', null, 'Message'),
            dataIndex: 'message',
            render: (value, row) => (
                <Tooltip content={value || '—'} position="topLeft">
                    <Space spacing={6}>
                        {row.level && row.level !== 'info' && (
                            <Tag size="small" color={row.level === 'error' ? 'red' : 'amber'}>{row.level}</Tag>
                        )}
                        <Text>{truncate(value || '—', 68)}</Text>
                    </Space>
                </Tooltip>
            )
        },
        {
            title: t('settingsAudit.colCategory', null, 'Category'),
            dataIndex: 'category',
            width: 120,
            render: value => <Tag size="small" color="blue">{categoryLabel(value)}</Tag>
        },
        {
            title: t('settingsAudit.colAction', null, 'Action'),
            dataIndex: 'action',
            width: 170,
            render: value => <Text type="tertiary">{actionLabel(value)}</Text>
        },
        {
            title: t('settingsAudit.colResult', null, 'Result'),
            dataIndex: 'result',
            width: 100,
            render: value => <ResultTag result={value} label={resultLabel(value)} />
        },
        {
            title: t('settingsAudit.colIp', null, 'IP'),
            dataIndex: 'clientIp',
            width: 140,
            render: value => <Mono>{value || '—'}</Mono>
        },
        {
            title: t('settingsAudit.colResource', null, 'Resource ID'),
            dataIndex: 'resourceId',
            width: 200,
            render: (value, row) => (
                <Tooltip content={[row.resourceType, value].filter(Boolean).join(' · ') || '—'} position="topLeft">
                    <Text type="tertiary">{truncate(value || '—', 22)}</Text>
                </Tooltip>
            )
        }
    ];

    return (
        <>
            <ErrorBanner error={meta.error} onRetry={meta.reload} />
            {meta.data?.enabled === false && (
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    className="settings-audit-banner"
                    description={t('settingsAudit.disabledHint', null, 'Audit logging is disabled; new actions are not written.')}
                />
            )}
            <StatGrid
                columns={4}
                metrics={[
                    { id: 'total', label: t('settingsAudit.statTotal', null, 'Filtered total'), value: formatNumber(total) },
                    { id: 'ok', label: t('settingsAudit.statSuccess', null, 'Success'), value: formatNumber(Math.max(0, total - failures)) },
                    { id: 'fail', label: t('settingsAudit.statFailures', null, 'Failures'), value: formatNumber(failures), tone: failures ? 'danger' : undefined },
                    { id: 'recent', label: t('settingsAudit.statRecent7d', null, 'Last 7 days'), value: formatNumber(recent7d) }
                ]}
            />
            <ErrorBanner error={summary.error} onRetry={summary.reload} />

            <SectionCard
                title={t('settingsAudit.title', null, 'Audit logs')}
                description={t('settingsAudit.description', null, 'Platform admin actions (login, config, deletes). Does not log chat content, per-command terminal/WebShell runs, or per-tool invocations.')}
                extra={(
                    <Space>
                        <Tag size="small" color="grey">
                            {t('settingsAudit.retentionHint', { days: meta.data?.retention_days ?? 0 }, 'Audit records are kept for {{days}} days, then purged automatically.')}
                        </Tag>
                        <Button loading={exporting === 'json'} onClick={() => exportLogs('json')}>
                            {t('settingsAudit.exportJson', null, 'Export JSON')}
                        </Button>
                        <Button loading={exporting === 'csv'} onClick={() => exportLogs('csv')}>
                            {t('settingsAudit.exportCsv', null, 'Export CSV')}
                        </Button>
                    </Space>
                )}
            >
                <div className="settings-audit-filters">
                    <Select
                        value={draft.category}
                        onChange={value => setDraft(current => ({ ...current, category: value, action: '' }))}
                        optionList={categories}
                        style={{ width: 150 }}
                    />
                    <Select
                        value={draft.action}
                        onChange={value => setDraft(current => ({ ...current, action: value }))}
                        optionList={actions}
                        disabled={!draft.category}
                        placeholder={draft.category
                            ? t('settingsAudit.filterAllActions', null, 'All actions')
                            : t('settingsAudit.filterCascadeHint', null, 'Select a category to filter by action')}
                        style={{ width: 170 }}
                    />
                    <Select
                        value={draft.result}
                        onChange={value => setDraft(current => ({ ...current, result: value }))}
                        style={{ width: 130 }}
                        optionList={[
                            { value: '', label: t('settingsAudit.filterAll', null, 'All') },
                            { value: 'success', label: t('settingsAudit.result.success', null, 'success') },
                            { value: 'failure', label: t('settingsAudit.result.failure', null, 'failure') }
                        ]}
                    />
                    <Input
                        prefix={<IconSearch />}
                        value={draft.q}
                        onChange={value => setDraft(current => ({ ...current, q: value }))}
                        placeholder={t('settingsAudit.filterQueryPlaceholder', null, 'Message / resource ID / action')}
                        style={{ width: 240 }}
                        showClear
                    />
                    <DatePicker
                        type="dateTime"
                        value={draft.since || undefined}
                        onChange={value => setDraft(current => ({ ...current, since: value || null }))}
                        placeholder={t('settingsAudit.filterSince', null, 'From')}
                        style={{ width: 200 }}
                    />
                    <DatePicker
                        type="dateTime"
                        value={draft.until || undefined}
                        onChange={value => setDraft(current => ({ ...current, until: value || null }))}
                        placeholder={t('settingsAudit.filterUntil', null, 'Until')}
                        style={{ width: 200 }}
                    />
                    <Button theme="solid" type="primary" onClick={applyFilters}>
                        {t('settingsAudit.filterBtn', null, 'Filter')}
                    </Button>
                    <Button onClick={resetFilters}>
                        {t('settingsAudit.resetBtn', null, 'Reset')}
                    </Button>
                    <Button icon={<IconRefresh />} theme="borderless" onClick={refreshAll} loading={logs.loading || summary.loading}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>
                </div>
                <ErrorBanner error={logs.error} onRetry={logs.reload} />
                <DataTable
                    columns={columns}
                    dataSource={Array.isArray(logs.data?.logs) ? logs.data.logs : []}
                    rowKey="id"
                    loading={logs.loading}
                    emptyText={t('settingsAudit.empty', null, 'No audit records')}
                    onRow={record => ({
                        onClick: () => setDetailId(record.id),
                        style: { cursor: 'pointer' }
                    })}
                    pagination={{
                        currentPage: page,
                        pageSize,
                        total: Number(logs.data?.total) || 0,
                        showSizeChanger: true,
                        pageSizeOpts: [10, 20, 50, 100],
                        onPageChange: next => setPage(next),
                        onPageSizeChange: size => { setPageSize(size); setPage(1); }
                    }}
                />
            </SectionCard>

            <SideSheet
                title={t('settingsAudit.detailTitle', null, 'Audit detail')}
                visible={Boolean(detailId)}
                onCancel={() => setDetailId('')}
                width={640}
                placement="right"
            >
                {detailId && <AuditDetail id={detailId} categoryLabel={categoryLabel} actionLabel={actionLabel} resultLabel={resultLabel} />}
            </SideSheet>
        </>
    );
}

function AuditDetail({ id, categoryLabel, actionLabel, resultLabel }) {
    const t = useT();
    const [state, setState] = useState({ loading: true, error: null, log: null });
    useEffect(() => {
        let cancelled = false;
        setState({ loading: true, error: null, log: null });
        api.get(`/audit/logs/${encodeURIComponent(id)}`)
            .then(payload => { if (!cancelled) setState({ loading: false, error: null, log: payload?.log || null }); })
            .catch(error => { if (!cancelled) setState({ loading: false, error, log: null }); });
        return () => { cancelled = true; };
    }, [id]);

    if (state.loading) return <LoadingBlock rows={6} />;
    if (state.error) return <ErrorBanner error={state.error} />;
    const log = state.log;
    if (!log) return <Text type="tertiary">{t('settingsAudit.empty', null, 'No audit records')}</Text>;

    return (
        <div className="settings-audit-detail">
            <KeyValueList
                columns={2}
                items={[
                    { label: t('settingsAudit.detailTime', null, 'Time'), value: formatDateTime(log.createdAt) },
                    { label: t('settingsAudit.detailResult', null, 'Result'), value: <ResultTag result={log.result} label={resultLabel(log.result)} /> },
                    { label: t('settingsAudit.detailCategory', null, 'Category'), value: categoryLabel(log.category) },
                    { label: t('settingsAudit.colAction', null, 'Action'), value: actionLabel(log.action) },
                    { label: t('settingsDisplay.actor', null, 'Actor'), value: log.actor || '—' },
                    { label: t('settingsAudit.colIp', null, 'IP'), value: <Mono>{log.clientIp || '—'}</Mono> },
                    { label: t('settingsDisplay.level', null, 'Log level'), value: log.level || '—' },
                    { label: t('settingsDisplay.resourceType', null, 'Resource type'), value: log.resourceType || '—' },
                    { label: t('settingsAudit.resourceIdLabel', null, 'Resource ID'), value: <Mono>{log.resourceId || '—'}</Mono> },
                    {
                        label: t('settingsDisplay.resourceAvailable', null, 'Resource accessible'),
                        value: log.resourceAvailable == null ? '—' : log.resourceAvailable ? t('common.yes', null, 'Yes') : t('common.no', null, 'No')
                    },
                    { label: t('settingsDisplay.session', null, 'Session ID'), value: <Mono>{log.sessionHint || '—'}</Mono> },
                    { label: t('settingsDisplay.userAgent', null, 'Client identifier'), value: truncate(log.userAgent || '—', 80) }
                ]}
            />
            <div className="settings-audit-message-block">
                <Text type="tertiary" size="small">{t('settingsAudit.detailMessage', null, 'Message')}</Text>
                <Text>{log.message || '—'}</Text>
            </div>
            {log.detail && <JsonViewer value={log.detail} collapsed title={t('settingsDisplay.details', null, 'Details')} />}
        </div>
    );
}
