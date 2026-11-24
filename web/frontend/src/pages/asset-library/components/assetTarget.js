/**
 * Asset target parsing: conversion between URL / domain / IP / IPv6 / port.
 * Rules match the legacy assets.js (parseAssetEditorTarget); shared by the editor, import and FOFA import.
 */
import { translate } from '../../../lib/i18n';

export const DEFAULT_PORTS = {
    http: 80, https: 443, ssh: 22, ftp: 21, smtp: 25, rdp: 3389,
    mysql: 3306, postgresql: 5432, redis: 6379, mongodb: 27017
};

export const PROTOCOL_BY_PORT = Object.entries(DEFAULT_PORTS)
    .reduce((acc, [protocol, port]) => ({ ...acc, [port]: protocol }), {});

export function defaultPortForProtocol(protocol) {
    return DEFAULT_PORTS[String(protocol || '').toLowerCase()] || 0;
}

export function protocolForPort(port) {
    return PROTOCOL_BY_PORT[Number(port)] || '';
}

export function isIPv4(value) {
    const parts = String(value || '').split('.');
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function isIPv6(value) {
    const candidate = String(value || '').replace(/^\[|\]$/g, '');
    if (!candidate.includes(':') || !/^[0-9a-f:.]+$/i.test(candidate)) return false;
    try {
        return new URL(`http://[${candidate}]/`).hostname.length > 2;
    } catch (error) {
        return false;
    }
}

export function normalizeDomain(value) {
    const raw = String(value || '').trim().replace(/\.$/, '');
    if (!raw || raw.length > 253 || raw.includes('_') || /[/?#@]/.test(raw)) return '';
    try {
        const hostname = new URL(`http://${raw}/`).hostname.toLowerCase().replace(/\.$/, '');
        if (!hostname || hostname.length > 253) return '';
        const labels = hostname.split('.');
        const valid = labels.every(label => label
            && label.length <= 63
            && /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/i.test(label));
        return valid ? hostname : '';
    } catch (error) {
        return '';
    }
}

/**
 * Parse a user-entered asset target. Always returns a struct; unrecognized formats are treated as an opaque host;
 * an out-of-range port throws (same as the legacy behavior).
 */
/** Split pasted text into single addresses; supports newlines, spaces, commas and semicolons. */
export function splitAssetTargets(value) {
    const seen = new Set();
    const targets = [];
    for (const item of String(value || '').split(/[\s,，;；]+/)) {
        const target = item.trim();
        const key = target.toLowerCase();
        if (!target || seen.has(key)) continue;
        seen.add(key);
        targets.push(target);
    }
    return targets;
}

export function parseAssetTarget(value) {
    const raw = String(value || '').trim();
    if (!raw) throw new Error(translate('ui.assetTarget.addressRequired', null, 'Enter an asset address'));
    if (/\s/.test(raw)) throw new Error(translate('ui.assetTarget.addressNoSpaces', null, 'Asset address cannot contain spaces'));
    const opaque = () => ({ host: raw, ip: '', domain: '', port: 0, protocol: '' });
    let hostname = '';
    let port = 0;
    let protocol = '';
    let host = '';
    if (/^[a-z][a-z0-9+.-]*:\/\//i.test(raw)) {
        let parsed;
        try {
            parsed = new URL(raw);
        } catch (error) {
            return opaque();
        }
        if (!parsed.hostname || parsed.username || parsed.password) return opaque();
        protocol = parsed.protocol.replace(':', '').toLowerCase();
        hostname = parsed.hostname.replace(/^\[|\]$/g, '');
        port = parsed.port ? Number(parsed.port) : defaultPortForProtocol(protocol);
        host = raw;
    } else {
        const authority = raw.replace(/\/$/, '');
        const bracketed = authority.match(/^\[([^\]]+)](?::(\d+))?$/);
        if (bracketed) {
            hostname = bracketed[1];
            port = Number(bracketed[2] || 0);
        } else if ((authority.match(/:/g) || []).length === 1 && /:\d+$/.test(authority)) {
            const splitAt = authority.lastIndexOf(':');
            hostname = authority.slice(0, splitAt);
            port = Number(authority.slice(splitAt + 1));
        } else {
            hostname = authority;
        }
        protocol = protocolForPort(port);
    }
    if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error(translate('ui.assetTarget.portRange', null, 'Port must be between 0 and 65535'));
    const ipAddress = isIPv4(hostname) || isIPv6(hostname);
    const domain = ipAddress ? '' : normalizeDomain(hostname);
    if (!ipAddress && (!domain || isIPv4(domain) || isIPv6(domain))) return opaque();
    return {
        host,
        ip: ipAddress ? hostname.toLowerCase() : '',
        domain,
        port,
        protocol
    };
}

export function assetTargetLabel(asset) {
    return asset?.host || asset?.domain || asset?.ip || asset?.target || '-';
}

export function assetServiceLabel(asset) {
    if (!asset) return '';
    const protocol = String(asset.protocol || '').trim();
    const port = Number(asset.port || 0);
    if (!protocol && !port) return '';
    return `${protocol}${port ? `:${port}` : ''}`;
}

/** Initial target input of the edit dialog: host first, then domain/ip plus port. */
export function targetInputFromAsset(asset) {
    if (!asset) return '';
    if (asset.host) return String(asset.host);
    const base = asset.domain || asset.ip || '';
    if (!base) return '';
    const wrapped = String(base).includes(':') && !String(base).startsWith('[') ? `[${base}]` : base;
    return `${wrapped}${Number(asset.port || 0) > 0 ? `:${asset.port}` : ''}`;
}

/** Asset dedup key (same shape as the server's dedup_key; only used for frontend hints before import). */
export function assetDedupKey(asset) {
    const target = String(asset?.domain || asset?.ip || asset?.host || '').toLowerCase();
    return `${target}|${Number(asset?.port || 0)}|${String(asset?.protocol || '').toLowerCase()}`;
}

export function splitTags(raw) {
    return String(raw || '')
        .split(/[,，;；|]/)
        .map(item => item.trim())
        .filter(Boolean);
}

export function validateAssetPayload(asset) {
    if (!asset) return translate('ui.assetTarget.assetEmpty', null, 'Asset cannot be empty');
    if (!asset.host && !asset.ip && !asset.domain) return translate('ui.assetTarget.targetEmpty', null, 'Asset target cannot be empty');
    if (asset.ip && !isIPv4(asset.ip) && !isIPv6(asset.ip)) return translate('ui.assetTarget.ipInvalid', null, 'Invalid IP address format');
    if (asset.domain && (!normalizeDomain(asset.domain) || isIPv4(asset.domain) || isIPv6(asset.domain))) {
        return translate('ui.assetTarget.domainInvalid', null, 'Invalid domain format');
    }
    if (asset.protocol && !/^[a-z][a-z0-9+.-]{0,31}$/.test(asset.protocol)) return translate('ui.assetTarget.protocolInvalid', null, 'Invalid protocol format');
    if (Number(asset.port) < 0 || Number(asset.port) > 65535) return translate('ui.assetTarget.portRange', null, 'Port must be between 0 and 65535');
    const tags = Array.isArray(asset.tags) ? asset.tags : [];
    if (tags.length > 30) return translate('ui.assetTarget.tagsMax', null, 'At most 30 tags');
    if (tags.some(tag => Array.from(String(tag)).length > 64)) return translate('ui.assetTarget.tagLengthMax', null, 'Each tag can be at most 64 characters');
    return '';
}
