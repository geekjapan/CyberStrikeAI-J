/** Formatting utilities: time, numbers, bytes, status palette. */
import { lazyLabels, translate } from './i18n';

export const SEVERITY_ORDER = ['critical', 'high', 'medium', 'low', 'info'];

export const SEVERITY_COLOR = {
    critical: 'red',
    high: 'orange',
    medium: 'amber',
    low: 'blue',
    info: 'grey'
};

export const SEVERITY_LABEL = lazyLabels('ui.format.severity', {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info'
});

export const STATUS_COLOR = {
    running: 'blue',
    pending: 'amber',
    queued: 'amber',
    paused: 'grey',
    success: 'green',
    succeeded: 'green',
    completed: 'green',
    done: 'green',
    failed: 'red',
    error: 'red',
    cancelled: 'grey',
    canceled: 'grey',
    stopped: 'grey',
    active: 'green',
    inactive: 'grey',
    online: 'green',
    offline: 'grey',
    open: 'red',
    closed: 'green',
    archived: 'grey'
};

// Date and number formats follow the UI language; fall back to en-US when unknown.
export function currentLocale() {
    return (typeof document !== 'undefined' && document.documentElement.lang) || 'en-US';
}

export function formatDateTime(value, locale = currentLocale()) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleString(locale, { hourCycle: 'h23' });
}

export function formatDate(value, locale = currentLocale()) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleDateString(locale);
}

export function formatTime(value, locale = currentLocale()) {
    if (!value) return '—';
    const date = value instanceof Date ? value : new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    return date.toLocaleTimeString(locale, { hourCycle: 'h23' });
}

export function relativeTime(value, t) {
    if (!value) return '—';
    const date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '—';
    const diff = Date.now() - date.getTime();
    if (diff < 60_000) return translate('common.justNow', null, 'Just now');
    if (diff < 3_600_000) return translate('common.minutesAgo', { n: Math.floor(diff / 60_000) }, '{{n}} min ago');
    if (diff < 86_400_000) return translate('common.hoursAgo', { n: Math.floor(diff / 3_600_000) }, '{{n}} h ago');
    if (diff < 30 * 86_400_000) return translate('common.daysAgo', { n: Math.floor(diff / 86_400_000) }, '{{n}} d ago');
    return formatDate(value);
}

export function formatBytes(bytes) {
    const value = Number(bytes);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1024) return `${value} B`;
    const units = ['KB', 'MB', 'GB', 'TB'];
    let size = value / 1024;
    let index = 0;
    while (size >= 1024 && index < units.length - 1) { size /= 1024; index += 1; }
    return `${size.toFixed(size >= 100 ? 0 : 1)} ${units[index]}`;
}

export function formatNumber(value, locale = currentLocale()) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return number.toLocaleString(locale);
}

export function formatDuration(seconds) {
    const value = Number(seconds);
    if (!Number.isFinite(value) || value < 0) return '—';
    if (value < 1) return `${Math.round(value * 1000)} ms`;
    if (value < 60) return `${value.toFixed(1)} s`;
    const minutes = Math.floor(value / 60);
    const rest = Math.round(value % 60);
    if (minutes < 60) return `${minutes}m ${rest}s`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

export function formatPercent(value, digits = 1) {
    const number = Number(value);
    if (!Number.isFinite(number)) return '—';
    return `${(number * (number <= 1 ? 100 : 1)).toFixed(digits)}%`;
}

export function severityColor(severity) {
    return SEVERITY_COLOR[String(severity || '').toLowerCase()] || 'grey';
}

export function statusColor(status) {
    return STATUS_COLOR[String(status || '').toLowerCase()] || 'grey';
}

export function truncate(text, length = 120) {
    const value = String(text ?? '');
    return value.length > length ? `${value.slice(0, length)}…` : value;
}

export function humanizeKey(key) {
    return String(key || '')
        .replace(/[_-]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .replace(/^\w/, match => match.toUpperCase());
}

// The default role: "Default", or the name earlier versions stored.
export function isDefaultRole(name) {
    return name === 'Default' || name === '默认';
}
