/**
 * Chat stream event reducer.
 * The backend (/agent/stream, /multi-agent/stream) pushes { type, message, data } one by one;
 * here they are folded into a block list that can be rendered directly (body / reasoning / tool / iteration / notice).
 * Unrecognized complex events are not dropped: they are collected into events and the UI shows the raw JSON collapsed.
 */

import { translate } from '../../lib/i18n';

export const PLAN_TOOL_NAMES = new Set(['taskcreate', 'taskupdate', 'tasklist', 'taskget', 'write_todos']);

const SILENT_EVENT_TYPES = new Set([
    'heartbeat',
    'response_delta',
    'thinking_stream_delta',
    'reasoning_chain_stream_delta',
    'tool_result_delta'
]);

const MAX_EVENTS = 200;
const MAX_BLOCK_TEXT = 20000;

function str(value) {
    return value === undefined || value === null ? '' : String(value);
}

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : null;
}

export function truncateText(value, limit = MAX_BLOCK_TEXT) {
    const text = str(value);
    if (text.length <= limit) return text;
    return `${text.slice(0, limit)}\n${translate('ui.stream.truncated', { count: text.length }, '…(truncated, {{count}} characters in total)')}`;
}

export function prettyJson(value, limit = 6000) {
    if (value === undefined || value === null) return '';
    try {
        const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
        return truncateText(text, limit);
    } catch (error) {
        return truncateText(String(value), limit);
    }
}

export function createLiveState({ conversationId = '', id } = {}) {
    return {
        id: id || `live-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        conversationId,
        status: 'streaming',
        text: '',
        blocks: [],
        toolsByCallId: new Map(),
        events: [],
        error: '',
        notice: '',
        statusText: '',
        messageId: '',
        userMessageId: '',
        finalizable: null,
        startedAt: Date.now(),
        endedAt: 0,
        seq: 0
    };
}

function nextKey(state, prefix) {
    state.seq += 1;
    return `${prefix}-${state.seq}`;
}

function pushRawEvent(state, event) {
    const type = str(event.type);
    if (SILENT_EVENT_TYPES.has(type)) return;
    state.events.push({
        at: Date.now(),
        type,
        message: str(event.message),
        data: event.data === undefined ? null : event.data
    });
    if (state.events.length > MAX_EVENTS) state.events.splice(0, state.events.length - MAX_EVENTS);
}

function pushNote(state, { title, message, tone = 'info', data = null }) {
    const last = state.blocks[state.blocks.length - 1];
    if (last && last.kind === 'note' && last.title === title && last.message === str(message)) return last;
    const block = {
        kind: 'note',
        id: nextKey(state, 'note'),
        title,
        message: truncateText(message),
        tone,
        data
    };
    state.blocks.push(block);
    return block;
}

function upsertReasoning(state, streamId, kind = 'thinking') {
    const key = str(streamId) || nextKey(state, 'reasoning');
    let block = key ? state.blocks.find(item => item.kind === 'reasoning' && item.key === key) : null;
    if (!block) {
        block = { kind: 'reasoning', id: nextKey(state, 'reason'), key, stream: str(streamId), label: kind, text: '' };
        state.blocks.push(block);
    }
    return block;
}

function toolArgumentsFromData(data) {
    const parsed = asObject(data.argumentsObj);
    if (parsed && Object.keys(parsed).length) return parsed;
    const args = data.arguments ?? data.argumentsObj ?? null;
    if (typeof args !== 'string') return args;
    if (!args.trim()) return null;
    try {
        return JSON.parse(args);
    } catch {
        return args;
    }
}

function matchToolResult({ blocks, toolsByCallId }, { toolCallId, toolName, agentName }) {
    const sameAgent = block => !agentName || !block.agentName || block.agentName === agentName;
    const matches = toolsByCallId.get(toolCallId)?.filter(sameAgent);
    if (matches?.length) {
        return matches.find(block => !block.hasResult) || matches[matches.length - 1];
    }
    if (!toolName) return null;
    // Older records may omit a call ID on one or both events.
    return blocks.find(block => block.kind === 'tool' && !block.hasResult && block.toolName === toolName
        && sameAgent(block) && (!toolCallId || !block.toolCallId));
}

function toolStatusFromData(data) {
    const explicit = str(data.displayStatus || data.status).toLowerCase();
    if (explicit === 'cancelled' || explicit === 'canceled') return 'cancelled';
    if (explicit === 'background_running') return 'running';
    if (explicit === 'blocked') return 'blocked';
    if (data.isError === true || data.success === false) return 'failed';
    return 'success';
}

function addToolEvent(timeline, type, data, message, key, processDetailId) {
    const identity = {
        toolCallId: str(data.toolCallId),
        toolName: str(data.toolName),
        agentName: str(data.agentName)
    };
    const args = toolArgumentsFromData(data);
    const isResult = type === 'tool_result';
    let tool = isResult ? matchToolResult(timeline, identity) : null;
    if (!tool) {
        tool = {
            kind: 'tool',
            id: key('tool'),
            toolCallId: '',
            toolName: identity.toolName,
            agentName: identity.agentName,
            args,
            result: '',
            status: 'running',
            processDetailId: str(processDetailId),
            hasResult: false
        };
        timeline.blocks.push(tool);
    }
    if (identity.toolCallId && !tool.toolCallId) {
        tool.toolCallId = identity.toolCallId;
        const matches = timeline.toolsByCallId.get(tool.toolCallId);
        if (matches) matches.push(tool);
        else timeline.toolsByCallId.set(tool.toolCallId, [tool]);
    }
    if (!isResult) return;

    tool.hasResult = true;
    tool.toolName ||= identity.toolName;
    tool.agentName ||= identity.agentName;
    tool.status = toolStatusFromData(data);
    if (args !== null && (tool.args === null || (asObject(tool.args) && !Object.keys(tool.args).length))) {
        tool.args = args;
    }
    tool.result = prettyJson(data.resultPreview ?? data.result ?? data.error ?? message, 8000);
}

/**
 * Reduce a single SSE event (mutates state in place; the caller triggers the re-render).
 * Returns state itself for chaining.
 */
export function applyStreamEvent(state, event) {
    if (!state || !event || typeof event !== 'object') return state;
    const type = str(event.type);
    const data = asObject(event.data) || {};

    pushRawEvent(state, event);

    switch (type) {
        case 'heartbeat':
            break;
        case 'conversation':
            if (data.conversationId) state.conversationId = str(data.conversationId);
            break;
        case 'message_saved':
            if (data.userMessageId) state.userMessageId = str(data.userMessageId);
            break;
        case 'progress':
            state.statusText = str(event.message) || state.statusText;
            break;
        case 'iteration': {
            const n = Number(data.iteration) || 1;
            const scope = str(data.piScope).trim();
            const agentName = str(data.agentName).trim();
            const phase = scope === 'main'
                ? (agentName ? `${translate('ui.stream.mainAgent', null, 'Main agent')} · ${agentName}` : translate('ui.stream.mainAgent', null, 'Main agent'))
                : (scope === 'sub' ? `${translate('ui.stream.subAgent', null, 'Sub-agent')}${agentName ? ` · ${agentName}` : ''}` : '');
            state.blocks.push({
                kind: 'iteration',
                id: nextKey(state, 'iter'),
                title: `${translate('ui.stream.iteration', { n }, 'Iteration {{n}}')}${phase ? ` · ${phase}` : ''}`,
                message: truncateText(event.message, 2000)
            });
            break;
        }
        case 'thinking_stream_start':
        case 'reasoning_chain_stream_start': {
            const block = upsertReasoning(state, data.streamId, type === 'reasoning_chain_stream_start' ? 'reasoning_chain' : 'thinking');
            block.text = '';
            break;
        }
        case 'thinking_stream_delta':
        case 'reasoning_chain_stream_delta': {
            const block = upsertReasoning(state, data.streamId, type === 'reasoning_chain_stream_delta' ? 'reasoning_chain' : 'thinking');
            const accumulated = typeof data.accumulated === 'string' ? data.accumulated : null;
            block.text = truncateText(accumulated !== null ? accumulated : block.text + str(event.message));
            break;
        }
        case 'thinking':
        case 'reasoning_chain': {
            if (data.streamId) {
                const block = upsertReasoning(state, data.streamId, type === 'reasoning_chain' ? 'reasoning_chain' : 'thinking');
                if (str(event.message)) block.text = truncateText(event.message);
                break;
            }
            state.blocks.push({
                kind: 'reasoning',
                id: nextKey(state, 'reason'),
                key: nextKey(state, 'reasonkey'),
                stream: '',
                label: type === 'reasoning_chain' ? 'reasoning_chain' : 'thinking',
                text: truncateText(event.message)
            });
            break;
        }
        case 'response_start':
            if (data.conversationId) state.conversationId = str(data.conversationId);
            if (!state.statusText) state.statusText = translate('ui.stream.generatingReply', null, 'Generating reply…');
            break;
        case 'response_delta': {
            const accumulated = typeof data.accumulated === 'string' ? data.accumulated : null;
            state.text = truncateText(accumulated !== null ? accumulated : state.text + str(event.message), 60000);
            break;
        }
        case 'response': {
            const finalText = str(event.message);
            if (finalText) state.text = truncateText(finalText, 60000);
            if (data.messageId) state.messageId = str(data.messageId);
            if (data.conversationId) state.conversationId = str(data.conversationId);
            if (data.finalizable === false) state.finalizable = false;
            else if (data.finalizable === true) state.finalizable = true;
            break;
        }
        case 'tool_call':
        case 'tool_result':
            addToolEvent(state, type, data, event.message, prefix => nextKey(state, prefix), data.processDetailId);
            break;
        case 'tool_calls_detected':
            pushNote(state, { title: `🔧 ${translate('ui.stream.toolCallsDetected', null, 'Tool calls detected')}`, message: event.message, data });
            break;
        case 'hitl_interrupt':
            pushNote(state, { title: `🧑‍⚖️ ${translate('ui.stream.hitlWaiting', null, 'Waiting for human approval')}`, message: `${str(data.toolName) || translate('ui.stream.toolFallback', null, 'Tool')} · ${str(event.message) || translate('ui.stream.approvalPolicyHit', null, 'Approval policy matched')}`, tone: 'warning', data });
            break;
        case 'hitl_resumed':
            pushNote(state, { title: `✅ ${translate('ui.stream.hitlApproved', null, 'Approved')}`, message: str(event.message), tone: 'success', data });
            break;
        case 'hitl_rejected':
            pushNote(state, { title: `⛔ ${translate('ui.stream.hitlRejected', null, 'Approval rejected')}`, message: str(event.message), tone: 'danger', data });
            break;
        case 'hitl_audit_agent_started':
            pushNote(state, { title: `🛡 ${translate('ui.stream.auditReviewing', null, 'Audit agent reviewing')}`, message: str(event.message), tone: 'info', data });
            break;
        case 'hitl_audit_agent':
            pushNote(state, {
                title: `🛡 ${translate('ui.stream.auditDecided', null, 'Audit agent decided')}`,
                message: `${str(data.decision) || '-'}${data.comment ? ` · ${str(data.comment)}` : ''}`,
                tone: 'info',
                data
            });
            break;
        case 'warning':
        case 'iteration_limit_reached':
        case 'pi_pending_orphaned':
            pushNote(state, { title: `⚠️ ${str(event.message) || translate('ui.stream.notice', null, 'Notice')}`, message: str(event.message), tone: 'warning', data });
            break;
        case 'finalization_check':
            pushNote(state, { title: `🔎 ${translate('ui.stream.finalizationFailed', null, 'Finalization check failed')}`, message: str(event.message), tone: 'warning', data });
            if (data.finalizable === false) state.finalizable = false;
            break;
        case 'finalization_auto_continue':
        case 'finalization_pending_tools_cancelled':
        case 'agent_empty_response_continue':
        case 'agent_run_retry':
        case 'pi_model_retry':
        case 'pi_model_failover':
        case 'pi_stream_error':
            pushNote(state, { title: str(event.message) || translate('ui.stream.runNotice', null, 'Run notice'), message: str(event.message), tone: 'warning', data });
            break;
        case 'agent_usage_summary':
            state.blocks.push({ kind: 'usage', id: nextKey(state, 'usage'), data });
            break;
        case 'user_interrupt_continue':
            pushNote(state, { title: `⏸️ ${translate('ui.stream.userInterrupt', null, 'User interrupted and continued')}`, message: str(event.message), tone: 'info', data });
            break;
        case 'agent_reply':
            pushNote(state, { title: `💬 ${translate('ui.stream.agentReply', { name: str(data.agentName) || translate('ui.stream.subAgent', null, 'Sub-agent') }, '{{name}} replied')}`, message: str(event.message), data });
            break;
        case 'workflow_start':
        case 'workflow_done':
        case 'workflow_node_start':
        case 'workflow_node_result':
        case 'workflow_branch_taken':
        case 'workflow_branch_skipped':
        case 'workflow_tool_start':
        case 'workflow_agent_output':
        case 'workflow_hitl_checkpoint':
        case 'workflow_hitl_waiting':
        case 'workflow_hitl_resumed':
        case 'workflow_hitl_rejected':
        case 'workflow_paused':
            pushNote(state, { title: `🧭 ${str(event.message) || type}`, message: str(event.message), data });
            break;
        case 'cancelled':
            state.status = 'cancelled';
            state.notice = str(event.message) || translate('ui.stream.taskCancelled', null, 'Task cancelled');
            state.endedAt = Date.now();
            break;
        case 'error':
            state.status = 'error';
            state.error = str(event.message) || translate('ui.stream.runFailed', null, 'Execution failed');
            state.endedAt = Date.now();
            break;
        case 'done':
            if (state.status === 'streaming') {
                state.status = data.status === 'blocked' || state.finalizable === false ? 'blocked' : 'done';
            }
            if (data.workflowStatus === 'awaiting_hitl') state.statusText = translate('ui.stream.workflowAwaitingHitl', null, 'Workflow waiting for approval');
            state.endedAt = Date.now();
            break;
        default:
            // Known events without a dedicated model (agent_trace_*, diagnostic events other than iteration) only go to the raw log.
            break;
    }
    return state;
}

export function isLiveStreaming(live) {
    return Boolean(live) && live.status === 'streaming';
}

export const LIVE_STATUS_META = {
    streaming: { get label() { return translate('ui.stream.statusStreaming', null, 'Generating'); }, color: 'blue' },
    done: { get label() { return translate('ui.stream.statusDone', null, 'Completed'); }, color: 'green' },
    blocked: { get label() { return translate('ui.stream.statusBlocked', null, 'Incomplete'); }, color: 'orange' },
    disconnected: { get label() { return translate('ui.stream.statusDisconnected', null, 'Connection ended'); }, color: 'grey' },
    error: { get label() { return translate('ui.stream.statusError', null, 'Failed'); }, color: 'red' },
    cancelled: { get label() { return translate('ui.stream.statusCancelled', null, 'Cancelled'); }, color: 'grey' }
};

/** Process details of a history message to unified render blocks (same fields as streaming blocks). */
export function buildHistoryBlocks(message) {
    const blocks = [];
    const timeline = { blocks, toolsByCallId: new Map() };
    let seq = 0;
    const key = prefix => {
        seq += 1;
        return `h-${prefix}-${seq}`;
    };

    const reasoningContent = str(message?.reasoningContent).trim();
    if (reasoningContent) {
        blocks.push({ kind: 'reasoning', id: key('reason'), key: 'reasoningContent', stream: '', label: 'thinking', text: truncateText(reasoningContent) });
    }

    const details = Array.isArray(message?.processDetails) ? message.processDetails : [];
    details.forEach(detail => {
        const eventType = str(detail?.eventType);
        const data = asObject(detail?.data) || {};
        const text = str(detail?.message);

        switch (eventType) {
            case 'iteration': {
                const n = Number(data.iteration) || 1;
                const scope = str(data.piScope).trim();
                const agent = str(data.agentName).trim();
                blocks.push({
                    kind: 'iteration',
                    id: key('iter'),
                    title: `${translate('ui.stream.iteration', { n }, 'Iteration {{n}}')}${scope === 'main' ? ` · ${translate('ui.stream.mainAgent', null, 'Main agent')}` : (scope === 'sub' ? ` · ${translate('ui.stream.subAgent', null, 'Sub-agent')}` : '')}${agent ? ` · ${agent}` : ''}`,
                    message: truncateText(text, 2000)
                });
                break;
            }
            case 'thinking':
            case 'reasoning_chain': {
                if (!text.trim()) break;
                blocks.push({
                    kind: 'reasoning',
                    id: key('reason'),
                    key: str(data.streamId) || key('reasonkey'),
                    stream: str(data.streamId),
                    label: eventType,
                    text: truncateText(text)
                });
                break;
            }
            case 'tool_call':
            case 'tool_result':
                addToolEvent(timeline, eventType, data, text, key, detail?.id);
                break;
            case 'planning': {
                if (!text.trim()) break;
                blocks.push({ kind: 'note', id: key('note'), title: `📝 ${translate('ui.stream.planning', null, 'Planning')}`, message: truncateText(text, 4000), tone: 'info', data: null });
                break;
            }
            case 'hitl_interrupt':
            case 'hitl_resumed':
            case 'hitl_rejected':
            case 'hitl_audit_agent':
            case 'hitl_audit_agent_started': {
                const tone = eventType === 'hitl_rejected' ? 'danger' : (eventType === 'hitl_resumed' ? 'success' : 'info');
                const title = eventType === 'hitl_interrupt'
                    ? `🧑‍⚖️ ${translate('ui.stream.hitlManual', null, 'Human approval')}`
                    : (eventType === 'hitl_rejected' ? `⛔ ${translate('ui.stream.hitlRejected', null, 'Approval rejected')}` : (eventType === 'hitl_resumed' ? `✅ ${translate('ui.stream.hitlApproved', null, 'Approved')}` : `🛡 ${translate('ui.stream.auditAgent', null, 'Audit agent')}`));
                blocks.push({
                    kind: 'note',
                    id: key('note'),
                    title,
                    message: `${text}${data.toolName ? ` · ${str(data.toolName)}` : ''}${data.decision ? ` · ${str(data.decision)}` : ''}`,
                    tone,
                    data: null
                });
                break;
            }
            case 'error':
            case 'timeout':
            case 'cancelled':
                blocks.push({ kind: 'note', id: key('note'), title: eventType === 'cancelled' ? `⏹ ${translate('ui.stream.cancelledNote', null, 'Cancelled')}` : `❌ ${translate('ui.stream.execError', null, 'Execution error')}`, message: text, tone: 'danger', data: null });
                break;
            case 'agent_reply':
                blocks.push({ kind: 'note', id: key('note'), title: `💬 ${translate('ui.stream.subAgentReply', null, 'Sub-agent reply')}`, message: truncateText(text, 6000), tone: 'info', data: null });
                break;
            case 'agent_usage_summary':
                blocks.push({ kind: 'usage', id: key('usage'), data });
                break;
            case 'progress':
                // Heartbeat/progress text stays out of the timeline to avoid noise in history replay.
                break;
            default:
                if (text.trim() || Object.keys(data).length) {
                    blocks.push({
                        kind: 'note',
                        id: key('note'),
                        title: str(eventType) || translate('ui.stream.processEvent', null, 'Process event'),
                        message: truncateText(text, 4000),
                        tone: 'info',
                        data: Object.keys(data).length ? data : null
                    });
                }
                break;
        }
    });

    return blocks;
}
