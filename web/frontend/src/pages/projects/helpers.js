/**
 * Project page private helpers: category/confidence dictionaries, error text normalization, graph colors.
 * Used only inside this project directory; not part of the shared modules.
 */

import { lazyLabels, translate } from '../../lib/i18n';

export const FACT_CATEGORIES = [
    { value: 'target', get label() { return translate('ui.projectsHelpers.categoryOption.target', null, 'target'); } },
    { value: 'auth', get label() { return translate('ui.projectsHelpers.categoryOption.auth', null, 'auth'); } },
    { value: 'infra', get label() { return translate('ui.projectsHelpers.categoryOption.infra', null, 'infra'); } },
    { value: 'business', get label() { return translate('ui.projectsHelpers.categoryOption.business', null, 'business'); } },
    { value: 'finding', get label() { return translate('ui.projectsHelpers.categoryOption.finding', null, 'finding'); } },
    { value: 'chain', get label() { return translate('ui.projectsHelpers.categoryOption.chain', null, 'chain'); } },
    { value: 'exploit', get label() { return translate('ui.projectsHelpers.categoryOption.exploit', null, 'exploit'); } },
    { value: 'poc', get label() { return translate('ui.projectsHelpers.categoryOption.poc', null, 'poc（POC）'); } },
    { value: 'note', get label() { return translate('ui.projectsHelpers.categoryOption.note', null, 'note'); } }
];

export const CATEGORY_LABEL = lazyLabels('ui.projectsHelpers.category', {
    target: 'Target',
    auth: 'Authentication',
    infra: 'Infrastructure',
    business: 'Business',
    finding: 'Finding',
    chain: 'Attack chain',
    exploit: 'Exploit',
    poc: 'POC',
    note: 'Note',
    vuln: 'Vulnerability',
    missing: 'Missing'
});

export const CONFIDENCE_OPTIONS = [
    { value: 'tentative', get label() { return translate('ui.projectsHelpers.confTentative', null, 'Unconfirmed'); } },
    { value: 'confirmed', get label() { return translate('ui.projectsHelpers.confConfirmed', null, 'Confirmed'); } },
    { value: 'deprecated', get label() { return translate('ui.projectsHelpers.confDeprecated', null, 'Deprecated'); } }
];

export const CONFIDENCE_META = {
    confirmed: { get label() { return translate('ui.projectsHelpers.confConfirmed', null, 'Confirmed'); }, color: 'green' },
    tentative: { get label() { return translate('ui.projectsHelpers.confTentative', null, 'Unconfirmed'); }, color: 'amber' },
    deprecated: { get label() { return translate('ui.projectsHelpers.confDeprecated', null, 'Deprecated'); }, color: 'grey' }
};

export const PROJECT_STATUS = [
    { value: 'active', get label() { return translate('ui.projectsHelpers.statusActive', null, 'Active'); } },
    { value: 'archived', get label() { return translate('ui.projectsHelpers.statusArchived', null, 'Archived'); } }
];

/** Graph node colors: aligned with the backend GraphNodeType. */
export const NODE_COLORS = {
    target: '#2563eb',
    auth: '#0891b2',
    infra: '#0d9488',
    finding: '#d97706',
    chain: '#db2777',
    exploit: '#7c3aed',
    poc: '#7c3aed',
    vulnerability: '#dc2626',
    note: '#64748b',
    missing: '#94a3b8'
};

export const NODE_TYPE_LABEL = lazyLabels('ui.projectsHelpers.nodeType', {
    target: 'TARGET · Target',
    auth: 'AUTH · Authentication',
    infra: 'INFRA · Infrastructure',
    finding: 'FINDING · Finding',
    chain: 'CHAIN · Attack chain',
    exploit: 'EXPLOIT · Exploit',
    poc: 'POC · Verification',
    vulnerability: 'VULN · Vulnerability',
    note: 'NOTE · Note',
    missing: 'MISSING · Missing'
});

export const EDGE_TYPE_HINTS = ['discovered_on', 'depends_on', 'leads_to', 'enables', 'exploits'];

/**
 * The ApiError message may be an object (workflow package endpoints return {error:{code,message}}).
 * Flatten it into a displayable string so objects are not put into Banner/Toast.
 */
export function errText(error, fallback = translate('ui.projectsHelpers.opFailed', null, 'Operation failed')) {
    if (!error) return fallback;
    if (typeof error === 'string') return error;
    const payload = error.payload;
    if (payload && typeof payload === 'object') {
        const body = payload.error;
        if (typeof body === 'string' && body) return body;
        if (body && typeof body === 'object') {
            const message = typeof body.message === 'string' ? body.message : '';
            const code = typeof body.code === 'string' ? body.code : '';
            if (message) return code ? `${message}（${code}）` : message;
        }
        if (typeof payload.message === 'string' && payload.message) return payload.message;
    }
    if (typeof error.message === 'string' && error.message && error.message !== '[object Object]') return error.message;
    return fallback;
}

/** ErrorBanner only accepts error objects that carry a message. */
export function errorProp(error, fallback = translate('ui.projectsHelpers.loadFailed', null, 'Failed to load')) {
    if (!error) return null;
    return { message: errText(error, fallback) };
}

export function factKeyOf(record) {
    return record?.fact_key || record?.key || record?.id || '';
}

export function isDeprecated(record) {
    return String(record?.confidence || '').toLowerCase() === 'deprecated';
}

/** Relation edge (incoming) textarea: one `type: source_fact_key` per line. */
export function formatIncomingLinks(links) {
    if (!Array.isArray(links) || !links.length) return '';
    return links
        .map(edge => `${edge.edge_type || edge.type || ''}: ${edge.source_fact_key || edge.from || ''}`.trim())
        .join('\n');
}
