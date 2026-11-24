/** Shared by HITL pages: decision/reviewer mapping, payload parsing, approval timeliness text. */
import { formatDateTime } from '../../lib/format';
import { lazyLabels, translate } from '../../lib/i18n';

export const HITL_MODES = [
    {
        value: 'off',
        get label() { return translate('ui.hitlUtils.modeOff', null, 'Off'); },
        get hint() { return translate('ui.hitlUtils.modeOffHint', null, 'Do not intercept tool calls'); }
    },
    {
        value: 'approval',
        get label() { return translate('ui.hitlUtils.modeApproval', null, 'Approval mode'); },
        get hint() { return translate('ui.hitlUtils.modeApprovalHint', null, 'Approve or reject only'); }
    },
    {
        value: 'review_edit',
        get label() { return translate('ui.hitlUtils.modeReviewEdit', null, 'Review and edit mode'); },
        get hint() { return translate('ui.hitlUtils.modeReviewEditHint', null, 'Can narrow arguments before approving'); }
    }
];

const DECISION_LABEL = lazyLabels('ui.hitlUtils.decision', { approve: 'Approved', reject: 'Rejected' });
const DECISION_COLOR = { approve: 'green', reject: 'red' };
const DECIDED_BY_LABEL = lazyLabels('ui.hitlUtils.decidedBy', {
    human: 'Human',
    audit_agent: 'Audit Agent',
    system: 'System',
    manual: 'Manual entry'
});

export function normalizeMode(mode) {
    const value = String(mode || '').trim().toLowerCase().replace(/-/g, '_');
    if (value === 'feedback' || value === 'followup') return 'approval';
    return ['off', 'approval', 'review_edit'].includes(value) ? value : 'off';
}

export function modeLabel(mode) {
    const value = normalizeMode(mode);
    const found = HITL_MODES.find(item => item.value === value);
    return found ? found.label : value;
}

export function reviewerValue(reviewer) {
    const value = String(reviewer || '').trim().toLowerCase();
    return value === 'audit_agent' || value === 'agent' || value === 'ai' ? 'audit_agent' : 'human';
}

export function reviewerLabel(reviewer) {
    return reviewerValue(reviewer) === 'audit_agent' ? translate('ui.hitlUtils.reviewerAuditAgent', null, 'Audit Agent') : translate('ui.hitlUtils.reviewerHuman', null, 'Human approval');
}

export function decisionLabel(decision) {
    const value = String(decision || '').trim().toLowerCase();
    return DECISION_LABEL[value] || value || '—';
}

export function decisionColor(decision) {
    return DECISION_COLOR[String(decision || '').toLowerCase()] || 'grey';
}

export function decidedByLabel(value) {
    const key = String(value || '').trim().toLowerCase();
    return DECIDED_BY_LABEL[key] || value || '—';
}

export function decisionStatusLabel(status) {
    const key = String(status || '').trim().toLowerCase();
    if (key === 'pending') return translate('ui.hitlUtils.statusPending', null, 'Pending approval');
    if (key === 'decided') return translate('ui.hitlUtils.statusDecided', null, 'Decided');
    if (key === 'timeout') return translate('ui.hitlUtils.statusTimeout', null, 'Timed out, auto-rejected');
    if (key === 'cancelled') return translate('ui.hitlUtils.statusCancelled', null, 'Cancelled');
    return status || '—';
}

/** The payload is a JSON string in the database; older sessions may store an object. */
export function parsePayload(raw) {
    if (!raw) return {};
    if (typeof raw === 'object') return raw;
    try {
        const parsed = JSON.parse(String(raw));
        return parsed && typeof parsed === 'object' ? parsed : {};
    } catch (error) {
        return {};
    }
}

/** Prefer the structured argumentsObj, then parse the arguments string. */
export function payloadArguments(payload) {
    if (!payload || typeof payload !== 'object') return null;
    if (payload.argumentsObj && typeof payload.argumentsObj === 'object') return payload.argumentsObj;
    if (typeof payload.arguments === 'string' && payload.arguments.trim()) {
        try {
            const parsed = JSON.parse(payload.arguments);
            if (parsed && typeof parsed === 'object') return parsed;
        } catch (error) {
            return { raw: payload.arguments };
        }
    }
    if (payload.arguments && typeof payload.arguments === 'object') return payload.arguments;
    return null;
}

export function contextBlocks(payload) {
    if (!payload || typeof payload !== 'object') return [];
    return [
        { key: 'userMessage', get label() { return translate('ui.hitlUtils.blockUserMessage', null, 'User message'); }, value: payload.userMessage },
        { key: 'thinking', get label() { return translate('ui.hitlUtils.blockThinking', null, 'Thinking'); }, value: payload.thinking },
        { key: 'reasoningChain', get label() { return translate('ui.hitlUtils.blockReasoning', null, 'Reasoning chain'); }, value: payload.reasoningChain },
        { key: 'planning', get label() { return translate('ui.hitlUtils.blockPlanning', null, 'Plan'); }, value: payload.planning }
    ].filter(item => String(item.value || '').trim());
}

export function executionResult(payload) {
    const result = payload?.executionResult;
    if (!result || typeof result !== 'object') return null;
    const text = String(result.result || '').trim();
    if (!text) return null;
    return { success: result.success === true, text };
}

export function approvalDeadlineText(payload) {
    const approval = payload?.hitlApproval;
    if (!approval || typeof approval !== 'object') return '';
    const timeoutSeconds = Number(approval.timeoutSeconds) || 0;
    if (timeoutSeconds <= 0) return translate('ui.hitlUtils.noTimeout', null, 'No timeout');
    const expiresAt = approval.expiresAt ? new Date(approval.expiresAt) : null;
    if (expiresAt && Number.isFinite(expiresAt.getTime())) {
        if (expiresAt.getTime() <= Date.now()) return translate('ui.hitlUtils.expiredAt', { time: formatDateTime(expiresAt) }, 'Expired at {{time}}');
        return translate('ui.hitlUtils.dueAt', { time: formatDateTime(expiresAt) }, 'Due {{time}}');
    }
    return translate('ui.hitlUtils.dueInSeconds', { seconds: timeoutSeconds }, 'Decision required within {{seconds}} s');
}

export function formatHitlTime(value) {
    return value ? formatDateTime(value) : '—';
}

export function parseToolTokens(text) {
    return String(text || '')
        .split(/[\n,，;；]/)
        .map(item => item.trim())
        .filter(Boolean)
        .filter((item, index, list) => list.indexOf(item) === index);
}

export function summarizePayload(payload) {
    const parts = [];
    if (payload?.userMessage) parts.push(translate('ui.hitlUtils.blockUserMessage', null, 'User message'));
    if (payload?.thinking) parts.push(translate('ui.hitlUtils.blockThinking', null, 'Thinking'));
    if (payload?.executionResult) parts.push(translate('ui.hitlUtils.summaryExecResult', null, 'Execution result'));
    return parts.length ? parts.join(' · ') : '—';
}
