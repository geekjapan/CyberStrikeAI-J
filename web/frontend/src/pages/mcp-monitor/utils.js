/** Display helpers for the MCP monitor page: status mapping, tool name normalization, duration and success rate. */
import { currentLocale } from '../../lib/format';
import { translate } from '../../lib/i18n';

export const STATUS_VALUES = ['completed', 'running', 'queued', 'failed', 'blocked', 'hard_timeout', 'cancelled', 'orphaned'];

const STATUS_KEY = {
    pending: 'statusPending',
    queued: 'statusQueued',
    running: 'statusRunning',
    completed: 'statusCompleted',
    failed: 'statusFailed',
    blocked: 'statusBlocked',
    cancelled: 'statusCancelled',
    hard_timeout: 'statusHardTimeout',
    orphaned: 'statusOrphaned'
};

const STATUS_FALLBACK = {
    pending: 'Pending',
    queued: 'Queued',
    running: 'Running',
    completed: 'Completed',
    failed: 'Failed',
    blocked: 'Blocked',
    cancelled: 'Cancelled',
    hard_timeout: 'Timed out',
    orphaned: 'Orphaned'
};

const STATUS_TAG_COLOR = {
    completed: 'green',
    running: 'blue',
    queued: 'amber',
    failed: 'red',
    blocked: 'orange',
    hard_timeout: 'red',
    cancelled: 'grey',
    orphaned: 'grey'
};

export function normalizeStatus(status) {
    return String(status || '').trim().toLowerCase();
}

export function statusLabel(t, status) {
    const key = normalizeStatus(status);
    const i18nKey = STATUS_KEY[key];
    if (i18nKey) return t(`mcpMonitor.${i18nKey}`, null, STATUS_FALLBACK[key] || key);
    return status || '—';
}

export function statusTagColor(status) {
    return STATUS_TAG_COLOR[normalizeStatus(status)] || 'grey';
}

/** Only running calls can be cancelled (queued calls have no cancel channel yet). */
export function isRunning(status) {
    return normalizeStatus(status) === 'running';
}

/** The model side shows mcp__tool while storage uses mcp::tool; always display the model-side form. */
export function toolDisplayName(name) {
    const value = String(name || '').trim();
    if (!value) return '';
    return value.includes('::') ? value.replace(/::/g, '__') : value;
}

/** Derive milliseconds from duration (Go time.Duration, nanoseconds) or start/end times. */
export function executionDurationMs(exec) {
    if (!exec) return null;
    const raw = Number(exec.duration);
    if (Number.isFinite(raw) && raw > 0) return raw / 1e6;
    const start = exec.startTime ? new Date(exec.startTime).getTime() : NaN;
    const end = exec.endTime ? new Date(exec.endTime).getTime() : NaN;
    if (Number.isFinite(start) && Number.isFinite(end) && end >= start) return end - start;
    return null;
}

export function formatDurationMs(ms) {
    const value = Number(ms);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1000) return `${Math.round(value)} ms`;
    if (value < 60_000) return `${(value / 1000).toFixed(2)} s`;
    const minutes = Math.floor(value / 60_000);
    const seconds = Math.round((value % 60_000) / 1000);
    if (minutes < 60) return translate('ui.mcpUtils.minutesSeconds', { minutes, seconds }, '{{minutes}} min {{seconds}} s');
    const hours = Math.floor(minutes / 60);
    return translate('ui.mcpUtils.hoursMinutes', { hours, minutes: minutes % 60 }, '{{hours}} h {{minutes}} min');
}

/** The success-rate numerator excludes blocked calls (blocked is neither success nor execution failure). */
export function successRate(summary) {
    if (!summary) return null;
    const total = Number(summary.totalCalls) || 0;
    const blocked = Number(summary.blockedCalls) || 0;
    const denominator = total - blocked;
    if (denominator <= 0) return null;
    return (Number(summary.successCalls) || 0) / denominator;
}

export function formatPercentValue(rate, digits = 1) {
    if (rate === null || rate === undefined || !Number.isFinite(Number(rate))) return '—';
    return `${(Number(rate) * 100).toFixed(digits)}%`;
}

/** Average duration of the timed records on the current page. */
export function averageDurationMs(executions) {
    const samples = (executions || [])
        .map(executionDurationMs)
        .filter(value => Number.isFinite(value) && value >= 0);
    if (!samples.length) return null;
    return samples.reduce((sum, value) => sum + value, 0) / samples.length;
}

export function formatBucketLabel(iso, range) {
    const date = new Date(iso);
    if (!Number.isFinite(date.getTime())) return '';
    const pad = value => String(value).padStart(2, '0');
    const day = `${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (range === '30d') return day;
    if (range === '7d') return `${day} ${pad(date.getHours())}h`;
    return `${pad(date.getHours())}:00`;
}

export function formatBucketTooltip(point, t) {
    const time = point?.t ? new Date(point.t).toLocaleString(currentLocale(), { hourCycle: 'h23' }) : '—';
    return t('mcpMonitor.timelineTooltip', {
        time,
        total: point?.total || 0,
        failed: point?.failed || 0,
        blocked: point?.blocked || 0
    }, '{{time}}: {{total}} calls ({{failed}} failed, {{blocked}} blocked)');
}
