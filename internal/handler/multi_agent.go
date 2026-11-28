package handler

import (
	"context"
	"cyberstrike-ai/internal/apimsg"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"sync"
	"time"

	"cyberstrike-ai/internal/agentfinalizer"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/mcp"
	"cyberstrike-ai/internal/multiagent"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// MultiAgentLoopStream Agent DeepAgent streaming conversation (requires config.multi_agent.enabled).
func (h *AgentHandler) MultiAgentLoopStream(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	if h.config == nil || !h.config.MultiAgent.Enabled {
		ev := StreamEvent{Type: "error", Message: "Multi-agent is not enabled; enable multi_agent.enabled in settings or config.yaml"}
		b, _ := json.Marshal(ev)
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		done := StreamEvent{Type: "done", Message: ""}
		db, _ := json.Marshal(done)
		fmt.Fprintf(c.Writer, "data: %s\n\n", db)
		if flusher, ok := c.Writer.(http.Flusher); ok {
			flusher.Flush()
		}
		return
	}

	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		event := StreamEvent{Type: "error", Message: "Invalid request parameters: " + err.Error()}
		b, _ := json.Marshal(event)
		fmt.Fprintf(c.Writer, "data: %s\n\n", b)
		done := StreamEvent{Type: "done", Message: ""}
		db, _ := json.Marshal(done)
		fmt.Fprintf(c.Writer, "data: %s\n\n", db)
		c.Writer.Flush()
		return
	}
	req.OutputLanguage = requestOutputLanguage(c)

	c.Header("X-Accel-Buffering", "no")

	// Used in sendEvent to determine whether a cancellation was caused by the user actively stopping.
	// Note: baseCtx is created later; this variable captures the reference early for the closure.
	var baseCtx context.Context

	clientDisconnected := false
	// Shared with sseKeepalive: concurrent writes to the ResponseWriter are forbidden, otherwise chunked encoding breaks (ERR_INVALID_CHUNKED_ENCODING).
	var sseWriteMu sync.Mutex
	var ssePublishConversationID string
	sseLang := apimsg.Lang(c)
	sendEvent := func(eventType, message string, data interface{}) {
		// When the user actively stops, the Agent may still concurrently report eventType == "error".
		// To prevent the UI from showing two replies, a "cancellation error" and a "cancelled" message, the error corresponding to the cancellation is discarded here directly.
		if eventType == "error" && baseCtx != nil {
			cause := context.Cause(baseCtx)
			if errors.Is(cause, ErrTaskCancelled) || errors.Is(cause, multiagent.ErrInterruptContinue) {
				return
			}
		}
		ev := StreamEvent{Type: eventType, Message: message, Data: data}
		b, errMarshal := json.Marshal(ev)
		if errMarshal != nil {
			b = []byte(`{"type":"error","message":"marshal failed"}`)
		}
		sseLine := make([]byte, 0, len(b)+8)
		sseLine = append(sseLine, []byte("data: ")...)
		sseLine = append(sseLine, b...)
		sseLine = append(sseLine, '\n', '\n')
		if ssePublishConversationID != "" && h.taskEventBus != nil {
			h.taskEventBus.Publish(ssePublishConversationID, sseLine)
		}
		if clientDisconnected {
			return
		}
		select {
		case <-c.Request.Context().Done():
			clientDisconnected = true
			return
		default:
		}
		sseWriteMu.Lock()
		_, err := c.Writer.Write(apimsg.TranslateSSE(sseLang, sseLine))
		if err != nil {
			sseWriteMu.Unlock()
			clientDisconnected = true
			return
		}
		if flusher, ok := c.Writer.(http.Flusher); ok {
			flusher.Flush()
		} else {
			c.Writer.Flush()
		}
		sseWriteMu.Unlock()
	}

	h.logger.Info("Received Agent DeepAgent streaming request",
		zap.String("conversationId", req.ConversationID),
	)

	releaseAdmission := h.lockAgentAdmission()
	defer releaseAdmission()
	prep, err := h.prepareMultiAgentSession(&req, c, "multi_agent_stream")
	if err != nil {
		sendEvent("error", err.Error(), nil)
		sendEvent("done", "", nil)
		return
	}
	ssePublishConversationID = prep.ConversationID
	if prep.CreatedNew {
		sendEvent("conversation", "Session created", map[string]interface{}{
			"conversationId": prep.ConversationID,
		})
	}

	conversationID := prep.ConversationID
	assistantMessageID := prep.AssistantMessageID
	h.activateHITLForConversation(conversationID, req.Hitl)
	if h.hitlManager != nil {
		defer h.hitlManager.DeactivateConversation(conversationID)
	}

	if prep.UserMessageID != "" {
		sendEvent("message_saved", "", map[string]interface{}{
			"conversationId": conversationID,
			"userMessageId":  prep.UserMessageID,
		})
	}
	if h.runRoleWorkflowStreamIfBound(c, &req, prep, sendEvent, releaseAdmission) {
		return
	}

	var cancelWithCause context.CancelCauseFunc
	curFinalMessage := prep.FinalMessage
	curHistory := prep.History
	roleTools := prep.RoleTools
	orch := strings.TrimSpace(req.Orchestration)

	taskStatus := "completed"
	// Call FinishTask only after StartTask succeeds; this avoids the "task already exists" branch's return mistakenly deleting a running task of the same session.
	taskOwned := false
	var taskRunID string
	defer func() {
		if taskOwned {
			h.tasks.FinishTaskRun(conversationID, taskRunID, taskStatus)
		}
	}()

	sendEvent("progress", "Starting Agent multi-agent...", map[string]interface{}{
		"conversationId": conversationID,
	})

	stopKeepalive := runSSEKeepalive(c, &sseWriteMu)
	defer stopKeepalive()
	runCfg, _, err := h.configForAIChannel(req.AIChannelID)
	if err != nil {
		sendEvent("error", err.Error(), nil)
		sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
		return
	}

	var result *multiagent.RunResult
	var runErr error

	baseCtx, cancelWithCause = context.WithCancelCause(detachedAgentContext(c.Request.Context()))
	taskCtx, timeoutCancel := h.newTaskContext(baseCtx)

	if startedTask, err := h.tasks.StartTask(conversationID, req.Message, cancelWithCause); err != nil {
		var errorMsg string
		if errors.Is(err, ErrTaskAlreadyRunning) {
			errorMsg = "⚠️ A task is already running in this conversation. Wait for it to finish or click \"Stop task\" and try again."
			sendEvent("error", errorMsg, map[string]interface{}{
				"conversationId": conversationID,
				"errorType":      "task_already_running",
			})
		} else {
			errorMsg = "❌ Failed to start task: " + err.Error()
			sendEvent("error", errorMsg, nil)
		}
		if assistantMessageID != "" {
			_, _ = h.db.Exec("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?", errorMsg, time.Now(), assistantMessageID)
		}
		sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
		timeoutCancel()
		return
	} else {
		taskRunID = startedTask.RunID
	}
	releaseAdmission()
	baseCtx = h.tasks.BindProcessScope(baseCtx, conversationID, taskRunID)
	taskCtx = h.tasks.BindProcessScope(taskCtx, conversationID, taskRunID)
	taskOwned = true
	sendEvent = h.taskFinishingEventSender(sendEvent, conversationID, taskRunID, func() string { return taskStatus })

	// Multiple Run segments within the same HTTP stream (such as interrupt and continue) merge their MCP execution IDs, so the final response, DB table and tool chips show the complete list
	var cumulativeMCPExecutionIDs []string
	// When resuming in segments within the same request, the main agent's iteration events are accumulated by offset, to avoid the UI jumping back from "round 3" to "round 1".
	var mainIterationOffset int
	var emptyResponseContinueAttempt int
	var finalizationAutoContinueAttempt int
	effectiveOrch := config.NormalizeMultiAgentOrchestration(h.config.MultiAgent.Orchestration)
	if o := strings.TrimSpace(req.Orchestration); o != "" {
		effectiveOrch = config.NormalizeMultiAgentOrchestration(o)
	}
	agentMode := effectiveOrch
	var decision agentfinalizer.Decision
	var autoCancelledPendingExecutionIDs []string

	for {
		segmentMainIterationMax := 0
		rawProgressCallback := h.createProgressCallback(taskCtx, cancelWithCause, conversationID, assistantMessageID, sendEvent)
		progressCallback := func(eventType, message string, data interface{}) {
			if eventType == "iteration" {
				if m, ok := data.(map[string]interface{}); ok {
					if scope, _ := m["agentScope"].(string); scope == "main" {
						raw := 0
						switch v := m["iteration"].(type) {
						case int:
							raw = v
						case int32:
							raw = int(v)
						case int64:
							raw = int(v)
						case float64:
							raw = int(v)
						case float32:
							raw = int(v)
						}
						if raw > 0 {
							if raw > segmentMainIterationMax {
								segmentMainIterationMax = raw
							}
							m["iteration"] = raw + mainIterationOffset
						}
					}
				}
			}
			rawProgressCallback(eventType, message, data)
		}
		taskCtxLoop := mcp.WithMCPConversationID(taskCtx, conversationID)
		taskCtxLoop = mcp.WithToolRunRegistry(taskCtxLoop, h.tasks)
		taskCtxLoop = mcp.WithAgentExecuteRunRegistry(taskCtxLoop, h.tasks)
		taskCtxLoop = multiagent.WithAgentRuntimeCancelRegistrar(taskCtxLoop, func(cancel func(error) bool) func() {
			return h.tasks.BindAgentRuntimeCancel(conversationID, cancel)
		})
		taskCtxLoop = multiagent.WithAgentTurnLoopInterruptRegistrar(taskCtxLoop, func(push func(string) bool) func() {
			return h.tasks.BindAgentTurnLoopInterrupt(conversationID, push)
		})
		taskCtxLoop = multiagent.WithHITLToolInterceptor(taskCtxLoop, func(ctx context.Context, toolName, arguments string) (string, error) {
			return h.interceptHITLForAgentTool(ctx, cancelWithCause, conversationID, assistantMessageID, sendEvent, toolName, arguments)
		})

		result, runErr = multiagent.RunMultiAgent(
			prep.withChatImages(taskCtxLoop, curFinalMessage),
			runCfg,
			&runCfg.MultiAgent,
			h.agent,
			h.db,
			h.logger,
			conversationID,
			h.conversationProjectID(conversationID),
			curFinalMessage,
			curHistory,
			roleTools,
			progressCallback,
			h.agentsMarkdownDir,
			orch,
			chatReasoningToClientIntent(req.Reasoning),
			h.chatPromptExtra(conversationID, &req),
		)

		if result != nil && len(result.MCPExecutionIDs) > 0 {
			cumulativeMCPExecutionIDs = mergeMCPExecutionIDLists(cumulativeMCPExecutionIDs, result.MCPExecutionIDs)
		}

		if runErr == nil {
			mw := &h.config.MultiAgent.Runtime
			if h.tryContinueOnAgentEmptyResponse(taskCtx, mw, conversationID, result, &emptyResponseContinueAttempt, &curHistory, &curFinalMessage, progressCallback) {
				mainIterationOffset += segmentMainIterationMax
				timeoutCancel()
				baseCtx, cancelWithCause, taskCtx, timeoutCancel = h.rebindAgentRunningTask(taskCtx, conversationID, timeoutCancel)
				continue
			}
			var cancelled []string
			decision, cancelled = h.decideAgentRunForDeliveryAndCleanup(taskCtx, conversationID, assistantMessageID, agentMode, result, cumulativeMCPExecutionIDs, requestRequiresExecutionEvidence(&req), progressCallback)
			autoCancelledPendingExecutionIDs = mergeMCPExecutionIDLists(autoCancelledPendingExecutionIDs, cancelled)
			if h.tryAutoContinueAfterFinalization(taskCtx, conversationID, result, decision, &finalizationAutoContinueAttempt, &curHistory, &curFinalMessage, progressCallback) {
				mainIterationOffset += segmentMainIterationMax
				timeoutCancel()
				baseCtx, cancelWithCause, taskCtx, timeoutCancel = h.rebindAgentRunningTask(taskCtx, conversationID, timeoutCancel)
				continue
			}
			timeoutCancel()
			break
		}

		cause := context.Cause(baseCtx)
		if cause == nil {
			switch {
			case errors.Is(runErr, multiagent.ErrInterruptContinue):
				cause = multiagent.ErrInterruptContinue
			case errors.Is(runErr, ErrTaskCancelled):
				cause = ErrTaskCancelled
			}
		}
		if errors.Is(cause, multiagent.ErrInterruptContinue) {
			if shouldPersistAgentAgentTraceAfterRunError(baseCtx) {
				h.persistAgentAgentTraceForResume(conversationID, result)
			}
			note := h.tasks.TakeInterruptContinueNote(conversationID)
			icSummary := interruptContinueTimelineSummary(note)
			progressCallback("user_interrupt_continue", icSummary, map[string]interface{}{
				"conversationId": conversationID,
				"rawReason":      strings.TrimSpace(note),
				"emptyReason":    strings.TrimSpace(note) == "",
				"kind":           "no_active_mcp_tool",
			})
			inject := formatInterruptContinueUserMessage(note)
			// Not written to the messages table as a user bubble: this avoids a large template appearing in the main conversation stream; the explanation is already recorded in the assistant's process_details (iteration details) by user_interrupt_continue.
			if hist, err := h.loadHistoryFromAgentTrace(conversationID); err == nil && len(hist) > 0 {
				curHistory = hist
			}
			curFinalMessage = inject
			sendEvent("progress", "Merged user addition with the latest trace, continuing reasoning...", map[string]interface{}{
				"conversationId": conversationID,
				"source":         "interrupt_continue",
			})
			mainIterationOffset += segmentMainIterationMax
			timeoutCancel()
			baseCtx, cancelWithCause = context.WithCancelCause(detachedAgentContext(baseCtx))
			h.tasks.BindTaskCancel(conversationID, cancelWithCause)
			taskCtx, timeoutCancel = h.newTaskContext(baseCtx)
			h.tasks.UpdateTaskStatus(conversationID, "running")
			continue
		}

		if shouldPersistAgentAgentTraceAfterRunError(baseCtx) {
			h.persistAgentAgentTraceForResume(conversationID, result)
		}
		if errors.Is(cause, ErrTaskCancelled) {
			taskStatus = "cancelled"
			h.tasks.UpdateTaskStatus(conversationID, taskStatus)
			cancelMsg := "Task was canceled by the user; subsequent operations have stopped."
			if assistantMessageID != "" {
				if result != nil {
					if err := h.mergeAssistantMessagePartialOnCancel(assistantMessageID, result.Response); err != nil {
						h.logger.Warn("Failed to merge partial reply before cancellation", zap.Error(err))
					}
				}
				if err := h.appendAssistantMessageNotice(assistantMessageID, cancelMsg); err != nil {
					h.logger.Warn("Failed to update assistant message after cancellation", zap.Error(err))
				}
				_ = h.db.AddProcessDetail(assistantMessageID, conversationID, "cancelled", cancelMsg, nil)
			}
			sendEvent("cancelled", cancelMsg, map[string]interface{}{
				"conversationId": conversationID,
				"messageId":      assistantMessageID,
			})
			sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
			timeoutCancel()
			return
		}

		if taskDeadlineExceeded(taskCtx) {
			taskStatus = "timeout"
			h.tasks.UpdateTaskStatus(conversationID, taskStatus)
			timeoutMsg := "Task execution timed out and was terminated automatically."
			if assistantMessageID != "" {
				_, _ = h.db.Exec("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?", timeoutMsg, time.Now(), assistantMessageID)
				_ = h.db.AddProcessDetail(assistantMessageID, conversationID, "timeout", timeoutMsg, nil)
			}
			sendEvent("error", timeoutMsg, map[string]interface{}{
				"conversationId": conversationID,
				"messageId":      assistantMessageID,
				"errorType":      "timeout",
			})
			sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
			timeoutCancel()
			return
		}

		h.logger.Error("Agent DeepAgent execution failed", zap.Error(runErr))
		taskStatus = "failed"
		h.tasks.UpdateTaskStatus(conversationID, taskStatus)
		clientErr := multiagent.ClientRunErrorMessage(runErr)
		errMsg := "Execution failed: " + clientErr
		if assistantMessageID != "" {
			_, _ = h.db.Exec("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?", errMsg, time.Now(), assistantMessageID)
			_ = h.db.AddProcessDetail(assistantMessageID, conversationID, "error", errMsg, nil)
		}
		errData := multiagent.ClientRunErrorFields(runErr)
		errData["conversationId"] = conversationID
		errData["messageId"] = assistantMessageID
		errData["error"] = errMsg
		sendEvent("error", errMsg, errData)
		sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
		timeoutCancel()
		return
	}

	timeoutCancel()

	if decision.CompletionReason == "" {
		var cancelled []string
		decision, cancelled = h.decideAgentRunForDeliveryAndCleanup(taskCtx, conversationID, assistantMessageID, agentMode, result, cumulativeMCPExecutionIDs, requestRequiresExecutionEvidence(&req), nil)
		autoCancelledPendingExecutionIDs = mergeMCPExecutionIDLists(autoCancelledPendingExecutionIDs, cancelled)
	}
	h.persistFinalizationDecision(conversationID, assistantMessageID, agentMode, cumulativeMCPExecutionIDs, multiagent.AggregatedReasoningFromTraceJSON(result.LastAgentTraceInput), decision)

	if result.LastAgentTraceInput != "" || result.LastAgentTraceOutput != "" {
		if err := h.db.SaveAgentTrace(conversationID, result.LastAgentTraceInput, result.LastAgentTraceOutput); err != nil {
			h.logger.Warn("Failed to save agent trace", zap.Error(err))
		}
	}

	responseText := decision.FinalText
	if !decision.Finalizable {
		responseText = finalizationBlockedMessage(decision)
		sendEvent("finalization_check", responseText, decision)
		taskStatus = decision.Status
		h.tasks.UpdateTaskStatus(conversationID, taskStatus)
	}
	sendEvent("response", responseText, finalizationResponsePayload(decision, map[string]interface{}{
		"mcpExecutionIds":                  cumulativeMCPExecutionIDs,
		"conversationId":                   conversationID,
		"messageId":                        assistantMessageID,
		"agentMode":                        agentMode,
		"autoCancelledPendingExecutionIds": autoCancelledPendingExecutionIDs,
	}))
	sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
}

// MultiAgentLoop Agent DeepAgent non-streaming conversation (requires multi_agent.enabled).
func (h *AgentHandler) MultiAgentLoop(c *gin.Context) {
	if h.config == nil || !h.config.MultiAgent.Enabled {
		c.JSON(http.StatusNotFound, gin.H{"error": "Multi-agent is not enabled. Set multi_agent.enabled: true in config.yaml"})
		return
	}

	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	req.OutputLanguage = requestOutputLanguage(c)

	h.logger.Info("Received Agent DeepAgent non-streaming request", zap.String("conversationId", req.ConversationID))

	releaseAdmission := h.lockAgentAdmission()
	defer releaseAdmission()
	prep, err := h.prepareMultiAgentSession(&req, c, "multi_agent")
	if err != nil {
		status, msg := multiAgentHTTPErrorStatus(err)
		c.JSON(status, gin.H{"error": msg})
		return
	}
	h.activateHITLForConversation(prep.ConversationID, req.Hitl)
	if h.hitlManager != nil {
		defer h.hitlManager.DeactivateConversation(prep.ConversationID)
	}
	if h.runRoleWorkflowJSONIfBound(c, &req, prep, releaseAdmission) {
		return
	}

	baseCtx, cancelWithCause := context.WithCancelCause(c.Request.Context())
	defer cancelWithCause(nil)
	taskCtx, timeoutCancel := h.newTaskContext(baseCtx)
	defer timeoutCancel()
	jsonTask, startErr := h.tasks.StartTask(prep.ConversationID, req.Message, cancelWithCause)
	if startErr != nil {
		c.JSON(http.StatusConflict, gin.H{"error": startErr.Error()})
		return
	}
	releaseAdmission()
	taskCtx = h.tasks.BindProcessScope(taskCtx, prep.ConversationID, jsonTask.RunID)
	taskCtx = mcp.WithMCPConversationID(taskCtx, prep.ConversationID)
	taskCtx = mcp.WithToolRunRegistry(taskCtx, h.tasks)
	taskCtx = mcp.WithAgentExecuteRunRegistry(taskCtx, h.tasks)
	jsonTaskStatus := "failed"
	defer func() { _ = h.tasks.FinishTaskRun(prep.ConversationID, jsonTask.RunID, jsonTaskStatus) }()
	respond := h.taskFinishingJSONResponder(c, prep.ConversationID, jsonTask.RunID, func() string { return jsonTaskStatus })

	h.runMultiJSON(taskCtx, baseCtx, cancelWithCause, &req, prep, &jsonTaskStatus, respond)
}

// persistAgentAgentTraceForResume writes the agent trace (DB column last_react_*) when an Agent run ends abnormally, so that the next request's loadHistoryFromAgentTrace can resume softly.
func (h *AgentHandler) persistAgentAgentTraceForResume(conversationID string, result *multiagent.RunResult) {
	if h == nil || result == nil {
		return
	}
	if result.LastAgentTraceInput == "" && result.LastAgentTraceOutput == "" {
		return
	}
	if err := h.db.SaveAgentTrace(conversationID, result.LastAgentTraceInput, result.LastAgentTraceOutput); err != nil {
		h.logger.Warn("Failed to save Agent resume context", zap.String("conversationId", conversationID), zap.Error(err))
	}
}

// mergeMCPExecutionIDLists deduplicates and merges the MCP execution IDs of multiple Run segments (order: dst first, then more).
func mergeMCPExecutionIDLists(dst []string, more []string) []string {
	seen := make(map[string]struct{}, len(dst)+len(more))
	out := make([]string, 0, len(dst)+len(more))
	add := func(ids []string) {
		for _, id := range ids {
			id = strings.TrimSpace(id)
			if id == "" {
				continue
			}
			if _, ok := seen[id]; ok {
				continue
			}
			seen[id] = struct{}{}
			out = append(out, id)
		}
	}
	add(dst)
	add(more)
	return out
}

// interruptContinueTimelineSummary is the short body shown in the timeline / process_details (the full template is already written as another user message).
func interruptContinueTimelineSummary(note string) string {
	note = strings.TrimSpace(note)
	if note == "" {
		return "The user chose \"interrupt and continue\" without a note; context was merged using the default penetration-test addition template and execution resumed."
	}
	return "User interruption note (original text):\n\n" + note
}

// formatInterruptContinueUserMessage formats the explanation from the "interrupt and continue" dialog into a new round's user message (emphasizing path supplements and port rescans in penetration scenarios).
func formatInterruptContinueUserMessage(note string) string {
	var b strings.Builder
	b.WriteString("[User addition / continue after interruption]\n")
	if s := strings.TrimSpace(note); s != "" {
		b.WriteString(s)
		b.WriteString("\n\n")
	}
	b.WriteString("[Apply in this round]\n")
	b.WriteString("- Take the API paths, parameters, and business changes provided by the user into account in subsequent testing and reasoning.\n")
	b.WriteString("- If asset or target information has been updated, re-run port/service probing on the target, then plan the next step based on the new results.\n")
	b.WriteString("- Build on the existing trace and avoid pointlessly repeating steps that are already done.\n")
	return strings.TrimSpace(b.String())
}

func multiAgentHTTPErrorStatus(err error) (int, string) {
	msg := err.Error()
	switch {
	case errors.Is(err, ErrTaskAlreadyRunning):
		return http.StatusConflict, msg
	case strings.Contains(msg, "Not authorized to access"):
		return http.StatusForbidden, msg
	case strings.Contains(msg, "Conversation not found"):
		return http.StatusNotFound, msg
	case strings.Contains(msg, "WebShell connection not found"):
		return http.StatusBadRequest, msg
	case strings.Contains(msg, "attachments are allowed"):
		return http.StatusBadRequest, msg
	case strings.Contains(msg, "Failed to save user message"), strings.Contains(msg, "Failed to create conversation"):
		return http.StatusInternalServerError, msg
	case strings.Contains(msg, "Failed to save uploaded file"):
		return http.StatusInternalServerError, msg
	default:
		return http.StatusBadRequest, msg
	}
}
