/** MCP monitor stat cards and tool call ranking. */
import { useMemo } from 'react';
import { Tag } from '@douyinfe/semi-ui';
import { SectionCard, StatGrid, DataTable } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { formatDateTime, formatPercent } from '../../lib/format';
import { formatDurationMs, formatPercentValue, successRate, toolDisplayName } from './utils';

/**
 * Stat cards: call count / success rate / average duration / failure count.
 * GET /monitor/stats has no duration field; the caller computes the average from the timing records of the current list and passes it in.
 */
export function MonitorStats({ summary, loading, avgMs = null, avgSamples = 0 }) {
    const t = useT();
    const rate = successRate(summary);
    return (
        <StatGrid
            columns={4}
            metrics={[
                {
                    id: 'calls',
                    label: t('mcpMonitor.totalCalls', null, 'Total calls'),
                    value: summary ? (summary.totalCalls ?? 0) : '—',
                    detail: summary
                        ? t('mcpMonitor.statsFromAllTools', null, 'From all tool calls')
                        : undefined,
                    loading
                },
                {
                    id: 'rate',
                    label: t('mcpMonitor.successRate', null, 'Success rate'),
                    value: formatPercentValue(rate),
                    detail: summary
                        ? `${t('common.ok', null, 'OK')} ${summary.successCalls ?? 0} / ${t('mcpMonitor.failedColumn', null, 'Failed')} ${summary.failedCalls ?? 0}`
                        : undefined,
                    tone: rate === null ? undefined : (rate >= 0.95 ? 'success' : rate >= 0.8 ? 'warning' : 'danger'),
                    loading
                },
                {
                    id: 'avg',
                    label: t('ui.mcpStats.avgDuration', null, 'Average duration'),
                    value: avgMs === null ? '—' : formatDurationMs(avgMs),
                    detail: avgSamples > 0
                        ? t('ui.mcpStats.avgEstimated', { count: avgSamples }, 'Estimated from {{count}} timed records on this page')
                        : t('ui.mcpStats.avgNone', null, 'No timed execution records on this page'),
                    loading
                },
                {
                    id: 'failed',
                    label: t('mcpMonitor.failedMetric', null, 'Failures'),
                    value: summary ? (summary.failedCalls ?? 0) : '—',
                    detail: summary
                        ? `${t('mcpMonitor.blockedCount', { n: summary.blockedCalls ?? 0 }, 'Blocked {{n}}')} · ${t('mcpMonitor.lastCall', null, 'Last call')} ${summary.lastCallTime ? formatDateTime(summary.lastCallTime) : '—'}`
                        : undefined,
                    tone: summary && summary.failedCalls > 0 ? 'danger' : undefined,
                    loading
                }
            ]}
        />
    );
}

export function ToolRankCard({ topTools, loading, onFilterTool, activeTool }) {
    const t = useT();
    const rows = useMemo(() => (topTools || []).map(item => {
        const total = Number(item.totalCalls) || 0;
        const blocked = Number(item.blockedCalls) || 0;
        const success = Number(item.successCalls) || 0;
        const denominator = total - blocked;
        return {
            ...item,
            key: item.toolName,
            displayName: toolDisplayName(item.toolName),
            rate: denominator > 0 ? success / denominator : null
        };
    }), [topTools]);

    const columns = [
        {
            title: t('mcpMonitor.columnTool', null, 'Tool'),
            dataIndex: 'displayName',
            render: (value, record) => (
                <button
                    type="button"
                    className={`mcp-monitor-tool-link ${activeTool && activeTool === record.toolName ? 'mcp-monitor-link-active' : ''}`}
                    onClick={() => onFilterTool?.(record.toolName)}
                >
                    {value || t('mcpMonitor.unknownTool', null, 'Unknown tool')}
                </button>
            )
        },
        {
            title: t('mcpMonitor.columnCalls', null, 'Calls'),
            dataIndex: 'totalCalls',
            width: 90,
            render: value => value ?? 0
        },
        {
            title: t('mcpMonitor.successColumn', null, 'Succeeded'),
            dataIndex: 'successCalls',
            width: 90,
            render: value => value ?? 0
        },
        {
            title: t('mcpMonitor.failedColumn', null, 'Failed'),
            dataIndex: 'failedCalls',
            width: 90,
            render: value => <span className={value > 0 ? 'mcp-monitor-danger' : undefined}>{value ?? 0}</span>
        },
        {
            title: t('mcpMonitor.blockedColumn', null, 'Blocked'),
            dataIndex: 'blockedCalls',
            width: 90,
            render: value => (value ? <Tag size="small" color="orange">{value}</Tag> : 0)
        },
        {
            title: t('mcpMonitor.columnSuccessRate', null, 'Success rate'),
            dataIndex: 'rate',
            width: 110,
            render: value => (value === null ? '—' : formatPercent(value, 1))
        }
    ];

    return (
        <SectionCard
            title={t('mcpMonitor.toolStatsTitle', null, 'Tool statistics')}
            description={t('mcpMonitor.toolStatsHint', null, 'Click a bar segment or row to filter records below; hover to highlight')}
        >
            <DataTable
                columns={columns}
                dataSource={rows}
                rowKey="key"
                loading={loading}
                pagination={false}
                size="small"
                emptyText={t('mcpMonitor.noStatsData', null, 'No statistical data')}
            />
        </SectionCard>
    );
}
