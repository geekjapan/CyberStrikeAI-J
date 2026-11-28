/**
 * i18n: uses the entries in web/static/i18n/*.json, with the same key names as the backend and the docs.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const LANGUAGES = [
    { id: 'en-US', label: 'English' },
    { id: 'ja-JP', label: '日本語' }
];

const STORAGE_KEY = 'csai_lang';
const DEFAULT_LANG = 'en-US';
const FALLBACK_LANGS = ['en-US', 'ja-JP'];
const RESOURCE_PREFIX = '/static/i18n';
const cache = new Map();

export function detectLanguage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && LANGUAGES.some(item => item.id === stored)) return stored;
    } catch (error) { /* storage unavailable */ }
    const nav = String(navigator.language || '').toLowerCase();
    if (nav.startsWith('ja')) return 'ja-JP';
    if (nav.startsWith('en')) return 'en-US';
    return DEFAULT_LANG;
}

function loadResource(lang) {
    if (!cache.has(lang)) {
        cache.set(lang, fetch(`${RESOURCE_PREFIX}/${lang}.json`, { cache: 'no-cache' })
            .then(response => (response.ok ? response.json() : {}))
            .catch(() => ({})));
    }
    return cache.get(lang);
}

function lookup(resource, key) {
    if (!resource) return undefined;
    let node = resource;
    for (const part of String(key).split('.')) {
        if (node === null || typeof node !== 'object') return undefined;
        node = node[part];
    }
    return typeof node === 'string' ? node : undefined;
}

function interpolate(template, vars) {
    if (!vars) return template;
    return template.replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) => (vars[name] === undefined ? match : String(vars[name])));
}

// Resources in effect; translate() lets non-component modules (constant tables, helpers) look up text at call time.
let activeResources = {};

function resolve(resources, key, vars, fallback) {
    if (!key) return fallback ?? '';
    let value = lookup(resources.current, key);
    for (const resource of resources.fallbacks || []) value ??= lookup(resource, key);
    if (value === undefined) return fallback === undefined || fallback === null ? key : interpolate(fallback, vars);
    return interpolate(value, vars);
}

/** The text of a key in every loaded language (current first), for accepting input written in any of them. */
export function translateAll(key) {
    const all = [activeResources.current, ...(activeResources.fallbacks || [])].map(resource => lookup(resource, key));
    return [...new Set(all.filter(value => value !== undefined))];
}

/** Non-hook lookup: call it during render or in an event handler, never at module top level (the language would be frozen). */
export function translate(key, vars, fallback) {
    return resolve(activeResources, key, vars, fallback);
}

/**
 * Module-level label table: each property of lazyLabels('ui.x.status', { active: 'Active' }) reads
 * `ui.x.status.active` in the current language when accessed; use it as a plain object (index, Object.entries).
 */
export function lazyLabels(prefix, fallbacks) {
    const labels = {};
    for (const [code, fallback] of Object.entries(fallbacks)) {
        Object.defineProperty(labels, code, { enumerable: true, get: () => translate(`${prefix}.${code}`, null, fallback) });
    }
    return labels;
}

/** Module-level option table: `label` reads `prefix.<value>` when accessed; other fields are kept as they are. */
export function lazyOptions(prefix, options) {
    return options.map(({ label, ...rest }) => Object.defineProperty({ ...rest }, 'label', {
        enumerable: true,
        get: () => translate(`${prefix}.${rest.value || 'default'}`, null, label)
    }));
}

const I18nContext = createContext({ lang: DEFAULT_LANG, t: key => key, ready: false, setLanguage: () => {} });

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(() => {
        const detected = detectLanguage();
        document.documentElement.lang = detected; // set before the first render so format.js can read the formatting language
        return detected;
    });
    const [resources, setResources] = useState({});
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([loadResource(lang), ...FALLBACK_LANGS.map(loadResource)])
            .then(([current, ...fallbacks]) => {
                if (cancelled) return;
                activeResources = { current, fallbacks };
                setResources({ current, fallbacks });
                setReady(true);
            });
        document.documentElement.lang = lang;
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (error) { /* ignore */ }
        return () => { cancelled = true; };
    }, [lang]);

    const t = useCallback((key, vars, fallback) => resolve(resources, key, vars, fallback), [resources]);

    const setLanguage = useCallback(next => {
        if (!next || next === lang) return;
        setReady(false);
        document.documentElement.lang = next;
        setLang(next);
        window.dispatchEvent(new CustomEvent('csai:languagechange', { detail: { lang: next } }));
    }, [lang]);

    const value = useMemo(() => ({ lang, t, ready, setLanguage }), [lang, t, ready, setLanguage]);
    return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
    return useContext(I18nContext);
}

export function useT() {
    return useContext(I18nContext).t;
}
