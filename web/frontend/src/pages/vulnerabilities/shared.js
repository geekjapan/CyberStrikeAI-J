/**
 * Shared constants and helpers of the vulnerability page:
 * enums come from internal/database/vulnerability.go (severity / status comments),
 * query parameters come from parseVulnerabilityListFilter in internal/handler/vulnerability.go.
 */
import { SEVERITY_LABEL } from '../../lib/format';

export const SEVERITY_CODES = ['critical', 'high', 'medium', 'low', 'info'];
export const STATUS_CODES = ['open', 'confirmed', 'fixed', 'ignored', 'false_positive'];
export const FILTER_KEYS = ['q', 'severity', 'status', 'project_id', 'conversation_tag', 'task_tag'];
export const DEFAULT_PAGE_SIZE = 20;
export const PAGE_SIZE_OPTIONS = [10, 20, 50, 100];

const SEVERITY_KEYS = {
    critical: 'dashboard.severityCritical',
    high: 'dashboard.severityHigh',
    medium: 'dashboard.severityMedium',
    low: 'dashboard.severityLow',
    info: 'dashboard.severityInfo'
};

const STATUS_KEYS = {
    open: 'vulnerabilityPage.statusOpen',
    confirmed: 'vulnerabilityPage.statusConfirmed',
    fixed: 'vulnerabilityPage.statusFixed',
    ignored: 'vulnerabilityPage.statusIgnored',
    false_positive: 'vulnerabilityPage.statusFalsePositive'
};

const STATUS_FALLBACK = {
    open: 'Open',
    confirmed: 'Confirmed',
    fixed: 'Fixed',
    ignored: 'Ignored',
    false_positive: 'False positive'
};

const HISTORY_FALLBACK = {
    retest: 'Retest result',
    retest_started: 'Retest branch created',
    merge: 'Reports merged',
    split: 'Group split',
    detach: 'Association removed'
};

const SORT_OPTIONS = [
    { value: '', key: 'vulnerabilityPage.sortDefault', fallback: 'Default order' },
    { value: 'severity', key: 'vulnerabilityPage.sortSeverity', fallback: 'Severity first' },
    { value: 'latest', key: 'vulnerabilityPage.sortLatest', fallback: 'Created: newest first' },
    { value: 'oldest', key: 'vulnerabilityPage.sortOldest', fallback: 'Created: oldest first' }
];

export function severityText(t, code) {
    if (!code) return '—';
    const key = SEVERITY_KEYS[code];
    return key ? t(key, null, SEVERITY_LABEL[code] || code) : String(code);
}

export function statusText(t, code) {
    if (!code) return '—';
    const key = STATUS_KEYS[code];
    return key ? t(key, null, STATUS_FALLBACK[code] || code) : String(code);
}

export function historyText(t, kind) {
    if (!kind) return '—';
    return t(`vulnerabilityPage.history_${kind}`, null, HISTORY_FALLBACK[kind] || kind);
}

export function severityOptions(t) {
    return SEVERITY_CODES.map(code => ({ value: code, label: severityText(t, code) }));
}

export function statusOptions(t) {
    return STATUS_CODES.map(code => ({ value: code, label: statusText(t, code) }));
}

export function sortOptions(t) {
    return SORT_OPTIONS.map(item => ({ value: item.value, label: t(item.key, null, item.fallback) }));
}

/** Filter query shared by list/stats/export; empty values are not sent, so the backend does not treat empty strings as conditions. */
export function filterQuery(filters) {
    const query = {};
    FILTER_KEYS.forEach(key => {
        const value = String(filters?.[key] ?? '').trim();
        if (value) query[key] = value;
    });
    return query;
}

/** Dashboard stats keep filters such as project/tags but omit severity (severity is toggled by the cards themselves). */
export function statsQuery(filters) {
    const query = filterQuery(filters);
    delete query.severity;
    return query;
}

export function hasActiveFilters(filters) {
    return FILTER_KEYS.some(key => String(filters?.[key] ?? '').trim() !== '');
}

export function percentOf(count, total) {
    const value = Number(count) || 0;
    const base = Number(total) || 0;
    return base > 0 ? Math.round((value / base) * 100) : 0;
}

/** Primary target of a vulnerability: the raw target text + the parsed host (backend targets[]). */
export function targetText(vuln) {
    return String(vuln?.target || '').trim();
}

export function hostText(vuln) {
    const targets = Array.isArray(vuln?.targets) ? vuln.targets : [];
    const host = targets.map(item => item?.host).find(Boolean);
    return host || vuln?.target_host || vuln?.target_domain || '';
}

export function hostPortText(asset) {
    if (!asset) return '—';
    const host = asset.host || asset.id || '—';
    return asset.port ? `${host}:${asset.port}` : host;
}

export function shortId(value, size = 8) {
    const text = String(value || '');
    return text.length > size ? `${text.slice(0, size)}…` : text;
}

/**
 * Save a text file. The export API returns {files:[{filename,content}]} JSON;
 * only a single-item download is binary, so a Blob is built from the content here (same approach as downloadFile in lib/http).
 */
export function saveTextFile(filename, content) {
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = filename;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    return filename;
}
