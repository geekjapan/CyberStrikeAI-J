/**
 * Single-turn chat run: SSE event reduction, completion/error/cancel wrap-up, stop request.
 * The page only selects the conversation and renders; all run state is flushed from the refs here with controlled throttling.
 */
import { useCallback, useRef, useState } from 'react';
import { api, errorMessage, postStream } from '../../lib/http';
import { toastSuccess, toastWarning } from '../../components/ui';
import { PLAN_TOOL_NAMES, applyStreamEvent, createLiveState } from './stream';

export function useAgentRun({
    conversationRef,
    bindConversation,
    requestDetailReload,
    onSettled,
    onHitlEvent,
    onPlanTool,
    t
}) {
    const [live, setLive] = useState(null);
    const [sending, setSending] = useState(false);
    const [lastEvents, setLastEvents] = useState([]);

    const liveRef = useRef(null);
    const runRef = useRef(null);
    const flushTimer = useRef(null);

    const flushLive = useCallback((immediate = false) => {
        const commit = () => {
            flushTimer.current = null;
            if (liveRef.current) setLive({ ...liveRef.current });
        };
        if (immediate) {
            if (flushTimer.current) {
                clearTimeout(flushTimer.current);
                flushTimer.current = null;
            }
            commit();
            return;
        }
        if (flushTimer.current) return;
        flushTimer.current = setTimeout(commit, 80);
    }, []);

    const finishRun = useCallback(run => {
        if (!run || run.markedFinished || runRef.current !== run) return;
        run.markedFinished = true;
        if (run.live.status === 'streaming') {
            run.live.status = run.live.error ? 'error' : 'done';
            run.live.endedAt = Date.now();
        }
        flushLive(true);
        onSettled?.();
        setSending(false);
        setLastEvents(run.live.events.slice(-80));
        const activeId = run.live.conversationId || conversationRef.current;
        if (!activeId) {
            runRef.current = null;
            liveRef.current = null;
            setLive(null);
            return;
        }
        Promise.resolve(requestDetailReload?.(activeId, { silent: true })).then(payload => {
            if (runRef.current !== run) return;
            if (payload) {
                runRef.current = null;
                liveRef.current = null;
                setLive(null);
            }
        });
    }, [conversationRef, flushLive, onSettled, requestDetailReload]);

    const send = useCallback(({ message, attachments, mode, projectId, role, aiChannelId, reasoning, hitl, requireHumanApproval }) => {
        const run = {
            live: createLiveState({ conversationId: conversationRef.current }),
            markedFinished: false,
            stopRequested: false,
            abort: null
        };
        runRef.current = run;
        liveRef.current = run.live;
        setLive({ ...run.live });
        setSending(true);
        setLastEvents([]);

        const streaming = mode !== 'single';
        const body = {
            message,
            conversationId: conversationRef.current || '',
            aiChannelId,
            reasoning,
            hitl,
            requireHumanApproval: requireHumanApproval || undefined
        };
        if (!conversationRef.current && projectId) body.projectId = projectId;
        if (role) body.role = role;
        if (streaming) body.orchestration = mode;
        if (Array.isArray(attachments) && attachments.length) {
            body.attachments = attachments.map(item => ({
                fileName: item.fileName,
                mimeType: item.mimeType || '',
                serverPath: item.serverPath
            }));
        }

        run.abort = postStream(streaming ? '/multi-agent/stream' : '/agent/stream', body, {
            onEvent(event) {
                if (run.markedFinished || runRef.current !== run) return;
                applyStreamEvent(run.live, event);
                const type = event?.type;
                if (type === 'conversation' && event?.data?.conversationId) {
                    const bound = String(event.data.conversationId);
                    run.live.conversationId = bound;
                    if (conversationRef.current !== bound) bindConversation?.(bound);
                }
                if (type === 'hitl_interrupt' || type === 'hitl_resumed' || type === 'hitl_rejected') onHitlEvent?.();
                if ((type === 'tool_call' || type === 'tool_result')
                    && PLAN_TOOL_NAMES.has(String(event?.data?.toolName || '').toLowerCase())) {
                    onPlanTool?.();
                }
                if (type === 'done' || type === 'error' || type === 'cancelled') {
                    finishRun(run);
                    return;
                }
                flushLive();
            },
            onError(error) {
                if (run.markedFinished || runRef.current !== run) return;
                run.live.status = 'error';
                run.live.error = errorMessage(error, t('chat.streamFailed', null, 'Streaming connection failed'));
                run.live.endedAt = Date.now();
                finishRun(run);
            },
            onClose() {
                if (run.markedFinished || runRef.current !== run) return;
                run.live.status = 'disconnected';
                run.live.endedAt = Date.now();
                if (!run.stopRequested) {
                    run.live.notice = t('chat.streamEndedWithoutDone', null,
                        'The connection ended before a completion signal was received. The task may still be running on the server; check running tasks at the top or refresh this conversation.');
                    toastWarning(run.live.notice);
                }
                finishRun(run);
            }
        });
    }, [
        bindConversation, conversationRef, finishRun, flushLive,
        onHitlEvent, onPlanTool, t
    ]);

    const stop = useCallback(async () => {
        const run = runRef.current;
        const target = conversationRef.current || run?.live?.conversationId || '';
        if (target) {
            try {
                await api.post('/agent-loop/cancel', { conversationId: target });
                if (run) run.stopRequested = true;
                toastSuccess(t('chat.stopRequested', null, 'Stop requested'));
            } catch (error) {
                toastWarning(errorMessage(error, t('chat.stopFailed', null, 'Stop request failed')));
            }
        }
        run?.abort?.();
        // After a server-side cancel the cancellation note is still written later; reload the history once more to get the final persisted content.
        setTimeout(() => {
            if (target && conversationRef.current === target) requestDetailReload?.(target, { silent: true });
        }, 900);
    }, [conversationRef, requestDetailReload, t]);

    const reset = useCallback(() => {
        const run = runRef.current;
        if (run && !run.markedFinished) run.abort?.();
        runRef.current = null;
        liveRef.current = null;
        if (flushTimer.current) {
            clearTimeout(flushTimer.current);
            flushTimer.current = null;
        }
        setLive(null);
        setSending(false);
        setLastEvents([]);
    }, []);

    const isStreaming = useCallback(id => {
        const run = runRef.current;
        return Boolean(run && !run.markedFinished && id && run.live.conversationId === id);
    }, []);

    return { live, sending, lastEvents, send, stop, reset, isStreaming };
}
