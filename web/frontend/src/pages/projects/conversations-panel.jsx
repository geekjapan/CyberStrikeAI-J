/** Linked conversations: open a conversation, promote the attack chain, unlink from the project. */
import { useNavigate } from 'react-router-dom';
import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { api } from '../../lib/http';
import { useT } from '../../lib/i18n';
import { useAuth } from '../../lib/auth';
import { useResource } from '../../components/hooks';
import {
    DataTable, ErrorBanner, SectionCard, confirmAction, toastError, toastSuccess
} from '../../components/ui';
import { formatDateTime } from '../../lib/format';
import { errorProp, errText } from './helpers';

const { Text } = Typography;

export default function ConversationsPanel({ projectId, canWrite, onChanged }) {
    const t = useT();
    const navigate = useNavigate();
    const { hasPermission } = useAuth();
    const canWriteChat = hasPermission('chat:write');

    const conversations = useResource(
        () => api.get(`/projects/${projectId}/conversations`, { limit: 100 }),
        [projectId]
    );

    const rows = conversations.data?.conversations || [];

    const promote = (record) => {
        confirmAction({
            title: t('projects.promoteAttackChain', null, 'Promote chain'),
            content: t('projects.confirmPromoteAttackChain', null, 'Promote this conversation\'s attack chain into the project? Facts and edges will be created or updated.'),
            okText: t('projects.promoteAttackChain', null, 'Promote chain'),
            danger: false,
            onOk: async () => {
                try {
                    const result = await api.post(`/projects/${projectId}/promote-attack-chain/${record.id}`);
                    toastSuccess(t('projects.promoteAttackChainSuccess', {
                        facts_created: result?.facts_created || 0,
                        facts_updated: result?.facts_updated || 0,
                        edges_created: result?.edges_created || 0
                    }, 'Promoted: {{facts_created}} new / {{facts_updated}} updated / {{edges_created}} edges'));
                    conversations.reload({ silent: true });
                    onChanged?.();
                } catch (error) {
                    toastError(errText(error, t('projects.promoteAttackChainFailed', null, 'Promote failed')));
                }
            }
        });
    };

    const unbind = (record) => {
        confirmAction({
            title: t('projects.unbind', null, 'Unbind'),
            content: t('projects.confirmUnbindConversation', null, 'Unbind this conversation from current project?'),
            okText: t('projects.unbind', null, 'Unbind'),
            onOk: async () => {
                try {
                    await api.put(`/conversations/${record.id}/project`, { projectId: '' });
                    toastSuccess(t('projects.projectUnbound', null, 'Project unbound'));
                    conversations.reload({ silent: true });
                    onChanged?.();
                } catch (error) {
                    toastError(errText(error, t('projects.unbindFailed', null, 'Unbind failed')));
                }
            }
        });
    };

    const columns = [
        {
            title: t('projects.titleLabel', null, 'Title'),
            dataIndex: 'title',
            render: (value, record) => (
                <button
                    type="button"
                    className="project-link-button"
                    onClick={() => navigate(`/chat?conversation=${encodeURIComponent(record.id)}`)}
                    title={value || record.id}
                >
                    {value || t('projects.untitledConversation', null, 'Untitled conversation')}
                </button>
            )
        },
        {
            title: 'ID',
            dataIndex: 'id',
            width: 240,
            render: value => <Text type="tertiary" size="small"><code>{value}</code></Text>
        },
        {
            title: t('projects.updated', null, 'Updated'),
            dataIndex: 'updated_at',
            width: 170,
            render: (value, record) => (
                <Text size="small">{formatDateTime(value || record.updatedAt || record.created_at || record.createdAt)}</Text>
            )
        },
        {
            title: t('common.actions', null, 'Actions'),
            dataIndex: 'id',
            width: 280,
            render: (value, record) => (
                <Space spacing={2} wrap>
                    <Button
                        size="small"
                        theme="borderless"
                        onClick={() => navigate(`/chat?conversation=${encodeURIComponent(record.id)}`)}
                    >
                        {t('projects.open', null, 'Open')}
                    </Button>
                    <Button
                        size="small"
                        theme="borderless"
                        disabled={!canWrite}
                        title={t('projects.promoteAttackChainTitle', null, 'Promote conversation attack chain to project facts')}
                        onClick={() => promote(record)}
                    >
                        {t('projects.promoteAttackChain', null, 'Promote chain')}
                    </Button>
                    <Button
                        size="small"
                        theme="borderless"
                        disabled={!canWriteChat}
                        title={t('projects.unbindProjectTitle', null, 'Unbind project')}
                        onClick={() => unbind(record)}
                    >
                        {t('projects.unbind', null, 'Unbind')}
                    </Button>
                </Space>
            )
        }
    ];

    return (
        <SectionCard
            title={t('projects.tabConversations', null, 'Bound conversations')}
            description={t('projects.boundConversationsHint', null, 'Conversations bound to this project; click to open')}
            extra={<Tag size="small" color="blue" type="light">{rows.length}</Tag>}
        >
            <ErrorBanner error={errorProp(conversations.error)} onRetry={conversations.reload} />
            <DataTable
                columns={columns}
                dataSource={rows}
                rowKey="id"
                loading={conversations.loading}
                pagination={{ pageSize: 10 }}
                emptyText={t('projects.noBoundConversations', null, 'No bound conversations yet; select this project in chat to bind')}
                onRefresh={() => conversations.reload()}
            />
        </SectionCard>
    );
}
