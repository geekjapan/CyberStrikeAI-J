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
	"cyberstrike-ai/internal/mcp"
	"cyberstrike-ai/internal/multiagent"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// SingleAgentLoopStream is the streaming conversation for the Pi single agent (ChatModelAgent + Runner); does not depend on multi_agent.enabled.
func (h *AgentHandler) SingleAgentLoopStream(c *gin.Context) {
	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")

	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		ev := StreamEvent{Type: "error", Message: "Invalid request parameters: " + err.Error()}
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

	c.Header("X-Accel-Buffering", "no")

	var baseCtx context.Context
	clientDisconnected := false
	var sseWriteMu sync.Mutex
	var ssePublishConversationID string
	sseLang := apimsg.Lang(c)
	sendEvent := func(eventType, message string, data interface{}) {
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

	h.logger.Info("Received Pi single-agent streaming request",
		zap.String("conversationId", req.ConversationID),
	)

	releaseAdmission := h.lockAgentAdmission()
	defer releaseAdmission()
	prep, err := h.prepareMultiAgentSession(&req, c, "agent_stream")
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

	taskStatus := "completed"
	// Call FinishTask only after StartTask succeeds. If StartTask fails with ErrTaskAlreadyRunning and FinishTask is still deferred,
	// it would wrongly delete the task running for the same session on another connection, causing "blocked the first time, allowed the second time".
	taskOwned := false
	var taskRunID string
	defer func() {
		if taskOwned {
			h.tasks.FinishTaskRun(conversationID, taskRunID, taskStatus)
		}
	}()

	sendEvent("progress", "Starting Pi single agent (ChatModelAgent)...", map[string]interface{}{
		"conversationId": conversationID,
	})

	stopKeepalive := runSSEKeepalive(c, &sseWriteMu)
	defer stopKeepalive()

	if h.config == nil {
		taskStatus = "failed"
		h.tasks.UpdateTaskStatus(conversationID, taskStatus)
		sendEvent("error", "Server configuration is not loaded", nil)
		sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
		return
	}
	runCfg, resolvedAIChannelID, err := h.configForAIChannel(req.AIChannelID)
	if err != nil {
		taskStatus = "failed"
		h.tasks.UpdateTaskStatus(conversationID, taskStatus)
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

	var cumulativeMCPExecutionIDs []string
	// When resuming in segments within the same request, the main agent's iteration events are accumulated by offset, to avoid the UI jumping back from "round 3" to "round 1".
	var mainIterationOffset int
	var emptyResponseContinueAttempt int
	var finalizationAutoContinueAttempt int
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

		result, runErr = multiagent.RunSingleAgent(
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
			chatReasoningToClientIntent(req.Reasoning),
			h.agentSessionContextBlock(conversationID),
		)
		_ = resolvedAIChannelID

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
			decision, cancelled = h.decideAgentRunForDeliveryAndCleanup(taskCtx, conversationID, assistantMessageID, "single", result, cumulativeMCPExecutionIDs, requestRequiresExecutionEvidence(&req), progressCallback)
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

		h.logger.Error("Pi single-agent execution failed", zap.Error(runErr))
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
		decision, cancelled = h.decideAgentRunForDeliveryAndCleanup(taskCtx, conversationID, assistantMessageID, "single", result, cumulativeMCPExecutionIDs, requestRequiresExecutionEvidence(&req), nil)
		autoCancelledPendingExecutionIDs = mergeMCPExecutionIDLists(autoCancelledPendingExecutionIDs, cancelled)
	}
	h.persistFinalizationDecision(conversationID, assistantMessageID, "single", cumulativeMCPExecutionIDs, multiagent.AggregatedReasoningFromTraceJSON(result.LastAgentTraceInput), decision)

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
		"agentMode":                        "single",
		"autoCancelledPendingExecutionIds": autoCancelledPendingExecutionIDs,
	}))
	sendEvent("done", "", map[string]interface{}{"conversationId": conversationID})
}

// SingleAgentLoop is the non-streaming conversation for the Pi single agent.
func (h *AgentHandler) SingleAgentLoop(c *gin.Context) {
	var req ChatRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.logger.Info("Received Pi single-agent non-streaming request", zap.String("conversationId", req.ConversationID))

	releaseAdmission := h.lockAgentAdmission()
	defer releaseAdmission()
	prep, err := h.prepareMultiAgentSession(&req, c, "agent")
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

	h.runSingleJSON(taskCtx, baseCtx, cancelWithCause, &req, prep, &jsonTaskStatus, respond)
}
