/** Recon: FOFA/ZoomEye/Quake/Shodan search, pagination, saving results, natural language parsing. */
import { useEffect, useMemo, useState } from 'react';
import {
    Banner, Button, Empty, Input, InputNumber, Pagination, Select, SideSheet, Space,
    Switch, TextArea, Typography
} from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch, IconCloudUploadStroked } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useLocalStorage } from '../../components/hooks';
import {
    ErrorBanner, JsonViewer, KeyValueList, PageHeader, SectionCard,
    toastError, toastSuccess, toastWarning
} from '../../components/ui';
import FofaResultTable from './components/FofaResultTable';
import FofaParseModal from './components/FofaParseModal';
import {
    FOFA_RESULT_FIELD_LIMIT, INFO_PROVIDERS, PROVIDER_OPTIONS, defaultVisibleFields,
    inferTarget, providerConfig, rowsForIndexes
} from './components/providers';
import { importFofaRows } from '../asset-library/components/fofaImport';
import './page.css';

const { Text } = Typography;

const STORAGE_KEY = 'csf.info-collect.form';
const DEFAULT_FORM = {
    provider: 'fofa',
    query: '',
    size: 100,
    fields: INFO_PROVIDERS.fofa.defaultFields,
    full: false
};

export default function InfoCollectPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canSearch = hasPermission('fofa:execute');
    const canImport = hasPermission('asset:write');

    const [form, setForm] = useLocalStorage(STORAGE_KEY, DEFAULT_FORM);
    const [naturalText, setNaturalText] = useState('');
    const [parseOpen, setParseOpen] = useState(false);
    const [result, setResult] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [selectedKeys, setSelectedKeys] = useState([]);
    const [visibleFields, setVisibleFields] = useState([]);
    const [detailRow, setDetailRow] = useState(null);
    const [importing, setImporting] = useState(false);
    const [projects, setProjects] = useState([]);
    const [projectId, setProjectId] = useState('');

    const config = providerConfig(form.provider);
    const providerLabel = config.label;

    useEffect(() => {
        if (!hasPermission('project:read')) return undefined;
        let cancelled = false;
        api.get('/projects', { limit: 500 })
            .then(payload => { if (!cancelled) setProjects(Array.isArray(payload?.projects) ? payload.projects : []); })
            .catch(() => { if (!cancelled) setProjects([]); });
        return () => { cancelled = true; };
    }, [hasPermission]);

    useEffect(() => {
        // Field template and count limit must follow the provider switch so fields of another provider do not linger.
        setVisibleFields([]);
        setSelectedKeys([]);
        setResult(null);
        setError(null);
    }, [form.provider]);

    const update = patch => setForm(prev => ({ ...DEFAULT_FORM, ...prev, ...patch }));

    const changeProvider = provider => {
        const next = providerConfig(provider);
        update({
            provider,
            fields: next.defaultFields,
            size: Math.min(Number(form.size || 100), next.maxSize),
            full: false
        });
    };

    const effectiveSize = Math.min(Math.max(Number(form.size || 100), 1), config.maxSize);

    const runSearch = async (page = 1, queryOverride) => {
        if (!canSearch) {
            toastWarning(t('infoCollect.permissionDenied', null, 'The current account lacks the fofa:execute permission'));
            return;
        }
        const query = String(queryOverride ?? form.query ?? '').trim();
        if (!query) {
            toastWarning(t('infoCollect.enterFofaQuery', null, 'Enter FOFA query syntax'));
            return;
        }
        setLoading(true);
        setError(null);
        try {
            const payload = await api.post('/fofa/search', {
                provider: form.provider,
                query,
                size: effectiveSize,
                page,
                fields: form.fields,
                full: Boolean(form.full)
            });
            setResult(payload);
            setSelectedKeys([]);
            setVisibleFields(defaultVisibleFields(payload?.fields || [], FOFA_RESULT_FIELD_LIMIT));
        } catch (searchError) {
            setError(searchError);
            setResult(null);
        } finally {
            setLoading(false);
        }
    };

    const reset = () => {
        setForm({ ...DEFAULT_FORM });
        setResult(null);
        setError(null);
        setSelectedKeys([]);
        setVisibleFields([]);
        setNaturalText('');
    };

    const fields = Array.isArray(result?.fields) ? result.fields : [];
    const results = Array.isArray(result?.results) ? result.results : [];
    const total = Number(result?.total || 0);
    const pageSize = Number(result?.size || effectiveSize);
    const currentPage = Number(result?.page || 1);

    const importSelected = async () => {
        if (importing) return;
        if (!canImport) {
            toastWarning(t('infoCollect.noImportPermission', null, 'The current account lacks the asset:write permission'));
            return;
        }
        if (!selectedKeys.length) {
            toastWarning(t('infoCollect.selectRowsFirst', null, 'Select rows to scan first'));
            return;
        }
        const rows = rowsForIndexes(results, selectedKeys);
        setImporting(true);
        try {
            const outcome = await importFofaRows(rows, {
                fields,
                provider: result?.provider || form.provider,
                query: result?.query || form.query,
                projectId
            });
            if (!outcome.assets.length) {
                toastWarning(t('assets.noValidImportTarget', null, 'None of the selected results has a valid asset target'));
                return;
            }
            const message = outcome.invalidCount
                ? t('assets.importDoneWithInvalid', {
                    created: outcome.created, updated: outcome.updated, invalid: outcome.invalidCount
                }, 'Created {{created}}, updated {{updated}}, skipped {{invalid}} results without valid targets')
                : t('assets.importDone', { created: outcome.created, updated: outcome.updated },
                    'Created {{created}}, updated {{updated}}');
            toastSuccess(message);
            setSelectedKeys([]);
        } catch (importError) {
            toastError(importError, t('assets.importFailed', null, 'Failed to import assets'));
        } finally {
            setImporting(false);
        }
    };

    const applyParsedQuery = (query, run) => {
        update({ query });
        setParseOpen(false);
        if (run) runSearch(1, query);
    };

    const detailItems = useMemo(() => {
        if (!detailRow) return [];
        return fields.map(field => {
            const value = detailRow[field];
            const text = Array.isArray(value) ? value.join(', ') : (value == null ? '—' : String(value));
            return { label: field, value: text };
        });
    }, [detailRow, fields]);

    const metaText = result
        ? t('infoCollect.resultsMeta', {
            total, count: results.length, page: currentPage, size: pageSize
        }, 'Total {{total}} · This page {{count}} · page={{page}} · size={{size}}')
        : '';

    return (
        <div className="info-collect-page">
            <PageHeader
                title={t('infoCollectPage.title', null, 'Recon')}
                description={t('ui.infoCollect.pageDescription', null, 'Search assets with FOFA and other cyberspace mapping syntax, and import the results directly.')}
                extra={(
                    <Space>
                        <Button icon={<IconRefresh />} onClick={() => { if (result) runSearch(currentPage); }}>
                            {t('common.refresh', null, 'Refresh')}
                        </Button>
                        <Button onClick={reset}>{t('infoCollectPage.reset', null, 'Reset')}</Button>
                    </Space>
                )}
            />
            {!canSearch && (
                <Banner
                    type="warning"
                    bordered
                    closeIcon={null}
                    className="info-collect-permission"
                    description={t('infoCollect.permissionDeniedHint', null, 'The current account lacks the fofa:execute permission: search, field listing, and import are unavailable. Contact an administrator for access.')}
                />
            )}
            <ErrorBanner error={error} onRetry={() => runSearch(currentPage)} />

            <SectionCard title={t('infoCollectPage.fofaQuerySyntax', null, 'FOFA query syntax')}>
                <div className="info-collect-form">
                    <Space className="info-collect-form-row">
                        <Select
                            value={form.provider}
                            optionList={PROVIDER_OPTIONS}
                            onChange={changeProvider}
                            style={{ width: 150 }}
                        />
                        <span className="info-collect-size">
                            <Text type="tertiary" size="small">{t('infoCollectPage.returnCount', null, 'Return count')}</Text>
                            <InputNumber
                                value={effectiveSize}
                                min={1}
                                max={config.maxSize}
                                onChange={value => update({ size: value })}
                                style={{ width: 120 }}
                            />
                        </span>
                        <Switch
                            checked={Boolean(form.full)}
                            disabled={!config.supportsFull}
                            onChange={checked => update({ full: checked })}
                        />
                        <Text type="tertiary" size="small">full</Text>
                        <Button theme="solid" type="primary" icon={<IconSearch />} onClick={() => runSearch(1)} loading={loading} disabled={!canSearch}>
                            {t('infoCollectPage.confirm', null, 'OK')}
                        </Button>
                        <Button
                            disabled={!naturalText.trim() || !canSearch}
                            onClick={() => setParseOpen(true)}
                            title={t('infoCollectPage.parseBtnTitle', null, 'Parse natural language to FOFA query')}
                        >
                            {t('infoCollectPage.parseBtn', null, 'AI parse')}
                        </Button>
                    </Space>

                    <TextArea
                        value={form.query}
                        rows={3}
                        placeholder={`${providerLabel}：${config.placeholder}`}
                        className="info-collect-query"
                        onChange={value => update({ query: value })}
                    />

                    <Space wrap className="info-collect-presets">
                        <Text type="tertiary" size="small">{t('infoCollectPage.fillExample', null, 'Fill example')}：</Text>
                        {config.queryPresets.map(([label, query]) => (
                            <Button key={label} size="small" theme="borderless" onClick={() => update({ query })}>
                                {label}
                            </Button>
                        ))}
                    </Space>

                    <Space className="info-collect-form-row">
                        <Text type="tertiary" size="small">{t('infoCollectPage.returnFields', null, 'Return fields (comma-separated)')}</Text>
                        <Input
                            value={form.fields}
                            onChange={value => update({ fields: value })}
                            className="info-collect-fields"
                            style={{ width: 420 }}
                        />
                        {config.fieldPresets.map(([label, value]) => (
                            <Button key={label} size="small" theme="borderless" onClick={() => update({ fields: value })}>
                                {label}
                            </Button>
                        ))}
                    </Space>

                    <Space className="info-collect-form-row">
                        <Select
                            value={projectId}
                            optionList={[{ value: '', label: t('ui.infoCollect.noProject', null, 'No project') }, ...projects.map(item => ({ value: item.id, label: item.name || item.id }))]}
                            placeholder={t('ui.infoCollect.assignProject', null, 'Add to project')}
                            style={{ width: 220 }}
                            onChange={value => setProjectId(value || '')}
                        />
                    </Space>

                    <TextArea
                        value={naturalText}
                        rows={2}
                        placeholder={t('infoCollectPage.nlPlaceholder', null, 'e.g. Apache sites in Missouri, US, title contains Home')}
                        className="info-collect-natural"
                        onChange={setNaturalText}
                    />
                </div>
            </SectionCard>

            <SectionCard
                className="info-collect-results"
                title={t('infoCollectPage.queryResults', null, 'Query results')}
                extra={(
                    <Space className="info-collect-results-actions" wrap>
                        <Text type="tertiary" size="small">{metaText}</Text>
                        <Select
                            multiple
                            value={visibleFields}
                            optionList={fields.map(field => ({ value: field, label: field }))}
                            disabled={!fields.length}
                            placeholder={t('infoCollectPage.showColumns', null, 'Show columns')}
                            maxTagCount={FOFA_RESULT_FIELD_LIMIT}
                            style={{ minWidth: 220 }}
                            onChange={values => {
                                const next = (values || []).slice(0, FOFA_RESULT_FIELD_LIMIT);
                                if ((values || []).length > FOFA_RESULT_FIELD_LIMIT) {
                                    toastWarning(t('ui.infoCollect.maxFields', { limit: FOFA_RESULT_FIELD_LIMIT }, 'Show at most {{limit}} fields'));
                                }
                                setVisibleFields(next);
                            }}
                        />
                        <Button
                            icon={<IconCloudUploadStroked />}
                            disabled={!canImport || !selectedKeys.length}
                            loading={importing}
                            onClick={importSelected}
                        >
                            {t('assets.importSelected', null, 'Import selected')}
                        </Button>
                    </Space>
                )}
            >
                {result?.warning && (
                    <Banner
                        type="warning"
                        bordered
                        closeIcon={null}
                        className="info-collect-warning"
                        description={result.warning}
                    />
                )}
                {!result && !loading && !error ? (
                    <Empty
                        title={t('infoCollect.noResults', null, 'No results')}
                        description={canSearch
                            ? t('ui.infoCollect.emptyHint', null, 'Enter a query and click "Search".')
                            : t('ui.infoCollect.emptyNoPermission', null, 'This account lacks the fofa:execute permission.')}
                        style={{ padding: 40 }}
                    />
                ) : (
                    <FofaResultTable
                        fields={fields}
                        results={results}
                        visibleFields={visibleFields}
                        selectedKeys={selectedKeys}
                        onSelectionChange={setSelectedKeys}
                        onOpenDetail={setDetailRow}
                        loading={loading}
                    />
                )}
                {result && total > pageSize && (
                    <div className="info-collect-pagination">
                        <Pagination
                            total={total}
                            pageSize={pageSize}
                            currentPage={currentPage}
                            onPageChange={next => runSearch(next)}
                            showTotal
                        />
                    </div>
                )}
                {result && (
                    <Text type="tertiary" size="small" className="info-collect-selected-meta">
                        {t('infoCollectPage.selectedRows', { count: selectedKeys.length }, '{{count}} selected')}
                    </Text>
                )}
            </SectionCard>

            <SideSheet
                visible={Boolean(detailRow)}
                onCancel={() => setDetailRow(null)}
                title={t('infoCollect.detailTitle', null, 'Result details')}
                width={600}
                placement="right"
            >
                {detailRow && (
                    <div className="info-collect-detail">
                        <Text strong>{inferTarget(detailRow, fields) || '—'}</Text>
                        <KeyValueList items={detailItems} columns={1} />
                        <JsonViewer value={detailRow} title={t('ui.infoCollect.rawJson', null, 'Raw JSON')} />
                    </div>
                )}
            </SideSheet>

            <FofaParseModal
                visible={parseOpen}
                provider={form.provider}
                text={naturalText}
                onClose={() => setParseOpen(false)}
                onApply={applyParsedQuery}
            />
        </div>
    );
}
