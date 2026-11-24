package handler

import (
	"context"

	"cyberstrike-ai/internal/agent"
	"cyberstrike-ai/internal/multiagent"
)

// applyAgentTraceResumeSegment for interrupt-and-continue: persist last_react_*, then loadHistory; optionally replaces the next user text.
func (h *AgentHandler) applyAgentTraceResumeSegment(
	conversationID string,
	result *multiagent.RunResult,
	curHistory *[]agent.ChatMessage,
	curFinalMessage *string,
	segmentUserMessage string,
) {
	if shouldPersistAgentAgentTraceAfterRunError(context.Background()) {
		h.persistAgentAgentTraceForResume(conversationID, result)
	}
	if hist, err := h.loadHistoryFromAgentTrace(conversationID); err == nil && len(hist) > 0 {
		*curHistory = hist
	}
	if segmentUserMessage != "" {
		*curFinalMessage = segmentUserMessage
	}
}
