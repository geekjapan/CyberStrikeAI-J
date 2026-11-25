/** Recon provider config: default fields, field templates and query examples (aligned with backend fofa.go). */
import { translate } from '../../../lib/i18n';

/** Preset [label, value]: the label is resolved in the current language when read (array destructuring also triggers the getter). */
function presetLabel(key, fallback, value) {
    const preset = [null, value];
    Object.defineProperty(preset, 0, { enumerable: true, get: () => translate(key, null, fallback) });
    return preset;
}

export const INFO_PROVIDERS = {
    fofa: {
        label: 'FOFA',
        maxSize: 10000,
        defaultFields: 'host,ip,port,domain,title,protocol,country,region,city,server',
        placeholder: 'app="Apache" && country="CN"',
        fieldPresets: [
            presetLabel('ui.infoProviders.fieldMinimal', 'Minimal fields', 'host,ip,port,domain'),
            presetLabel('ui.infoProviders.fieldWebCommon', 'Common web fields', 'host,title,ip,port,domain,protocol,server,icp,country,region,city'),
            presetLabel('ui.infoProviders.fieldIntel', 'Enriched intelligence', 'host,ip,port,domain,title,protocol,country,region,city,server,asn,org,icp,header,banner')
        ],
        queryPresets: [
            presetLabel('ui.infoProviders.queryApacheChina', 'Apache + China', 'app="Apache" && country="CN"'),
            presetLabel('ui.infoProviders.queryLoginChina', 'Login pages + China', 'title="login" && country="CN"'),
            presetLabel('ui.infoProviders.queryDomain', 'Specific domain', 'domain="example.com"'),
            presetLabel('ui.infoProviders.queryIp', 'Specific IP', 'ip="1.1.1.1"')
        ],
        supportsFull: true
    },
    zoomeye: {
        label: 'ZoomEye',
        maxSize: 10000,
        defaultFields: 'ip,port,domain,hostname,title,service,app,country,city',
        placeholder: 'app="Apache" && country="CN"',
        fieldPresets: [
            presetLabel('ui.infoProviders.fieldMinimal', 'Minimal fields', 'ip,port,domain,hostname'),
            presetLabel('ui.infoProviders.fieldWebCommon', 'Common web fields', 'ip,port,domain,hostname,title,service,app,country,city'),
            presetLabel('ui.infoProviders.fieldIntel', 'Enriched intelligence', 'ip,port,domain,hostname,title,service,app,country,city,org,isp,ssl')
        ],
        queryPresets: [
            presetLabel('ui.infoProviders.queryApacheChina', 'Apache + China', 'app="Apache" && country="CN"'),
            presetLabel('ui.infoProviders.querySsh', 'SSH service', 'service="ssh"'),
            presetLabel('ui.infoProviders.queryDomain', 'Specific domain', 'domain="example.com"'),
            presetLabel('ui.infoProviders.queryIp', 'Specific IP', 'ip="1.1.1.1"')
        ],
        supportsFull: false
    },
    quake: {
        label: 'Quake',
        maxSize: 10000,
        defaultFields: 'ip,port,domain,service.name,service.http.title,location.country_cn,location.province_cn,location.city_cn',
        placeholder: 'service.name:"http" AND country:"China"',
        fieldPresets: [
            presetLabel('ui.infoProviders.fieldMinimal', 'Minimal fields', 'ip,port,domain'),
            presetLabel('ui.infoProviders.fieldWebCommon', 'Common web fields', 'ip,port,domain,service.name,service.http.title,location.country_cn,location.city_cn'),
            presetLabel('ui.infoProviders.fieldIntel', 'Enriched intelligence', 'ip,port,domain,service.name,service.http.title,service.http.server,location.country_cn,location.province_cn,location.city_cn,asn')
        ],
        queryPresets: [
            presetLabel('ui.infoProviders.queryHttpChina', 'HTTP + China', 'service.name:"http" AND country:"China"'),
            presetLabel('ui.infoProviders.queryPort443', 'Port 443', 'port:443'),
            presetLabel('ui.infoProviders.queryDomain', 'Specific domain', 'domain:"example.com"'),
            presetLabel('ui.infoProviders.queryIp', 'Specific IP', 'ip:"1.1.1.1"')
        ],
        supportsFull: true
    },
    shodan: {
        label: 'Shodan',
        maxSize: 1000,
        defaultFields: 'ip_str,port,hostnames,domains,org,isp,location.country_name,location.city,product,transport',
        placeholder: 'product:nginx country:CN',
        fieldPresets: [
            presetLabel('ui.infoProviders.fieldMinimal', 'Minimal fields', 'ip_str,port,hostnames,domains'),
            presetLabel('ui.infoProviders.fieldWebCommon', 'Common web fields', 'ip_str,port,hostnames,domains,product,org,location.country_name,location.city'),
            presetLabel('ui.infoProviders.fieldIntel', 'Enriched intelligence', 'ip_str,port,hostnames,domains,org,isp,asn,location.country_name,location.city,product,transport,ssl.cert.subject.cn')
        ],
        queryPresets: [
            presetLabel('ui.infoProviders.queryNginxChina', 'Nginx + China', 'product:nginx country:CN'),
            presetLabel('ui.infoProviders.querySsh', 'SSH service', 'port:22'),
            presetLabel('ui.infoProviders.queryCertDomain', 'Certificate domain', 'ssl.cert.subject.cn:example.com'),
            ['Amazon 443', 'org:"Amazon" port:443']
        ],
        supportsFull: false
    }
};

export const PROVIDER_OPTIONS = Object.entries(INFO_PROVIDERS)
    .map(([value, config]) => ({ value, label: config.label }));

export function providerConfig(provider) {
    return INFO_PROVIDERS[provider] || INFO_PROVIDERS.fofa;
}

export function splitFields(raw) {
    return String(raw || '')
        .split(',')
        .map(field => field.trim())
        .filter(Boolean);
}

export function defaultVisibleFields(fields, limit = 5) {
    const preferred = ['host', 'ip', 'port', 'domain', 'title', 'protocol', 'server', 'country', 'city'];
    const picked = preferred.filter(field => fields.includes(field));
    const rest = fields.filter(field => !picked.includes(field));
    return [...picked, ...rest].slice(0, limit);
}

/** Infer the target address (host/domain/IP) from a result row. */
export function inferTarget(row, fields) {
    if (!row || typeof row !== 'object') return '';
    const pick = names => {
        for (const name of names) {
            const value = row[name];
            if (Array.isArray(value) && value.length) return String(value[0]);
            if (value) return String(value);
        }
        return '';
    };
    const host = pick(['host', 'url', 'hostname']);
    if (host) return host;
    const domain = pick(['domain', 'domains', 'hostnames']);
    if (domain) return domain;
    const ip = pick(['ip', 'ip_str']);
    const port = row.port;
    if (ip) return port ? `${ip}:${port}` : ip;
    return '';
}

export function rowsForIndexes(results, indexes) {
    const set = new Set(indexes.map(Number));
    return (results || []).filter((_, index) => set.has(index));
}

export const FOFA_RESULT_FIELD_LIMIT = 5;
