/** Inline HITL approval card: shows the tool and arguments awaiting approval; supports approve / reject / dismiss. */
import { useMemo, useState } from 'react';
import { Button, Card, Collapse, Input, Space, Tag, Typography } from '@douyinfe/semi-ui';
import { IconTick, IconClose } from '@douyinfe/semi-icons';
import { lazyLabels, translate, useT } from '../../lib/i18n';
import { formatDateTime } from '../../lib/format';
import { prettyJson } from './stream';

const { Text } = Typography;

const MODE_LABEL = lazyLabels('ui.hitlCard.mode', {
    approval: 'Approval only',
    feedback: 'Approve with feedback',
    followup: 'Approve with follow-up',
    review_edit: 'Review and edit'
});

export function parseHitlItem(item) {
    if (!item) return null;
    let payload = item.payload;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch (error) {
            payload = null;
        }
    }
    if (!payload || typeof payload !== 'object') payload = {};
    const args = payload.argumentsObj && typeof payload.argumentsObj === 'object'
        ? payload.argumentsObj
        : (payload.arguments || null);
    return {
        ...item,
        payload,
        interruptId: String(item.id || item.interruptId || ''),
        toolName: String(item.toolName || payload.toolName || translate('ui.hitlCard.unknownTool', null, 'Unknown tool')),
        mode: String(item.mode || payload.mode || 'approval').toLowerCase(),
        args
    };
}

export default function HitlCard({ item, busy, readOnly, onApprove, onReject, onDismiss }) {
    const t = useT();
    const data = useMemo(() => parseHitlItem(item), [item]);
    const [comment, setComment] = useState('');
    if (!data) return null;
    const argsText = prettyJson(data.args, 4000);
    const modeLabel = MODE_LABEL[data.mode] || data.mode;
    const disabled = readOnly || busy || !data.interruptId;
    return (
        <Card
            className="chat-hitl-card"
            bordered
            title={(
                <span className="chat-hitl-title">
                    <span>{t('chat.hitlTitle', null, 'Human-in-the-loop')}</span>
                    <Tag size="small" color="orange" shape="circle">{modeLabel}</Tag>
                    <span className="chat-hitl-tool">{data.toolName}</span>
                </span>
            )}
            headerExtraContent={(
                <Text type="tertiary" size="small">
                    {data.createdAt ? formatDateTime(data.createdAt) : ''}
                </Text>
            )}
        >
            <div className="chat-hitl-meta">
                {data.reviewer && <Text type="tertiary" size="small">{t('ui.hitlCard.reviewer', null, 'Reviewer: ')}{data.reviewer === 'audit_agent' ? t('ui.hitlCard.auditAgent', null, 'Audit agent') : t('ui.hitlCard.human', null, 'Human')}</Text>}
                {data.expiresAt && <Text type="tertiary" size="small">{t('ui.hitlCard.expires', null, 'Expires: ')}{formatDateTime(data.expiresAt)}</Text>}
                {data.conversationId && <Text type="tertiary" size="small">{t('ui.hitlCard.conversation', null, 'Conversation: ')}{String(data.conversationId).slice(0, 8)}</Text>}
            </div>
            {argsText && (
                <Collapse className="chat-block-collapse">
                    <Collapse.Panel itemKey="1" header={<span className="chat-block-title">{t('ui.hitlCard.callArgs', null, 'Call arguments')}</span>}>
                        <pre className="chat-pre">{argsText}</pre>
                    </Collapse.Panel>
                </Collapse>
            )}
            <div className="chat-hitl-actions">
                <Input
                    size="small"
                    placeholder={t('chat.hitlComment', null, 'Approval note (a reason is recommended when rejecting)')}
                    disabled={readOnly}
                    value={comment}
                    onChange={setComment}
                    className="chat-hitl-comment"
                />
                <Space>
                    <Button
                        theme="solid"
                        size="small"
                        icon={<IconTick />}
                        disabled={disabled}
                        onClick={() => onApprove(data, comment)}
                    >
                        {t('chat.hitlApprove', null, 'Approve')}
                    </Button>
                    <Button
                        type="danger"
                        size="small"
                        icon={<IconClose />}
                        disabled={disabled}
                        onClick={() => onReject(data, comment)}
                    >
                        {t('chat.hitlReject', null, 'Reject')}
                    </Button>
                    <Button size="small" theme="borderless" disabled={disabled} onClick={() => onDismiss(data)}>
                        {t('chat.hitlDismiss', null, 'Dismiss')}
                    </Button>
                </Space>
            </div>
        </Card>
    );
}
