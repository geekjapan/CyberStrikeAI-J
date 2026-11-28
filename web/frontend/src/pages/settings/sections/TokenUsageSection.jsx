import { useCallback, useId, useMemo, useState } from 'react';
import { Button, Input, Select, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh } from '@douyinfe/semi-icons';
import { api } from '../../../lib/http';
import { useAuth } from '../../../lib/auth';
import { useT } from '../../../lib/i18n';
import { useDebounced, useResource } from '../../../components/hooks';
import {
    DataTable, ErrorBanner, SectionCard, StatGrid
} from '../../../components/ui';
import { formatDateTime, formatNumber, truncate } from '../../../lib/format';
import { LoadingBlock, PermissionBanner } from './common';

const { Text } = Typography;

function count(value) {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? Math.trunc(number) : 0;
}

function cacheRate(summary) {
    const input = count(summary?.promptTokens);
    const cached = count(summary?.cachedTokens);
    if (!input) return '—';
    return `${(Math.min(cached, input) / input * 100).toFixed(1)}%`;
}

const BREAKDOWN_COLUMNS = [
    ['events', 'settingsDisplay.events', 'Records'],
    ['modelCalls', 'dashboard.usageCalls', 'Model calls'],
    ['promptTokens', 'dashboard.usageInput', 'Input tokens'],
    ['completionTokens', 'dashboard.usageOutput', 'Output tokens'],
    ['totalTokens', 'dashboard.usageTotal', 'Total tokens'],
    ['cachedTokens', 'dashboard.usageCacheRead', 'Cache read']
];

function breakdownColumns(t, firstTitle) {
    return [
        { title: firstTitle, dataIndex: 'key', render: (value, row) => <Text strong>{row.label || value || '—'}</Text> },
        ...BREAKDOWN_COLUMNS.map(([dataIndex, key, fallback]) => ({
            title: t(key, null, fallback),
            dataIndex,
            align: 'right',
            render: value => formatNumber(count(value))
        }))
    ];
}

export default function TokenUsageSection() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canReadOverall = hasPermission('dashboard:read');
    const canReadConversation = hasPermission('chat:read');
    const filtersId = useId();
    const [overallDays, setOverallDays] = useState(7);
    const [conversationDays, setConversationDays] = useState(365);
    const [limit, setLimit] = useState(20);
    const [projectInput, setProjectInput] = useState('');
    const projectId = useDebounced(projectInput.trim(), 400);
    const [selectedConversation, setSelectedConversation] = useState(null);
    const [pickerOpen, setPickerOpen] = useState(false);
    const [pickerInput, setPickerInput] = useState('');
    const conversationSearch = useDebounced(pickerInput.trim(), 300);
    const conversationId = canReadConversation ? selectedConversation?.value : undefined;
    const days = conversationId ? conversationDays : overallDays;
    const canQueryUsage = Boolean(conversationId) || canReadOverall;
    const loadPicker = canReadConversation && pickerOpen;
    const picker = useResource(async () => {
        const result = await api.get('/conversations', { search: conversationSearch || undefined, limit: 50 });
        return (result?.conversations || []).map(conversation => ({
            value: conversation.id,
            label: [
                conversation.title || t('chat.untitled', null, 'Untitled conversation'),
                formatDateTime(conversation.updatedAt || conversation.createdAt)
            ].join(' · ')
        }));
    }, [loadPicker, conversationSearch, t], { skip: !loadPicker });
    const pickerOptions = picker.data || [];
    const options = selectedConversation && !pickerOptions.some(option => option.value === selectedConversation.value)
        ? [selectedConversation, ...pickerOptions]
        : pickerOptions;

    const usageProjectId = conversationId ? undefined : projectId || undefined;
    const scopeKey = conversationId ? ['conversation', conversationId].join(':') : usageProjectId || '';
    const loader = useCallback(async () => ({
        scopeKey,
        result: conversationId
            ? await api.get(`/conversations/${encodeURIComponent(conversationId)}/token-usage`, { days, limit })
            : await api.get('/usage/tokens', { days, limit, project_id: usageProjectId })
    }), [conversationId, days, limit, scopeKey, usageProjectId]);
    const usage = useResource(loader, [loader, canQueryUsage], { skip: !canQueryUsage });
    const data = canQueryUsage && scopeKey === usage.data?.scopeKey ? usage.data.result : null;

    const summary = data?.summary || {};
    const metrics = useMemo(() => ([
        { id: 'total', label: t('tokenUsageUI.usageTotal', null, 'Total tokens'), value: formatNumber(count(summary.totalTokens)) },
        { id: 'input', label: t('tokenUsageUI.usageInput', null, 'Input tokens'), value: formatNumber(count(summary.promptTokens)) },
        { id: 'output', label: t('tokenUsageUI.usageOutput', null, 'Output tokens'), value: formatNumber(count(summary.completionTokens)) },
        { id: 'cache', label: t('tokenUsageUI.usageCacheRead', null, 'Cache read'), value: formatNumber(count(summary.cachedTokens)) },
        { id: 'cacheWrite', label: t('tokenUsageUI.usageCacheWrite', null, 'Cache write'), value: formatNumber(count(summary.cacheWriteTokens)) },
        { id: 'reasoning', label: t('tokenUsageUI.usageReasoning', null, 'Reasoning tokens'), value: formatNumber(count(summary.reasoningTokens)) },
        { id: 'calls', label: t('tokenUsageUI.usageCalls', null, 'Model calls'), value: formatNumber(count(summary.modelCalls)) },
        {
            id: 'rate',
            label: t('tokenUsageUI.usageCacheRate', null, 'Cache hit rate'),
            value: cacheRate(summary),
            detail: t('tokenUsageUI.cacheNote', null, 'Cache reads are part of input, not added to the total again. Cache writes are listed separately.')
        }
    ]), [summary, t]);

    if (!canReadOverall && !canReadConversation) {
        return <PermissionBanner permission="dashboard:read" label={t('settings.nav.tokenUsage', null, 'Token usage')} />;
    }

    const byDay = Array.isArray(data?.byDay) ? data.byDay : [];
    const byModel = Array.isArray(data?.byModel) ? data.byModel : [];
    const recent = Array.isArray(data?.recent) ? data.recent : [];
    const today = data?.today || {};
    const pickerLabel = t('tokenUsageUI.selectConversation', null, 'Search and select a conversation');

    return (
        <>
            {canQueryUsage && <ErrorBanner error={usage.error} onRetry={usage.reload} />}
            <SectionCard
                title={t('settings.nav.tokenUsage', null, 'Token usage')}
            >
                <div className="settings-token-filters">
                    {canReadConversation && (
                        <>
                            <span id={filtersId + '-conversation'} hidden>{pickerLabel}</span>
                            <Select
                                className="settings-token-conversation"
                                aria-labelledby={filtersId + '-conversation'}
                                placeholder={pickerLabel}
                                value={conversationId}
                                optionList={options}
                                filter
                                remote
                                showClear
                                loading={picker.loading}
                                onSearch={setPickerInput}
                                onDropdownVisibleChange={open => {
                                    setPickerOpen(open);
                                    if (!open) setPickerInput('');
                                }}
                                onChange={value => setSelectedConversation(options.find(option => option.value === value) || null)}
                            />
                        </>
                    )}
                    <span id={filtersId + '-days'} hidden>{t('settings.usageDays', null, 'Time range')}</span>
                    <Select
                        aria-labelledby={filtersId + '-days'}
                        value={days}
                        onChange={value => (conversationId ? setConversationDays : setOverallDays)(Number(value))}
                        style={{ width: 120 }}
                        optionList={[7, 30, 90, 365].map(value => ({
                            value, label: t('tokenUsageUI.periodDays', { count: value }, '{{count}} days')
                        }))}
                    />
                    <span id={filtersId + '-limit'} hidden>{t('tokenUsageUI.recentTitle', null, 'Recent records')}</span>
                    <Select
                        aria-labelledby={filtersId + '-limit'}
                        value={limit}
                        onChange={value => setLimit(Number(value))}
                        style={{ width: 130 }}
                        optionList={[20, 50, 100, 200].map(value => ({
                            value, label: t('tokenUsageUI.recentLimit', { count: value }, 'Latest {{count}} records')
                        }))}
                    />
                    {canReadOverall && !conversationId && (
                        <Input
                            value={projectInput}
                            onChange={value => setProjectInput(value)}
                            placeholder={t('settingsDisplay.projectIdOptional', null, 'Project ID (optional)')}
                            style={{ width: 180 }}
                            showClear
                        />
                    )}
                    <Button icon={<IconRefresh />} onClick={usage.reload} loading={usage.loading} disabled={!canQueryUsage}>
                        {t('common.refresh', null, 'Refresh')}
                    </Button>
                </div>
                {canReadConversation && <ErrorBanner error={picker.error} onRetry={picker.reload} />}
                {canQueryUsage && (usage.loading || !usage.error) && !data && <LoadingBlock rows={3} />}
                {data && (
                    <>
                        <StatGrid metrics={metrics} columns={4} />
                        <Space spacing={8} wrap>
                            <Tag size="small" color="blue">
                                {t('tokenUsageUI.todayTotal', { total: formatNumber(count(today.totalTokens)) }, '{{total}} tokens today')}
                            </Tag>
                            <Tag size="small" color="grey">
                                {t('tokenUsageUI.todayCalls', { calls: formatNumber(count(today.modelCalls)) }, '{{calls}} model calls today')}
                            </Tag>
                            <Tag size="small" color="green">
                                {t('tokenUsageUI.todayCache', { rate: cacheRate(today) }, 'Cache hit rate today: {{rate}}')}
                            </Tag>
                        </Space>
                    </>
                )}
            </SectionCard>

            {data && (
                <>
                    <SectionCard title={t('tokenUsageUI.trendTitle', null, 'Daily usage')}>
                        <DataTable
                            columns={breakdownColumns(t, t('tokenUsageUI.colDay', null, 'Date'))}
                            dataSource={byDay}
                            rowKey="key"
                            loading={usage.loading}
                            pagination={false}
                            emptyText={t('tokenUsageUI.noDailyData', null, 'No daily usage records')}
                        />
                    </SectionCard>

                    <SectionCard title={t('tokenUsageUI.modelTitle', null, 'By model')}>
                        <DataTable
                            columns={breakdownColumns(t, t('tokenUsageUI.colModel', null, 'Model'))}
                            dataSource={byModel}
                            rowKey="key"
                            loading={usage.loading}
                            pagination={false}
                            emptyText={t('common.noData', null, 'No data')}
                        />
                    </SectionCard>

                    <SectionCard title={t('tokenUsageUI.recentTitle', null, 'Recent records')}>
                        <DataTable
                            columns={[
                                {
                                    title: t('tokenUsageUI.colTime', null, 'Time'),
                                    dataIndex: 'createdAt',
                                    width: 180,
                                    render: value => formatDateTime(value)
                                },
                                { title: t('tokenUsageUI.colModel', null, 'Model'), dataIndex: 'model', render: value => value || '—' },
                                { title: t('settingsDisplay.usageSource', null, 'Usage source'), dataIndex: 'source', render: value => value || '—' },
                                { title: t('settingsDisplay.orchestration', null, 'Orchestration'), dataIndex: 'orchestration', render: value => value || '—' },
                                {
                                    title: t('settingsDisplay.tokensBreakdown', null, 'Input / output / total tokens'),
                                    align: 'right',
                                    render: (_, row) => `${formatNumber(count(row.promptTokens))} / ${formatNumber(count(row.completionTokens))} / ${formatNumber(count(row.totalTokens))}`
                                },
                                {
                                    title: t('settingsDisplay.conversation', null, 'Conversation'),
                                    dataIndex: 'conversationId',
                                    width: 200,
                                    render: value => <Text type="tertiary">{truncate(value || '—', 18)}</Text>
                                }
                            ]}
                            dataSource={recent}
                            rowKey="id"
                            loading={usage.loading}
                            pagination={{ pageSize: 10, showSizeChanger: false }}
                            emptyText={t('common.noData', null, 'No data')}
                        />
                    </SectionCard>
                </>
            )}
        </>
    );
}
