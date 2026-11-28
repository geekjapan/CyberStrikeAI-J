/** Workflow page private helpers: graph parsing, node dictionary, run status, workflow package error code mapping. */
import { lazyLabels, translate } from '../../lib/i18n';

export const NODE_TYPE_LABEL = lazyLabels('ui.workflowsHelpers.nodeType', {
    start: 'Start',
    tool: 'Tool',
    agent: 'Agent',
    condition: 'Condition',
    hitl: 'Approval',
    output: 'Output',
    end: 'End'
});

export const NODE_TYPES = Object.keys(NODE_TYPE_LABEL).map(value => ({
    value,
    get label() { return NODE_TYPE_LABEL[value]; }
}));

export const RUN_STATUS = {
    running: { get label() { return translate('ui.workflowsHelpers.runStatus.running', null, 'Running'); }, color: 'blue' },
    awaiting_hitl: { get label() { return translate('ui.workflowsHelpers.runStatus.awaitingHitl', null, 'Awaiting approval'); }, color: 'amber' },
    completed: { get label() { return translate('ui.workflowsHelpers.runStatus.completed', null, 'Completed'); }, color: 'green' },
    failed: { get label() { return translate('ui.workflowsHelpers.runStatus.failed', null, 'Failed'); }, color: 'red' },
    cancelled: { get label() { return translate('ui.workflowsHelpers.runStatus.cancelled', null, 'Cancelled'); }, color: 'grey' },
    pending: { get label() { return translate('ui.workflowsHelpers.runStatus.pending', null, 'Pending'); }, color: 'amber' }
};

export const GRAPH_TEMPLATE = {
    nodes: [
        { id: 'start', type: 'start', label: 'Start', position: { x: 80, y: 140 }, config: {} },
        { id: 'out', type: 'output', label: 'Output', position: { x: 380, y: 140 }, config: { output_key: 'result' } }
    ],
    edges: [{ id: 'e1', source: 'start', target: 'out', label: '' }],
    config: {}
};

export const PACKAGE_ERROR_KEYS = {
    WFPKG_FILE_REQUIRED: 'workflows.package.errors.fileRequired',
    WFPKG_FILE_TOO_LARGE: 'workflows.package.errors.fileTooLarge',
    WFPKG_UNSUPPORTED_FORMAT: 'workflows.package.errors.unsupportedFormat',
    WFPKG_INVALID_ARCHIVE: 'workflows.package.errors.invalidArchive',
    WFPKG_INVALID_MANIFEST: 'workflows.package.errors.invalidManifest',
    WFPKG_CHECKSUM_MISMATCH: 'workflows.package.errors.checksumMismatch',
    WFPKG_MULTIPLE_WORKFLOWS: 'workflows.package.errors.multipleWorkflows',
    WFPKG_WORKFLOW_INVALID: 'workflows.package.errors.workflowInvalid',
    WFPKG_INSPECTION_NOT_FOUND: 'workflows.package.errors.inspectionNotFound',
    WFPKG_INSPECTION_EXPIRED: 'workflows.package.errors.inspectionExpired',
    WFPKG_INSPECTION_CONSUMED: 'workflows.package.errors.inspectionConsumed',
    WFPKG_CONFLICT_CHANGED: 'workflows.package.errors.conflictChanged',
    WFPKG_ID_CONFLICT: 'workflows.package.errors.idConflict',
    WFPKG_INVALID_ACTION: 'workflows.package.errors.invalidAction',
    WFPKG_INVALID_RENAME_ID: 'workflows.package.errors.invalidRenameId',
    WFPKG_OVERWRITE_CONFIRMATION_REQUIRED: 'workflows.package.errors.overwriteConfirmationRequired',
    WFPKG_IDEMPOTENCY_KEY_REQUIRED: 'workflows.package.errors.idempotencyKeyRequired',
    WFPKG_IDEMPOTENCY_KEY_REUSED: 'workflows.package.errors.idempotencyKeyReused',
    WFPKG_IMPORT_FAILED: 'workflows.package.errors.importFailed'
};

export const PACKAGE_ACTIONS = {
    create: {
        get label() { return translate('ui.workflowsHelpers.actionCreateLabel', null, 'Create from import'); },
        get hint() { return translate('ui.workflowsHelpers.actionCreateHint', null, 'A new local workflow will be created after import.'); }
    },
    keep_existing: {
        get label() { return translate('ui.workflowsHelpers.actionKeepLabel', null, 'Keep local version'); },
        get hint() { return translate('ui.workflowsHelpers.actionKeepHint', null, 'The current local workflow is not modified; the import record is kept.'); }
    },
    overwrite: {
        get label() { return translate('ui.workflowsHelpers.actionOverwriteLabel', null, 'Overwrite local version'); },
        get hint() { return translate('ui.workflowsHelpers.actionOverwriteHint', null, 'Replaces the name, description, graph definition and enabled state; requires another confirmation.'); }
    },
    rename: {
        get label() { return translate('ui.workflowsHelpers.actionRenameLabel', null, 'Save as new ID'); },
        get hint() { return translate('ui.workflowsHelpers.actionRenameHint', null, 'Keeps the current local workflow and creates a copy with a new ID.'); }
    }
};

export const CONFLICT_ACTIONS = {
    none: ['create'],
    identical: ['keep_existing'],
    id_conflict: ['keep_existing', 'overwrite', 'rename']
};

export function allowedActions(conflictState) {
    return (CONFLICT_ACTIONS[conflictState] || []).slice();
}

export function parseGraph(raw) {
    if (!raw || !String(raw).trim()) return { graph: null, error: translate('ui.workflowsHelpers.graphEmpty', null, 'The graph definition cannot be empty') };
    try {
        const parsed = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') return { graph: null, error: translate('ui.workflowsHelpers.graphNotObject', null, 'The graph definition must be a JSON object') };
        return {
            graph: {
                nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
                edges: Array.isArray(parsed.edges) ? parsed.edges : [],
                config: parsed.config || {}
            },
            error: null
        };
    } catch (error) {
        return { graph: null, error: error.message || translate('ui.workflowsHelpers.jsonParseFailed', null, 'Failed to parse JSON') };
    }
}

export function graphSummary(raw) {
    const { graph, error } = parseGraph(raw);
    if (!graph) return { nodes: [], edges: [], error };
    return { nodes: graph.nodes, edges: graph.edges, error: null };
}

export function shortHash(value, size = 12) {
    const text = String(value || '');
    if (!text) return '—';
    const body = text.startsWith('sha256:') ? text.slice(7) : text;
    return body.length > size ? `${body.slice(0, size)}…` : body;
}

export function errText(error, fallback = translate('ui.workflowsHelpers.operationFailed', null, 'Operation failed')) {
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

export function errorProp(error, fallback = translate('ui.workflowsHelpers.loadFailed', null, 'Failed to load')) {
    if (!error) return null;
    return { message: errText(error, fallback) };
}

export function packageErrorCode(error) {
    const body = error?.payload?.error;
    if (body && typeof body === 'object' && typeof body.code === 'string') return body.code;
    return '';
}

/** Workflow package endpoints use {error:{code,message}}; prefer the localized hint by code. */
export function packageErrorText(error, t) {
    const code = packageErrorCode(error);
    if (code && PACKAGE_ERROR_KEYS[code]) {
        const text = t?.(PACKAGE_ERROR_KEYS[code], null, '');
        if (text) return text;
    }
    return errText(error, translate('ui.workflowsHelpers.operationIncomplete', null, 'The operation did not complete. Try again later.'));
}

export function createIdempotencyKey() {
    const cryptoApi = typeof globalThis !== 'undefined' ? globalThis.crypto : null;
    if (!cryptoApi || typeof cryptoApi.randomUUID !== 'function') return '';
    return cryptoApi.randomUUID();
}
