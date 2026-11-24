/**
 * 国际化：复用仓库既有 web/static/i18n/*.json 词条，保持与后端/文档一致的键名。
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

export const LANGUAGES = [
    { id: 'en-US', label: 'English' },
    { id: 'ja-JP', label: '日本語' },
    { id: 'zh-CN', label: '简体中文' },
    { id: 'ru-RU', label: 'Русский' },
    { id: 'ar-SA', label: 'العربية' }
];

const STORAGE_KEY = 'csai_lang';
const DEFAULT_LANG = 'en-US';
const FALLBACK_LANGS = ['en-US', 'ja-JP', 'zh-CN'];
const RESOURCE_PREFIX = '/static/i18n';
const cache = new Map();

export function detectLanguage() {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored && LANGUAGES.some(item => item.id === stored)) return stored;
    } catch (error) { /* storage unavailable */ }
    const nav = String(navigator.language || '').toLowerCase();
    if (nav.startsWith('zh')) return 'zh-CN';
    if (nav.startsWith('ja')) return 'ja-JP';
    if (nav.startsWith('ru')) return 'ru-RU';
    if (nav.startsWith('ar')) return 'ar-SA';
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

const I18nContext = createContext({ lang: DEFAULT_LANG, t: key => key, ready: false, setLanguage: () => {} });

export function I18nProvider({ children }) {
    const [lang, setLang] = useState(() => {
        const detected = detectLanguage();
        document.documentElement.lang = detected; // 首次渲染前就绪，供 format.js 取格式语言
        return detected;
    });
    const [resources, setResources] = useState({});
    const [ready, setReady] = useState(false);

    useEffect(() => {
        let cancelled = false;
        Promise.all([loadResource(lang), ...FALLBACK_LANGS.map(loadResource)])
            .then(([current, ...fallbacks]) => {
                if (cancelled) return;
                setResources({ current, fallbacks });
                setReady(true);
            });
        document.documentElement.lang = lang;
        document.documentElement.dir = lang === 'ar-SA' ? 'rtl' : 'ltr';
        try { localStorage.setItem(STORAGE_KEY, lang); } catch (error) { /* ignore */ }
        return () => { cancelled = true; };
    }, [lang]);

    const t = useCallback((key, vars, fallback) => {
        if (!key) return fallback ?? '';
        let value = lookup(resources.current, key);
        for (const resource of resources.fallbacks || []) value ??= lookup(resource, key);
        if (value === undefined) return fallback ?? key;
        return interpolate(value, vars);
    }, [resources]);

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
