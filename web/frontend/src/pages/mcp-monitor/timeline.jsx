/** Call trend: pure DOM bars (no chart library), bucketed by 24h / 7d / 30d. */
import { useMemo } from 'react';
import { Select } from '@douyinfe/semi-ui';
import { SectionCard, ErrorBanner, StatCard } from '../../components/ui';
import { useT } from '../../lib/i18n';
import { formatNumber } from '../../lib/format';
import { formatBucketLabel, formatBucketTooltip } from './utils';

const RANGE_OPTIONS = [
    { value: '24h', labelKey: 'timelineRange24h', fallback: '24h' },
    { value: '7d', labelKey: 'timelineRange7d', fallback: '7d' },
    { value: '30d', labelKey: 'timelineRange30d', fallback: '30d' }
];

export function CallsTimeline({ data, loading, error, range, onRangeChange, onRetry }) {
    const t = useT();
    const points = Array.isArray(data?.points) ? data.points : [];
    const summary = data?.summary || {};
    const peak = Number(summary.peak) || 0;
    const max = useMemo(() => points.reduce((acc, point) => Math.max(acc, Number(point.total) || 0), 0), [points]);
    const totalCalls = Number(summary.totalCalls) || 0;
    const tickStep = Math.max(1, Math.ceil(points.length / 8));

    const options = RANGE_OPTIONS.map(item => ({
        value: item.value,
        label: t(`mcpMonitor.${item.labelKey}`, null, item.fallback)
    }));

    return (
        <SectionCard
            title={t('mcpMonitor.timelineTitle', null, 'Call trend')}
            description={t('mcpMonitor.timelineHint', null, 'All tools combined (not split by tool)')}
            extra={(
                <Select
                    size="small"
                    value={range}
                    optionList={options}
                    style={{ width: 120 }}
                    onChange={onRangeChange}
                />
            )}
        >
            <ErrorBanner error={error} onRetry={onRetry} />
            <div className="mcp-monitor-timeline-summary">
                <StatCard
                    label={t('mcpMonitor.timelineTotalLegend', null, 'Total calls')}
                    value={formatNumber(totalCalls)}
                    loading={loading}
                />
                <StatCard
                    label={t('ui.mcpTimeline.peakPerBucket', null, 'Peak / bucket')}
                    value={formatNumber(peak)}
                    detail={t('mcpMonitor.scopeTimeline', null, 'Trend period')}
                    loading={loading}
                />
                <div className="mcp-monitor-timeline-legend">
                    <span className="mcp-monitor-legend-item">
                        <i className="mcp-monitor-legend-dot mcp-monitor-legend-total" />
                        {t('mcpMonitor.timelineTotalLegend', null, 'Total calls')}
                    </span>
                    <span className="mcp-monitor-legend-item">
                        <i className="mcp-monitor-legend-dot mcp-monitor-legend-failed" />
                        {t('mcpMonitor.timelineFailedLegend', null, 'Failed')}
                    </span>
                    <span className="mcp-monitor-legend-item">
                        <i className="mcp-monitor-legend-dot mcp-monitor-legend-blocked" />
                        {t('mcpMonitor.timelineBlockedLegend', null, 'Blocked')}
                    </span>
                </div>
            </div>

            {loading && !points.length ? (
                <div className="mcp-monitor-timeline-empty">{t('mcpMonitor.timelineLoading', null, 'Loading trend…')}</div>
            ) : totalCalls === 0 || max === 0 ? (
                <div className="mcp-monitor-timeline-empty">
                    <p>{t('mcpMonitor.timelineNoData', null, 'No calls in this period')}</p>
                    <p className="mcp-monitor-timeline-hint">{t('mcpMonitor.timelineEmptyHint', null, 'Switch the time range or invoke MCP tools in chat or tasks')}</p>
                </div>
            ) : (
                <div className="mcp-monitor-timeline-chart" role="img" aria-label={t('mcpMonitor.timelineTitle', null, 'Call trend')}>
                    {points.map((point, index) => {
                        const total = Number(point.total) || 0;
                        const failed = Number(point.failed) || 0;
                        const blocked = Number(point.blocked) || 0;
                        const height = total > 0 ? Math.max(3, (total / max) * 100) : 0;
                        const failedShare = total > 0 ? (failed / total) * 100 : 0;
                        const blockedShare = total > 0 ? (blocked / total) * 100 : 0;
                        const label = formatBucketLabel(point.t, range);
                        return (
                            <div
                                className="mcp-monitor-timeline-slot"
                                key={point.t || index}
                                title={formatBucketTooltip(point, t)}
                            >
                                <div className="mcp-monitor-timeline-bar-wrap">
                                    <div className="mcp-monitor-timeline-bar" style={{ height: `${height}%` }}>
                                        {blockedShare > 0 && (
                                            <span className="mcp-monitor-timeline-seg mcp-monitor-seg-blocked" style={{ height: `${blockedShare}%` }} />
                                        )}
                                        {failedShare > 0 && (
                                            <span className="mcp-monitor-timeline-seg mcp-monitor-seg-failed" style={{ height: `${failedShare}%` }} />
                                        )}
                                    </div>
                                </div>
                                <span className="mcp-monitor-timeline-tick">
                                    {index % tickStep === 0 ? label : ''}
                                </span>
                            </div>
                        );
                    })}
                </div>
            )}
        </SectionCard>
    );
}
