import { useState } from 'react';
import { Button, Input, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import { DataTable, ErrorBanner, JsonViewer, KeyValueList, MarkdownView, PageHeader, SectionCard, toastError, Drawer } from '../../components/ui';

const { Text } = Typography;

export default function AgentsManagementPage() {
    const t = useT();
    const [search, setSearch] = useState('');
    const [detail, setDetail] = useState(null);

    const agents = useResource(() => api.get('/multi-agent/markdown-agents'), []);
    const rows = (Array.isArray(agents.data?.agents) ? agents.data.agents : []).filter(item => {
        if (!search) return true;
        const needle = search.toLowerCase();
        return [item.name, item.id, item.filename, item.description].some(value => String(value || '').toLowerCase().includes(needle));
    });

    const openDetail = async record => {
        try {
            setDetail(await api.get(`/multi-agent/markdown-agents/${encodeURIComponent(record.filename)}`));
        } catch (error) {
            toastError(error, t('ui.agentsManagement.readFailed', null, 'Failed to load the agent'));
        }
    };

    const columns = [
        {
            title: t('ui.agentsManagement.agent', null, 'Agent'), dataIndex: 'name', render: (value, record) => (
                <Space vertical spacing={0} align="start">
                    <Space>
                        <Text strong>{value || record.id}</Text>
                        {record.is_orchestrator && <Tag size="small" color="purple">{t('ui.agentsManagement.orchestrator', null, 'Orchestrator')}</Tag>}
                    </Space>
                    <Text type="tertiary">{record.filename}</Text>
                </Space>
            )
        },
        { title: t('ui.agentsManagement.kind', null, 'Type'), dataIndex: 'kind', width: 110, render: value => <Tag size="small">{value || 'sub'}</Tag> },
        { title: t('ui.agentsManagement.description', null, 'Description'), dataIndex: 'description', render: value => <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 460 }}>{value || '—'}</Text> },
        {
            title: t('ui.agentsManagement.actions', null, 'Actions'), width: 180, render: (_, record) => (
                <Space>
                    <Button size="small" theme="borderless" onClick={() => openDetail(record)}>{t('ui.agentsManagement.detail', null, 'Details')}</Button>
                </Space>
            )
        }
    ];

    return (
        <div>
            <PageHeader
                title={t('agents.title', null, 'Agent Management')}
                description={agents.data?.dir ? t('ui.agentsManagement.dir', { dir: agents.data.dir }, 'Directory: {{dir}}') : t('ui.agentsManagement.subtitle', null, 'Sub-agents and orchestrators defined as Markdown files.')}
                extra={(
                    <Button icon={<IconRefresh />} onClick={() => agents.reload()} loading={agents.loading}>{t('ui.agentsManagement.refresh', null, 'Refresh')}</Button>
                )}
            />
            {agents.data?.error && <ErrorBanner error={agents.data.error} />}
            <SectionCard title={t('ui.agentsManagement.listTitle', { count: rows.length }, 'Agents ({{count}})')}>
                <ErrorBanner error={agents.error} onRetry={() => agents.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={rows}
                    rowKey="filename"
                    loading={agents.loading}
                    pagination={{ pageSize: 20 }}
                    toolbar={<Input prefix={<IconSearch />} value={search} onChange={setSearch} placeholder={t('ui.agentsManagement.searchPlaceholder', null, 'Search by name or file name')} style={{ width: 280 }} />}
                />
            </SectionCard>

            <Drawer title={detail?.name || t('ui.agentsManagement.detailTitle', null, 'Agent details')} visible={Boolean(detail)} onCancel={() => setDetail(null)} width={720}>
                {detail && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                        <KeyValueList items={[
                            { label: t('ui.agentsManagement.filename', null, 'File name'), value: detail.filename },
                            { label: 'ID', value: detail.id },
                            { label: t('ui.agentsManagement.kind', null, 'Type'), value: detail.kind },
                            { label: t('ui.agentsManagement.bindRole', null, 'Bound role'), value: detail.bind_role || '—' },
                            { label: t('ui.agentsManagement.maxIterations', null, 'Max iterations'), value: detail.max_iterations ?? '—' },
                            { label: t('ui.agentsManagement.tools', null, 'Tools'), value: Array.isArray(detail.tools) && detail.tools.length ? detail.tools.join('、') : '—' }
                        ]} />
                        <MarkdownView content={detail.instruction || detail.raw || ''} />
                        <JsonViewer value={detail.raw || detail} title={t('ui.agentsManagement.rawMarkdown', null, 'Raw Markdown')} collapsed />
                    </div>
                )}
            </Drawer>
        </div>
    );
}
