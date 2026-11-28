/**
 * Shared asset constants: enum labels, filter options, import header aliases.
 * Only used by the asset-overview / asset-library / info-collect page directories.
 */
import { lazyLabels, translate } from '../../../lib/i18n';

export const ASSET_PAGE_SIZE_OPTIONS = [10, 20, 50, 100];
export const ASSET_DEFAULT_PAGE_SIZE = 20;

export const STATUS_LABELS = lazyLabels('ui.assetConstants.status', { active: 'Active', inactive: 'Inactive' });

export const STATUS_OPTIONS = [
    { value: 'active', get label() { return STATUS_LABELS.active; } },
    { value: 'inactive', get label() { return STATUS_LABELS.inactive; } }
];

export const ENVIRONMENT_LABELS = lazyLabels('ui.assetConstants.environment', {
    production: 'Production',
    staging: 'Staging',
    testing: 'Testing',
    development: 'Development',
    other: 'Other'
});

export const ENVIRONMENT_OPTIONS = Object.keys(ENVIRONMENT_LABELS)
    .map(value => ({ value, get label() { return ENVIRONMENT_LABELS[value]; } }));

export const CRITICALITY_LABELS = lazyLabels('ui.assetConstants.criticality', {
    critical: 'Core',
    high: 'Important',
    medium: 'Normal',
    low: 'Low'
});

export const CRITICALITY_OPTIONS = Object.keys(CRITICALITY_LABELS)
    .map(value => ({ value, get label() { return CRITICALITY_LABELS[value]; } }));

export const RISK_LABELS = lazyLabels('ui.assetConstants.risk', {
    critical: 'Critical',
    high: 'High',
    medium: 'Medium',
    low: 'Low',
    info: 'Info',
    normal: 'Normal',
    unassessed: 'Not assessed'
});

export const RISK_COLORS = {
    critical: 'red',
    high: 'orange',
    medium: 'amber',
    low: 'blue',
    info: 'grey',
    normal: 'green',
    unassessed: 'grey'
};

export const RISK_OPTIONS = Object.keys(RISK_LABELS)
    .map(value => ({ value, get label() { return RISK_LABELS[value]; } }));

export function riskLevelOf(asset) {
    const level = String(asset?.risk_level || '').toLowerCase();
    return RISK_LABELS[level] ? level : 'unassessed';
}

export function riskLabel(level) {
    return RISK_LABELS[String(level || '').toLowerCase()] || RISK_LABELS.unassessed;
}

/** Common protocols (values of the protocol field in FOFA / the asset library). */
export const PROTOCOL_OPTIONS = [
    'http', 'https', 'ssh', 'ftp', 'smtp', 'dns', 'ldap', 'smb',
    'telnet', 'rdp', 'mysql', 'postgresql', 'mssql', 'redis', 'mongodb'
].map(value => ({ value, label: value }));

export const SORT_OPTIONS = [
    { value: 'last_seen_at:desc', get label() { return translate('ui.assetConstants.sortLastSeenDesc', null, 'Last seen (newest first)'); } },
    { value: 'last_seen_at:asc', get label() { return translate('ui.assetConstants.sortLastSeenAsc', null, 'Last seen (oldest first)'); } },
    { value: 'last_scan_at:asc', get label() { return translate('ui.assetConstants.sortLastScanAsc', null, 'Longest unscanned first'); } },
    { value: 'last_scan_at:desc', get label() { return translate('ui.assetConstants.sortLastScanDesc', null, 'Most recently scanned first'); } },
    { value: 'risk_level:desc', get label() { return translate('ui.assetConstants.sortRiskDesc', null, 'Risk (high to low)'); } },
    { value: 'vulnerability_count:desc', get label() { return translate('ui.assetConstants.sortVulnCountDesc', null, 'Vulnerabilities (most first)'); } },
    { value: 'first_seen_at:desc', get label() { return translate('ui.assetConstants.sortFirstSeenDesc', null, 'First seen (newest first)'); } },
    { value: 'host:asc', get label() { return translate('ui.assetConstants.sortHostAsc', null, 'Target name'); } },
    { value: 'port:asc', get label() { return translate('ui.assetConstants.sortPortAsc', null, 'Port'); } }
];

/** Scan-state filter: never / scanned / overdue:N, mapped to the handler's scan_state and scan_overdue_days. */
export const SCAN_STATE_OPTIONS = [
    { value: '', get label() { return translate('ui.assetConstants.scanAll', null, 'All'); } },
    { value: 'never', get label() { return translate('ui.assetConstants.scanNever', null, 'Never scanned'); } },
    { value: 'scanned', get label() { return translate('ui.assetConstants.scanScanned', null, 'Scanned'); } },
    { value: 'overdue:30', get label() { return translate('ui.assetConstants.scanOverdue30', null, 'Not scanned in 30 days'); } },
    { value: 'overdue:60', get label() { return translate('ui.assetConstants.scanOverdue60', null, 'Not scanned in 60 days'); } },
    { value: 'overdue:90', get label() { return translate('ui.assetConstants.scanOverdue90', null, 'Not scanned in 90 days'); } }
];

export function applyScanStateParam(query, value) {
    const raw = String(value || '');
    if (!raw) return query;
    const overdue = raw.match(/^overdue:(\d+)$/);
    if (overdue) return { ...query, scan_overdue_days: overdue[1] };
    return { ...query, scan_state: raw };
}

/** Bulk-import columns (same as the legacy template). */
export const IMPORT_COLUMNS = [
    'target', 'project', 'tags', 'host', 'ip', 'domain', 'port', 'protocol', 'title',
    'server', 'country', 'province', 'city', 'responsible_person', 'department',
    'business_system', 'environment', 'criticality', 'status'
];

// Language-neutral aliases; headers in every loaded UI language are matched via translateAll(EXPORT_COLUMNS key) in assetCsv.js.
export const IMPORT_HEADER_ALIASES = {
    target: ['target', 'asset', 'assetaddress'],
    project: ['project', 'projectname', 'projectid'],
    tags: ['tags', 'tag'],
    host: ['host', 'url'],
    ip: ['ip', 'ipaddress'],
    domain: ['domain'],
    port: ['port'],
    protocol: ['protocol', 'scheme'],
    title: ['title', 'pagetitle'],
    server: ['server', 'service', 'product'],
    country: ['country', 'countryregion'],
    province: ['province', 'state'],
    city: ['city'],
    responsible_person: ['responsibleperson', 'owner'],
    department: ['department'],
    business_system: ['businesssystem', 'system'],
    environment: ['environment', 'env'],
    source: ['source'],
    criticality: ['criticality', 'importance'],
    status: ['status']
};

export const MAX_IMPORT_ROWS = 100000;

/** Export columns: [column, i18n key of the CSV header, English fallback]. */
export const EXPORT_COLUMNS = [
    ['target', 'assets.target', 'Target'], ['host', 'assets.hostUrl', 'Full URL / Host'],
    ['ip', 'assets.exportIP', 'IP address'], ['domain', 'assets.domain', 'Domain'],
    ['port', 'assets.port', 'Port'], ['protocol', 'assets.protocol', 'Protocol'],
    ['title', 'assets.title', 'Title / fingerprint'], ['server', 'assets.server', 'Server fingerprint'],
    ['project', 'assets.project', 'Project'], ['responsible_person', 'assets.responsiblePerson', 'Owner'],
    ['department', 'assets.department', 'Department'], ['business_system', 'assets.businessSystem', 'Business system'],
    ['environment', 'assets.environment', 'Environment'], ['criticality', 'assets.criticality', 'Criticality'],
    ['country', 'assets.country', 'Country / region'], ['province', 'assets.province', 'Province / state'],
    ['city', 'assets.city', 'City'], ['source', 'assets.source', 'Source'],
    ['status', 'assets.status', 'Status'], ['tags', 'assets.tagsLabel', 'Tags'],
    ['risk_level', 'assets.riskLevel', 'Risk'], ['vulnerability_count', 'assets.exportVulnerabilityCount', 'Vulnerability count'],
    ['first_seen_at', 'assets.firstSeen', 'First seen'], ['last_seen_at', 'assets.lastSeen', 'Last seen'],
    ['last_scan_at', 'assets.lastScan', 'Last scan']
];

export function environmentLabel(value) {
    return ENVIRONMENT_LABELS[value] || value || '';
}

export function criticalityLabel(value) {
    return CRITICALITY_LABELS[value] || value || '';
}

export function statusLabel(value) {
    return STATUS_LABELS[value] || value || '';
}
