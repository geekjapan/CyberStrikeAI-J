/** Helpers for the call interception page: config normalization, byte length, rule validation and draft comparison. */

import { translate } from '../../lib/i18n';

export const MAX_RULES = 100;
const NAME_LIMIT = 200;
const TEXT_LIMIT = 4096;

export function clone(value) {
    return JSON.parse(JSON.stringify(value));
}

export function normalizeConfig(raw) {
    if (!raw || typeof raw.enabled !== 'boolean' || (raw.rules != null && !Array.isArray(raw.rules))) {
        throw new Error(translate('ui.toolGuardUtils.badConfig', null, 'The configuration returned by the server has an invalid format'));
    }
    return {
        enabled: raw.enabled,
        rules: (raw.rules || []).map(rule => ({
            id: String(rule.id || ''),
            name: String(rule.name || ''),
            enabled: Boolean(rule.enabled),
            pattern: String(rule.pattern || ''),
            message: String(rule.message || '')
        }))
    };
}

export function ruleKey(rule, index) {
    return rule.id || `rule-${index}`;
}

export function newRuleId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `rule-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

export function byteLength(text) {
    return new TextEncoder().encode(String(text || '')).length;
}

/** Returns null when valid, otherwise { index, field, message }. */
export function validateRules(config) {
    if (!config) return { index: -1, field: '', message: translate('ui.toolGuardUtils.loadFirst', null, 'Load the interception configuration first') };
    if (config.rules.length > MAX_RULES) {
        return { index: -1, field: '', message: translate('ui.toolGuardUtils.maxRules', { max: MAX_RULES }, 'You can configure at most {{max}} interception rules') };
    }
    for (let index = 0; index < config.rules.length; index += 1) {
        const rule = config.rules[index];
        if (!rule.name.trim()) return { index, field: 'name', message: translate('ui.toolGuardUtils.missingName', { n: index + 1 }, 'Rule {{n}} is missing a name') };
        if (!rule.pattern.trim()) return { index, field: 'pattern', message: translate('ui.toolGuardUtils.missingPattern', { n: index + 1 }, 'Rule {{n}} is missing a match regex') };
        if (byteLength(rule.name) > NAME_LIMIT) {
            return { index, field: 'name', message: translate('ui.toolGuardUtils.nameTooLong', { n: index + 1, limit: NAME_LIMIT }, 'The name of rule {{n}} exceeds {{limit}} bytes') };
        }
        if (byteLength(rule.pattern) > TEXT_LIMIT) {
            return { index, field: 'pattern', message: translate('ui.toolGuardUtils.patternTooLong', { n: index + 1, limit: TEXT_LIMIT }, 'The regex of rule {{n}} exceeds {{limit}} bytes') };
        }
        if (byteLength(rule.message) > TEXT_LIMIT) {
            return { index, field: 'message', message: translate('ui.toolGuardUtils.messageTooLong', { n: index + 1, limit: TEXT_LIMIT }, 'The reminder of rule {{n}} exceeds {{limit}} bytes') };
        }
    }
    return null;
}

export function isDirty(config, saved) {
    if (!config || !saved) return false;
    return JSON.stringify(config) !== JSON.stringify(saved);
}

export function requestConfig(config) {
    return {
        enabled: Boolean(config?.enabled),
        rules: (config?.rules || []).map(rule => ({
            id: rule.id,
            name: rule.name,
            enabled: Boolean(rule.enabled),
            pattern: rule.pattern,
            message: rule.message
        }))
    };
}

/** Used for single-rule validation: ignores the master switch and rule enable state, looks only at this rule. */
export function singleRuleConfig(rule) {
    return {
        enabled: true,
        rules: [{ id: rule.id, name: rule.name, enabled: true, pattern: rule.pattern, message: rule.message }]
    };
}
