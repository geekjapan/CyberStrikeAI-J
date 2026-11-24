package handler

import (
	"context"
	"fmt"
	"time"

	"cyberstrike-ai/internal/agent"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/multiagent"

	"go.uber.org/zap"
)

// rebindAgentRunningTask for interrupt-and-continue / empty-body resume: rebuilds the cancel chain and timeout ctx, keeping the task running.
func (h *AgentHandler) rebindAgentRunningTask(parent context.Context, conversationID string, timeoutCancel context.CancelFunc) (context.Context, context.CancelCauseFunc, context.Context, context.CancelFunc) {
	if timeoutCancel != nil {
		timeoutCancel()
	}
	baseCtx, cancelWithCause := context.WithCancelCause(detachedAgentContext(parent))
	h.tasks.BindTaskCancel(conversationID, cancelWithCause)
	taskCtx, newTimeoutCancel := h.newTaskContext(baseCtx)
	h.tasks.UpdateTaskStatus(conversationID, "running")
	return baseCtx, cancelWithCause, taskCtx, newTimeoutCancel
}

// tryContinueOnAgentEmptyResponse: when Run succeeds but Response is emptyHint, resumes after a backoff; true means the next Run segment has been prepared.
func (h *AgentHandler) tryContinueOnAgentEmptyResponse(
	taskCtx context.Context,
	mw *config.AgentTuningConfig,
	conversationID string,
	result *multiagent.RunResult,
	attempt *int,
	curHistory *[]agent.ChatMessage,
	curFinalMessage *string,
	progressCallback func(eventType, message string, data interface{}),
) bool {
	if result == nil || !multiagent.IsEmptyResponseResult(result) || !multiagent.HasResumeTrace(result) {
		return false
	}
	maxAttempts := multiagent.EmptyResponseContinueMaxAttemptsFromConfig(mw)
	if *attempt >= maxAttempts {
		if h.logger != nil {
			h.logger.Warn("pi empty response continue exhausted",
				zap.String("conversationId", conversationID),
				zap.Int("maxAttempts", maxAttempts))
		}
		return false
	}
	*attempt++
	h.persistAgentAgentTraceForResume(conversationID, result)

	backoff := multiagent.EmptyResponseContinueBackoff(*attempt-1, mw)
	waitMsg := fmt.Sprintf("Session ended without a captured assistant body, auto-resuming in %d s (attempt %d/%d)...",
		int(backoff.Seconds()), *attempt, maxAttempts)
	if progressCallback != nil {
		progressCallback("agent_empty_response_continue", waitMsg, map[string]interface{}{
			"conversationId": conversationID,
			"source":         "pi",
			"attempt":        *attempt,
			"maxAttempts":    maxAttempts,
			"backoffSec":     int(backoff.Seconds()),
		})
	}
	select {
	case <-taskCtx.Done():
		return false
	case <-time.After(backoff):
	}

	h.applyAgentTraceResumeSegment(conversationID, result, curHistory, curFinalMessage, "")
	if progressCallback != nil {
		progressCallback("agent_empty_response_continue", "Context restored, resuming...", map[string]interface{}{
			"conversationId":   conversationID,
			"source":           "pi",
			"attempt":          *attempt,
			"maxAttempts":      maxAttempts,
			"contextSource":    "empty_response_continue",
			"contextInjection": false,
		})
	}
	return true
}
