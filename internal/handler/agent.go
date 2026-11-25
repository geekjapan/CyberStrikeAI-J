package handler

import (
	"context"
	"crypto/rand"
	"cyberstrike-ai/internal/apimsg"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"
	"unicode/utf8"

	"cyberstrike-ai/internal/agent"
	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/authctx"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/mcp/builtin"
	"cyberstrike-ai/internal/multiagent"
	"cyberstrike-ai/internal/openai"
	"cyberstrike-ai/internal/reasoning"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"github.com/robfig/cron/v3"
	"go.uber.org/zap"
)

// safeTruncateString safely truncates a string, avoiding a cut in the middle of a UTF-8 character
func safeTruncateString(s string, maxLen int) string {
	if maxLen <= 0 {
		return ""
	}
	if utf8.RuneCountInString(s) <= maxLen {
		return s
	}

	// Convert the string to a rune slice to count characters correctly
	runes := []rune(s)
	if len(runes) <= maxLen {
		return s
	}

	// Truncate to the maximum length
	truncated := string(runes[:maxLen])

	// Try to truncate at punctuation or a space, so the truncation reads more naturally
	// Search backwards from the truncation point for a suitable break (no more than 20% of the length)
	searchRange := maxLen / 5
	if searchRange > maxLen {
		searchRange = maxLen
	}
	breakChars := []rune("，。、 ,.;:!?！？/\\-_")
	bestBreakPos := len(runes[:maxLen])

	for i := bestBreakPos - 1; i >= bestBreakPos-searchRange && i >= 0; i-- {
		for _, breakChar := range breakChars {
			if runes[i] == breakChar {
				bestBreakPos = i + 1 // Break after punctuation
				goto found
			}
		}
	}

found:
	truncated = string(runes[:bestBreakPos])
	return truncated + "..."
}

// responsePlanAgg buffers main-assistant response_stream chunks for one "planning" process_detail row.
type responsePlanAgg struct {
	meta            map[string]interface{}
	b               strings.Builder
	detailID        string
	lastPersistAt   time.Time
	lastPersistSize int
}

// thinkingBuf aggregates thinking_stream_* / reasoning_chain_stream_* before flush to process_details.
type thinkingBuf struct {
	b         strings.Builder
	meta      map[string]interface{}
	persistAs string // "thinking" | "reasoning_chain"
}

func normalizeProcessDetailText(s string) string {
	s = strings.ReplaceAll(s, "\r\n", "\n")
	s = strings.ReplaceAll(s, "\r", "\n")
	return strings.TrimSpace(s)
}

// discardPlanningIfEchoesToolResult drops buffered planning text when it only repeats the
// upcoming tool_result body. Streaming models often echo tool stdout in chunk.Content; flushing
// that into "planning" before persisting tool_result duplicates the output after page refresh.
// sameResponseStreamMeta reports whether this is the same segment of the main-channel stream (Pi may send response_start repeatedly for the same MessageStream).
func sameResponseStreamMeta(a, b map[string]interface{}) bool {
	if a == nil || b == nil {
		return false
	}
	agentA, _ := a["agentName"].(string)
	agentB, _ := b["agentName"].(string)
	agentA = strings.TrimSpace(agentA)
	agentB = strings.TrimSpace(agentB)
	if agentA == "" || !strings.EqualFold(agentA, agentB) {
		return false
	}
	orchA, _ := a["orchestration"].(string)
	orchB, _ := b["orchestration"].(string)
	if strings.TrimSpace(orchA) != strings.TrimSpace(orchB) {
		return false
	}
	iterA := responseStreamIterationFromMeta(a)
	iterB := responseStreamIterationFromMeta(b)
	if iterA != 0 && iterB != 0 && iterA != iterB {
		return false
	}
	streamA, _ := a["streamId"].(string)
	streamB, _ := b["streamId"].(string)
	streamA = strings.TrimSpace(streamA)
	streamB = strings.TrimSpace(streamB)
	if streamA != "" && streamB != "" && streamA != streamB {
		return false
	}
	return true
}

func responseStreamIterationFromMeta(m map[string]interface{}) int {
	if m == nil {
		return 0
	}
	switch v := m["iteration"].(type) {
	case int:
		return v
	case int32:
		return int(v)
	case int64:
		return int(v)
	case float64:
		return int(v)
	default:
		return 0
	}
}

func discardPlanningIfEchoesToolResult(respPlan *responsePlanAgg, toolData interface{}) string {
	if respPlan == nil {
		return ""
	}
	plan := normalizeProcessDetailText(respPlan.b.String())
	if plan == "" {
		return ""
	}
	dataMap, ok := toolData.(map[string]interface{})
	if !ok {
		return ""
	}
	res, ok := dataMap["result"].(string)
	if !ok {
		return ""
	}
	r := normalizeProcessDetailText(res)
	if r == "" {
		return ""
	}
	if plan == r || strings.HasSuffix(plan, r) {
		detailID := respPlan.detailID
		respPlan.meta = nil
		respPlan.b.Reset()
		respPlan.detailID = ""
		respPlan.lastPersistAt = time.Time{}
		respPlan.lastPersistSize = 0
		return detailID
	}
	return ""
}

// AgentHandler agent handler
type AgentHandler struct {
	asyncWorkers     sync.WaitGroup
	asyncSubmitMu    sync.Mutex
	agent            *agent.Agent
	db               *database.DB
	logger           *zap.Logger
	tasks            *AgentTaskManager
	taskEventBus     *TaskEventBus // Mirror of SSE events, so that the same running task can be subscribed to after a refresh
	batchTaskManager *BatchTaskManager
	hitlManager      *HITLManager
	config           *config.Config // Config reference, used to obtain role information
	knowledgeManager interface {    // Knowledge base manager interface
		LogRetrieval(conversationID, messageID, query, riskType string, retrievedItems []string) error
	}
	agentsMarkdownDir string // Multi-agent: directory of Markdown sub-agents (absolute path; empty means nothing is merged from disk)
	batchCronParser   cron.Parser
	// hitlWhitelistSaver merges the session's incremental whitelist into config.yaml when HITL is "applied" in the sidebar (optional)
	hitlWhitelistSaver       HitlToolWhitelistSaver
	hitlStrategySaver        HitlAuditStrategySaver
	hitlDefaultReviewerSaver HitlDefaultReviewerSaver
	auditLLM                 *openai.Client
	audit                    *audit.Service
}

// SetAudit wires platform audit logging.
func (h *AgentHandler) SetAudit(s *audit.Service) {
	h.audit = s
}

// TaskManager returns the agent task manager (used by the MCP monitoring page to terminate agent execute calls, etc.).
func (h *AgentHandler) TaskManager() *AgentTaskManager {
	if h == nil {
		return nil
	}
	return h.tasks
}

// CancelRunningTaskForConversation stops any in-flight agent work for the conversation (idempotent).
func (h *AgentHandler) CancelRunningTaskForConversation(conversationID string) {
	if h == nil || conversationID == "" || h.tasks == nil {
		return
	}
	ok, err := h.tasks.CancelTask(conversationID, ErrTaskCancelled)
	if !ok {
		h.cancelRunningMCPToolsForConversation(conversationID)
		h.tasks.AbortActiveAgentExecute(conversationID, "")
	}
	if h.logger != nil {
		if err != nil {
			h.logger.Warn("Failed to cancel running tasks of the session", zap.String("conversationId", conversationID), zap.Error(err))
		} else if ok {
			h.logger.Info("Canceled running tasks of the session", zap.String("conversationId", conversationID))
		}
	}

}

// ConversationTaskRuntimeState exposes the authoritative live state and start
// time used to scope persisted TaskCreate files to the current run. A task
// already entering cancellation must stop driving progress UI immediately.
func (h *AgentHandler) ConversationTaskRuntimeState(conversationID string) (bool, time.Time) {
	if h == nil || h.tasks == nil || strings.TrimSpace(conversationID) == "" {
		return false, time.Time{}
	}
	task := h.tasks.GetTaskSnapshot(strings.TrimSpace(conversationID))
	if task == nil || !strings.EqualFold(strings.TrimSpace(task.Status), "running") {
		return false, time.Time{}
	}
	return true, task.StartedAt
}

func (h *AgentHandler) cancelRunningMCPToolsForConversation(conversationID string) {
	if h == nil || h.agent == nil {
		return
	}
	n := h.agent.CancelRunningMCPToolsForConversation(conversationID, "Session ended, automatically terminating tools that are still running")
	if n > 0 && h.logger != nil {
		h.logger.Info("Terminated MCP tools still running for the session", zap.String("conversationId", conversationID), zap.Int("count", n))
	}
}

// HitlToolWhitelistSaver merges/sets the HITL approval-exempt tools into the global config and writes it to disk
type HitlToolWhitelistSaver interface {
	MergeHitlToolWhitelistIntoConfig(add []string) error
	SetHitlToolWhitelist(tools []string) error
}

// NewAgentHandler creates a new agent handler
func NewAgentHandler(agent *agent.Agent, db *database.DB, cfg *config.Config, logger *zap.Logger) *AgentHandler {
	batchTaskManager := NewBatchTaskManager(logger)
	batchTaskManager.SetDB(db)

	// Load all batch task queues from the database
	if err := batchTaskManager.LoadFromDB(); err != nil {
		logger.Warn("Failed to load batch task queue from database", zap.Error(err))
	}

	bus := NewTaskEventBus()
	tm := NewAgentTaskManager()
	tm.SetTaskEventBus(bus)
	llmHTTP := &http.Client{Timeout: 2 * time.Minute}
	var llmCfg *config.OpenAIConfig
	if cfg != nil {
		llmCfg = &cfg.OpenAI
	}
	handler := &AgentHandler{
		agent:            agent,
		db:               db,
		logger:           logger,
		tasks:            tm,
		taskEventBus:     bus,
		batchTaskManager: batchTaskManager,
		config:           cfg,
		hitlManager:      NewHITLManager(db, logger),
		batchCronParser:  cron.NewParser(cron.Minute | cron.Hour | cron.Dom | cron.Month | cron.Dow | cron.Descriptor),
		auditLLM:         openai.NewClient(llmCfg, llmHTTP, logger),
	}
	tm.SetToolCanceler(handler.cancelRunningMCPToolsForConversation)
	if err := handler.hitlManager.EnsureSchema(); err != nil {
		logger.Warn("Failed to initialize HITL table", zap.Error(err))
	}
	go handler.batchQueueSchedulerLoop()
	return handler
}

// SetKnowledgeManager sets the knowledge base manager (used to record retrieval logs)
func (h *AgentHandler) SetKnowledgeManager(manager interface {
	LogRetrieval(conversationID, messageID, query, riskType string, retrievedItems []string) error
}) {
	h.knowledgeManager = manager
}

// SetAgentsMarkdownDir sets the agents/*.md sub-agent directory (absolute path); empty means only the sub_agents in config.yaml are used.
func (h *AgentHandler) SetAgentsMarkdownDir(absDir string) {
	h.agentsMarkdownDir = strings.TrimSpace(absDir)
}

// SetHitlToolWhitelistSaver sets the persistence for the HITL whitelist (works with ConfigHandler; an interface is used to avoid a circular reference)
func (h *AgentHandler) SetHitlToolWhitelistSaver(s HitlToolWhitelistSaver) {
	h.hitlWhitelistSaver = s
}

// HitlDefaultReviewerSaver persists the global default human-in-the-loop configuration to config.yaml.
type HitlDefaultReviewerSaver interface {
	UpdateHitlDefaultConfig(mode, reviewer string, timeoutSeconds int) error
	UpdateHitlDefaultReviewer(reviewer string) error
}

// SetHitlDefaultReviewerSaver sets the persistence for the HITL default configuration.
func (h *AgentHandler) SetHitlDefaultReviewerSaver(s HitlDefaultReviewerSaver) {
	h.hitlDefaultReviewerSaver = s
}

func (h *AgentHandler) hitlEffectiveDefaultReviewer() string {
	if h != nil && h.config != nil {
		return normalizeHitlReviewer(h.config.Hitl.EffectiveDefaultReviewer())
	}
	return "human"
}

func (h *AgentHandler) hitlEffectiveDefaultMode() string {
	if h != nil && h.config != nil {
		return normalizeHitlDefaultMode(h.config.Hitl.EffectiveDefaultMode())
	}
	return "off"
}

func (h *AgentHandler) hitlEffectiveDefaultTimeoutSeconds() int {
	if h != nil && h.config != nil {
		timeout := h.config.Hitl.EffectiveDefaultTimeoutSeconds()
		if timeout < 0 {
			return 0
		}
		return timeout
	}
	return 300
}

func (h *AgentHandler) hitlEffectiveDefaultRequest() *HITLRequest {
	mode := h.hitlEffectiveDefaultMode()
	return &HITLRequest{
		Enabled:        mode != "off",
		Mode:           mode,
		Reviewer:       h.hitlEffectiveDefaultReviewer(),
		SensitiveTools: []string{},
		TimeoutSeconds: h.hitlEffectiveDefaultTimeoutSeconds(),
	}
}

// HITLNeedsToolApproval is used by the C2 dangerous-task gate: consistent with the session-side HITL and approval-exempt whitelist decision.
func (h *AgentHandler) HITLNeedsToolApproval(conversationID, toolName string) bool {
	if h == nil || h.hitlManager == nil {
		return false
	}
	return h.hitlManager.NeedsToolApproval(conversationID, toolName)
}

// ChatAttachment chat attachment (a file uploaded by the user)
type ChatAttachment struct {
	FileName   string `json:"fileName"`          // File name for display
	Content    string `json:"content,omitempty"` // Text or base64; may be left empty if the file has already been uploaded to the server
	MimeType   string `json:"mimeType,omitempty"`
	ServerPath string `json:"serverPath,omitempty"` // Absolute path already saved under chat_uploads (returned by POST /api/chat-uploads)
}

// ChatReasoningRequest the "model reasoning" intent of the chat page (consumed by the single and multi-agent paths).
type ChatReasoningRequest struct {
	// Mode: default (follow the system) | off | on | auto
	Mode string `json:"mode,omitempty"`
	// Effort: low | medium | high | max | xhigh (passed through as-is; the top tier is named differently across gateways). Empty means unspecified.
	Effort string `json:"effort,omitempty"`
}

// ChatFinalizationRequest is a caller-provided delivery policy. The server does
// not infer execution intent from natural-language user text.
type ChatFinalizationRequest struct {
	RequireExecutionEvidence *bool `json:"requireExecutionEvidence,omitempty"`
}

// ChatRequest chat request
type ChatRequest struct {
	Message              string                  `json:"message" binding:"required"`
	ConversationID       string                  `json:"conversationId,omitempty"`
	ProjectID            string                  `json:"projectId,omitempty"` // Project bound to a new conversation (optional; if not specified, config.project.default_project_id may be used)
	Role                 string                  `json:"role,omitempty"`      // Role name
	Attachments          []ChatAttachment        `json:"attachments,omitempty"`
	WebShellConnectionID string                  `json:"webshellConnectionId,omitempty"` // WebShell management - AI assistant: the currently selected connection ID; only webshell_* tools are used
	AIChannelID          string                  `json:"aiChannelId,omitempty"`          // Session-level AI channel; empty means ai.default_channel is used
	Hitl                 *HITLRequest            `json:"hitl,omitempty"`
	Reasoning            *ChatReasoningRequest   `json:"reasoning,omitempty"`
	Finalization         ChatFinalizationRequest `json:"finalization,omitempty"`
	// Orchestration applies only to /api/multi-agent and /api/multi-agent/stream: deep | plan_execute | supervisor; empty is equivalent to deep. For bot/batch requests without a body, the server defaults to deep. /api/agent* does not use this field.
	Orchestration string `json:"orchestration,omitempty"`
}

func (h *AgentHandler) configForAIChannel(channelID string) (*config.Config, string, error) {
	if h == nil || h.config == nil {
		return nil, "", fmt.Errorf("Server configuration is not loaded")
	}
	oa, resolvedID, ok := h.config.ResolveAIChannel(channelID)
	if !ok {
		return nil, resolvedID, fmt.Errorf("AI channel not found: %s", resolvedID)
	}
	cfgCopy := *h.config
	cfgCopy.OpenAI = oa
	return &cfgCopy, resolvedID, nil
}

func chatReasoningToClientIntent(r *ChatReasoningRequest) *reasoning.ClientIntent {
	if r == nil {
		return nil
	}
	return &reasoning.ClientIntent{Mode: r.Mode, Effort: r.Effort}
}

type HITLRequest struct {
	Enabled        bool     `json:"enabled"`
	Mode           string   `json:"mode,omitempty"`
	Reviewer       string   `json:"reviewer,omitempty"` // human | audit_agent
	SensitiveTools []string `json:"sensitiveTools,omitempty"`
	TimeoutSeconds int      `json:"timeoutSeconds,omitempty"`
}

const (
	maxAttachments     = 10
	chatUploadsDirName = "chat_uploads" // Root directory for conversation attachment storage (relative to the current working directory)
)

// validateChatAttachmentServerPath validates that the absolute path lies under the working directory's chat_uploads and is a regular file (prevents path traversal)
func validateChatAttachmentServerPath(abs string) (string, error) {
	p := strings.TrimSpace(abs)
	if p == "" {
		return "", fmt.Errorf("empty path")
	}
	cwd, err := os.Getwd()
	if err != nil {
		return "", fmt.Errorf("Failed to get current working directory: %w", err)
	}
	root := filepath.Join(cwd, chatUploadsDirName)
	rootAbs, err := filepath.Abs(filepath.Clean(root))
	if err != nil {
		return "", err
	}
	pathAbs, err := filepath.Abs(filepath.Clean(p))
	if err != nil {
		return "", err
	}
	sep := string(filepath.Separator)
	if pathAbs != rootAbs && !strings.HasPrefix(pathAbs, rootAbs+sep) {
		return "", fmt.Errorf("path outside chat_uploads")
	}
	st, err := os.Stat(pathAbs)
	if err != nil {
		return "", err
	}
	if st.IsDir() {
		return "", fmt.Errorf("not a regular file")
	}
	return pathAbs, nil
}

// avoidChatUploadDestCollision: if path already exists, generates a new file name with a timestamp and random suffix (consistent with the naming style of the upload API)
func avoidChatUploadDestCollision(path string) string {
	if _, err := os.Stat(path); os.IsNotExist(err) {
		return path
	}
	dir := filepath.Dir(path)
	base := filepath.Base(path)
	ext := filepath.Ext(base)
	nameNoExt := strings.TrimSuffix(base, ext)
	suffix := fmt.Sprintf("_%s_%s", time.Now().Format("150405"), shortRand(6))
	var unique string
	if ext != "" {
		unique = nameNoExt + suffix + ext
	} else {
		unique = base + suffix
	}
	return filepath.Join(dir, unique)
}

// relocateManualOrNewUploadToConversation: when there is no conversation ID, the frontend uploads to .../date/_manual; after the first message creates the conversation, the file is moved to .../date/{conversationId}/ to isolate it by conversation.
func relocateManualOrNewUploadToConversation(absPath, conversationID string, logger *zap.Logger) (string, error) {
	conv := strings.TrimSpace(conversationID)
	if conv == "" {
		return absPath, nil
	}
	convSan := strings.ReplaceAll(conv, string(filepath.Separator), "_")
	if convSan == "" || convSan == "_manual" || convSan == "_new" {
		return absPath, nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return absPath, err
	}
	rootAbs, err := filepath.Abs(filepath.Join(cwd, chatUploadsDirName))
	if err != nil {
		return absPath, err
	}
	rel, err := filepath.Rel(rootAbs, absPath)
	if err != nil {
		return absPath, nil
	}
	rel = filepath.ToSlash(filepath.Clean(rel))
	var segs []string
	for _, p := range strings.Split(rel, "/") {
		if p != "" && p != "." {
			segs = append(segs, p)
		}
	}
	// Only handles the flat structure: date/_manual|_new/filename
	if len(segs) != 3 {
		return absPath, nil
	}
	datePart, placeFolder, baseName := segs[0], segs[1], segs[2]
	if placeFolder != "_manual" && placeFolder != "_new" {
		return absPath, nil
	}
	targetDir := filepath.Join(rootAbs, datePart, convSan)
	if err := os.MkdirAll(targetDir, 0755); err != nil {
		return "", fmt.Errorf("Failed to create conversation attachment directory: %w", err)
	}
	dest := filepath.Join(targetDir, baseName)
	dest = avoidChatUploadDestCollision(dest)
	if err := os.Rename(absPath, dest); err != nil {
		return "", fmt.Errorf("Failed to move attachment into conversation directory: %w", err)
	}
	out, _ := filepath.Abs(dest)
	if logger != nil {
		logger.Info("Conversation attachments moved from the placeholder directory into the session directory",
			zap.String("from", absPath),
			zap.String("to", out),
			zap.String("conversationId", conv))
	}
	return out, nil
}

// saveAttachmentsToDateAndConversationDir processes attachments: if serverPath is set, only verifies that the existing file exists; otherwise writes content to chat_uploads/YYYY-MM-DD/{conversationID}/.
// When conversationID is empty, "_new" is used as the directory name (a new conversation does not have an ID yet)
func saveAttachmentsToDateAndConversationDir(attachments []ChatAttachment, conversationID string, logger *zap.Logger) (savedPaths []string, err error) {
	if len(attachments) == 0 {
		return nil, nil
	}
	cwd, err := os.Getwd()
	if err != nil {
		return nil, fmt.Errorf("Failed to get current working directory: %w", err)
	}
	dateDir := filepath.Join(cwd, chatUploadsDirName, time.Now().Format("2006-01-02"))
	convDirName := strings.TrimSpace(conversationID)
	if convDirName == "" {
		convDirName = "_new"
	} else {
		convDirName = strings.ReplaceAll(convDirName, string(filepath.Separator), "_")
	}
	targetDir := filepath.Join(dateDir, convDirName)
	if err = os.MkdirAll(targetDir, 0755); err != nil {
		return nil, fmt.Errorf("Failed to create upload directory: %w", err)
	}
	savedPaths = make([]string, 0, len(attachments))
	for i, a := range attachments {
		if sp := strings.TrimSpace(a.ServerPath); sp != "" {
			valid, verr := validateChatAttachmentServerPath(sp)
			if verr != nil {
				return nil, fmt.Errorf("Attachment %s: %w", a.FileName, verr)
			}
			finalPath, rerr := relocateManualOrNewUploadToConversation(valid, conversationID, logger)
			if rerr != nil {
				return nil, fmt.Errorf("Attachment %s: %w", a.FileName, rerr)
			}
			savedPaths = append(savedPaths, finalPath)
			if logger != nil {
				logger.Debug("Conversation attachment uses the already uploaded path", zap.Int("index", i+1), zap.String("fileName", a.FileName), zap.String("path", finalPath))
			}
			continue
		}
		if strings.TrimSpace(a.Content) == "" {
			return nil, fmt.Errorf("Attachment %s has no content or serverPath", a.FileName)
		}
		raw, decErr := attachmentContentToBytes(a)
		if decErr != nil {
			return nil, fmt.Errorf("Failed to decode attachment %s: %w", a.FileName, decErr)
		}
		baseName := filepath.Base(a.FileName)
		if baseName == "" || baseName == "." {
			baseName = "file"
		}
		baseName = strings.ReplaceAll(baseName, string(filepath.Separator), "_")
		ext := filepath.Ext(baseName)
		nameNoExt := strings.TrimSuffix(baseName, ext)
		suffix := fmt.Sprintf("_%s_%s", time.Now().Format("150405"), shortRand(6))
		var unique string
		if ext != "" {
			unique = nameNoExt + suffix + ext
		} else {
			unique = baseName + suffix
		}
		fullPath := filepath.Join(targetDir, unique)
		if err = os.WriteFile(fullPath, raw, 0644); err != nil {
			return nil, fmt.Errorf("Failed to write file %s: %w", a.FileName, err)
		}
		absPath, _ := filepath.Abs(fullPath)
		savedPaths = append(savedPaths, absPath)
		if logger != nil {
			logger.Debug("Conversation attachment saved", zap.Int("index", i+1), zap.String("fileName", a.FileName), zap.String("path", absPath))
		}
	}
	return savedPaths, nil
}

func shortRand(n int) string {
	const letters = "0123456789abcdef"
	b := make([]byte, n)
	_, _ = rand.Read(b)
	for i := range b {
		b[i] = letters[int(b[i])%len(letters)]
	}
	return string(b)
}

func attachmentContentToBytes(a ChatAttachment) ([]byte, error) {
	content := a.Content
	if decoded, err := base64.StdEncoding.DecodeString(content); err == nil && len(decoded) > 0 {
		return decoded, nil
	}
	return []byte(content), nil
}

// userMessageContentForStorage returns the user message content to store in the database: when there are attachments, the attachment names (and paths) are appended after the body, so they still display after a refresh and the LLM can get the paths from history when the conversation continues.
func userMessageContentForStorage(message string, attachments []ChatAttachment, savedPaths []string) string {
	if len(attachments) == 0 {
		return message
	}
	var b strings.Builder
	b.WriteString(message)
	for i, a := range attachments {
		b.WriteString("\n📎 ")
		b.WriteString(a.FileName)
		if i < len(savedPaths) && savedPaths[i] != "" {
			b.WriteString(": ")
			b.WriteString(savedPaths[i])
		}
	}
	return b.String()
}

// appendAttachmentsToMessage appends only the saved paths of the attachments to the end of the user message, no longer inlining attachment content, to avoid an overly long context
func appendAttachmentsToMessage(msg string, attachments []ChatAttachment, savedPaths []string) string {
	if len(attachments) == 0 {
		return msg
	}
	var b strings.Builder
	b.WriteString(msg)
	b.WriteString("\n\n[User-uploaded files]\n")
	for i, a := range attachments {
		if i < len(savedPaths) && savedPaths[i] != "" {
			b.WriteString(fmt.Sprintf("- %s: %s\n", a.FileName, savedPaths[i]))
		} else {
			b.WriteString(fmt.Sprintf("- %s: (path unknown, saving may have failed)\n", a.FileName))
		}
	}
	return b.String()
}

// appendAssistantMessageNotice appends a notice to the end of an assistant message, without overwriting the content already generated.
// If the message is empty, write the notice directly; if it already contains the same notice, leave it unchanged.
func (h *AgentHandler) appendAssistantMessageNotice(messageID, notice string) error {
	trimmedNotice := strings.TrimSpace(notice)
	if strings.TrimSpace(messageID) == "" || trimmedNotice == "" {
		return nil
	}
	_, err := h.db.Exec(
		`UPDATE messages
		 SET content = CASE
			WHEN content IS NULL OR TRIM(content) = '' THEN ?
			WHEN INSTR(content, ?) > 0 THEN content
			ELSE content || '\n\n' || ?
		 END,
		     updated_at = ?
		 WHERE id = ?`,
		trimmedNotice,
		trimmedNotice,
		trimmedNotice,
		time.Now(),
		messageID,
	)
	return err
}

// mergeAssistantMessagePartialOnCancel merges as much of the partial reply generated before cancellation as possible into the message:
// - When content is empty or only a placeholder (processing...), replace it directly with partial;
// - When there is existing body text, append only if it does not already contain the partial, to avoid losing or duplicating text.
func (h *AgentHandler) mergeAssistantMessagePartialOnCancel(messageID, partial string) error {
	trimmedPartial := strings.TrimSpace(partial)
	if strings.TrimSpace(messageID) == "" || trimmedPartial == "" {
		return nil
	}
	_, err := h.db.Exec(
		`UPDATE messages
		 SET content = CASE
			WHEN content IS NULL OR TRIM(content) = '' OR TRIM(content) IN ('Processing...', '处理中...') THEN ?
			WHEN INSTR(content, ?) > 0 THEN content
			ELSE content || '\n\n' || ?
		 END,
		     updated_at = ?
		 WHERE id = ?`,
		trimmedPartial,
		trimmedPartial,
		trimmedPartial,
		time.Now(),
		messageID,
	)
	return err
}

// ChatResponse chat response
type ChatResponse struct {
	Response                         string    `json:"response"`
	MCPExecutionIDs                  []string  `json:"mcpExecutionIds,omitempty"` // List of MCP call IDs executed in this conversation
	ConversationID                   string    `json:"conversationId"`            // Conversation ID
	Time                             time.Time `json:"time"`
	Finalizable                      bool      `json:"finalizable"`
	Finalized                        bool      `json:"finalized"`
	Status                           string    `json:"status,omitempty"`
	CompletionReason                 string    `json:"completionReason,omitempty"`
	EvidenceVerified                 bool      `json:"evidenceVerified"`
	EvidenceRefs                     []string  `json:"evidenceRefs,omitempty"`
	PendingExecutionIDs              []string  `json:"pendingExecutionIds,omitempty"`
	MissingChecks                    []string  `json:"missingChecks,omitempty"`
	AutoCancelledPendingExecutionIDs []string  `json:"autoCancelledPendingExecutionIds,omitempty"`
}

func (h *AgentHandler) finalizeRobotAgentError(ctx context.Context, assistantMessageID, conversationID string, resultMA *multiagent.RunResult, errMA error) (string, string, error) {
	if shouldPersistAgentAgentTraceAfterRunError(ctx) {
		h.persistAgentAgentTraceForResume(conversationID, resultMA)
	}
	errMsg := "Execution failed: " + multiagent.ClientRunErrorMessage(errMA)
	if assistantMessageID != "" {
		_, _ = h.db.Exec("UPDATE messages SET content = ?, updated_at = ? WHERE id = ?", errMsg, time.Now(), assistantMessageID)
		_ = h.db.AddProcessDetail(assistantMessageID, conversationID, "error", errMsg, nil)
	}
	return "", conversationID, errMA
}

func (h *AgentHandler) finalizeRobotAgentSuccess(taskCtx context.Context, assistantMessageID, conversationID string, resultMA *multiagent.RunResult) (string, string, error) {
	reasoningContent := multiagent.AggregatedReasoningFromTraceJSON(resultMA.LastAgentTraceInput)
	decision, _ := h.decideAgentRunForDeliveryAndCleanup(taskCtx, conversationID, assistantMessageID, "robot", resultMA, resultMA.MCPExecutionIDs, false, nil)
	h.persistFinalizationDecision(conversationID, assistantMessageID, "robot", resultMA.MCPExecutionIDs, reasoningContent, decision)
	responseText := decision.FinalText
	if !decision.Finalizable {
		responseText = finalizationBlockedMessage(decision)
	}
	if assistantMessageID == "" {
		if _, err := h.db.AddMessage(conversationID, "assistant", responseText, resultMA.MCPExecutionIDs); err != nil {
			h.logger.Warn("Bot: failed to save assistant message", zap.Error(err))
		}
	}
	if resultMA.LastAgentTraceInput != "" || resultMA.LastAgentTraceOutput != "" {
		_ = h.db.SaveAgentTrace(conversationID, resultMA.LastAgentTraceInput, resultMA.LastAgentTraceOutput)
	}
	return responseText, conversationID, nil
}

func (h *AgentHandler) runRobotAgentSingleWithRetry(
	taskCtx context.Context,
	conversationID, finalMessage string,
	history []agent.ChatMessage,
	roleTools []string,
	progressCallback agent.ProgressCallback,
	assistantMessageID string,
	taskStatus *string,
) (string, string, error) {
	resultMA, errMA := multiagent.RunSingleAgent(
		taskCtx, h.config, &h.config.MultiAgent, h.agent, h.db, h.logger,
		conversationID, h.conversationProjectID(conversationID), finalMessage, history, roleTools, progressCallback, nil, h.agentSessionContextBlock(conversationID),
	)
	if errMA != nil {
		*taskStatus = "failed"
		return h.finalizeRobotAgentError(taskCtx, assistantMessageID, conversationID, resultMA, errMA)
	}
	response, id, err := h.finalizeRobotAgentSuccess(taskCtx, assistantMessageID, conversationID, resultMA)
	*taskStatus = resultMA.Status
	return response, id, err
}

func (h *AgentHandler) runRobotMultiAgentWithRetry(
	taskCtx context.Context,
	conversationID, finalMessage, orchestration string,
	history []agent.ChatMessage,
	roleTools []string,
	progressCallback agent.ProgressCallback,
	assistantMessageID string,
	taskStatus *string,
) (string, string, error) {
	resultMA, errMA := multiagent.RunMultiAgent(
		taskCtx, h.config, &h.config.MultiAgent, h.agent, h.db, h.logger,
		conversationID, h.conversationProjectID(conversationID), finalMessage, history, roleTools, progressCallback,
		h.agentsMarkdownDir, orchestration, nil, h.agentSessionContextBlock(conversationID),
	)
	if errMA != nil {
		*taskStatus = "failed"
		return h.finalizeRobotAgentError(taskCtx, assistantMessageID, conversationID, resultMA, errMA)
	}
	response, id, err := h.finalizeRobotAgentSuccess(taskCtx, assistantMessageID, conversationID, resultMA)
	*taskStatus = resultMA.Status
	return response, id, err
}

// ProcessMessageForRobot is called by the bots (WeCom / DingTalk / Lark): runs the agent single or multi-agent execution path (including progressCallback and process details), without sending SSE, and returns the full reply at the end
func (h *AgentHandler) ProcessMessageForRobot(ctx context.Context, platform string, principal authctx.Principal, conversationID, message, role, agentMode string) (response string, convID string, err error) {
	ownerUserID := strings.TrimSpace(principal.UserID)
	if ownerUserID == "" {
		return "", "", fmt.Errorf("authenticated robot principal is required")
	}
	if !principal.HasPermission("agent:execute") || !principal.HasPermission("chat:read") || !principal.HasPermission("chat:write") {
		return "", "", fmt.Errorf("Robot account is missing agent:execute, chat:read or chat:write permission")
	}
	ctx = authctx.WithPrincipal(ctx, principal)
	if conversationID == "" {
		title := safeTruncateString(message, 50)
		src := "robot"
		if strings.TrimSpace(platform) != "" {
			src = "robot:" + strings.TrimSpace(platform)
		}
		meta := audit.ConversationCreateMeta(src)
		meta.ProjectID = effectiveProjectID(h.config, "")
		if meta.ProjectID != "" && (!principal.HasPermission("project:read") || !h.db.UserCanAccessResource(ownerUserID, principal.ScopeFor("project:read"), "project", meta.ProjectID)) {
			meta.ProjectID = ""
		}
		conv, createErr := h.db.CreateConversation(title, meta)
		if createErr != nil {
			return "", "", fmt.Errorf("Failed to create conversation: %w", createErr)
		}
		conversationID = conv.ID
		_ = h.db.SetResourceOwner("conversation", conversationID, ownerUserID)
	} else {
		if _, getErr := h.db.GetConversation(conversationID); getErr != nil || !h.db.UserCanAccessResource(ownerUserID, principal.ScopeFor("chat:write"), "conversation", conversationID) {
			return "", "", fmt.Errorf("Conversation not found")
		}
	}

	agentHistoryMessages, err := h.loadHistoryFromAgentTrace(conversationID)
	if err != nil {
		historyMessages, getErr := h.db.GetMessages(conversationID)
		if getErr != nil {
			agentHistoryMessages = []agent.ChatMessage{}
		} else {
			agentHistoryMessages = make([]agent.ChatMessage, 0, len(historyMessages))
			for _, msg := range historyMessages {
				agentHistoryMessages = append(agentHistoryMessages, agent.ChatMessage{Role: msg.Role, Content: msg.Content})
			}
		}
	}

	finalMessage := message
	var roleTools []string
	if role != "" && !config.IsDefaultRole(role) && h.config.Roles != nil {
		if r, exists := h.config.Roles[role]; exists && r.Enabled {
			if r.UserPrompt != "" {
				finalMessage = r.UserPrompt + "\n\n" + message
			}
			roleTools = r.Tools
		}
	}

	if _, err = h.db.AddMessage(conversationID, "user", message, nil); err != nil {
		return "", "", fmt.Errorf("Failed to save user message: %w", err)
	}

	// Consistent with the agent streaming chat: first create a placeholder assistant message, then use progressCallback to write process details (without sending SSE)
	assistantMsg, err := h.db.AddMessage(conversationID, "assistant", "Processing...", nil)
	if err != nil {
		h.logger.Warn("Bot: failed to create assistant message placeholder", zap.Error(err))
	}
	var assistantMessageID string
	if assistantMsg != nil {
		assistantMessageID = assistantMsg.ID
	}

	// Register the running task and mirror progress events to taskEventBus, so the Web task-events endpoint can backfill the stream.
	taskCtx, cancelWithCause := context.WithCancelCause(ctx)
	defer cancelWithCause(nil)
	taskStatus := "completed"
	var taskRunID string
	defer func() {
		if taskRunID == "" {
			return
		}
		if cleanupErr := h.tasks.FinishTaskRun(conversationID, taskRunID, taskStatus); cleanupErr != nil {
			err = errors.Join(err, cleanupErr)
		}
	}()
	if startedTask, err := h.tasks.StartTask(conversationID, message, cancelWithCause); err != nil {
		if errors.Is(err, ErrTaskAlreadyRunning) {
			return "", conversationID, fmt.Errorf("A task is already running in this conversation, please try again later")
		}
		return "", conversationID, fmt.Errorf("Cannot start task: %w", err)
	} else {
		taskRunID = startedTask.RunID
	}
	taskCtx = h.tasks.BindProcessScope(taskCtx, conversationID, taskRunID)
	progressCallback := h.createProgressCallback(taskCtx, cancelWithCause, conversationID, assistantMessageID, nil)

	robotMode := config.NormalizeAgentMode(agentMode)
	if err := h.db.SetConversationAgentMode(conversationID, robotMode); err != nil {
		h.logger.Warn("Bot: failed to update conversation mode", zap.String("conversationId", conversationID), zap.String("agentMode", robotMode), zap.Error(err))
	}
	switch robotMode {
	case "single":
		return h.runRobotAgentSingleWithRetry(taskCtx, conversationID, finalMessage, agentHistoryMessages, roleTools, progressCallback, assistantMessageID, &taskStatus)
	case "deep", "plan_execute", "supervisor":
		if h.config == nil || !h.config.MultiAgent.Enabled {
			taskStatus = "failed"
			return "", conversationID, fmt.Errorf("Robot conversation mode %s requires Agent multi-agent to be enabled", robotMode)
		}
		return h.runRobotMultiAgentWithRetry(taskCtx, conversationID, finalMessage, robotMode, agentHistoryMessages, roleTools, progressCallback, assistantMessageID, &taskStatus)
	}

	taskStatus = "failed"
	return "", conversationID, fmt.Errorf("Unsupported robot agent mode: %s", robotMode)
}

// StreamEvent streaming event
type StreamEvent struct {
	Type    string      `json:"type"`    // conversation, progress, tool_call, tool_result, response, error, cancelled, done
	Message string      `json:"message"` // Display message
	Data    interface{} `json:"data,omitempty"`
}

// publishProgressToTaskEventBus mirrors progress events to taskEventBus (for Web task-events subscribers when there is no HTTP SSE client, such as bots).
func (h *AgentHandler) publishProgressToTaskEventBus(conversationID, eventType, message string, data interface{}) {
	if h == nil || h.taskEventBus == nil || strings.TrimSpace(conversationID) == "" {
		return
	}
	event := StreamEvent{Type: eventType, Message: message, Data: data}
	eventJSON, err := json.Marshal(event)
	if err != nil {
		return
	}
	sseLine := make([]byte, 0, len(eventJSON)+8)
	sseLine = append(sseLine, []byte("data: ")...)
	sseLine = append(sseLine, eventJSON...)
	sseLine = append(sseLine, '\n', '\n')
	h.taskEventBus.Publish(conversationID, sseLine)
}

func isInternalAgentDiagnosticProgress(eventType, message string, data interface{}) bool {
	switch eventType {
	case "model_output_rejected":
		return true
	case "progress":
		m, ok := data.(map[string]interface{})
		if !ok {
			return false
		}
		switch strings.TrimSpace(fmt.Sprint(m["kind"])) {
		case "turn_loop_takeover", "turn_loop_preempted":
			return true
		default:
			return false
		}
	default:
		return false
	}
}

// enrichProgressEventData fills in conversationId and messageId for SSE / taskEventBus events, so the frontend can lazy-load process details.
func enrichProgressEventData(data interface{}, conversationID, assistantMessageID string) interface{} {
	if strings.TrimSpace(conversationID) == "" && strings.TrimSpace(assistantMessageID) == "" {
		return data
	}
	var m map[string]interface{}
	switch v := data.(type) {
	case map[string]interface{}:
		m = make(map[string]interface{}, len(v)+2)
		for k, val := range v {
			m[k] = val
		}
	case nil:
		m = make(map[string]interface{}, 2)
	default:
		m = map[string]interface{}{"payload": data}
	}
	if id := strings.TrimSpace(assistantMessageID); id != "" {
		if existing, ok := m["messageId"]; !ok || strings.TrimSpace(fmt.Sprint(existing)) == "" {
			m["messageId"] = id
		}
	}
	if id := strings.TrimSpace(conversationID); id != "" {
		if existing, ok := m["conversationId"]; !ok || strings.TrimSpace(fmt.Sprint(existing)) == "" {
			m["conversationId"] = id
		}
	}
	return m
}

// createProgressCallback creates the progress callback function, used to save processDetails
// sendEventFunc: optional streaming event send function; if nil, no streaming events are sent
func (h *AgentHandler) createProgressCallback(runCtx context.Context, cancelRun context.CancelCauseFunc, conversationID, assistantMessageID string, sendEventFunc func(eventType, message string, data interface{})) agent.ProgressCallback {
	// Stores the arguments from the tool_call event, for use at tool_result
	toolCallCache := make(map[string]map[string]interface{}) // toolCallId -> arguments
	skillCallCache := make(map[string]string)                // toolCallId -> skillName
	skillToolName := "skill"
	if h.config != nil {
		if customName := strings.TrimSpace(h.config.MultiAgent.Skills.SkillToolName); customName != "" {
			skillToolName = customName
		}
	}

	extractSkillName := func(args map[string]interface{}) string {
		if len(args) == 0 {
			return ""
		}
		for _, key := range []string{"skill_name", "skillName", "name", "skill", "id", "skill_id", "skillId"} {
			if v, ok := args[key]; ok {
				switch vv := v.(type) {
				case string:
					if s := strings.TrimSpace(vv); s != "" {
						return s
					}
				case map[string]interface{}:
					for _, nestedKey := range []string{"name", "id", "skill_name", "skillId"} {
						if nestedV, nestedOK := vv[nestedKey].(string); nestedOK {
							if s := strings.TrimSpace(nestedV); s != "" {
								return s
							}
						}
					}
				}
			}
		}
		return ""
	}
	skillNameFromEvent := func(data map[string]interface{}) string {
		for _, field := range []string{"argumentsObj", "arguments"} {
			args, _ := data[field].(map[string]interface{})
			if name := extractSkillName(args); name != "" {
				return name
			}
		}
		return ""
	}

	// thinking_stream_* (assistant body stream, such as ReAct) and reasoning_chain_stream_* (Agent ReasoningContent):
	// Not persisted one by one; aggregated by streamId, and flushed separately as thinking / reasoning_chain.
	thinkingStreams := make(map[string]*thinkingBuf) // streamId -> buf
	flushedThinking := make(map[string]bool)         // streamId -> flushed
	seenToolCallSigs := make(map[string]string)      // toolCallId -> payload signature
	seenToolResultSigs := make(map[string]string)    // toolCallId -> payload signature

	// progressMu protects the map and aggregation state inside the closure. The Agent parallelRunToolCall calls back concurrently from multiple goroutines
	// progress (ToolInvokeNotifyHolder.Fire → createProgressCallback); an unlocked map would trigger a fatal panic.
	var progressMu sync.Mutex

	// response_start + response_delta: the frontend timeline shows these as "📝 Planning" (monitor.js); individual deltas are not persisted;
	// they are aggregated into a single planning entry written to process_details, so the view matches the live one after a refresh.
	var respPlan responsePlanAgg
	if assistantMessageID != "" {
		h.tasks.SetHitlAssistantMessageID(conversationID, assistantMessageID)
	}
	syncHitlCognition := func() {
		h.syncHitlCognitionFromProgress(conversationID, assistantMessageID, thinkingStreams, &respPlan)
	}
	persistResponsePlan := func(reset bool) {
		if assistantMessageID == "" {
			return
		}
		content := strings.TrimSpace(respPlan.b.String())
		if content == "" {
			if reset {
				respPlan = responsePlanAgg{}
			}
			return
		}
		data := map[string]interface{}{
			"source": "response_stream",
		}
		for k, v := range respPlan.meta {
			data[k] = v
		}
		var err error
		if respPlan.detailID == "" {
			respPlan.detailID, err = h.db.AddProcessDetailWithID(
				assistantMessageID, conversationID, "planning", content, data,
			)
		} else {
			err = h.db.UpdateProcessDetailContent(respPlan.detailID, content, data)
		}
		if err != nil {
			h.logger.Warn("Failed to save process details", zap.Error(err), zap.String("eventType", "planning"))
		} else {
			respPlan.lastPersistAt = time.Now()
			respPlan.lastPersistSize = respPlan.b.Len()
		}
		syncHitlCognition()
		if reset {
			respPlan = responsePlanAgg{}
		}
	}
	flushResponsePlan := func() { persistResponsePlan(true) }

	flushThinkingStreams := func() {
		if assistantMessageID == "" {
			return
		}
		for sid, tb := range thinkingStreams {
			if sid == "" || flushedThinking[sid] || tb == nil {
				continue
			}
			content := strings.TrimSpace(tb.b.String())
			if content == "" {
				flushedThinking[sid] = true
				continue
			}
			data := map[string]interface{}{
				"streamId": sid,
			}
			for k, v := range tb.meta {
				// Avoid overwriting streamId
				if k == "streamId" {
					continue
				}
				data[k] = v
			}
			persist := tb.persistAs
			if persist != "reasoning_chain" {
				persist = "thinking"
			}
			if err := h.db.AddProcessDetail(assistantMessageID, conversationID, persist, content, data); err != nil {
				h.logger.Warn("Failed to save process details", zap.Error(err), zap.String("eventType", persist))
			}
			flushedThinking[sid] = true
		}
		syncHitlCognition()
	}

	return func(eventType, message string, data interface{}) {
		progressMu.Lock()
		defer progressMu.Unlock()

		if isInternalAgentDiagnosticProgress(eventType, message, data) {
			return
		}

		// Upstream may invoke the same tool_call/tool_result callbacks again during retries or compensation.
		// Idempotency filtering here ensures that both the frontend display and process_details treat unique events as the source of truth.
		if (eventType == "tool_call" || eventType == "tool_result") && data != nil {
			if dataMap, ok := data.(map[string]interface{}); ok {
				toolCallID := strings.TrimSpace(fmt.Sprint(dataMap["toolCallId"]))
				if toolCallID != "" && toolCallID != "<nil>" {
					payloadJSON, _ := json.Marshal(dataMap)
					sig := eventType + "|" + message + "|" + string(payloadJSON)
					seen := seenToolCallSigs
					if eventType == "tool_result" {
						seen = seenToolResultSigs
					}
					if prev, exists := seen[toolCallID]; exists && prev == sig {
						h.logger.Debug("Skipped duplicate tool progress event",
							zap.String("eventType", eventType),
							zap.String("toolCallId", toolCallID))
						return
					}
					seen[toolCallID] = sig
				}
			}
		}

		// Tool output fragments are not shown live in the detail area; the full result is fetched on demand after tool_result is persisted.
		if eventType == "tool_result_delta" {
			return
		}

		deferToolProgressSend := eventType == "tool_call" || eventType == "tool_result"
		// The main HTTP SSE and taskEventBus must both be written: a page refresh cuts the original connection, and
		// subscribing to GET task-events after the refresh depends on eventBus to keep receiving later iterations. Bots and other sources without a main SSE
		// likewise write only to eventBus. Tool events must first be persisted to obtain a processDetailId before the summary is sent.
		if !deferToolProgressSend {
			clientData := enrichProgressEventData(data, conversationID, assistantMessageID)
			if sendEventFunc != nil {
				sendEventFunc(eventType, message, clientData)
			}
			h.publishProgressToTaskEventBus(conversationID, eventType, message, clientData)
		}

		// Save the arguments from the tool_call event
		if eventType == "tool_call" {
			if dataMap, ok := data.(map[string]interface{}); ok {
				toolName, _ := dataMap["toolName"].(string)
				if toolName == builtin.ToolSearchKnowledgeBase {
					if toolCallId, ok := dataMap["toolCallId"].(string); ok && toolCallId != "" {
						if argumentsObj, ok := dataMap["argumentsObj"].(map[string]interface{}); ok {
							toolCallCache[toolCallId] = argumentsObj
						}
					}
				}
				if strings.EqualFold(strings.TrimSpace(toolName), skillToolName) {
					toolCallID, _ := dataMap["toolCallId"].(string)
					if toolCallID != "" {
						if skillName := skillNameFromEvent(dataMap); skillName != "" {
							skillCallCache[toolCallID] = skillName
						}
					}
				}
			}
		}

		if eventType == "tool_result" {
			if dataMap, ok := data.(map[string]interface{}); ok {
				toolName, _ := dataMap["toolName"].(string)
				toolCallID, _ := dataMap["toolCallId"].(string)
				success := true
				if v, ok := dataMap["success"].(bool); ok {
					success = v
				}
				resultText := ""
				if r, ok := dataMap["result"].(string); ok {
					resultText = r
				}
				if strings.TrimSpace(resultText) == "" {
					resultText = message
				}
				h.recordHitlToolExecutionResult(conversationID, toolCallID, toolName, success, resultText)
			}
		}

		// Handle knowledge retrieval log recording
		if eventType == "tool_result" && h.knowledgeManager != nil {
			if dataMap, ok := data.(map[string]interface{}); ok {
				toolName, _ := dataMap["toolName"].(string)
				if toolName == builtin.ToolSearchKnowledgeBase {
					// Extract retrieval information
					query := ""
					riskType := ""
					var retrievedItems []string

					// First try to get the arguments from the tool_call cache
					if toolCallId, ok := dataMap["toolCallId"].(string); ok && toolCallId != "" {
						if cachedArgs, exists := toolCallCache[toolCallId]; exists {
							if q, ok := cachedArgs["query"].(string); ok && q != "" {
								query = q
							}
							if rt, ok := cachedArgs["risk_type"].(string); ok && rt != "" {
								riskType = rt
							}
							// Clear the cache after use
							delete(toolCallCache, toolCallId)
						}
					}

					// If not in the cache, try to extract them from argumentsObj
					if query == "" {
						if arguments, ok := dataMap["argumentsObj"].(map[string]interface{}); ok {
							if q, ok := arguments["query"].(string); ok && q != "" {
								query = q
							}
							if rt, ok := arguments["risk_type"].(string); ok && rt != "" {
								riskType = rt
							}
						}
					}

					// If the query is still empty, try to extract it from the result (from the first line of the result text)
					if query == "" {
						if result, ok := dataMap["result"].(string); ok && result != "" {
							// Try to extract the query from the result (if the result contains the not-found message for query 'xxx')
							if strings.Contains(result, "No knowledge found for query '") {
								start := strings.Index(result, "No knowledge found for query '") + len("No knowledge found for query '")
								end := strings.Index(result[start:], "'")
								if end > 0 {
									query = result[start : start+end]
								}
							}
						}
						// If still empty, use the default value
						if query == "" {
							query = "Unknown query"
						}
					}

					// Extract the retrieved knowledge item IDs from the tool result
					// Result format: "Found X related knowledge items:\n\n--- Result 1 (similarity: XX.XX%) ---\nSource: [category] title\n...\n<!-- METADATA: {...} -->"
					if result, ok := dataMap["result"].(string); ok && result != "" {
						// Try to extract the knowledge item ID from the metadata
						metadataMatch := strings.Index(result, "<!-- METADATA:")
						if metadataMatch > 0 {
							// Extract the metadata JSON
							metadataStart := metadataMatch + len("<!-- METADATA: ")
							metadataEnd := strings.Index(result[metadataStart:], " -->")
							if metadataEnd > 0 {
								metadataJSON := result[metadataStart : metadataStart+metadataEnd]
								var metadata map[string]interface{}
								if err := json.Unmarshal([]byte(metadataJSON), &metadata); err == nil {
									if meta, ok := metadata["_metadata"].(map[string]interface{}); ok {
										if ids, ok := meta["retrievedItemIDs"].([]interface{}); ok {
											retrievedItems = make([]string, 0, len(ids))
											for _, id := range ids {
												if idStr, ok := id.(string); ok {
													retrievedItems = append(retrievedItems, idStr)
												}
											}
										}
									}
								}
							}
						}

						// If nothing was extracted from the metadata, but the result contains "found X items", at least mark it as having results
						if len(retrievedItems) == 0 && strings.Contains(result, "Found ") && !strings.Contains(result, "No knowledge found") {
							// There are results but the ID cannot be extracted accurately; use a special marker
							retrievedItems = []string{"_has_results"}
						}
					}

					// Record the retrieval log (asynchronous, non-blocking)
					go func() {
						if err := h.knowledgeManager.LogRetrieval(conversationID, assistantMessageID, query, riskType, retrievedItems); err != nil {
							h.logger.Warn("Failed to record knowledge retrieval log", zap.Error(err))
						}
					}()

					// Add the knowledge retrieval event to processDetails
					if assistantMessageID != "" {
						retrievalData := map[string]interface{}{
							"query":    query,
							"riskType": riskType,
							"toolName": toolName,
						}
						if err := h.db.AddProcessDetail(assistantMessageID, conversationID, "knowledge_retrieval", fmt.Sprintf("Knowledge retrieval: %s", query), retrievalData); err != nil {
							h.logger.Warn("Failed to save knowledge retrieval details", zap.Error(err))
						}
					}
				}
			}
		}

		// Record skills call statistics (associating tool_call with tool_result)
		if eventType == "tool_result" && h.db != nil {
			if dataMap, ok := data.(map[string]interface{}); ok {
				toolName, _ := dataMap["toolName"].(string)
				if strings.EqualFold(strings.TrimSpace(toolName), skillToolName) {
					toolCallID, _ := dataMap["toolCallId"].(string)
					skillName := ""
					if toolCallID != "" {
						skillName = strings.TrimSpace(skillCallCache[toolCallID])
						delete(skillCallCache, toolCallID)
					}
					if skillName == "" {
						skillName = skillNameFromEvent(dataMap)
					}
					if skillName != "" {
						success, ok := dataMap["success"].(bool)
						if !ok {
							if isError, okErr := dataMap["isError"].(bool); okErr {
								success = !isError
							}
						}
						successCalls := 0
						failedCalls := 0
						if success {
							successCalls = 1
						} else {
							failedCalls = 1
						}
						now := time.Now()
						if err := h.db.UpdateSkillStats(skillName, 1, successCalls, failedCalls, &now); err != nil {
							h.logger.Warn("Failed to update skill call statistics", zap.Error(err), zap.String("skill", skillName))
						}
					}
				}
			}
		}

		// Incremental streaming of sub-agent replies is not persisted; when it ends, they are merged into a single agent_reply
		if assistantMessageID != "" && eventType == "agent_reply_stream_end" {
			flushResponsePlan()
			// Ensure the thinking stream is persisted before the sub-agent reply (so it is readable after a refresh)
			flushThinkingStreams()
			if err := h.db.AddProcessDetail(assistantMessageID, conversationID, "agent_reply", message, data); err != nil {
				h.logger.Warn("Failed to save process details", zap.Error(err), zap.String("eventType", eventType))
			}
			return
		}

		// Multi-agent main agent "planning": response_start / response_delta are used only for SSE; aggregated into a single planning entry
		if eventType == "response_start" {
			if dataMap, ok := data.(map[string]interface{}); ok {
				if sameResponseStreamMeta(respPlan.meta, dataMap) {
					if respPlan.meta == nil {
						respPlan.meta = make(map[string]interface{}, len(dataMap))
					}
					for k, v := range dataMap {
						respPlan.meta[k] = v
					}
					return
				}
			}
			flushResponsePlan()
			// Before the assistant body starts, the reasoning stream has usually ended; persist it so the penetration testing details can be replayed after a refresh
			flushThinkingStreams()
			respPlan.meta = nil
			if dataMap, ok := data.(map[string]interface{}); ok {
				respPlan.meta = make(map[string]interface{}, len(dataMap))
				for k, v := range dataMap {
					respPlan.meta[k] = v
				}
			}
			respPlan.b.Reset()
			return
		}
		if eventType == "response_delta" {
			if dataMap, ok := data.(map[string]interface{}); ok {
				if acc, okAcc := dataMap[openai.SSEAccumulatedKey].(string); okAcc {
					respPlan.b.Reset()
					respPlan.b.WriteString(acc)
				} else {
					respPlan.b.WriteString(message)
				}
			} else {
				respPlan.b.WriteString(message)
			}
			if dataMap, ok := data.(map[string]interface{}); ok && respPlan.meta == nil {
				respPlan.meta = make(map[string]interface{}, len(dataMap))
				for k, v := range dataMap {
					respPlan.meta[k] = v
				}
			} else if dataMap, ok := data.(map[string]interface{}); ok {
				for k, v := range dataMap {
					respPlan.meta[k] = v
				}
			}
			// A running main reply cannot be kept only in memory: a refresh destroys the old page, and the new task-events
			// subscription can only receive future increments. Throttle updates to the same planning record by time or increment size,
			// so that a refresh can restore all the text that was already displayed before it from the database.
			if respPlan.lastPersistAt.IsZero() ||
				time.Since(respPlan.lastPersistAt) >= 300*time.Millisecond ||
				respPlan.b.Len()-respPlan.lastPersistSize >= 1024 {
				persistResponsePlan(false)
			}
			syncHitlCognition()
			return
		}
		if eventType == "response" {
			flushResponsePlan()
			flushThinkingStreams()
			return
		}
		if eventType == "done" {
			flushResponsePlan()
			flushThinkingStreams()
			return
		}

		// Streaming thinking/reasoning ended: aggregate and persist (same reasoning as agent_reply_stream_end)
		if eventType == "thinking_stream_end" || eventType == "reasoning_chain_stream_end" {
			flushResponsePlan()
			flushThinkingStreams()
			return
		}

		// Aggregate thinking_stream_* / reasoning_chain_stream_*, not persisted one by one
		if eventType == "thinking_stream_start" || eventType == "reasoning_chain_stream_start" {
			persistAs := "thinking"
			if eventType == "reasoning_chain_stream_start" {
				persistAs = "reasoning_chain"
			}
			if dataMap, ok := data.(map[string]interface{}); ok {
				if sid, ok2 := dataMap["streamId"].(string); ok2 && sid != "" {
					tb := thinkingStreams[sid]
					if tb == nil {
						tb = &thinkingBuf{meta: map[string]interface{}{}, persistAs: persistAs}
						thinkingStreams[sid] = tb
					} else {
						tb.persistAs = persistAs
					}
					// Record metadata (source/agentName/agentRole/iteration, etc.)
					for k, v := range dataMap {
						tb.meta[k] = v
					}
				}
			}
			return
		}
		if eventType == "thinking_stream_delta" || eventType == "reasoning_chain_stream_delta" {
			persistAs := "thinking"
			if eventType == "reasoning_chain_stream_delta" {
				persistAs = "reasoning_chain"
			}
			if dataMap, ok := data.(map[string]interface{}); ok {
				if sid, ok2 := dataMap["streamId"].(string); ok2 && sid != "" {
					tb := thinkingStreams[sid]
					if tb == nil {
						tb = &thinkingBuf{meta: map[string]interface{}{}, persistAs: persistAs}
						thinkingStreams[sid] = tb
					} else if tb.persistAs == "" {
						tb.persistAs = persistAs
					}
					if acc, okAcc := dataMap[openai.SSEAccumulatedKey].(string); okAcc {
						tb.b.Reset()
						tb.b.WriteString(acc)
					} else {
						tb.b.WriteString(message)
					}
					// Sometimes the delta arrives before the start, so supplement the metadata
					for k, v := range dataMap {
						tb.meta[k] = v
					}
				}
			}
			syncHitlCognition()
			return
		}

		// When an Agent sends both *_stream_* and thinking/reasoning_chain with the same streamId,
		// the stream aggregation is already persisted by flushThinkingStreams(); skip the duplicate per-item write here.
		if eventType == "thinking" || eventType == "reasoning_chain" {
			if dataMap, ok := data.(map[string]interface{}); ok {
				if sid, ok2 := dataMap["streamId"].(string); ok2 && sid != "" {
					if tb, exists := thinkingStreams[sid]; exists && tb != nil {
						if strings.TrimSpace(tb.b.String()) != "" {
							return
						}
					}
					if flushedThinking[sid] {
						return
					}
				}
			}
		}

		// Save process details to the database (excluding response/done; the response body is already in the messages table)
		// response_start/response_delta have already been aggregated into planning and are not persisted individually.
		// [Agent] agent heartbeat progress is used only for the live progress title; it is not persisted, to avoid flooding the timeline.
		skipAgentAgentHeartbeat := eventType == "progress" && strings.HasPrefix(strings.TrimSpace(message), "[Agent] ")
		if assistantMessageID != "" &&
			!skipAgentAgentHeartbeat &&
			eventType != "response" &&
			eventType != "done" &&
			eventType != "response_start" &&
			eventType != "response_delta" &&
			eventType != "tool_result_delta" &&
			eventType != "agent_trace_run" &&
			eventType != "agent_trace_start" &&
			eventType != "agent_trace_end" &&
			eventType != "agent_trace_error" &&
			eventType != "agent_reply_stream_start" &&
			eventType != "agent_reply_stream_delta" &&
			eventType != "agent_reply_stream_end" {
			if eventType == "tool_result" {
				if detailID := discardPlanningIfEchoesToolResult(&respPlan, data); detailID != "" {
					if err := h.db.DeleteProcessDetail(detailID); err != nil {
						h.logger.Warn("Failed to delete tool result echo plan", zap.Error(err), zap.String("processDetailId", detailID))
					}
				}
			}
			// Before persisting key process events, first persist the "planning" stream and the aggregated thinking / reasoning_chain streams
			flushResponsePlan()
			flushThinkingStreams()
			processDetailID, err := h.db.AddProcessDetailWithID(assistantMessageID, conversationID, eventType, message, data)
			if err != nil {
				h.logger.Warn("Failed to save process details", zap.Error(err), zap.String("eventType", eventType))
			}
			if deferToolProgressSend {
				clientData := enrichProgressEventData(summarizeProcessDetailData(eventType, data), conversationID, assistantMessageID)
				if m, ok := clientData.(map[string]interface{}); ok {
					m["processDetailId"] = processDetailID
				}
				if sendEventFunc != nil {
					sendEventFunc(eventType, message, clientData)
				}
				h.publishProgressToTaskEventBus(conversationID, eventType, message, clientData)
			}
		} else if deferToolProgressSend {
			clientData := enrichProgressEventData(summarizeProcessDetailData(eventType, data), conversationID, assistantMessageID)
			if sendEventFunc != nil {
				sendEventFunc(eventType, message, clientData)
			}
			h.publishProgressToTaskEventBus(conversationID, eventType, message, clientData)
		}
	}
}

// cancelToolContinueAfter terminates only the current tool call, not the whole Agent task (shared by the conversation's "interrupt and continue" and MCP monitoring termination).
func (h *AgentHandler) cancelToolContinueAfter(conversationID, preferredExecID, note string) (bool, gin.H) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || h.tasks.GetTask(conversationID) == nil {
		return false, nil
	}
	note = strings.TrimSpace(note)
	execID := strings.TrimSpace(preferredExecID)
	if execID == "" {
		execID = h.tasks.ActiveMCPExecutionID(conversationID)
	}
	if execID != "" {
		if h.agent.CancelMCPToolExecutionWithNote(execID, note) {
			return true, gin.H{
				"status":              "tool_abort_requested",
				"conversationId":      conversationID,
				"executionId":         execID,
				"message":             "Termination of the current tool call has been requested; reasoning for this turn will continue after the tool returns (same as terminating from the MCP monitor page).",
				"continueAfter":       true,
				"interruptWithNote":   note != "",
				"continueWithoutTool": false,
			}
		}
		if h.tasks.AbortActiveAgentExecute(conversationID, note) {
			return true, gin.H{
				"status":              "tool_abort_requested",
				"conversationId":      conversationID,
				"executionId":         execID,
				"message":             "Termination of the current execute command has been requested; reasoning for this turn will continue after the command returns.",
				"continueAfter":       true,
				"interruptWithNote":   note != "",
				"continueWithoutTool": false,
			}
		}
		return false, nil
	}
	if h.tasks.AbortActiveAgentExecute(conversationID, note) {
		return true, gin.H{
			"status":              "tool_abort_requested",
			"conversationId":      conversationID,
			"message":             "Termination of the current execute command has been requested; reasoning for this turn will continue after the command returns.",
			"continueAfter":       true,
			"interruptWithNote":   note != "",
			"continueWithoutTool": false,
		}
	}
	return false, nil
}

// CancelAgentLoop cancels a running task
func (h *AgentHandler) CancelAgentLoop(c *gin.Context) {
	var req struct {
		ConversationID string `json:"conversationId" binding:"required"`
		ExecutionID    string `json:"executionId,omitempty"`
		Reason         string `json:"reason,omitempty"`
		ContinueAfter  bool   `json:"continueAfter,omitempty"`
	}

	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !h.agentConversationAllowed(c, req.ConversationID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You do not have access to this resource"})
		return
	}

	if req.ContinueAfter {
		if h.tasks.GetTask(req.ConversationID) == nil {
			c.JSON(http.StatusNotFound, gin.H{"error": "No running task found"})
			return
		}
		note := strings.TrimSpace(req.Reason)
		activeExec := strings.TrimSpace(h.tasks.ActiveMCPExecutionID(req.ConversationID))
		if ok, payload := h.cancelToolContinueAfter(req.ConversationID, strings.TrimSpace(req.ExecutionID), note); ok {
			execID, _ := payload["executionId"].(string)
			h.logger.Info("Conversation page terminates only the current tool",
				zap.String("conversationId", req.ConversationID),
				zap.String("executionId", execID),
				zap.Bool("hasNote", note != ""),
			)
			c.JSON(http.StatusOK, payload)
			return
		}
		if activeExec != "" {
			c.JSON(http.StatusNotFound, gin.H{"error": "No in-progress tool execution found, or the call has already finished"})
			return
		}
		// No MCP tool in progress (the model is purely reasoning or streaming output): cancel the current context, and the Agent streaming handler merges the user's supplement and resumes automatically.
		h.tasks.SetInterruptContinueNote(req.ConversationID, note)
		ok, err := h.tasks.CancelTask(req.ConversationID, multiagent.ErrInterruptContinue)
		if err != nil {
			h.logger.Error("Interrupt and continue (no tool) failed", zap.Error(err))
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
			return
		}
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "No running task found"})
			return
		}
		h.logger.Info("Conversation page interrupt and continue (no MCP tool, will auto-resume)",
			zap.String("conversationId", req.ConversationID),
			zap.Bool("hasNote", note != ""),
		)
		c.JSON(http.StatusOK, gin.H{
			"status":              "interrupt_continue_scheduled",
			"conversationId":      req.ConversationID,
			"message":             "Pausing the current reasoning has been requested; user additions will be merged into the context and execution will continue automatically (no need to stop the whole turn).",
			"continueAfter":       true,
			"interruptWithNote":   note != "",
			"continueWithoutTool": true,
		})
		return
	}

	var cause error = ErrTaskCancelled
	msg := "Cancel request submitted; the task will stop after the current step completes."
	h.cancelRunningMCPToolsForConversation(req.ConversationID)
	h.tasks.AbortActiveAgentExecute(req.ConversationID, "")
	ok, err := h.tasks.CancelTask(req.ConversationID, cause)
	if errors.Is(err, security.ErrCleanupUnconfirmed) {
		msg = taskCleanupMessage(err)
	} else if err != nil {
		h.logger.Error("Failed to cancel task", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "No running task found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{
		"status":            "cancelling",
		"conversationId":    req.ConversationID,
		"message":           msg,
		"continueAfter":     false,
		"interruptWithNote": false,
	})
}

// SubscribeAgentTaskEvents GET SSE: subscribes to the event mirror of the tasks currently running in the specified session (frame format identical to POST .../stream), used to resume the UI after a page refresh or disconnection.
func (h *AgentHandler) SubscribeAgentTaskEvents(c *gin.Context) {
	conversationID := strings.TrimSpace(c.Query("conversationId"))
	if conversationID == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "conversationId is required"})
		return
	}
	if !h.agentConversationAllowed(c, conversationID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "You do not have access to this resource"})
		return
	}
	if h.tasks.GetTask(conversationID) == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "no active task for this conversation"})
		return
	}
	if h.taskEventBus == nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "task event bus unavailable"})
		return
	}

	c.Header("Content-Type", "text/event-stream; charset=utf-8")
	c.Header("Cache-Control", "no-cache")
	c.Header("Connection", "keep-alive")
	c.Header("X-Accel-Buffering", "no")

	lang := apimsg.Lang(c)
	sub, ch := h.taskEventBus.Subscribe(conversationID)
	defer h.taskEventBus.Unsubscribe(conversationID, sub)

	flusher, _ := c.Writer.(http.Flusher)
	ctx := c.Request.Context()
	var writeMu sync.Mutex
	stopKeepalive := runSSEKeepalive(c, &writeMu)
	defer stopKeepalive()

	for {
		select {
		case <-ctx.Done():
			return
		case chunk, ok := <-ch:
			if !ok {
				return
			}
			writeMu.Lock()
			if _, err := c.Writer.Write(apimsg.TranslateSSE(lang, chunk)); err != nil {
				writeMu.Unlock()
				return
			}
			if flusher != nil {
				flusher.Flush()
			}
			writeMu.Unlock()
		}
	}
}

// enrichAgentTasksWithConversationTitles attaches the current conversation title to the task list (for display in the top bar and task page; synced automatically after a rename)
func (h *AgentHandler) enrichAgentTasksWithConversationTitles(tasks []*AgentTask) {
	if h == nil || h.db == nil {
		return
	}
	for _, task := range tasks {
		if task == nil || strings.TrimSpace(task.ConversationID) == "" {
			continue
		}
		if title, err := h.db.GetConversationTitle(task.ConversationID); err == nil {
			task.Title = strings.TrimSpace(title)
		}
	}
}

// enrichCompletedTasksWithConversationTitles attaches the current conversation title to completed tasks
func (h *AgentHandler) enrichCompletedTasksWithConversationTitles(tasks []*CompletedTask) {
	if h == nil || h.db == nil {
		return
	}
	for _, task := range tasks {
		if task == nil || strings.TrimSpace(task.ConversationID) == "" {
			continue
		}
		if title, err := h.db.GetConversationTitle(task.ConversationID); err == nil {
			task.Title = strings.TrimSpace(title)
		}
	}
}

// ListAgentTasks lists all running tasks
func (h *AgentHandler) ListAgentTasks(c *gin.Context) {
	tasks := h.tasks.GetActiveTasks()
	tasks = filterSlice(tasks, func(task *AgentTask) bool {
		return task != nil && h.agentConversationAllowed(c, task.ConversationID)
	})
	h.enrichAgentTasksWithConversationTitles(tasks)
	c.JSON(http.StatusOK, gin.H{
		"tasks": tasks,
	})
}

// ListCompletedTasks lists the history of recently completed tasks
func (h *AgentHandler) ListCompletedTasks(c *gin.Context) {
	tasks := h.tasks.GetCompletedTasks()
	tasks = filterSlice(tasks, func(task *CompletedTask) bool {
		return task != nil && h.agentConversationAllowed(c, task.ConversationID)
	})
	h.enrichCompletedTasksWithConversationTitles(tasks)
	c.JSON(http.StatusOK, gin.H{
		"tasks": tasks,
	})
}

func (h *AgentHandler) agentConversationAllowed(c *gin.Context, conversationID string) bool {
	session, ok := security.CurrentSession(c)
	return ok && h.db != nil && h.db.UserCanAccessResource(session.UserID, session.Scope, "conversation", strings.TrimSpace(conversationID))
}

func filterSlice[T any](items []T, keep func(T) bool) []T {
	out := make([]T, 0, len(items))
	for _, item := range items {
		if keep(item) {
			out = append(out, item)
		}
	}
	return out
}

// BatchTaskRequest batch task request
type BatchTaskRequest struct {
	HITLPolicy   string   `json:"hitlPolicy"`
	Title        string   `json:"title"`                    // Task title (optional)
	Tasks        []string `json:"tasks" binding:"required"` // Task list, one task per line
	Role         string   `json:"role,omitempty"`           // Role name (optional; an empty string means the default role)
	AgentMode    string   `json:"agentMode,omitempty"`      // single | deep | plan_execute | supervisor
	ScheduleMode string   `json:"scheduleMode,omitempty"`   // manual | cron
	CronExpr     string   `json:"cronExpr,omitempty"`       // Required when scheduleMode=cron
	ExecuteNow   bool     `json:"executeNow,omitempty"`     // Whether to run immediately after creation (default false)
	ProjectID    string   `json:"projectId,omitempty"`      // Project bound to the sub-conversations in the queue (optional)
	Concurrency  int      `json:"concurrency,omitempty"`    // Number of sub-tasks executed concurrently; default 1, maximum 8
}

// batchQueueWantsAgent reports whether the queue is configured to run through the Agent multi-agent path.
func batchQueueWantsAgent(agentMode string) bool {
	m := strings.TrimSpace(strings.ToLower(agentMode))
	return m == "deep" || m == "plan_execute" || m == "supervisor"
}

func normalizeBatchQueueScheduleMode(mode string) string {
	if strings.TrimSpace(mode) == "cron" {
		return "cron"
	}
	return "manual"
}

// CreateBatchQueue creates a batch task queue
func (h *AgentHandler) CreateBatchQueue(c *gin.Context) {
	var req BatchTaskRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	if len(req.Tasks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task list is required"})
		return
	}

	// Filter out empty tasks
	validTasks := make([]string, 0, len(req.Tasks))
	for _, task := range req.Tasks {
		if task != "" {
			validTasks = append(validTasks, task)
		}
	}

	if len(validTasks) == 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "No valid tasks"})
		return
	}
	if session, ok := security.CurrentSession(c); ok && h.db != nil && session.Scope != database.RBACScopeAll && strings.TrimSpace(req.ProjectID) != "" {
		if !h.db.UserCanAccessResource(session.UserID, session.Scope, "project", strings.TrimSpace(req.ProjectID)) {
			c.JSON(http.StatusForbidden, gin.H{"error": "You do not have permission to create batch tasks in this project"})
			return
		}
	}

	agentMode := config.NormalizeAgentMode(req.AgentMode)
	scheduleMode := normalizeBatchQueueScheduleMode(req.ScheduleMode)
	cronExpr := strings.TrimSpace(req.CronExpr)
	var nextRunAt *time.Time
	if scheduleMode == "cron" {
		if cronExpr == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The schedule expression is required when Cron scheduling is enabled"})
			return
		}
		schedule, err := h.batchCronParser.Parse(cronExpr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cron expression: " + err.Error()})
			return
		}
		next := schedule.Next(time.Now())
		nextRunAt = &next
	}

	queue, createErr := h.batchTaskManager.CreateBatchQueue(req.Title, req.Role, agentMode, scheduleMode, cronExpr, req.ProjectID, nextRunAt, req.Concurrency, validTasks, req.HITLPolicy)
	if createErr != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": createErr.Error()})
		return
	}
	if session, ok := security.CurrentSession(c); ok && h.db != nil {
		_ = h.db.SetResourceOwner("batch_task", queue.ID, session.UserID)
		_ = h.db.AssignResourceToUser(session.UserID, "batch_task", queue.ID)
	}
	started := false
	if req.ExecuteNow {
		ok, err := h.startBatchQueueExecution(queue.ID, false)
		if !ok {
			c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
			return
		}
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": err.Error(), "queueId": queue.ID})
			return
		}
		started = true
		if refreshed, exists := h.batchTaskManager.GetBatchQueue(queue.ID); exists {
			queue = refreshed
		}
	}
	if h.audit != nil {
		h.audit.RecordOK(c, "task", "create_queue", "Create batch task queue", "batch_queue", queue.ID, map[string]interface{}{
			"task_count": len(validTasks), "started": started,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"queueId": queue.ID,
		"queue":   queue,
		"started": started,
	})
}

// GetBatchQueue gets a batch task queue
func (h *AgentHandler) GetBatchQueue(c *gin.Context) {
	queueID := c.Param("queueId")
	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"queue": queue})
}

// ListBatchQueuesResponse batch task queue list response
type ListBatchQueuesResponse struct {
	Queues     []*BatchTaskQueue `json:"queues"`
	Total      int               `json:"total"`
	Page       int               `json:"page"`
	PageSize   int               `json:"page_size"`
	TotalPages int               `json:"total_pages"`
}

// ListBatchQueues lists all batch task queues (supports filtering and pagination)
func (h *AgentHandler) ListBatchQueues(c *gin.Context) {
	limitStr := c.DefaultQuery("limit", "10")
	offsetStr := c.DefaultQuery("offset", "0")
	pageStr := c.Query("page")
	status := c.Query("status")
	keyword := c.Query("keyword")

	limit, _ := strconv.Atoi(limitStr)
	offset, _ := strconv.Atoi(offsetStr)
	page := 1

	// If the page parameter is provided, prefer it for calculating the offset
	if pageStr != "" {
		if p, err := strconv.Atoi(pageStr); err == nil && p > 0 {
			page = p
			offset = (page - 1) * limit
		}
	}

	// Limit the pageSize range
	if limit <= 0 || limit > 100 {
		limit = 10
	}
	if offset < 0 {
		offset = 0
	}
	// Prevent a malicious large offset from causing DB performance problems
	const maxOffset = 100000
	if offset > maxOffset {
		offset = maxOffset
	}

	// Default status is "all"
	if status == "" {
		status = "all"
	}

	// Get the queue list and total count
	session, _ := security.CurrentSession(c)
	queues, total, err := h.batchTaskManager.ListQueuesForAccess(limit, offset, status, keyword, session.UserID, session.Scope)
	if err != nil {
		h.logger.Error("Failed to get batch task queue list", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		return
	}

	// Calculate the total number of pages
	totalPages := (total + limit - 1) / limit
	if totalPages == 0 {
		totalPages = 1
	}

	// If the page was calculated from the offset, recalculate it
	if pageStr == "" {
		page = (offset / limit) + 1
	}

	response := ListBatchQueuesResponse{
		Queues:     queues,
		Total:      total,
		Page:       page,
		PageSize:   limit,
		TotalPages: totalPages,
	}

	c.JSON(http.StatusOK, response)
}

// StartBatchQueue starts executing a batch task queue
func (h *AgentHandler) StartBatchQueue(c *gin.Context) {
	queueID := c.Param("queueId")
	h.batchTaskManager.ClearSingleRunTask(queueID)
	ok, err := h.startBatchQueueExecution(queueID, false)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	if h.audit != nil {
		h.audit.RecordOK(c, "task", "start_queue", "Start batch task queue", "batch_queue", queueID, nil)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Batch tasks have started", "queueId": queueID})
}

// RerunBatchQueue reruns a batch task queue (re-executes after resetting all sub-tasks)
func (h *AgentHandler) RerunBatchQueue(c *gin.Context) {
	queueID := c.Param("queueId")
	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	if queue.Status != "completed" && queue.Status != "cancelled" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Only completed or cancelled queues can be rerun"})
		return
	}
	if !h.batchTaskManager.ResetQueueForRerun(queueID) {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to reset queue"})
		return
	}
	h.batchTaskManager.ClearSingleRunTask(queueID)
	ok, err := h.startBatchQueueExecution(queueID, false)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !ok {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to start"})
		return
	}
	if h.audit != nil {
		h.audit.RecordOK(c, "task", "rerun_queue", "Rerun batch task queue", "batch_queue", queueID, nil)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Batch tasks have restarted", "queueId": queueID})
}

// PauseBatchQueue pauses a batch task queue
func (h *AgentHandler) PauseBatchQueue(c *gin.Context) {
	queueID := c.Param("queueId")
	success := h.batchTaskManager.PauseQueue(queueID)
	if !success {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found or cannot be paused"})
		return
	}
	if h.audit != nil {
		h.audit.RecordOK(c, "task", "pause_queue", "Pause batch task queue", "batch_queue", queueID, nil)
	}
	c.JSON(http.StatusOK, gin.H{"message": "Batch tasks have been paused"})
}

// UpdateBatchQueueMetadata modifies the title, role and agent mode of a batch task queue
func (h *AgentHandler) UpdateBatchQueueMetadata(c *gin.Context) {
	queueID := c.Param("queueId")
	var req struct {
		HITLPolicy  *string `json:"hitlPolicy"`
		Title       string  `json:"title"`
		Role        string  `json:"role"`
		AgentMode   string  `json:"agentMode"`
		Concurrency *int    `json:"concurrency"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	var policies []string
	if req.HITLPolicy != nil {
		policies = append(policies, *req.HITLPolicy)
	}
	if err := h.batchTaskManager.UpdateQueueMetadata(queueID, req.Title, req.Role, req.AgentMode, req.Concurrency, policies...); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	updated, _ := h.batchTaskManager.GetBatchQueue(queueID)
	c.JSON(http.StatusOK, gin.H{"queue": updated})
}

// UpdateBatchQueueSchedule modifies the schedule configuration (scheduleMode / cronExpr) of a batch task queue
func (h *AgentHandler) UpdateBatchQueueSchedule(c *gin.Context) {
	queueID := c.Param("queueId")
	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	// Schedule changes are allowed only when the queue is not running
	if queue.Status == "running" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The queue is running; the schedule configuration cannot be modified"})
		return
	}
	var req struct {
		ScheduleMode string `json:"scheduleMode"`
		CronExpr     string `json:"cronExpr"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	scheduleMode := normalizeBatchQueueScheduleMode(req.ScheduleMode)
	cronExpr := strings.TrimSpace(req.CronExpr)
	var nextRunAt *time.Time
	if scheduleMode == "cron" {
		if cronExpr == "" {
			c.JSON(http.StatusBadRequest, gin.H{"error": "The schedule expression is required when Cron scheduling is enabled"})
			return
		}
		schedule, err := h.batchCronParser.Parse(cronExpr)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cron expression: " + err.Error()})
			return
		}
		next := schedule.Next(time.Now())
		nextRunAt = &next
	}
	h.batchTaskManager.UpdateQueueSchedule(queueID, scheduleMode, cronExpr, nextRunAt)
	updated, _ := h.batchTaskManager.GetBatchQueue(queueID)
	c.JSON(http.StatusOK, gin.H{"queue": updated})
}

// SetBatchQueueScheduleEnabled enables or disables Cron automatic scheduling (manual execution is unaffected)
func (h *AgentHandler) SetBatchQueueScheduleEnabled(c *gin.Context) {
	queueID := c.Param("queueId")
	if _, exists := h.batchTaskManager.GetBatchQueue(queueID); !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	var req struct {
		ScheduleEnabled bool `json:"scheduleEnabled"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if !h.batchTaskManager.SetScheduleEnabled(queueID, req.ScheduleEnabled) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	queue, _ := h.batchTaskManager.GetBatchQueue(queueID)
	c.JSON(http.StatusOK, gin.H{"queue": queue})
}

// DeleteBatchQueue deletes a batch task queue
func (h *AgentHandler) DeleteBatchQueue(c *gin.Context) {
	queueID := c.Param("queueId")
	if err := h.batchTaskManager.DeleteQueue(queueID); err != nil {
		switch {
		case errors.Is(err, ErrBatchQueueNotFound):
			c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		case errors.Is(err, ErrBatchQueueExecutorActive):
			c.JSON(http.StatusConflict, gin.H{"error": "The queue executor is still running; try deleting again later"})
		case errors.Is(err, ErrBatchQueueStillRunning):
			c.JSON(http.StatusConflict, gin.H{"error": "The queue is running and cannot be deleted"})
		default:
			c.JSON(http.StatusInternalServerError, gin.H{"error": err.Error()})
		}
		return
	}
	if h.audit != nil {
		h.audit.Record(c, audit.Entry{
			Category:     "task",
			Action:       "delete_queue",
			Result:       "success",
			ResourceType: "batch_queue",
			ResourceID:   queueID,
			Message:      "Delete batch task queue",
		})
	}
	c.JSON(http.StatusOK, gin.H{"message": "Batch task queue deleted"})
}

// UpdateBatchTask updates the message of a batch task
func (h *AgentHandler) UpdateBatchTask(c *gin.Context) {
	queueID := c.Param("queueId")
	taskID := c.Param("taskId")

	var req struct {
		Message string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}

	if req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task message is required"})
		return
	}

	err := h.batchTaskManager.UpdateTaskMessage(queueID, taskID, req.Message)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Return the updated queue information
	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Task updated", "queue": queue})
}

// AddBatchTask adds a task to a batch task queue
func (h *AgentHandler) AddBatchTask(c *gin.Context) {
	queueID := c.Param("queueId")

	var req struct {
		Message string `json:"message" binding:"required"`
	}
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}

	if req.Message == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Task message is required"})
		return
	}

	task, err := h.batchTaskManager.AddTaskToQueue(queueID, req.Message)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Return the updated queue information
	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Task added", "task": task, "queue": queue})
}

// RunSingleBatchTask runs the specified sub-task alone (may overwrite an already successful item), and pauses the queue when it completes
func (h *AgentHandler) RunSingleBatchTask(c *gin.Context) {
	queueID := c.Param("queueId")
	taskID := c.Param("taskId")

	if err := h.batchTaskManager.PrepareSingleTaskRun(queueID, taskID); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	h.batchTaskManager.SetSingleRunTask(queueID, taskID)

	// Single run in paused state: an old batch goroutine may still hold an execution slot, so reclaim it first before restarting
	if queue, ok := h.batchTaskManager.GetBatchQueue(queueID); ok && queue.Status == BatchQueueStatusPaused {
		h.batchTaskManager.ForceUnmarkQueueExecutor(queueID)
	}

	autoStarted := true
	autoStartMsg := "Single-item execution started"
	ok, startErr := h.startBatchQueueExecution(queueID, false)
	if startErr != nil {
		h.batchTaskManager.ClearSingleRunTask(queueID)
		autoStarted = false
		autoStartMsg = "Task is ready, but automatic start failed: " + startErr.Error()
	} else if !ok {
		h.batchTaskManager.ClearSingleRunTask(queueID)
		autoStarted = false
		autoStartMsg = "Task is ready, but the queue does not exist"
	}

	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	if h.audit != nil {
		h.audit.RecordOK(c, "task", "run_single_batch_task", "Run batch sub-task individually", "batch_task", taskID, map[string]interface{}{
			"batch_queue_id": queueID,
			"auto_started":   autoStarted,
		})
	}
	c.JSON(http.StatusOK, gin.H{
		"message":     autoStartMsg,
		"queue":       queue,
		"autoStarted": autoStarted,
	})
}

// DeleteBatchTask deletes a batch task
func (h *AgentHandler) DeleteBatchTask(c *gin.Context) {
	queueID := c.Param("queueId")
	taskID := c.Param("taskId")

	err := h.batchTaskManager.DeleteTask(queueID, taskID)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Return the updated queue information
	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Queue not found"})
		return
	}
	if h.audit != nil {
		h.audit.RecordOK(c, "task", "delete_batch_task", "Delete batch sub-task", "batch_task", taskID, map[string]interface{}{
			"batch_queue_id": queueID,
		})
	}
	c.JSON(http.StatusOK, gin.H{"message": "Task deleted", "queue": queue})
}

func (h *AgentHandler) nextBatchQueueRunAt(cronExpr string, from time.Time) (*time.Time, error) {
	expr := strings.TrimSpace(cronExpr)
	if expr == "" {
		return nil, nil
	}
	schedule, err := h.batchCronParser.Parse(expr)
	if err != nil {
		return nil, err
	}
	next := schedule.Next(from)
	return &next, nil
}

func (h *AgentHandler) startBatchQueueExecution(queueID string, scheduled bool) (bool, error) {
	// Acquire the execution mutex gate first, then read the queue status, to avoid decisions based on a stale snapshot
	if !h.batchTaskManager.TryMarkQueueExecutor(queueID) {
		return true, nil
	}

	queue, exists := h.batchTaskManager.GetBatchQueue(queueID)
	if !exists {
		h.batchTaskManager.UnmarkQueueExecutor(queueID)
		return false, nil
	}

	if scheduled {
		if queue.ScheduleMode != "cron" {
			h.batchTaskManager.UnmarkQueueExecutor(queueID)
			err := fmt.Errorf("Cron scheduling is not enabled for this queue")
			h.batchTaskManager.SetLastScheduleError(queueID, err.Error())
			return true, err
		}
		if queue.Status == "running" || queue.Status == "paused" || queue.Status == "cancelled" {
			h.batchTaskManager.UnmarkQueueExecutor(queueID)
			err := fmt.Errorf("The current queue status does not allow scheduled execution")
			h.batchTaskManager.SetLastScheduleError(queueID, err.Error())
			return true, err
		}
		if !h.batchTaskManager.ResetQueueForRerun(queueID) {
			h.batchTaskManager.UnmarkQueueExecutor(queueID)
			err := fmt.Errorf("Failed to reset queue")
			h.batchTaskManager.SetLastScheduleError(queueID, err.Error())
			return true, err
		}
		queue, _ = h.batchTaskManager.GetBatchQueue(queueID)
	} else if queue.Status != "pending" && queue.Status != "paused" {
		h.batchTaskManager.UnmarkQueueExecutor(queueID)
		return true, fmt.Errorf("The queue status does not allow starting")
	}

	if queue != nil && batchQueueWantsAgent(queue.AgentMode) && (h.config == nil || !h.config.MultiAgent.Enabled) {
		h.batchTaskManager.UnmarkQueueExecutor(queueID)
		err := fmt.Errorf("The queue is configured for Agent multi-agent mode, but multi-agent is not enabled in the system")
		if scheduled {
			h.batchTaskManager.SetLastScheduleError(queueID, err.Error())
		}
		return true, err
	}

	if scheduled {
		h.batchTaskManager.RecordScheduledRunStart(queueID)
	}
	h.batchTaskManager.UpdateQueueStatus(queueID, "running")
	if queue != nil && queue.ScheduleMode == "cron" {
		nextRunAt, err := h.nextBatchQueueRunAt(queue.CronExpr, time.Now())
		if err == nil {
			h.batchTaskManager.UpdateQueueSchedule(queueID, "cron", queue.CronExpr, nextRunAt)
		}
	}

	go h.executeBatchQueue(queueID)
	return true, nil
}

func (h *AgentHandler) batchQueueSchedulerLoop() {
	ticker := time.NewTicker(20 * time.Second)
	defer ticker.Stop()
	for range ticker.C {
		queues := h.batchTaskManager.GetLoadedQueues()
		now := time.Now()
		for _, queue := range queues {
			if queue == nil || queue.ScheduleMode != "cron" || !queue.ScheduleEnabled || queue.Status == "cancelled" || queue.Status == "running" || queue.Status == "paused" {
				continue
			}
			nextRunAt := queue.NextRunAt
			if nextRunAt == nil {
				next, err := h.nextBatchQueueRunAt(queue.CronExpr, now)
				if err != nil {
					h.logger.Warn("Batch task cron expression is invalid, skipping scheduling", zap.String("queueId", queue.ID), zap.String("cronExpr", queue.CronExpr), zap.Error(err))
					continue
				}
				h.batchTaskManager.UpdateQueueSchedule(queue.ID, "cron", queue.CronExpr, next)
				nextRunAt = next
			}
			if nextRunAt != nil && (nextRunAt.Before(now) || nextRunAt.Equal(now)) {
				if _, err := h.startBatchQueueExecution(queue.ID, true); err != nil {
					h.logger.Warn("Failed to auto-schedule batch task", zap.String("queueId", queue.ID), zap.Error(err))
				}
			}
		}
	}
}

// loadHistoryFromAgentTrace restores history from the agent message trace saved in the database (column last_react_*; covers the single agent and Agent)
// The logic is consistent with the attack chain: prefer the saved JSON message bundle plus the last-round assistant summary, otherwise fall back to the message table.
func (h *AgentHandler) loadHistoryFromAgentTrace(conversationID string) ([]agent.ChatMessage, error) {
	traceInputJSON, assistantOut, err := h.db.GetAgentTrace(conversationID)
	if err != nil {
		return nil, fmt.Errorf("Failed to get agent trace: %w", err)
	}

	if traceInputJSON == "" {
		return nil, fmt.Errorf("Agent trace is empty; the messages table will be used")
	}

	dataSource := "database_last_agent_trace"

	parsed, err := agent.ParseTraceMessages(traceInputJSON)
	if err != nil {
		return nil, fmt.Errorf("Failed to parse agent trace JSON: %w", err)
	}

	messageCount := len(parsed)

	h.logger.Info("Restoring history context from saved agent trace",
		zap.String("conversationId", conversationID),
		zap.String("dataSource", dataSource),
		zap.Int("traceInputSize", len(traceInputJSON)),
		zap.Int("messageCount", messageCount),
		zap.Int("assistantOutSize", len(assistantOut)),
	)
	agentMessages := agent.TraceMessagesForResume(parsed)

	// If last_react_output exists (assistant summary), merge it into the last assistant message (consistent with the saved format)
	if assistantOut != "" {
		if len(agentMessages) > 0 {
			lastMsg := &agentMessages[len(agentMessages)-1]
			if strings.EqualFold(lastMsg.Role, "assistant") && len(lastMsg.ToolCalls) == 0 {
				lastMsg.Content = assistantOut
			} else {
				agentMessages = append(agentMessages, agent.ChatMessage{
					Role:    "assistant",
					Content: assistantOut,
				})
			}
		} else {
			agentMessages = append(agentMessages, agent.ChatMessage{
				Role:    "assistant",
				Content: assistantOut,
			})
		}
	}

	if len(agentMessages) == 0 {
		return nil, fmt.Errorf("Messages parsed from the agent trace are empty")
	}

	if h.agent != nil {
		if fixed := h.agent.RepairOrphanToolMessages(&agentMessages); fixed {
			h.logger.Info("Repaired mismatched tool messages in history restored from agent trace",
				zap.String("conversationId", conversationID),
			)
		}
	}

	h.logger.Info("History messages restored from agent trace",
		zap.String("conversationId", conversationID),
		zap.String("dataSource", dataSource),
		zap.Int("originalMessageCount", messageCount),
		zap.Int("finalMessageCount", len(agentMessages)),
		zap.Bool("hasAssistantOut", assistantOut != ""),
	)
	return agentMessages, nil
}

// dbMessagesToAgentChatMessages maps DB rows to agent ChatMessage for history fallback
// (includes reasoning_content for DeepSeek thinking + tool replay).
func dbMessagesToAgentChatMessages(msgs []database.Message) []agent.ChatMessage {
	out := make([]agent.ChatMessage, 0, len(msgs))
	for i := range msgs {
		m := msgs[i]
		out = append(out, agent.ChatMessage{
			Role:             m.Role,
			Content:          m.Content,
			ReasoningContent: m.ReasoningContent,
		})
	}
	return out
}
