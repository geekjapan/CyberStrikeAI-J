import { useState } from 'react';
import { Button, Input, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconRefresh, IconSearch } from '@douyinfe/semi-icons';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, PageHeader, SectionCard
} from '../../components/ui';

const { Text } = Typography;

export default function RolesManagementPage() {
    const t = useT();
    const [search, setSearch] = useState('');

    const roles = useResource(() => api.get('/roles'), []);
    const rows = (Array.isArray(roles.data?.roles) ? roles.data.roles : []).filter(role => {
        if (!search) return true;
        const needle = search.toLowerCase();
        return [role.name, role.description].some(value => String(value || '').toLowerCase().includes(needle));
    });

    const columns = [
        {
            title: t('ui.rolesManagement.role', null, 'Role'), dataIndex: 'name', render: (value, record) => (
                <Space vertical spacing={0} align="start">
                    <Space>
                        <Text strong>{value}</Text>
                        {record.enabled === false && <Tag size="small" color="grey">{t('ui.rolesManagement.disabled', null, 'Disabled')}</Tag>}
                    </Space>
                    <Text type="tertiary" ellipsis={{ showTooltip: true }} style={{ maxWidth: 460 }}>{record.description || '—'}</Text>
                </Space>
            )
        },
        {
            title: t('ui.rolesManagement.tools', null, 'Tools'), dataIndex: 'tools', width: 260,
            render: value => (Array.isArray(value) && value.length
                ? <Space wrap spacing={4}>{value.slice(0, 4).map(tool => <Tag size="small" key={tool}>{tool}</Tag>)}{value.length > 4 && <Text type="tertiary">+{value.length - 4}</Text>}</Space>
                : <Text type="tertiary">{t('ui.rolesManagement.unbound', null, 'None bound')}</Text>)
        },
        { title: t('ui.rolesManagement.workflow', null, 'Workflow'), dataIndex: 'workflow_id', width: 160, render: value => value || '—' },
    ];

    return (
        <div>
            <PageHeader
                title={t('roles.title', null, 'Role Management')}
                description={t('ui.rolesManagement.description', null, 'Roles define the system prompt, available tools and bound workflow of a conversation.')}
                extra={(
                    <Button icon={<IconRefresh />} onClick={() => roles.reload()} loading={roles.loading}>{t('ui.rolesManagement.refresh', null, 'Refresh')}</Button>
                )}
            />
            <SectionCard title={t('ui.rolesManagement.listTitle', { count: rows.length }, 'Roles ({{count}})')}>
                <ErrorBanner error={roles.error} onRetry={() => roles.reload()} />
                <DataTable
                    columns={columns}
                    dataSource={rows}
                    rowKey="name"
                    loading={roles.loading}
                    pagination={{ pageSize: 20 }}
                    toolbar={<Input prefix={<IconSearch />} value={search} onChange={setSearch} placeholder={t('ui.rolesManagement.searchPlaceholder', null, 'Search role name')} style={{ width: 260 }} />}
                />
            </SectionCard>
        </div>
    );
}
