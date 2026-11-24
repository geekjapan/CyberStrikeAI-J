/** Fact blackboard: filtering, table and entry points for add/edit/delete/deprecate/restore. */
import { useMemo, useState } from 'react';
import {
    Button, Checkbox, Input, Popconfirm, Select, Space, Tag, Typography
} from '@douyinfe/semi-ui';
import { IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useDebounced, useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, SectionCard, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import {
    CATEGORY_LABEL, CONFIDENCE_META, CONFIDENCE_OPTIONS, FACT_CATEGORIES, errorProp, errText
} from './helpers';

const { Text } = Typography;

function ConfidenceTag({ value }) {
    const meta = CONFIDENCE_META[String(value || '').toLowerCase()] || { label: value || '—', color: 'grey' };
    return <Tag size="small" color={meta.color}>{meta.label}</Tag>;
}

export default function FactsPanel({
    projectId, canWrite, revision = 0, onAddFact, onEditFact, onViewFact, onMutated
}) {
    const t = useT();
    const [search, setSearch] = useState('');
    const debounced = useDebounced(search, 300);
    const [category, setCategory] = useState('all');
    const [confidence, setConfidence] = useState('all');
    const [hideDeprecated, setHideDeprecated] = useState(true);
    const [sparseOnly, setSparseOnly] = useState(false);

    const facts = useResource(() => api.get(`/projects/${projectId}/facts`, {
        limit: 200,
        include_link_counts: 'true',
        exclude_deprecated: hideDeprecated ? 'true' : undefined,
        search: debounced.trim() || undefined,
        category: category === 'all' ? undefined : category,
        confidence: confidence === 'all' ? undefined : confidence,
        sparse_only: sparseOnly ? 'true' : undefined
    }), [projectId, debounced, category, confidence, hideDeprecated, sparseOnly, revision]);

    const rows = useMemo(() => (Array.isArray(facts.data) ? facts.data : []), [facts.data]);

    const deprecate = async (record) => {
        try {
            await api.post(`/projects/${projectId}/facts/deprecate`, { fact_key: record.fact_key });
            toastSuccess(t('projects.saved', null, 'Saved'));
            if (onMutated) onMutated();
            else facts.reload({ silent: true });
        } catch (error) {
            toastError(errText(error, t('projects.operationFailed', null, 'Operation failed')));
        }
    };

    const restore = async (record) => {
        try {
            await api.post(`/projects/${projectId}/facts/restore`, { fact_key: record.fact_key, confidence: 'tentative' });
            toastSuccess(t('projects.saved', null, 'Saved'));
            if (onMutated) onMutated();
            else facts.reload({ silent: true });
        } catch (error) {
            toastError(errText(error, t('projects.operationFailed', null, 'Operation failed')));
        }
    };

    const remove = (record) => {
        confirmAction({
            title: t('projects.deleteForeverTitle', null, 'Delete permanently'),
            content: t('projects.confirmDeleteFact', null, 'Delete this fact?'),
            okText: t('common.delete', null, 'Delete'),
            onOk: async () => {
                try {
                    await api.del(`/projects/${projectId}/facts/${record.id}`);
                    toastSuccess(t('common.delete', null, 'Delete'));
                    if (onMutated) onMutated();
                    else facts.reload({ silent: true });
                } catch (error) {
                    toastError(errText(error, t('projects.operationFailed', null, 'Operation failed')));
                }
            }
        });
    };

    const columns = [
        {
            title: 'fact_key',
            dataIndex: 'fact_key',
            width: 230,
            render: (value, record) => (
                <div className="project-fact-key">
                    <code className="project-fact-key-chip" title={value}>{value}</code>
                    <div className="project-fact-key-meta">
                        {record.pinned && <Tag size="small" color="blue" type="light">{t('projects.pinned', null, 'Pinned')}</Tag>}
                        {record.related_vulnerability_id && (
                            <Tag size="small" color="violet" type="light" title={record.related_vulnerability_id}>
                                {t('projects.relatedVulnIdTitle', null, 'Related vulnerability ID')}
                            </Tag>
                        )}
                    </div>
                </div>
            )
        },
        {
            title: t('projects.category', null, 'Category'),
            dataIndex: 'category',
            width: 108,
            render: value => (
                <Tag size="small" color="cyan" type="light">
                    {CATEGORY_LABEL[String(value || '').toLowerCase()] || value || '—'}
                </Tag>
            )
        },
        {
            title: t('projects.summary', null, 'Summary'),
            dataIndex: 'summary',
            render: (value, record) => (
                <button type="button" className="project-cell-ellipsis project-link-button" title={value} onClick={() => onViewFact?.(record.fact_key)}>
                    {value || '—'}
                </button>
            )
        },
        {
            title: t('projects.linksColumn', null, 'Links'),
            dataIndex: 'link_counts',
            width: 92,
            render: value => {
                const out = value?.outgoing || 0;
                const inc = value?.incoming || 0;
                if (!out && !inc) return <Text type="tertiary">—</Text>;
                return (
                    <span className="project-link-counts" title={t('projects.linkCountsTitle', null, 'Outgoing / incoming edge counts')}>
                        ↑{out} ↓{inc}
                    </span>
                );
            }
        },
        {
            title: t('projects.confidence', null, 'Confidence'),
            dataIndex: 'confidence',
            width: 92,
            render: value => <ConfidenceTag value={value} />
        },
        {
            title: t('projects.updated', null, 'Updated'),
            dataIndex: 'updated_at',
            width: 158,
            render: value => <Text size="small">{formatDateTime(value)}</Text>
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 224,
            render: (value, record) => {
                const deprecated = String(record.confidence || '').toLowerCase() === 'deprecated';
                return (
                    <Space spacing={2} wrap>
                        <Button size="small" theme="borderless" onClick={() => onViewFact?.(record.fact_key)}>
                            {t('projects.details', null, 'Details')}
                        </Button>
                        <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => onEditFact?.(record.fact_key)}>
                            {t('common.edit', null, 'Edit')}
                        </Button>
                        {deprecated ? (
                            <Button size="small" theme="borderless" disabled={!canWrite} onClick={() => restore(record)}>
                                {t('projects.restore', null, 'Restore')}
                            </Button>
                        ) : (
                            <Popconfirm
                                title={t('projects.confirmDeprecateFact', { factKey: record.fact_key }, 'Mark fact {{factKey}} as deprecated?')}
                                onConfirm={() => deprecate(record)}
                                disabled={!canWrite}
                            >
                                <Button
                                    size="small"
                                    theme="borderless"
                                    disabled={!canWrite}
                                    title={t('projects.deprecateTitle', null, 'Mark as deprecated')}
                                >
                                    {t('projects.deprecate', null, 'Deprecate')}
                                </Button>
                            </Popconfirm>
                        )}
                        <Button size="small" theme="borderless" type="danger" disabled={!canWrite} onClick={() => remove(record)}>
                            {t('common.delete', null, 'Delete')}
                        </Button>
                    </Space>
                );
            }
        }
    ];

    return (
        <SectionCard
            title={t('projects.tabFacts', null, 'Fact board')}
            description={t('projects.factToolbarHint', null, 'Index includes key and summary only (must include what + where + how to verify); put attack chain / POC in body, and reproduce via get_project_fact.')}
            extra={(
                <Space>
                    <Button
                        icon={<IconRefresh />}
                        theme="borderless"
                        loading={facts.loading}
                        onClick={() => { if (onMutated) onMutated(); else facts.reload(); }}
                    />
                    <Button type="primary" icon={<IconPlus />} disabled={!canWrite} onClick={onAddFact}>
                        {t('projects.addFact', null, 'Add fact')}
                    </Button>
                </Space>
            )}
        >
            <ErrorBanner error={errorProp(facts.error)} onRetry={facts.reload} />
            <div className="project-toolbar">
                <Input
                    prefix={<IconSearch />}
                    value={search}
                    showClear
                    aria-label={t('projects.searchFactsSr', null, 'Search facts')}
                    placeholder={t('projects.searchFactsPlaceholder', null, 'Search key, summary, body…')}
                    onChange={value => setSearch(value)}
                    style={{ width: 260 }}
                />
                <Select
                    value={category}
                    onChange={setCategory}
                    style={{ width: 146 }}
                    optionList={[{ value: 'all', label: t('projects.all', null, 'All') }, ...FACT_CATEGORIES]}
                />
                <Select
                    value={confidence}
                    onChange={setConfidence}
                    style={{ width: 128 }}
                    optionList={[{ value: 'all', label: t('projects.all', null, 'All') }, ...CONFIDENCE_OPTIONS]}
                />
                <Checkbox checked={hideDeprecated} onChange={event => setHideDeprecated(event.target.checked)}>
                    {t('projects.hideDeprecated', null, 'Hide deprecated')}
                </Checkbox>
                <Checkbox checked={sparseOnly} onChange={event => setSparseOnly(event.target.checked)}>
                    {t('projects.sparseOnly', null, 'Sparse only')}
                </Checkbox>
            </div>
            <DataTable
                columns={columns}
                dataSource={rows}
                rowKey="id"
                loading={facts.loading}
                pagination={{ pageSize: 20 }}
                emptyText={search || category !== 'all' || confidence !== 'all'
                    ? t('projects.noMatchingFacts', null, 'No matching facts, try adjusting filters')
                    : t('projects.noFacts', null, 'No facts yet. Click Add fact or let Agent write facts automatically')}
            />
        </SectionCard>
    );
}
