import { useCallback, useEffect, useState } from 'react';
import { Button, Form, Input, Select, Space, Tag, TextArea, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconEdit, IconPlus, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { DataTable, ErrorBanner, KeyValueList, MarkdownView, PageHeader, SectionCard, StatGrid, confirmAction, toastError, toastSuccess, Drawer } from '../../components/ui';
import { formatDateTime, formatNumber } from '../../lib/format';

const { Text } = Typography;

export default function KnowledgeManagementPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canWrite = hasPermission('knowledge:write');
    const [category, setCategory] = useState('');
    const [keyword, setKeyword] = useState('');
    const [page, setPage] = useState(1);
    const [pageSize, setPageSize] = useState(20);
    const [editor, setEditor] = useState(null);
    const [detail, setDetail] = useState(null);
    const [saving, setSaving] = useState(false);
    const [searchOpen, setSearchOpen] = useState(false);
    const [searchResult, setSearchResult] = useState(null);

    const list = useResource(
        () => api.get('/knowledge/items', { category: category || undefined, search: keyword || undefined, limit: pageSize, offset: (page - 1) * pageSize }),
        [category, keyword, page, pageSize]
    );
    const stats = useResource(() => api.get('/knowledge/stats'), []);
    const categories = useResource(() => api.get('/knowledge/categories'), []);
    const indexStatus = useResource(() => api.get('/knowledge/index-status'), []);
    const disabled = list.data?.enabled === false;

    const items = Array.isArray(list.data?.items) ? list.data.items : [];
    const total = Number(list.data?.total || 0);
    const categoryOptions = (Array.isArray(categories.data?.categories) ? categories.data.categories : [])
        .map(item => (typeof item === 'string' ? { value: item, label: item } : { value: item.name || item.category, label: item.name || item.category }));

    const refreshAll = useCallback(() => {
        list.reload();
        stats.reload();
        indexStatus.reload();
    }, [list, stats, indexStatus]);

    const save = async () => {
        if (saving || !editor?.form) return;
        const values = await editor.form.validate().catch(() => null);
        if (!values) return;
        setSaving(true);
        try {
            const payload = { category: values.category.trim(), title: values.title.trim(), content: values.content };
            if (editor.item?.id) await api.put(`/knowledge/items/${encodeURIComponent(editor.item.id)}`, payload);
            else await api.post('/knowledge/items', payload);
            toastSuccess(editor.item?.id ? t('ui.knowledgeManagement.itemUpdated', null, 'Knowledge item updated') : t('ui.knowledgeManagement.itemCreated', null, 'Knowledge item created'));
            setEditor(null);
            refreshAll();
        } catch (error) {
            toastError(error, t('ui.knowledgeManagement.saveFailed', null, 'Failed to save'));
        } finally {
            setSaving(false);
        }
    };

    const remove = item => confirmAction({
        title: t('ui.knowledgeManagement.deleteItemTitle', { title: item.title }, 'Delete knowledge item "{{title}}"?'),
        content: t('ui.knowledgeManagement.deleteItemContent', null, 'The index must be rebuilt after deletion, and this cannot be undone.'),
        onOk: async () => {
            await api.del(`/knowledge/items/${encodeURIComponent(item.id)}`);
            toastSuccess(t('ui.knowledgeManagement.deleted', null, 'Deleted'));
            refreshAll();
        }
    });

    const buildIndex = async full => {
        try {
            await api.post('/knowledge/index', full ? { full: true } : {});
            toastSuccess(t('ui.knowledgeManagement.indexSubmitted', null, 'Index task submitted'));
            indexStatus.reload();
        } catch (error) {
            toastError(error, t('ui.knowledgeManagement.buildIndexFailed', null, 'Failed to build index'));
        }
    };

    const runSearch = async query => {
        try {
            setSearchResult(await api.post('/knowledge/search', { query, topK: 5 }));
        } catch (error) {
            toastError(error, t('ui.knowledgeManagement.searchFailed', null, 'Search failed'));
        }
    };

    const columns = [
        { title: t('ui.knowledgeManagement.colTitle', null, 'Title'), dataIndex: 'title', render: (value, record) => <Text strong>{value || record.filePath}</Text> },
        { title: t('ui.knowledgeManagement.colCategory', null, 'Category'), dataIndex: 'category', width: 160, render: value => (value ? <Tag size="small">{value}</Tag> : '—') },
        { title: t('ui.knowledgeManagement.colUpdatedAt', null, 'Updated'), dataIndex: 'updatedAt', width: 180, render: value => formatDateTime(value) },
        {
            title: t('ui.knowledgeManagement.colActions', null, 'Actions'), width: 150, render: (_, record) => (
                <Space>
                    <Button size="small" theme="borderless" onClick={() => setDetail(record)}>{t('ui.knowledgeManagement.view', null, 'View')}</Button>
                    {canWrite && <Button size="small" theme="borderless" icon={<IconEdit />} onClick={() => setEditor({ item: record, form: {} })} />}
                    {canWrite && <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => remove(record)} />}
                </Space>
            )
        }
    ];

    return (
        <div>
            <PageHeader
                title={t('knowledge.title', null, 'Knowledge Management')}
                description={t('ui.knowledgeManagement.pageDescription', null, 'Knowledge entries are used by agents for retrieval. Rebuild the index after changes for them to take effect.')}
                extra={(
                    <Space wrap>
                        <Button icon={<IconRefresh />} onClick={refreshAll}>{t('ui.knowledgeManagement.refresh', null, 'Refresh')}</Button>
                        {canWrite && !disabled && <Button onClick={() => buildIndex(false)}>{t('ui.knowledgeManagement.buildIndex', null, 'Build index')}</Button>}
                        {canWrite && !disabled && <Button onClick={() => buildIndex(true)}>{t('ui.knowledgeManagement.rebuildAll', null, 'Full rebuild')}</Button>}
                        {canWrite && !disabled && <Button theme="solid" type="primary" icon={<IconPlus />} onClick={() => setEditor({ item: null, form: {} })}>{t('ui.knowledgeManagement.addKnowledge', null, 'Add knowledge')}</Button>}
                    </Space>
                )}
            />
            {disabled && <Typography.Paragraph type="tertiary">{t('ui.knowledgeManagement.disabledHint', null, list.data.message)}</Typography.Paragraph>}
            <StatGrid
                columns={4}
                metrics={[
                    { id: 'items', label: t('ui.knowledgeManagement.statItems', null, 'Knowledge entries'), value: formatNumber(stats.data?.total_items || 0), loading: stats.loading },
                    { id: 'categories', label: t('ui.knowledgeManagement.statCategories', null, 'Categories'), value: formatNumber(stats.data?.total_categories || 0), loading: stats.loading },
                    { id: 'indexed', label: t('ui.knowledgeManagement.statIndexed', null, 'Indexed'), value: formatNumber(indexStatus.data?.indexed_items ?? indexStatus.data?.total_indexed ?? 0), loading: indexStatus.loading },
                    { id: 'pending', label: t('ui.knowledgeManagement.statPending', null, 'Pending index'), value: formatNumber(indexStatus.data?.pending_items ?? 0), loading: indexStatus.loading }
                ]}
            />
            <SectionCard title={t('ui.knowledgeManagement.statItems', null, 'Knowledge entries')}>
                <ErrorBanner error={list.error} onRetry={() => list.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={items}
                    rowKey="id"
                    loading={list.loading}
                    pagination={{
                        currentPage: page,
                        pageSize,
                        total,
                        onPageChange: setPage,
                        onPageSizeChange: size => { setPageSize(size); setPage(1); }
                    }}
                    toolbar={(
                        <Space wrap>
                            <Input prefix={<IconSearch />} value={keyword} onChange={value => { setKeyword(value); setPage(1); }} placeholder={t('ui.knowledgeManagement.searchPlaceholder', null, 'Search title or content')} style={{ width: 220 }} />
                            <Select
                                value={category}
                                onChange={value => { setCategory(value || ''); setPage(1); }}
                                placeholder={t('ui.knowledgeManagement.allCategories', null, 'All categories')}
                                style={{ width: 180 }}
                                showClear
                                optionList={categoryOptions}
                            />
                            <Button disabled={disabled} onClick={() => setSearchOpen(true)}>{t('ui.knowledgeManagement.searchTest', null, 'Retrieval test')}</Button>
                        </Space>
                    )}
                />
            </SectionCard>

            <Drawer
                title={editor?.item ? t('ui.knowledgeManagement.editItem', null, 'Edit knowledge item') : t('ui.knowledgeManagement.newItem', null, 'New knowledge item')}
                visible={Boolean(editor)}
                key={editor?.item?.id || 'new'}
                onCancel={() => setEditor(null)}
                onOk={save}
                confirmLoading={saving}
                width={760}
            >
                <Form
                    getFormApi={form => setEditor(current => (current ? { ...current, form } : current))}
                    initValues={editor?.item ? { category: editor.item.category, title: editor.item.title, content: editor.item.content } : {}}
                >
                    <Form.Input field="category" label={t('ui.knowledgeManagement.colCategory', null, 'Category')} rules={[{ required: true, message: t('ui.knowledgeManagement.categoryRequired', null, 'Enter a category') }]} />
                    <Form.Input field="title" label={t('ui.knowledgeManagement.colTitle', null, 'Title')} rules={[{ required: true, message: t('ui.knowledgeManagement.titleRequired', null, 'Enter a title') }]} />
                    <Form.TextArea field="content" label={t('ui.knowledgeManagement.contentMarkdown', null, 'Content (Markdown)')} rules={[{ required: true, message: t('ui.knowledgeManagement.contentRequired', null, 'Enter the content') }]} autosize={{ minRows: 10, maxRows: 24 }} />
                </Form>
            </Drawer>

            <Drawer title={detail?.title || t('ui.knowledgeManagement.itemFallbackTitle', null, 'Knowledge item')} visible={Boolean(detail)} onCancel={() => setDetail(null)} width={640}>
                {detail && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <KeyValueList items={[
                            { label: t('ui.knowledgeManagement.colCategory', null, 'Category'), value: detail.category },
                            { label: t('ui.knowledgeManagement.filePath', null, 'File path'), value: detail.filePath },
                            { label: t('ui.knowledgeManagement.createdAt', null, 'Created'), value: formatDateTime(detail.createdAt) },
                            { label: t('ui.knowledgeManagement.colUpdatedAt', null, 'Updated'), value: formatDateTime(detail.updatedAt) }
                        ]} />
                        <MarkdownView content={detail.content || t('ui.knowledgeManagement.contentUnavailable', null, '(Open the original file to view the content)')} />
                    </div>
                )}
            </Drawer>

            <Drawer title={t('ui.knowledgeManagement.searchDrawerTitle', null, 'Knowledge retrieval test')} visible={searchOpen} onCancel={() => { setSearchOpen(false); setSearchResult(null); }} footer={null} width={720}>
                <Form onSubmit={({ query }) => runSearch(query)}>
                    <Form.Input field="query" label={t('ui.knowledgeManagement.queryLabel', null, 'Query')} rules={[{ required: true, message: t('ui.knowledgeManagement.queryRequired', null, 'Enter a query') }]} />
                    <Button htmlType="submit" theme="solid" type="primary">{t('ui.knowledgeManagement.search', null, 'Search')}</Button>
                </Form>
                {searchResult && (
                    <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {(searchResult.results || []).map((hit, index) => (
                            <div key={hit.id || index} style={{ border: '1px solid var(--semi-color-border)', borderRadius: 8, padding: 12 }}>
                                <Space>
                                    <Tag color="blue">#{index + 1}</Tag>
                                    <Text strong>{hit.item?.title || hit.title || hit.id}</Text>
                                    {hit.score !== undefined && <Text type="tertiary">{t('ui.knowledgeManagement.similarity', { score: Number(hit.score).toFixed(3) }, 'Similarity {{score}}')}</Text>}
                                </Space>
                                <div style={{ marginTop: 8 }}>
                                    <MarkdownView content={String(hit.content || hit.item?.content || '').slice(0, 600)} />
                                </div>
                            </div>
                        ))}
                        {(searchResult.results || []).length === 0 && <Text type="tertiary">{t('ui.knowledgeManagement.noHits', null, 'No matching results')}</Text>}
                    </div>
                )}
            </Drawer>
        </div>
    );
}
