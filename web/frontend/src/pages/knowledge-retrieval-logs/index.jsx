import { useState } from 'react';
import { Button, Input, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconDelete, IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useAuth } from '../../lib/auth';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { DataTable, ErrorBanner, JsonViewer, KeyValueList, PageHeader, SectionCard, confirmAction, toastError, toastSuccess, Drawer } from '../../components/ui';
import { formatDateTime } from '../../lib/format';

const { Text } = Typography;

export default function KnowledgeRetrievalLogsPage() {
    const t = useT();
    const { hasPermission } = useAuth();
    const canDelete = hasPermission('knowledge:delete');
    const [conversationId, setConversationId] = useState('');
    const [limit, setLimit] = useState(50);
    const [detail, setDetail] = useState(null);

    const logs = useResource(
        () => api.get('/knowledge/retrieval-logs', { conversationId: conversationId || undefined, limit }),
        [conversationId, limit]
    );
    const rows = Array.isArray(logs.data?.logs) ? logs.data.logs : [];

    const remove = row => confirmAction({
        title: t('ui.knowledgeRetrievalLogs.deleteTitle', null, 'Delete this retrieval log?'),
        content: row.query || row.id,
        onOk: async () => {
            await api.del(`/knowledge/retrieval-logs/${encodeURIComponent(row.id)}`);
            toastSuccess(t('ui.knowledgeRetrievalLogs.deleted', null, 'Deleted'));
            logs.reload();
        }
    });

    const columns = [
        {
            title: t('ui.knowledgeRetrievalLogs.query', null, 'Query'), dataIndex: 'query', render: (value, record) => (
                <button type="button" className="link-button" onClick={() => setDetail(record)} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', textAlign: 'left', color: 'var(--semi-color-primary)' }}>
                    {value || '—'}
                </button>
            )
        },
        { title: t('ui.knowledgeRetrievalLogs.riskType', null, 'Risk type'), dataIndex: 'riskType', width: 140, render: value => (value ? <Tag size="small">{value}</Tag> : '—') },
        {
            title: t('ui.knowledgeRetrievalLogs.hitItems', null, 'Matched knowledge items'), dataIndex: 'retrievedItems', width: 120,
            render: value => <Text type="tertiary">{t('ui.knowledgeRetrievalLogs.countUnit', { count: Array.isArray(value) ? value.length : 0 }, '{{count}} items')}</Text>
        },
        { title: t('ui.knowledgeRetrievalLogs.conversation', null, 'Conversation'), dataIndex: 'conversationId', width: 200, render: value => <Text type="tertiary" ellipsis={{ showTooltip: true }}>{value || '—'}</Text> },
        { title: t('ui.knowledgeRetrievalLogs.time', null, 'Time'), dataIndex: 'createdAt', width: 180, render: value => formatDateTime(value) },
        {
            title: t('ui.knowledgeRetrievalLogs.actions', null, 'Actions'), width: 110, render: (_, record) => (
                <Space>
                    <Button size="small" theme="borderless" onClick={() => setDetail(record)}>{t('ui.knowledgeRetrievalLogs.details', null, 'Details')}</Button>
                    {canDelete && <Button size="small" theme="borderless" type="danger" icon={<IconDelete />} onClick={() => remove(record)} />}
                </Space>
            )
        }
    ];

    return (
        <div>
            <PageHeader
                title={t('knowledge.retrievalLogsTitle', null, 'Retrieval history')}
                description={t('ui.knowledgeRetrievalLogs.pageDescription', null, 'Records the query, matched items and conversation of each agent knowledge base retrieval, to trace the basis of answers.')}
                extra={<Button icon={<IconRefresh />} onClick={() => logs.reload()} loading={logs.loading}>{t('ui.knowledgeRetrievalLogs.refresh', null, 'Refresh')}</Button>}
            />
            <SectionCard title={t('ui.knowledgeRetrievalLogs.recordsTitle', { count: rows.length }, 'Retrieval records ({{count}})')}>
                <ErrorBanner error={logs.error} onRetry={() => logs.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={rows}
                    rowKey="id"
                    loading={logs.loading}
                    pagination={false}
                    toolbar={(
                        <Space>
                            <Input
                                prefix={<IconSearch />}
                                placeholder={t('ui.knowledgeRetrievalLogs.filterByConversation', null, 'Filter by conversation ID')}
                                value={conversationId}
                                onChange={setConversationId}
                                style={{ width: 260 }}
                            />
                            <Input
                                placeholder={t('ui.knowledgeRetrievalLogs.limitPlaceholder', null, 'Count')}
                                value={String(limit)}
                                onChange={value => setLimit(Math.min(Math.max(Number(value) || 50, 1), 500))}
                                style={{ width: 100 }}
                                suffix={<Text type="tertiary">{t('ui.knowledgeRetrievalLogs.limitSuffix', null, 'items')}</Text>}
                            />
                        </Space>
                    )}
                />
            </SectionCard>
            <Drawer title={t('ui.knowledgeRetrievalLogs.detailTitle', null, 'Retrieval log details')} visible={Boolean(detail)} onCancel={() => setDetail(null)} width={560}>
                {detail && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <KeyValueList items={[
                            { label: t('ui.knowledgeRetrievalLogs.logId', null, 'Log ID'), value: detail.id },
                            { label: t('ui.knowledgeRetrievalLogs.query', null, 'Query'), value: detail.query },
                            { label: t('ui.knowledgeRetrievalLogs.riskType', null, 'Risk type'), value: detail.riskType || '—' },
                            { label: t('ui.knowledgeRetrievalLogs.conversationId', null, 'Conversation ID'), value: detail.conversationId || '—' },
                            { label: t('ui.knowledgeRetrievalLogs.messageId', null, 'Message ID'), value: detail.messageId || '—' },
                            { label: t('ui.knowledgeRetrievalLogs.time', null, 'Time'), value: formatDateTime(detail.createdAt) }
                        ]} />
                        <JsonViewer value={detail.retrievedItems || []} title={t('ui.knowledgeRetrievalLogs.hitItems', null, 'Matched knowledge items')} />
                    </div>
                )}
            </Drawer>
        </div>
    );
}
