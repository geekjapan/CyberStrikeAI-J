package handler

import (
	"cyberstrike-ai/internal/apimsg"
	"encoding/json"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// ConversationTaskStopper cancels in-flight agent work when a conversation is removed.
type ConversationTaskStopper interface {
	CancelRunningTaskForConversation(conversationID string)
}

// ConversationTaskStateProvider reports whether the in-memory agent task for
// a conversation is still genuinely running. Plan files may survive a service
// restart or cancellation, so their status alone is not authoritative.
type ConversationTaskStateProvider interface {
	ConversationTaskRuntimeState(conversationID string) (running bool, startedAt time.Time)
}

// ConversationHandler conversation handler
type ConversationHandler struct {
	db          *database.DB
	logger      *zap.Logger
	audit       *audit.Service
	taskStopper ConversationTaskStopper
	taskState   ConversationTaskStateProvider
}

// SetAudit wires platform audit logging.
func (h *ConversationHandler) SetAudit(s *audit.Service) {
	h.audit = s
}

// SetTaskStopper wires cancellation of in-flight agent tasks on conversation delete.
func (h *ConversationHandler) SetTaskStopper(stopper ConversationTaskStopper) {
	h.taskStopper = stopper
}

// SetTaskStateProvider wires the live agent task registry used by supplemental
// conversation UI such as the agent-maintained plan list.
func (h *ConversationHandler) SetTaskStateProvider(provider ConversationTaskStateProvider) {
	h.taskState = provider
}

// NewConversationHandler creates a new conversation handler
func NewConversationHandler(db *database.DB, logger *zap.Logger) *ConversationHandler {
	return &ConversationHandler{
		db:     db,
		logger: logger,
	}
}

// CreateConversationRequest create conversation request
type CreateConversationRequest struct {
	Title     string `json:"title"`
	ProjectID string `json:"projectId,omitempty"`
}

// SetConversationProjectRequest sets the project a conversation belongs to
type SetConversationProjectRequest struct {
	ProjectID string `json:"projectId"` // An empty string removes the binding
}

// CreateConversation creates a new conversation
func (h *ConversationHandler) CreateConversation(c *gin.Context) {
	var req CreateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	title := req.Title
	if title == "" {
		title = "New conversation"
	}

	meta := audit.ConversationCreateMetaFromGin(c, "api")
	meta.ProjectID = strings.TrimSpace(req.ProjectID)
	if !h.conversationProjectAllowed(c, meta.ProjectID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to access the target project"})
		return
	}
	conv, err := h.db.CreateConversation(title, meta)
	if err != nil {
		h.logger.Error("Failed to create conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if session, ok := security.CurrentSession(c); ok {
		_ = h.db.SetResourceOwner("conversation", conv.ID, session.UserID)
		_ = h.db.AssignResourceToUser(session.UserID, "conversation", conv.ID)
		if conv.ProjectID != "" {
			_ = h.db.AssignResourceToUser(session.UserID, "project", conv.ProjectID)
		}
	}

	c.JSON(http.StatusOK, conv)
}

// SetConversationProject sets or clears the project bound to a conversation
func (h *ConversationHandler) SetConversationProject(c *gin.Context) {
	id := c.Param("id")
	var req SetConversationProjectRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if _, err := h.db.GetConversation(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}
	projectID := strings.TrimSpace(req.ProjectID)
	if !h.conversationProjectAllowed(c, projectID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to access the target project"})
		return
	}
	if err := h.db.SetConversationProjectID(id, projectID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	c.JSON(http.StatusOK, gin.H{"success": true, "projectId": projectID})
}

func (h *ConversationHandler) conversationProjectAllowed(c *gin.Context, projectID string) bool {
	projectID = strings.TrimSpace(projectID)
	if projectID == "" {
		return true
	}
	session, ok := security.CurrentSession(c)
	if !ok {
		return false
	}
	return h.db.UserCanAccessResource(session.UserID, session.Scope, "project", projectID)
}

// ListConversations lists conversations
func (h *ConversationHandler) ListConversations(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "50")
	offsetStr := c.DefaultQuery("offset", "0")
	search := c.Query("search") // Get search parameters
	projectID := strings.TrimSpace(c.Query("project_id"))

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)

	if limit <= 0 {
		limit = 50
	}
	if limit > 1000 {
		limit = 1000
	}

	sortBy := strings.TrimSpace(c.Query("sort_by"))
	session, _ := security.CurrentSession(c)
	grouped := c.Query("group_by_project") == "1"

	var conversations []*database.Conversation
	var groups []database.ConversationProjectGroup
	var total int
	var err error
	conversations, err = h.db.ListConversationsForAccess(limit, offset, search, sortBy, projectID, session.UserID, session.Scope)
	if err == nil {
		total, err = h.db.CountConversationsForAccess(search, projectID, session.UserID, session.Scope)
	}
	if err == nil && grouped {
		groups, err = h.db.ListConversationProjectGroups(search, session.UserID, session.Scope)
	}
	if err != nil {
		h.logger.Error("Failed to get conversation list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	if conversations == nil {
		conversations = []*database.Conversation{}
	}
	response := gin.H{
		"conversations": conversations,
		"total":         total,
		"limit":         limit,
		"offset":        offset,
	}
	if grouped {
		response["projectGroups"] = groups
	}
	c.JSON(http.StatusOK, response)
}

// UpdateConversationPinnedRequest update conversation pinned state request
type UpdateConversationPinnedRequest struct {
	Pinned bool `json:"pinned"`
}

// UpdateConversationPinned updates the pinned state of a conversation
func (h *ConversationHandler) UpdateConversationPinned(c *gin.Context) {
	conversationID := c.Param("id")
	session, ok := security.CurrentSession(c)
	if !ok || !h.db.UserCanAccessResource(session.UserID, session.Scope, "conversation", conversationID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You do not have access to this resource"})
		return
	}

	var req UpdateConversationPinnedRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if err := h.db.UpdateConversationPinned(conversationID, req.Pinned); err != nil {
		h.logger.Error("Failed to update conversation pinned status", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Updated successfully"})
}

// GetConversation gets a conversation
func (h *ConversationHandler) GetConversation(c *gin.Context) {
	id := c.Param("id")

	// Lightweight loading by default; details are fetched on demand only when the user needs to expand them
	// When include_process_details=1/true, return the full processDetails (compatible with the old behavior)
	includeStr := c.DefaultQuery("include_process_details", "0")
	include := includeStr == "1" || includeStr == "true" || includeStr == "yes"

	var (
		conv *database.Conversation
		err  error
	)
	if include {
		conv, err = h.db.GetConversation(id)
	} else {
		conv, err = h.db.GetConversationLite(id)
	}
	if err != nil {
		h.logger.Error("Failed to get conversation", zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	conv.Retest, err = h.db.GetVulnerabilityRetest(id)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to read retest branch"})
		return
	}
	if lang := apimsg.Lang(c); lang != "en" {
		// Stored text is English; show server-written notices in the caller's language.
		for i := range conv.Messages {
			m := &conv.Messages[i]
			if m.Role == "assistant" {
				m.Content = apimsg.TranslateReply(lang, m.Content)
			}
			translateProcessDetails(lang, m.ProcessDetails)
		}
	}
	c.JSON(http.StatusOK, conv)
}

// GetConversationPlanTasks returns the task list maintained by the agent's
// TaskCreate/TaskUpdate tools for this conversation.
func (h *ConversationHandler) GetConversationPlanTasks(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	session, ok := security.CurrentSession(c)
	if !ok || !h.db.UserCanAccessResource(session.UserID, session.Scope, "conversation", id) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not authorized to access this conversation"})
		return
	}
	if _, err := h.db.GetConversationLite(id); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}
	running := false
	startedAt := time.Time{}
	if h.taskState != nil {
		running, startedAt = h.taskState.ConversationTaskRuntimeState(id)
	}
	if !running {
		c.JSON(http.StatusOK, gin.H{
			"tasks": []database.ConversationPlanTask{}, "total": 0,
			"completed": 0, "activeStep": 0, "running": false,
		})
		return
	}
	tasks, err := h.db.ListConversationPlanTasksSince(id, startedAt)
	if err != nil {
		h.logger.Error("Failed to get conversation task list", zap.String("conversationId", id), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get task list"})
		return
	}

	completed := 0
	activeStep := 0
	for i, task := range tasks {
		status := strings.ToLower(strings.TrimSpace(task.Status))
		if status == "completed" {
			completed++
		}
		if activeStep == 0 && status == "in_progress" {
			activeStep = i + 1
		}
	}
	if activeStep == 0 {
		for i, task := range tasks {
			if strings.ToLower(strings.TrimSpace(task.Status)) != "completed" {
				activeStep = i + 1
				break
			}
		}
	}
	if activeStep == 0 && len(tasks) > 0 {
		activeStep = len(tasks)
	}

	c.JSON(http.StatusOK, gin.H{
		"tasks":      tasks,
		"total":      len(tasks),
		"completed":  completed,
		"activeStep": activeStep,
		"running":    true,
	})
}

const (
	defaultProcessDetailsPageLimit = 50
	maxProcessDetailsPageLimit     = 500
)

// GetMessageProcessDetails gets the process details of a specified message (loaded on demand)
// Query parameters:
//   - summary=1: return only the summary (total / iterationCount / maxIteration)
//   - limit + offset: return processDetails paginated (defaults to 50 items when limit is not specified)
//   - anchorId: return the page containing that process-detail anchor, suitable for locating precisely from a tool button
//   - full=1: explicitly return all processDetails (for export and legacy integrations; not recommended for UI expansion)
func (h *ConversationHandler) GetMessageProcessDetails(c *gin.Context) {
	messageID := c.Param("id")
	if messageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "message id required"})
		return
	}

	summaryStr := strings.TrimSpace(c.Query("summary"))
	if summaryStr == "1" || strings.EqualFold(summaryStr, "true") || strings.EqualFold(summaryStr, "yes") {
		summary, err := h.db.GetProcessDetailsSummary(messageID)
		if err != nil {
			h.logger.Error("Failed to get process detail summary", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		c.JSON(http.StatusOK, gin.H{"summary": summary})
		return
	}

	fullStr := strings.TrimSpace(c.Query("full"))
	if fullStr == "1" || strings.EqualFold(fullStr, "true") || strings.EqualFold(fullStr, "yes") {
		details, err := h.db.GetProcessDetails(messageID)
		if err != nil {
			h.logger.Error("Failed to get process details", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}

		details = database.DedupeConsecutiveProcessDetails(details)
		out := processDetailsToJSON(h.logger, h.db, details, true)
		translateProcessDetails(apimsg.Lang(c), out)
		c.JSON(http.StatusOK, gin.H{
			"processDetails": out,
			"total":          len(out),
			"offset":         0,
			"limit":          len(out),
			"hasMore":        false,
		})
		return
	}

	limitStr := strings.TrimSpace(c.Query("limit"))
	limit := defaultProcessDetailsPageLimit
	if limitStr != "" {
		parsedLimit, err := strconv.Atoi(limitStr)
		if err != nil || parsedLimit <= 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "invalid limit"})
			return
		}
		limit = parsedLimit
	}
	if limit > maxProcessDetailsPageLimit {
		limit = maxProcessDetailsPageLimit
	}
	offset, _ := strconv.Atoi(strings.TrimSpace(c.Query("offset")))
	if offset < 0 {
		offset = 0
	}
	anchorID := strings.TrimSpace(c.Query("anchorId"))
	if anchorID != "" {
		anchorOffset, err := h.db.GetProcessDetailOffset(messageID, anchorID)
		if err != nil {
			h.logger.Warn("Failed to get process detail anchor position", zap.Error(err), zap.String("messageID", messageID), zap.String("anchorID", anchorID))
			c.JSON(http.StatusNotFound, gin.H{"error": err.Error()})
			return
		}
		offset = anchorOffset - limit/3
		if offset < 0 {
			offset = 0
		}
	}

	details, total, err := h.db.GetProcessDetailsPage(messageID, limit, offset)
	if err != nil {
		h.logger.Error("Failed to get process details by page", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}
	details = database.DedupeConsecutiveProcessDetails(details)
	out := processDetailsToJSON(h.logger, h.db, details, false)
	translateProcessDetails(apimsg.Lang(c), out)
	// A page may end between tool_call and tool_result. Return the full-history
	// execution summary so the UI can render terminal status without pretending
	// that an unloaded result is still running.
	summary, summaryErr := h.db.GetProcessDetailsSummary(messageID)
	if summaryErr != nil {
		h.logger.Warn("Failed to get paginated tool execution status", zap.Error(summaryErr), zap.String("messageID", messageID))
	}
	var toolExecutions []database.ProcessDetailsToolExecution
	if summary != nil {
		toolExecutions = summary.ToolExecutions
	}
	c.JSON(http.StatusOK, gin.H{
		"processDetails": out,
		"toolExecutions": toolExecutions,
		"total":          total,
		"offset":         offset,
		"limit":          limit,
		"hasMore":        offset+len(out) < total,
	})
}

// GetProcessDetail gets a single complete process detail. The list endpoint does not include tool payloads by default; this is called when the user opens a single tool.
func (h *ConversationHandler) GetProcessDetail(c *gin.Context) {
	id := strings.TrimSpace(c.Param("id"))
	if id == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "process detail id required"})
		return
	}
	detail, err := h.db.GetProcessDetailByID(id)
	if err != nil {
		h.logger.Error("Failed to get process details", zap.Error(err))
		c.JSON(http.StatusNotFound, gin.H{"error": "Process detail not found"})
		return
	}
	out := processDetailsToJSON(h.logger, h.db, []database.ProcessDetail{*detail}, true)
	if len(out) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Process detail not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"processDetail": out[0]})
}

// translateProcessDetails shows server-written process messages in lang.
func translateProcessDetails(lang string, details []map[string]interface{}) {
	if lang == "en" {
		return
	}
	for _, d := range details {
		kind, _ := d["eventType"].(string)
		if text, ok := d["message"].(string); ok {
			d["message"] = apimsg.TranslateEvent(lang, kind, text)
		}
	}
}

func processDetailsToJSON(logger *zap.Logger, db *database.DB, details []database.ProcessDetail, includeToolPayload bool) []map[string]interface{} {
	out := make([]map[string]interface{}, 0, len(details))
	for _, d := range details {
		var data interface{}
		if d.Data != "" {
			if err := json.Unmarshal([]byte(d.Data), &data); err != nil {
				logger.Warn("Failed to parse process detail data", zap.Error(err))
			}
		}
		if m, ok := data.(map[string]interface{}); ok {
			enrichEmptyToolCallArgumentsFromExecution(logger, db, d, m)
		}
		if !includeToolPayload {
			data = summarizeProcessDetailData(d.EventType, data)
		}
		out = append(out, map[string]interface{}{
			"id":             d.ID,
			"messageId":      d.MessageID,
			"conversationId": d.ConversationID,
			"eventType":      d.EventType,
			"message":        d.Message,
			"data":           data,
			"createdAt":      d.CreatedAt,
		})
	}
	return out
}

func enrichEmptyToolCallArgumentsFromExecution(logger *zap.Logger, db *database.DB, detail database.ProcessDetail, data map[string]interface{}) {
	if db == nil || detail.EventType != "tool_call" || !toolCallArgumentsEmpty(data) {
		return
	}
	toolName := strings.TrimSpace(fmt.Sprint(data["toolName"]))
	if toolName == "" || detail.ConversationID == "" || detail.CreatedAt.IsZero() {
		return
	}
	execID, args, err := db.FindNearestToolExecutionArguments(detail.ConversationID, toolName, detail.CreatedAt, 5*time.Second)
	if err != nil {
		if logger != nil {
			logger.Debug("Could not fill in process detail parameters from tool execution records",
				zap.Error(err),
				zap.String("processDetailId", detail.ID),
				zap.String("toolName", toolName))
		}
		return
	}
	if len(args) == 0 {
		return
	}
	data["argumentsObj"] = args
	if b, err := json.Marshal(args); err == nil {
		data["arguments"] = string(b)
	}
	if strings.TrimSpace(execID) != "" {
		data["executionId"] = strings.TrimSpace(execID)
	}
}

func toolCallArgumentsEmpty(data map[string]interface{}) bool {
	if data == nil {
		return true
	}
	if args, ok := data["argumentsObj"].(map[string]interface{}); ok && len(args) > 0 {
		return false
	}
	if raw, ok := data["arguments"]; ok {
		s := strings.TrimSpace(fmt.Sprint(raw))
		return s == "" || s == "{}" || s == "null"
	}
	return true
}

func summarizeProcessDetailData(eventType string, data interface{}) interface{} {
	m, ok := data.(map[string]interface{})
	if !ok || (eventType != "tool_call" && eventType != "tool_result") {
		return data
	}
	allow := map[string]bool{
		"toolName": true, "toolCallId": true, "index": true, "total": true,
		"arguments": true, "argumentsObj": true,
		"success": true, "isError": true, "executionId": true,
		"agentName": true, "agentRole": true, "agentScope": true, "orchestration": true,
		"agentFacing": true,
		"status":      true, "modelFacingIsError": true, "resultPreview": true,
	}
	out := make(map[string]interface{}, len(allow)+1)
	for k, v := range m {
		if allow[k] {
			out[k] = v
		}
	}
	out["_payloadDeferred"] = true
	return out
}

// UpdateConversationRequest update conversation request
type UpdateConversationRequest struct {
	Title string `json:"title"`
}

// UpdateConversation updates a conversation
func (h *ConversationHandler) UpdateConversation(c *gin.Context) {
	id := c.Param("id")

	var req UpdateConversationRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if req.Title == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Title is required"})
		return
	}

	if err := h.db.UpdateConversationTitle(id, req.Title); err != nil {
		h.logger.Error("Failed to update conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Return the updated conversation
	conv, err := h.db.GetConversation(id)
	if err != nil {
		h.logger.Error("Failed to get updated conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	c.JSON(http.StatusOK, conv)
}

// DeleteConversation deletes a conversation
func (h *ConversationHandler) DeleteConversation(c *gin.Context) {
	id := c.Param("id")

	if h.taskStopper != nil {
		h.taskStopper.CancelRunningTaskForConversation(id)
	}

	if err := h.db.DeleteConversation(id); err != nil {
		h.logger.Error("Failed to delete conversation", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if h.audit != nil {
		h.audit.Record(c, audit.Entry{
			Category:     "conversation",
			Action:       "delete",
			Result:       "success",
			ResourceType: "conversation",
			ResourceID:   id,
			Message:      "Delete conversation",
		})
	}

	c.JSON(http.StatusOK, gin.H{"message": "Deleted successfully"})
}

// DeleteTurnRequest deletes one conversation turn (POST /api/conversations/:id/delete-turn)
type DeleteTurnRequest struct {
	MessageID string `json:"messageId"`
}

// DeleteConversationTurn deletes the turn containing the anchor message (from that turn's user message up to the next user message) and clears last_react_*.
func (h *ConversationHandler) DeleteConversationTurn(c *gin.Context) {
	conversationID := c.Param("id")
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversation id required"})
		return
	}

	var req DeleteTurnRequest
	if err := c.ShouldBindJSON(&req); err != nil || req.MessageID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "messageId required"})
		return
	}

	if _, err := h.db.GetConversation(conversationID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Conversation not found"})
		return
	}

	if h.taskState != nil {
		if running, _ := h.taskState.ConversationTaskRuntimeState(conversationID); running {
			c.JSON(http.StatusConflict, gin.H{"error": "Please stop the current task before deleting the conversation turn"})
			return
		}
	}

	deletedIDs, err := h.db.DeleteConversationTurn(conversationID, req.MessageID)
	if err != nil {
		h.logger.Warn("Failed to delete conversation turn",
			zap.String("conversationId", conversationID),
			zap.String("messageId", req.MessageID),
			zap.Error(err),
		)
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if h.audit != nil {
		h.audit.RecordOK(c, "conversation", "delete_turn", "Delete conversation turn", "conversation", conversationID, map[string]interface{}{
			"message_id": req.MessageID,
			"deleted":    len(deletedIDs),
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"deletedMessageIds": deletedIDs,
		"message":           "ok",
	})
}
