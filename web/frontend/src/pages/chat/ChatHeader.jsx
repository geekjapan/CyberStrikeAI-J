import { Button, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconMenu, IconRefresh } from '@douyinfe/semi-icons';
import { useT } from '../../lib/i18n';

const { Text, Title } = Typography;

const MODE_TAG = {
    single: { key: 'chat.agentModePiSingle', label: 'Single agent', color: 'blue' },
    deep: { key: 'chat.agentModeDeep', label: 'Deep', color: 'purple' },
    plan_execute: { key: 'chat.agentModePlanExecuteLabel', label: 'Plan-Execute', color: 'orange' },
    supervisor: { key: 'chat.agentModeSupervisorLabel', label: 'Supervisor', color: 'green' }
};

export default function ChatHeader({
    conversation, mode, hitlCount, conversationId, narrow, onToggleSidebar, onRefresh
}) {
    const t = useT();
    const modeTag = MODE_TAG[mode] || MODE_TAG.single;
    const title = conversation?.title || t('chat.newChat', null, 'New chat');

    return (
        <header className="chat-header">
            <div className="chat-header-main">
                <div className="chat-header-heading">
                    <Title heading={3} className="chat-header-title" title={title}>{title}</Title>
                    <Space spacing={6} wrap className="chat-header-tags">
                        {conversation?.pinned && <Tag size="small" color="amber">{t('chat.pinned', null, 'Pinned')}</Tag>}
                        <Tag size="small" color={modeTag.color}>{t(modeTag.key, null, modeTag.label)}</Tag>
                        {hitlCount > 0 && (
                            <Tag size="small" color="orange">
                                {t('chat.pendingApprovals', { count: hitlCount }, 'Pending approvals: {{count}}')}
                            </Tag>
                        )}
                    </Space>
                </div>
                <Text type="tertiary" size="small" className="chat-header-description">
                    {conversationId
                        ? t('chat.conversationHint', null, 'Conversation history and tool executions are saved automatically')
                        : t('chat.newConversationHint', null, 'Type a message to start a new conversation')}
                </Text>
            </div>
            <Space spacing={8} wrap className="chat-header-actions">
                {narrow && (
                    <Button icon={<IconMenu />} onClick={onToggleSidebar}>
                        {t('chat.conversations', null, 'Conversations')}
                    </Button>
                )}
                {conversationId && (
                    <Button
                        theme="borderless"
                        type="tertiary"
                        icon={<IconRefresh aria-hidden="true" />}
                        title={t('chat.refreshConversationHint', null, 'Reload the conversation list, messages, pending approvals, and execution plan')}
                        onClick={onRefresh}
                    >
                        {t('chat.refreshConversation', null, 'Refresh conversation')}
                    </Button>
                )}
            </Space>
        </header>
    );
}
