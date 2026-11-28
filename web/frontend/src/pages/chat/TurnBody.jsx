/** Single-turn output: execution process and events first, the assistant's final text shown separately at the end. */
import { useState } from 'react';
import { Collapse, Tag, Typography } from '@douyinfe/semi-ui';
import { MarkdownView, JsonViewer } from '../../components/ui';
import { formatNumber } from '../../lib/format';
import { translate, useI18n } from '../../lib/i18n';
import { prettyJson, truncateText } from './stream';

const { Text } = Typography;

const STATUS_TAG = {
    running: { color: 'blue', get label() { return translate('ui.turnBody.statusRunning', null, 'Running'); } },
    success: { color: 'green', get label() { return translate('ui.turnBody.statusSuccess', null, 'Done'); } },
    failed: { color: 'red', get label() { return translate('ui.turnBody.statusFailed', null, 'Failed'); } },
    cancelled: { color: 'grey', get label() { return translate('ui.turnBody.statusCancelled', null, 'Cancelled'); } },
    blocked: { color: 'orange', get label() { return translate('ui.turnBody.statusBlocked', null, 'Blocked'); } }
};

function ReasoningBlock({ block, defaultOpen }) {
    const { t } = useI18n();
    const text = block.text || '';
    if (!text.trim()) return null;
    const title = block.label === 'reasoning_chain'
        ? t('ui.turnBody.reasoningChain', null, '🔗 Reasoning chain')
        : t('ui.turnBody.thinkingProcess', null, '🤔 Thinking');
    return (
        <Collapse className="chat-block-collapse" defaultActiveKey={defaultOpen ? ['1'] : []}>
            <Collapse.Panel itemKey="1" header={<span className="chat-block-title">{title} · {t('ui.turnBody.charCount', { count: text.length }, '{{count}} characters')}</span>}>
                <pre className="chat-pre">{truncateText(text)}</pre>
            </Collapse.Panel>
        </Collapse>
    );
}

function ToolBlock({ block, index, total }) {
    const { t } = useI18n();
    const meta = STATUS_TAG[block.status] || STATUS_TAG.running;
    const argsText = prettyJson(block.args);
    const resultText = block.result || '';
    const hasBody = Boolean(argsText || resultText);
    const name = block.toolName || t('chat.unknownTool', null, 'Unknown tool');
    const header = (
        <span className="chat-tool-head">
            <span className="chat-tool-name">
                {block.agentName ? `${block.agentName} · ` : ''}
                {t('chat.callTool', { name, index, total }, 'Call tool: {{name}} ({{index}}/{{total}})')}
            </span>
            <Tag size="small" color={meta.color} shape="circle">{meta.label}</Tag>
        </span>
    );
    if (!hasBody) {
        return <div className="chat-tool"><div className="chat-tool-head-row">{header}</div></div>;
    }
    return (
        <div className="chat-tool">
            <Collapse className="chat-block-collapse">
                <Collapse.Panel itemKey="1" header={header}>
                    {argsText && (
                        <>
                            <Text type="tertiary" size="small">{t('ui.turnBody.args', null, 'Arguments')}</Text>
                            <pre className="chat-pre">{argsText}</pre>
                        </>
                    )}
                    {resultText && (
                        <>
                            <Text type="tertiary" size="small">{t('ui.turnBody.result', null, 'Result')}</Text>
                            <pre className="chat-pre">{resultText}</pre>
                        </>
                    )}
                </Collapse.Panel>
            </Collapse>
        </div>
    );
}

function NoteBlock({ block }) {
    const { t } = useI18n();
    const [open, setOpen] = useState(false);
    const tone = block.tone || 'info';
    return (
        <div className={`chat-note chat-note-${tone}`}>
            <div className="chat-note-head">
                <span className="chat-note-title">{block.title}</span>
                {block.data && (
                    <button type="button" className="chat-link-btn" onClick={() => setOpen(!open)}>
                        {open ? t('ui.turnBody.hideJson', null, 'Hide JSON') : t('ui.turnBody.showJson', null, 'View JSON')}
                    </button>
                )}
            </div>
            {block.message && <div className="chat-note-body">{block.message}</div>}
            {open && block.data && <JsonViewer value={block.data} collapsed={false} title={t('ui.turnBody.eventData', null, 'Event data')} />}
        </div>
    );
}

function UsageSummaryBlock({ data }) {
    const { t, lang } = useI18n();
    const number = value => formatNumber(Math.max(0, Math.trunc(Number(value) || 0)), lang);
    const rows = [
        ['chat.piUsageModelCalls', data.modelCalls],
        ['chat.piUsagePromptTokens', data.promptTokens],
        ['chat.piUsageCompletionTokens', data.completionTokens],
        ['chat.piUsageTotalTokens', data.totalTokens]
    ];
    const optionalRows = [
        ['chat.piUsageCachedTokens', data.cachedTokens],
        ['chat.piUsageCacheWriteTokens', data.cacheWriteTokens],
        ['chat.piUsageReasoningTokens', data.reasoningTokens]
    ];
    const message = [...rows, ...optionalRows.filter(([, count]) => Number(count) > 0)]
        .map(([label, count]) => `${t(label)}: ${number(count)}`)
        .join('\n');
    const total = Number(data.totalTokens);
    const title = [
        data.agentName,
        t('chat.piUsageSummaryTitle'),
        Number.isFinite(total) && total > 0 ? number(total) : ''
    ].filter(Boolean).join(' · ');
    return <NoteBlock block={{ title, message, data }} />;
}

function EventLog({ events }) {
    const { t } = useI18n();
    if (!events || !events.length) return null;
    return (
        <Collapse className="chat-block-collapse chat-event-log">
            <Collapse.Panel itemKey="1" header={<span className="chat-block-title">{t('ui.turnBody.rawEvents', { count: events.length }, '🧾 Raw events · {{count}}')}</span>}>
                <pre className="chat-pre">
                    {events.map((event, index) => `${index + 1}. ${JSON.stringify(event)}`).join('\n')}
                </pre>
            </Collapse.Panel>
        </Collapse>
    );
}

export default function TurnBody({
    text,
    blocks,
    events,
    streaming = false,
    openReasoning = false,
    isAssistant = false
}) {
    const { t } = useI18n();
    const list = Array.isArray(blocks) ? blocks : [];
    const body = text || '';
    const toolCount = list.filter(block => block.kind === 'tool').length;
    let toolIndex = 0;
    return (
        <div className="chat-turn-body">
            {list.map(block => {
                if (block.kind === 'reasoning') {
                    return <ReasoningBlock key={block.id} block={block} defaultOpen={openReasoning} />;
                }
                if (block.kind === 'tool') {
                    toolIndex += 1;
                    return <ToolBlock key={block.id} block={block} index={toolIndex} total={toolCount} />;
                }
                if (block.kind === 'iteration') {
                    return (
                        <div className="chat-iteration" key={block.id}>
                            <span className="chat-iteration-label">{block.title}</span>
                        </div>
                    );
                }
                if (block.kind === 'note') {
                    return <NoteBlock key={block.id} block={block} />;
                }
                if (block.kind === 'usage') {
                    return <UsageSummaryBlock key={block.id} data={block.data} />;
                }
                return null;
            })}
            <EventLog events={events} />
            {body.trim() && (isAssistant && !streaming ? (
                <section className="chat-task-summary" aria-label={t('chat.taskSummary')} data-chat-summary>
                    <details key={body} open>
                        <summary className="chat-task-summary-title">{t('chat.taskSummary')}</summary>
                        <div className="chat-task-summary-content"><MarkdownView content={body} /></div>
                    </details>
                </section>
            ) : streaming ? (
                <pre className="chat-pre chat-stream-text">{body}</pre>
            ) : <MarkdownView content={body} />)}
            {!body.trim() && streaming && <div className="chat-stream-placeholder">{t('ui.turnBody.generating', null, 'Generating…')}</div>}
        </div>
    );
}
