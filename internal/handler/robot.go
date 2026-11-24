package handler

import (
	"bytes"
	"context"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"crypto/sha1"
	"crypto/sha256"
	"encoding/base32"
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"encoding/xml"
	"errors"
	"fmt"
	"io"
	"net/http"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/authctx"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

const (
	robotCmdHelp          = "帮助" // Chinese bot commands are user input and stay Chinese
	robotCmdList          = "列表"
	robotCmdListAlt       = "对话列表"
	robotCmdSwitch        = "切换"
	robotCmdContinue      = "继续"
	robotCmdNew           = "新对话"
	robotCmdClear         = "清空"
	robotCmdStatus        = "状态"
	robotCmdStop          = "停止"
	robotCmdRoles         = "角色"
	robotCmdRolesList     = "角色列表"
	robotCmdSwitchRole    = "切换角色"
	robotCmdModes         = "模式"
	robotCmdModesList     = "模式列表"
	robotCmdSwitchMode    = "切换模式"
	robotCmdDelete        = "删除"
	robotCmdVersion       = "版本"
	robotCmdProjects      = "项目"
	robotCmdProjectsList  = "项目列表"
	robotCmdBindProject   = "绑定项目"
	robotCmdNewProject    = "新建项目"
	robotCmdUnbindProject = "解除项目"
	robotCmdBindUser      = "绑定"
	robotCmdUnbindUser    = "解绑"
	robotCmdIdentity      = "身份"
	robotCmdTask          = "任务"
	robotCmdRename        = "重命名"
	robotCmdPermissions   = "权限"
	robotCmdDoctor        = "诊断"
	robotCmdConfirm       = "确认"
	robotCmdCancel        = "取消"
	robotCmdVulnAlerts    = "漏洞提醒"
	robotBindingCodeTTL   = 5 * time.Minute
)

type robotPendingConfirmation struct {
	Action    string
	Target    string
	ExpiresAt time.Time
}

// RobotHandler handles callbacks from bots such as WeCom, DingTalk and Lark
type RobotHandler struct {
	config               *config.Config
	db                   *database.DB
	agentHandler         *AgentHandler
	logger               *zap.Logger
	mu                   sync.RWMutex
	sessions             map[string]string             // key: "platform_userID", value: conversationID
	sessionRoles         map[string]string             // key: "platform_userID", value: roleName (default "default")
	sessionModes         map[string]string             // key: "platform_userID", value: agent mode
	cancelMu             sync.Mutex                    // Protects runningCancels
	runningCancels       map[string]context.CancelFunc // key: "platform_userID", used by the stop command to interrupt a task
	wecomReplay          map[string]time.Time
	pendingConfirmations map[string]robotPendingConfirmation
	alertWake            chan struct{}
	audit                *audit.Service
}

// NewRobotHandler creates the bot handler
func NewRobotHandler(cfg *config.Config, db *database.DB, agentHandler *AgentHandler, logger *zap.Logger) *RobotHandler {
	return &RobotHandler{
		config:               cfg,
		db:                   db,
		agentHandler:         agentHandler,
		logger:               logger,
		sessions:             make(map[string]string),
		sessionRoles:         make(map[string]string),
		sessionModes:         make(map[string]string),
		runningCancels:       make(map[string]context.CancelFunc),
		wecomReplay:          make(map[string]time.Time),
		pendingConfirmations: make(map[string]robotPendingConfirmation),
		alertWake:            make(chan struct{}, 1),
	}
}

func (h *RobotHandler) SetAudit(s *audit.Service) {
	h.audit = s
}

func (h *RobotHandler) acceptFreshWecomRequest(timestamp, nonce, signature string) bool {
	unixSeconds, err := strconv.ParseInt(strings.TrimSpace(timestamp), 10, 64)
	if err != nil {
		return false
	}
	now := time.Now()
	requestTime := time.Unix(unixSeconds, 0)
	if requestTime.Before(now.Add(-5*time.Minute)) || requestTime.After(now.Add(5*time.Minute)) {
		return false
	}
	key := strings.TrimSpace(timestamp) + "\x00" + strings.TrimSpace(nonce) + "\x00" + strings.TrimSpace(signature)
	if strings.TrimSpace(nonce) == "" || strings.TrimSpace(signature) == "" {
		return false
	}
	h.mu.Lock()
	defer h.mu.Unlock()
	for replayKey, seenAt := range h.wecomReplay {
		if now.Sub(seenAt) > 10*time.Minute {
			delete(h.wecomReplay, replayKey)
		}
	}
	if _, exists := h.wecomReplay[key]; exists {
		return false
	}
	h.wecomReplay[key] = now
	return true
}

// sessionKey generates the session key
func (h *RobotHandler) sessionKey(platform, userID string) string {
	return platform + "_" + userID
}

func normalizeRobotBindingCode(code string) string {
	return strings.ToUpper(strings.ReplaceAll(strings.TrimSpace(code), "-", ""))
}

func hashRobotBindingCode(code string) string {
	sum := sha256.Sum256([]byte(normalizeRobotBindingCode(code)))
	return fmt.Sprintf("%x", sum[:])
}

func (h *RobotHandler) resolveRobotAccess(platform, userID string) (*database.RBACAccess, error) {
	if h.db == nil {
		return nil, fmt.Errorf("Bot authentication service unavailable")
	}
	authorization := h.config.Robots.AuthorizationFor(platform)
	var access *database.RBACAccess
	var err error
	switch authorization.EffectiveMode() {
	case config.RobotAuthModeUserBinding:
		access, err = h.db.ResolveRobotRBACAccess(platform, userID)
	case config.RobotAuthModeServiceAccount:
		if !authorization.ExternalUserAllowed(userID) {
			return nil, fmt.Errorf("Bot sender is not in the service account allowlist")
		}
		access, err = h.db.ResolveRBACAccess(strings.TrimSpace(authorization.ServiceUserID))
	default:
		return nil, fmt.Errorf("Invalid bot authentication mode")
	}
	if err != nil {
		return nil, err
	}
	if !access.User.Enabled {
		return nil, fmt.Errorf("The bound platform account has been disabled")
	}
	return access, nil
}

func robotPrincipal(access *database.RBACAccess) authctx.Principal {
	if access == nil {
		return authctx.Principal{}
	}
	return authctx.NewPrincipalWithScopes(access.User.ID, access.User.Username, access.Scope, access.Permissions, access.PermissionScopes)
}

func (h *RobotHandler) robotAccessDeniedMessage(platform string) string {
	if h.config.Robots.AuthorizationFor(platform).EffectiveMode() == config.RobotAuthModeServiceAccount {
		return "The current platform account is not on this bot's service account allowlist, or the service account is unavailable."
	}
	return "The current platform account is not yet bound to a CyberStrikeAI user. Generate a binding code in the web UI first, then send: bind XXXX-XXXX"
}

func (h *RobotHandler) loadSessionBinding(sk string) (convID, role, agentMode string) {
	if h.db == nil || strings.TrimSpace(sk) == "" {
		return "", "", ""
	}
	binding, err := h.db.GetRobotSessionBinding(sk)
	if err != nil {
		h.logger.Warn("Failed to read bot session binding", zap.String("session_key", sk), zap.Error(err))
		return "", "", ""
	}
	if binding == nil {
		return "", "", ""
	}
	return binding.ConversationID, binding.RoleName, binding.AgentMode
}

func (h *RobotHandler) persistSessionBinding(sk, convID, role, agentMode string) {
	if h.db == nil || strings.TrimSpace(sk) == "" || strings.TrimSpace(convID) == "" {
		return
	}
	if err := h.db.UpsertRobotSessionBinding(sk, convID, role, agentMode); err != nil {
		h.logger.Warn("Failed to write bot session binding", zap.String("session_key", sk), zap.Error(err))
	}
}

func (h *RobotHandler) deleteSessionBinding(sk string) {
	if h.db == nil || strings.TrimSpace(sk) == "" {
		return
	}
	if err := h.db.DeleteRobotSessionBinding(sk); err != nil {
		h.logger.Warn("Failed to delete bot session binding", zap.String("session_key", sk), zap.Error(err))
	}
}

// getOrCreateConversation gets or creates the current conversation; title is used as the title of a new conversation (the first 50 characters of the user's first message)
func (h *RobotHandler) getOrCreateConversation(platform, userID, title string, access *database.RBACAccess) (convID string, isNew bool) {
	sk := h.sessionKey(platform, userID)
	h.mu.RLock()
	convID = h.sessions[sk]
	h.mu.RUnlock()
	ownerID := access.User.ID
	readScope := robotPrincipal(access).ScopeFor("chat:read")
	if convID != "" && access.Permissions["chat:read"] && h.db.UserCanAccessResource(ownerID, readScope, "conversation", convID) {
		return convID, false
	}
	if persistedConvID, persistedRole, persistedMode := h.loadSessionBinding(sk); strings.TrimSpace(persistedConvID) != "" {
		if !access.Permissions["chat:read"] || !h.db.UserCanAccessResource(ownerID, readScope, "conversation", persistedConvID) {
			h.deleteSessionBinding(sk)
		} else {
			// Session binding is persisted: the current conversation and role can be restored after a service restart.
			h.mu.Lock()
			h.sessions[sk] = persistedConvID
			if strings.TrimSpace(persistedRole) != "" {
				h.sessionRoles[sk] = persistedRole
			}
			if strings.TrimSpace(persistedMode) != "" {
				h.sessionModes[sk] = config.NormalizeAgentMode(persistedMode)
			}
			h.mu.Unlock()
			return persistedConvID, false
		}
	}
	t := strings.TrimSpace(title)
	if t == "" {
		t = "New conversation " + time.Now().Format("01-02 15:04")
	} else {
		t = safeTruncateString(t, 50)
	}
	meta := database.ConversationCreateMeta{Source: "robot:" + platform}
	if !access.Permissions["chat:write"] {
		return "", false
	}
	meta.ProjectID = effectiveProjectID(h.config, "")
	if meta.ProjectID != "" && (!access.Permissions["project:read"] || !h.db.UserCanAccessResource(ownerID, robotPrincipal(access).ScopeFor("project:read"), "project", meta.ProjectID)) {
		meta.ProjectID = ""
	}
	conv, err := h.db.CreateConversation(t, meta)
	if err != nil {
		h.logger.Warn("Failed to create bot session", zap.Error(err))
		return "", false
	}
	convID = conv.ID
	_ = h.db.SetResourceOwner("conversation", convID, ownerID)
	h.mu.Lock()
	role := h.sessionRoles[sk]
	agentMode := h.sessionModes[sk]
	h.sessions[sk] = convID
	h.mu.Unlock()
	if agentMode == "" {
		agentMode = config.NormalizeRobotAgentMode(h.config.MultiAgent)
	}
	h.persistSessionBinding(sk, convID, role, agentMode)
	return convID, true
}

// setConversation switches the current conversation
func (h *RobotHandler) setConversation(platform, userID, convID string) {
	sk := h.sessionKey(platform, userID)
	h.mu.Lock()
	role := h.sessionRoles[sk]
	agentMode := h.sessionModes[sk]
	h.sessions[sk] = convID
	h.mu.Unlock()
	h.persistSessionBinding(sk, convID, role, agentMode)
}

// getRole gets the role the current user is using; returns "default" when none is set
func (h *RobotHandler) getRole(platform, userID string) string {
	sk := h.sessionKey(platform, userID)
	h.mu.RLock()
	role := h.sessionRoles[sk]
	h.mu.RUnlock()
	if strings.TrimSpace(role) != "" {
		return role
	}
	if _, persistedRole, _ := h.loadSessionBinding(sk); strings.TrimSpace(persistedRole) != "" {
		h.mu.Lock()
		h.sessionRoles[sk] = persistedRole
		h.mu.Unlock()
		return persistedRole
	}
	return config.DefaultRoleName
}

// setRole sets the role the current user is using
func (h *RobotHandler) setRole(platform, userID, roleName string) {
	sk := h.sessionKey(platform, userID)
	h.mu.Lock()
	h.sessionRoles[sk] = roleName
	convID := h.sessions[sk]
	agentMode := h.sessionModes[sk]
	h.mu.Unlock()
	h.persistSessionBinding(sk, convID, roleName, agentMode)
}

func (h *RobotHandler) getAgentMode(platform, userID string) string {
	sk := h.sessionKey(platform, userID)
	h.mu.RLock()
	mode := h.sessionModes[sk]
	h.mu.RUnlock()
	if mode != "" {
		return config.NormalizeAgentMode(mode)
	}
	if _, _, persistedMode := h.loadSessionBinding(sk); persistedMode != "" {
		mode = config.NormalizeAgentMode(persistedMode)
		h.mu.Lock()
		h.sessionModes[sk] = mode
		h.mu.Unlock()
		return mode
	}
	return config.NormalizeRobotAgentMode(h.config.MultiAgent)
}

func (h *RobotHandler) setAgentMode(platform, userID, mode string) {
	sk := h.sessionKey(platform, userID)
	mode = config.NormalizeAgentMode(mode)
	h.mu.Lock()
	h.sessionModes[sk] = mode
	convID := h.sessions[sk]
	role := h.sessionRoles[sk]
	h.mu.Unlock()
	h.persistSessionBinding(sk, convID, role, mode)
}

// clearConversation clears the current conversation (switches to a new conversation)
func (h *RobotHandler) clearConversation(platform, userID string, access *database.RBACAccess) (newConvID string) {
	title := "New conversation " + time.Now().Format("01-02 15:04")
	meta := database.ConversationCreateMeta{Source: "robot:" + platform + ":new"}
	meta.ProjectID = effectiveProjectID(h.config, "")
	ownerID := access.User.ID
	if meta.ProjectID != "" && (!access.Permissions["project:read"] || !h.db.UserCanAccessResource(ownerID, robotPrincipal(access).ScopeFor("project:read"), "project", meta.ProjectID)) {
		meta.ProjectID = ""
	}
	conv, err := h.db.CreateConversation(title, meta)
	if err != nil {
		h.logger.Warn("Failed to create new conversation", zap.Error(err))
		return ""
	}
	_ = h.db.SetResourceOwner("conversation", conv.ID, ownerID)
	h.setConversation(platform, userID, conv.ID)
	return conv.ID
}

// HandleMessage handles user input and returns the reply text (called by each platform's webhook)
func (h *RobotHandler) HandleMessage(platform, userID, text string) (reply string) {
	platform = strings.TrimSpace(platform)
	userID = strings.TrimSpace(userID)
	text = strings.TrimSpace(text)
	if platform == "" {
		platform = "unknown"
	}
	if userID == "" {
		h.logger.Warn("Bot message has no user identifier; rejected", zap.String("platform", platform))
		return "Cannot identify the sender; check the bot's event subscription permissions (a usable user ID must be returned)."
	}
	if text == "" {
		return "Enter some text, or send \"help\" to see the commands."
	}

	// First try to handle it as a command (supports both Chinese and English)
	if cmdReply, ok := h.handleRobotCommand(platform, userID, text); ok {
		return cmdReply
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return h.robotAccessDeniedMessage(platform)
	}
	if !access.Permissions["agent:execute"] || !access.Permissions["chat:read"] || !access.Permissions["chat:write"] {
		return "Insufficient permissions: bot conversations require the agent:execute, chat:read and chat:write permissions."
	}
	if h.audit != nil && h.config.Robots.AuthorizationFor(platform).EffectiveMode() == config.RobotAuthModeServiceAccount {
		hint := sha256.Sum256([]byte(userID))
		h.audit.RecordSystem(audit.Entry{
			Category: "robot", Action: "service_account_execute", Result: "success", Actor: access.User.Username,
			ResourceType: "robot_sender", ResourceID: platform + ":" + fmt.Sprintf("%x", hint[:4]),
			Message: "Allowlisted platform sender runs the agent with the bot service account",
		})
	}

	// Ordinary message: goes to the Agent
	convID, _ := h.getOrCreateConversation(platform, userID, text, access)
	if convID == "" {
		return "Unable to create or get the conversation; please try again later."
	}
	// If the conversation title is in the "New conversation xx:xx" format (created by the "new conversation" command), update the title to the content of the first message, to match the Web experience
	if conv, err := h.db.GetConversation(convID); err == nil && (strings.HasPrefix(conv.Title, "New conversation ") || strings.HasPrefix(conv.Title, "新对话 ")) {
		newTitle := safeTruncateString(text, 50)
		if newTitle != "" {
			_ = h.db.UpdateConversationTitle(convID, newTitle)
		}
	}
	ctx, cancel := context.WithTimeout(context.Background(), h.robotMessageTimeout())
	sk := h.sessionKey(platform, userID)
	h.cancelMu.Lock()
	h.runningCancels[sk] = cancel
	h.cancelMu.Unlock()
	defer func() {
		cancel()
		h.cancelMu.Lock()
		delete(h.runningCancels, sk)
		h.cancelMu.Unlock()
	}()
	role := h.getRole(platform, userID)
	agentMode := h.getAgentMode(platform, userID)
	resp, newConvID, err := h.agentHandler.ProcessMessageForRobot(ctx, platform, robotPrincipal(access), convID, text, role, agentMode)
	if err != nil {
		h.logger.Warn("Bot agent execution failed", zap.String("platform", platform), zap.String("userID", userID), zap.Error(err))
		if errors.Is(err, context.Canceled) {
			return "Task cancelled."
		}
		if errors.Is(err, context.DeadlineExceeded) {
			return "Task timed out; retry later or narrow the scope of this request."
		}
		return "Processing failed: " + err.Error()
	}
	if newConvID != convID {
		h.setConversation(platform, userID, newConvID)
	}
	return resp
}

func (h *RobotHandler) robotMessageTimeout() time.Duration {
	// Overall timeout for handling one bot message (decoupled from the single-tool timeout agent.tool_timeout_minutes).
	return 10 * time.Hour
}

func (h *RobotHandler) cmdHelp(platform, userID string) string {
	access, _ := h.resolveRobotAccess(platform, userID)
	can := func(permission string) bool {
		return access != nil && access.Permissions[permission]
	}
	var b strings.Builder
	b.WriteString("[CyberStrikeAI bot commands]\n\n")
	b.WriteString("[General]\n")
	b.WriteString("· help — Show this help\n")
	b.WriteString("· version — Show the current version\n")
	b.WriteString("· bind <code> — Bind your web UI RBAC user\n")
	b.WriteString("· unbind — Request to unbind the account (confirmation required)\n")
	b.WriteString("· whoami — Show the platform sender, auth mode and the current effective RBAC identity\n")
	if can("chat:read") || can("chat:write") || can("chat:delete") {
		b.WriteString("\n[Conversation]\n")
		if can("chat:read") {
			b.WriteString("· list — List all conversation titles and IDs\n· switch <ID> — Continue the specified conversation\n· status — Summarize the current selection\n· task — Show the current task status\n")
		}
		if can("chat:write") {
			b.WriteString("· new; clear — Start a new conversation\n· rename <name> — Rename the current conversation\n")
		}
		if can("chat:delete") {
			b.WriteString("· delete <ID> — Delete the specified conversation (confirmation required)\n")
		}
	}
	if can("roles:read") {
		b.WriteString("\n[Role]\n· roles — List all available roles\n· role <name> — Switch the current role\n")
	}
	if can("agent:execute") {
		b.WriteString("\n[Mode]\n· modes — List conversation modes and the current selection\n· mode <name> — Switch the conversation mode\n· stop — Interrupt the current task\n")
	}
	if can("vulnerability:read") {
		b.WriteString("\n[Vulnerability alerts]\n· vuln alerts — Show subscription status\n· vuln alerts on — Turn alerts on\n· vuln alerts critical|high|medium — Set the minimum severity\n· vuln alerts off — Turn alerts off\n")
	}
	b.WriteString("\n[Diagnostics]\n")
	b.WriteString("· permissions — Show the current business permissions\n")
	if can("config:read") {
		b.WriteString("· doctor — Check the status of key bot configuration\n")
	}
	b.WriteString("· confirm; cancel — Confirm or cancel a high-risk operation\n")
	if h.projectsEnabled() && (can("project:read") || can("project:write")) {
		b.WriteString("\n[Project]\n")
		if can("project:read") {
			b.WriteString("· projects — List all projects\n")
		}
		if can("project:write") {
			b.WriteString("· new project <name> — Create a project and bind it to the current conversation\n· bind project <ID|name> — Bind an existing project\n· unbind project — Remove the project binding\n")
		}
	}
	b.WriteString("\n──────────────\n")
	b.WriteString("Beyond the commands above, anything you type is sent to the AI for penetration testing/security analysis.")
	return b.String()
}

func (h *RobotHandler) projectsEnabled() bool {
	return h.config != nil && h.config.Project.Enabled
}

func (h *RobotHandler) resolveProjectByIDOrName(access *database.RBACAccess, idOrName string) (*database.Project, string) {
	idOrName = strings.TrimSpace(idOrName)
	if idOrName == "" {
		return nil, "Specify a project ID or name, for example: bind project xxx-xxx"
	}
	ownerID := access.User.ID
	scope := robotPrincipal(access).ScopeFor("project:read")
	if p, err := h.db.GetProject(idOrName); err == nil {
		if h.db.UserCanAccessResource(ownerID, scope, "project", p.ID) {
			return p, ""
		}
		return nil, "Project does not exist or access is denied."
	}
	list, err := h.db.ListProjectsForAccess("", "", 200, 0, ownerID, scope)
	if err != nil {
		return nil, "Failed to query project: " + err.Error()
	}
	var matches []*database.Project
	for _, p := range list {
		if p.Name == idOrName {
			matches = append(matches, p)
		}
	}
	switch len(matches) {
	case 0:
		return nil, fmt.Sprintf("Project \"%s\" does not exist. Send \"projects\" to see the list.", idOrName)
	case 1:
		return matches[0], ""
	default:
		var b strings.Builder
		b.WriteString(fmt.Sprintf("Name \"%s\" matches multiple projects; use the ID to bind:\n", idOrName))
		for _, p := range matches {
			b.WriteString(fmt.Sprintf("· %s\n  ID: %s\n", p.Name, p.ID))
		}
		return nil, strings.TrimSuffix(b.String(), "\n")
	}
}

func (h *RobotHandler) formatProjectLabel(projectID string) string {
	if strings.TrimSpace(projectID) == "" {
		return "Not bound"
	}
	if p, err := h.db.GetProject(projectID); err == nil {
		return fmt.Sprintf("\"%s\" (%s)", p.Name, p.ID)
	}
	return projectID
}

func (h *RobotHandler) cmdProjects(platform, userID string) string {
	if !h.projectsEnabled() {
		return "The project feature is not enabled (config.project.enabled)."
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	list, err := h.db.ListProjectsForAccess("", "", 50, 0, access.User.ID, robotPrincipal(access).ScopeFor("project:read"))
	if err != nil {
		return "Failed to get project list: " + err.Error()
	}
	if len(list) == 0 {
		return "No projects yet. Send \"new project <name>\" to create one and bind it to the current conversation."
	}
	var b strings.Builder
	b.WriteString("[Project list]\n")
	for i, p := range list {
		if i >= 20 {
			b.WriteString("... Showing only the first 20\n")
			break
		}
		status := p.Status
		if status == "" {
			status = "active"
		}
		b.WriteString(fmt.Sprintf("· %s [%s]\n  ID: %s\n", p.Name, status, p.ID))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (h *RobotHandler) cmdBindProject(platform, userID, idOrName string) string {
	if !h.projectsEnabled() {
		return "The project feature is not enabled (config.project.enabled)."
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	p, errMsg := h.resolveProjectByIDOrName(access, idOrName)
	if p == nil {
		return errMsg
	}
	convID, _ := h.getOrCreateConversation(platform, userID, "", access)
	if convID == "" {
		return "Unable to get the current conversation; please try again later."
	}
	if err := h.db.SetConversationProjectID(convID, p.ID); err != nil {
		return "Binding failed: " + err.Error()
	}
	return fmt.Sprintf("Bound the current conversation to project: \"%s\"\nID: %s", p.Name, p.ID)
}

func (h *RobotHandler) cmdNewProject(platform, userID, name string) string {
	if !h.projectsEnabled() {
		return "The project feature is not enabled (config.project.enabled)."
	}
	name = strings.TrimSpace(name)
	if name == "" {
		return "Specify a project name, for example: new project Example target pentest"
	}
	access, accessErr := h.resolveRobotAccess(platform, userID)
	if accessErr != nil {
		return "The current platform account is not yet bound."
	}
	p := &database.Project{Name: name, Status: "active"}
	created, err := h.db.CreateProject(p)
	if err != nil {
		return "Failed to create project: " + err.Error()
	}
	_ = h.db.SetResourceOwner("project", created.ID, access.User.ID)
	convID, _ := h.getOrCreateConversation(platform, userID, name, access)
	if convID == "" {
		return fmt.Sprintf("Project created: \"%s\"\nID: %s\n(Binding the current conversation failed; send \"bind project %s\" manually)", created.Name, created.ID, created.ID)
	}
	if err := h.db.SetConversationProjectID(convID, created.ID); err != nil {
		return fmt.Sprintf("Project created: \"%s\"\nID: %s\nBinding failed: %s", created.Name, created.ID, err.Error())
	}
	return fmt.Sprintf("Created the project and bound the current conversation: \"%s\"\nID: %s", created.Name, created.ID)
}

func (h *RobotHandler) cmdUnbindProject(platform, userID string) string {
	if !h.projectsEnabled() {
		return "The project feature is not enabled (config.project.enabled)."
	}
	sk := h.sessionKey(platform, userID)
	h.mu.RLock()
	convID := h.sessions[sk]
	h.mu.RUnlock()
	if convID == "" {
		if persistedConvID, _, _ := h.loadSessionBinding(sk); persistedConvID != "" {
			convID = persistedConvID
		}
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	if !h.db.UserCanAccessResource(access.User.ID, robotPrincipal(access).ScopeFor("chat:write"), "conversation", convID) {
		return "The current conversation does not exist or access is denied."
	}
	if convID == "" {
		return "There is no active conversation, so there is nothing to unbind."
	}
	projectID, err := h.db.GetConversationProjectID(convID)
	if err != nil {
		return "Failed to get conversation project: " + err.Error()
	}
	if strings.TrimSpace(projectID) == "" {
		return "The current conversation is not bound to a project."
	}
	if err := h.db.SetConversationProjectID(convID, ""); err != nil {
		return "Failed to unbind: " + err.Error()
	}
	return "Removed the project binding of the current conversation."
}

func (h *RobotHandler) cmdList(platform, userID string) string {
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	convs, err := h.db.ListConversationsForAccess(50, 0, "", "", "", access.User.ID, robotPrincipal(access).ScopeFor("chat:read"))
	if err != nil {
		return "Failed to get conversation list: " + err.Error()
	}
	if len(convs) == 0 {
		return "No conversations yet. Send anything to create a new conversation automatically."
	}
	var b strings.Builder
	b.WriteString("[Conversation list]\n")
	for i, c := range convs {
		if i >= 20 {
			b.WriteString("... Showing only the first 20\n")
			break
		}
		b.WriteString(fmt.Sprintf("· %s\n  ID: %s\n", c.Title, c.ID))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (h *RobotHandler) cmdSwitch(platform, userID, convID string) string {
	if convID == "" {
		return "Specify a conversation ID, for example: switch xxx-xxx-xxx"
	}
	access, accessErr := h.resolveRobotAccess(platform, userID)
	if accessErr != nil {
		return "The current platform account is not yet bound."
	}
	conv, err := h.db.GetConversation(convID)
	if err != nil || !h.db.UserCanAccessResource(access.User.ID, robotPrincipal(access).ScopeFor("chat:read"), "conversation", convID) {
		return "Conversation does not exist or the ID is wrong."
	}
	h.setConversation(platform, userID, conv.ID)
	return fmt.Sprintf("Switched to conversation: \"%s\"\nID: %s", conv.Title, conv.ID)
}

func (h *RobotHandler) cmdNew(platform, userID string) string {
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	newID := h.clearConversation(platform, userID, access)
	if newID == "" {
		return "Failed to create new conversation; please retry."
	}
	return "Started a new conversation; you can send content directly."
}

func (h *RobotHandler) cmdClear(platform, userID string) string {
	return h.cmdNew(platform, userID)
}

func (h *RobotHandler) cmdStop(platform, userID string) string {
	sk := h.sessionKey(platform, userID)
	h.cancelMu.Lock()
	cancel, ok := h.runningCancels[sk]
	if ok {
		delete(h.runningCancels, sk)
		cancel()
	}
	h.cancelMu.Unlock()
	if !ok {
		return "There is no task running."
	}
	return "Stopped the current task."
}

func (h *RobotHandler) cmdStatus(platform, userID string) string {
	convID := h.currentConversationID(platform, userID)
	if convID == "" {
		return fmt.Sprintf("[Current status]\nConversation: none\nRole: %s\nMode: %s\nProject: none\n\nSend anything to create a new conversation.", h.getRole(platform, userID), robotAgentModeLabel(h.getAgentMode(platform, userID)))
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	if !h.db.UserCanAccessResource(access.User.ID, robotPrincipal(access).ScopeFor("chat:read"), "conversation", convID) {
		return "The current conversation does not exist or access is denied."
	}
	conv, err := h.db.GetConversation(convID)
	if err != nil {
		return "Current conversation ID: " + convID + " (failed to get title)"
	}
	role := h.getRole(platform, userID)
	reply := fmt.Sprintf("[Current status]\nConversation: %s\nConversation ID: %s\nMode: %s\nRole: %s", conv.Title, conv.ID, robotAgentModeLabel(h.getAgentMode(platform, userID)), role)
	if h.projectsEnabled() {
		projectID, _ := h.db.GetConversationProjectID(conv.ID)
		reply += "\nProject: " + h.formatProjectLabel(projectID)
	} else {
		reply += "\nProject: not enabled"
	}
	return reply
}

func (h *RobotHandler) currentConversationID(platform, userID string) string {
	sk := h.sessionKey(platform, userID)
	h.mu.RLock()
	convID := h.sessions[sk]
	h.mu.RUnlock()
	if convID != "" {
		return convID
	}
	persistedConvID, persistedRole, persistedMode := h.loadSessionBinding(sk)
	if persistedConvID == "" {
		return ""
	}
	h.mu.Lock()
	h.sessions[sk] = persistedConvID
	h.sessionRoles[sk] = persistedRole
	h.sessionModes[sk] = config.NormalizeAgentMode(persistedMode)
	h.mu.Unlock()
	return persistedConvID
}

func (h *RobotHandler) cmdTask(platform, userID string) string {
	convID := h.currentConversationID(platform, userID)
	if convID == "" {
		return "[Task status]\nThere is no conversation and no task running."
	}
	if h.agentHandler == nil || h.agentHandler.tasks == nil {
		return "Task status service is unavailable."
	}
	task := h.agentHandler.tasks.GetTaskSnapshot(convID)
	if task == nil {
		return "[Task status]\nStatus: idle\nThere is no task running."
	}
	elapsed := time.Since(task.StartedAt).Round(time.Second)
	return fmt.Sprintf("[Task status]\nStatus: %s\nElapsed: %s\nConversation ID: %s\nMode: %s\nAvailable action: stop", task.Status, elapsed, convID, robotAgentModeLabel(h.getAgentMode(platform, userID)))
}

func (h *RobotHandler) cmdRename(platform, userID, title string) string {
	title = strings.TrimSpace(title)
	if title == "" {
		return "Specify a new title, for example: rename External asset review"
	}
	title = safeTruncateString(title, 100)
	convID := h.currentConversationID(platform, userID)
	if convID == "" {
		return "There is no conversation, so it cannot be renamed."
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil || !h.db.UserCanAccessResource(access.User.ID, robotPrincipal(access).ScopeFor("chat:write"), "conversation", convID) {
		return "The current conversation does not exist or you have no permission to modify it."
	}
	if err := h.db.UpdateConversationTitle(convID, title); err != nil {
		return "Rename failed: " + err.Error()
	}
	h.recordRobotCommandAudit(access, platform, "conversation_rename", "conversation", convID, "Bot renamed the current conversation")
	return fmt.Sprintf("Renamed the current conversation to: \"%s\"", title)
}

func (h *RobotHandler) cmdPermissions(platform, userID string) string {
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return h.robotAccessDeniedMessage(platform)
	}
	allowed := func(permission string) string {
		if access.Permissions[permission] {
			return "Allowed"
		}
		return "Not allowed"
	}
	return fmt.Sprintf("[Current permissions]\nRun Agent: %s\nRead conversations: %s\nEdit conversations: %s\nDelete conversations: %s\nRead roles: %s\nRead projects: %s\nEdit projects: %s\nResource scope: %s", allowed("agent:execute"), allowed("chat:read"), allowed("chat:write"), allowed("chat:delete"), allowed("roles:read"), allowed("project:read"), allowed("project:write"), access.Scope)
}

func (h *RobotHandler) cmdDoctor() string {
	configured := func(ok bool) string {
		if ok {
			return "OK"
		}
		return "Not configured"
	}
	enabled := func(ok bool) string {
		if ok {
			return "Enabled"
		}
		return "Disabled"
	}
	enabledInternalTools := 0
	for _, tool := range h.config.Security.Tools {
		if tool.Enabled {
			enabledInternalTools++
		}
	}
	enabledExternal := 0
	for _, server := range h.config.ExternalMCP.Servers {
		if server.ExternalMCPEnable && !server.Disabled {
			enabledExternal++
		}
	}
	return fmt.Sprintf("[Config diagnostics]\nMain model: %s\nAgent multi-agent: %s\nBuilt-in MCP tools: %d/%d enabled\nHTTP MCP service: %s\nExternal MCP: %d enabled\nKnowledge base: %s\nProject feature: %s\nNote: built-in tools do not depend on the HTTP MCP service; this command only checks configuration and does not actively probe external services.", configured(strings.TrimSpace(h.config.OpenAI.Model) != "" && strings.TrimSpace(h.config.OpenAI.BaseURL) != ""), enabled(h.config.MultiAgent.Enabled), enabledInternalTools, len(h.config.Security.Tools), enabled(h.config.MCP.Enabled), enabledExternal, enabled(h.config.Knowledge.Enabled), enabled(h.config.Project.Enabled))
}

func (h *RobotHandler) recordRobotCommandAudit(access *database.RBACAccess, platform, action, resourceType, resourceID, message string) {
	if h.audit == nil || access == nil {
		return
	}
	h.audit.RecordSystem(audit.Entry{Category: "robot", Action: action, Result: "success", Actor: access.User.Username, ResourceType: resourceType, ResourceID: resourceID, Message: message + " (" + platform + ")"})
}

func (h *RobotHandler) cmdRoles() string {
	if h.config.Roles == nil || len(h.config.Roles) == 0 {
		return "No roles available."
	}
	names := make([]string, 0, len(h.config.Roles))
	for name, role := range h.config.Roles {
		if role.Enabled {
			names = append(names, name)
		}
	}
	if len(names) == 0 {
		return "No roles available."
	}
	sort.Slice(names, func(i, j int) bool {
		if config.IsDefaultRole(names[i]) {
			return true
		}
		if config.IsDefaultRole(names[j]) {
			return false
		}
		return names[i] < names[j]
	})
	var b strings.Builder
	b.WriteString("[Role list]\n")
	for _, name := range names {
		role := h.config.Roles[name]
		desc := role.Description
		if desc == "" {
			desc = "No description"
		}
		b.WriteString(fmt.Sprintf("· %s — %s\n", name, desc))
	}
	return strings.TrimSuffix(b.String(), "\n")
}

func (h *RobotHandler) cmdSwitchRole(platform, userID, roleName string) string {
	if roleName == "" {
		return "Specify a role name, for example: role Penetration Testing"
	}
	if h.config.Roles == nil {
		return "No roles available."
	}
	role, exists := h.config.Roles[roleName]
	if !exists {
		return fmt.Sprintf("Role \"%s\" does not exist. Send \"roles\" to see the available roles.", roleName)
	}
	if !role.Enabled {
		return fmt.Sprintf("Role \"%s\" is disabled.", roleName)
	}
	h.setRole(platform, userID, roleName)
	return fmt.Sprintf("Switched to role: \"%s\"\n%s", roleName, role.Description)
}

func robotAgentModeLabel(mode string) string {
	switch config.NormalizeAgentMode(mode) {
	case "deep":
		return "Deep"
	case "plan_execute":
		return "Plan-Execute"
	case "supervisor":
		return "Supervisor"
	default:
		return "Single agent"
	}
}

func parseRobotAgentMode(input string) (string, bool) {
	switch strings.ToLower(strings.TrimSpace(input)) {
	case "single", "pi-single", "pi_single", "eino_single", "eino-single", "单代理", "eino单代理", "eino 单代理":
		return "single", true
	case "deep":
		return "deep", true
	case "plan_execute", "plan-execute", "planexecute", "pe":
		return "plan_execute", true
	case "supervisor", "super", "sv":
		return "supervisor", true
	default:
		return "", false
	}
}

func (h *RobotHandler) cmdModes(platform, userID string) string {
	current := h.getAgentMode(platform, userID)
	multiStatus := "Available"
	if h.config == nil || !h.config.MultiAgent.Enabled {
		multiStatus = "Unavailable (enable Agent multi-agent in system settings)"
	}
	return fmt.Sprintf("[Conversation modes]\n· Single agent — Available\n· Deep — %s\n· Plan-Execute — %s\n· Supervisor — %s\n\nCurrent mode: %s\nSwitch example: mode deep", multiStatus, multiStatus, multiStatus, robotAgentModeLabel(current))
}

func (h *RobotHandler) cmdSwitchMode(platform, userID, input string) string {
	mode, ok := parseRobotAgentMode(input)
	if !ok {
		return fmt.Sprintf("Unsupported conversation mode \"%s\". Send \"modes\" to see the available modes.", strings.TrimSpace(input))
	}
	if mode != "single" && (h.config == nil || !h.config.MultiAgent.Enabled) {
		return fmt.Sprintf("Cannot switch to %s: enable Agent multi-agent in system settings first.", robotAgentModeLabel(mode))
	}
	h.setAgentMode(platform, userID, mode)
	return fmt.Sprintf("Switched conversation mode: %s\nSubsequent messages and new conversations will use this mode.", robotAgentModeLabel(mode))
}

func (h *RobotHandler) cmdDelete(platform, userID, convID string) string {
	if convID == "" {
		return "Specify a conversation ID, for example: delete xxx-xxx-xxx"
	}
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		return "The current platform account is not yet bound."
	}
	if !h.db.UserCanAccessResource(access.User.ID, robotPrincipal(access).ScopeFor("chat:delete"), "conversation", convID) {
		return "Conversation does not exist or access is denied."
	}
	h.setPendingConfirmation(platform, userID, "delete_conversation", convID)
	return fmt.Sprintf("⚠️ About to delete conversation ID: %s\nThis cannot be undone. Send \"confirm\" within 2 minutes to continue, or send \"cancel\".", convID)
}

func (h *RobotHandler) executeDelete(platform, userID, convID string) string {
	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil || !h.db.UserCanAccessResource(access.User.ID, robotPrincipal(access).ScopeFor("chat:delete"), "conversation", convID) {
		return "Conversation does not exist or you have no permission to delete it."
	}
	sk := h.sessionKey(platform, userID)
	h.mu.RLock()
	currentConvID := h.sessions[sk]
	h.mu.RUnlock()
	if convID == currentConvID {
		// When deleting the current conversation, clear the session binding first
		h.mu.Lock()
		delete(h.sessions, sk)
		delete(h.sessionRoles, sk)
		delete(h.sessionModes, sk)
		h.mu.Unlock()
		h.deleteSessionBinding(sk)
	}
	if h.agentHandler != nil {
		h.agentHandler.CancelRunningTaskForConversation(convID)
	}
	if err := h.db.DeleteConversation(convID); err != nil {
		return "Delete failed: " + err.Error()
	}
	h.recordRobotCommandAudit(access, platform, "conversation_delete", "conversation", convID, "Bot deleted conversation")
	return fmt.Sprintf("Deleted conversation ID: %s", convID)
}

func (h *RobotHandler) cmdVersion() string {
	v := h.config.Version
	if v == "" {
		v = "Unknown"
	}
	return "CyberStrikeAI " + v
}

func (h *RobotHandler) cmdIdentity(platform, userID string) string {
	authorization := h.config.Robots.AuthorizationFor(platform)
	mode := authorization.EffectiveMode()
	modeLabel := "Per-user binding (user_binding)"
	if mode == config.RobotAuthModeServiceAccount {
		modeLabel = "Dedicated service account (service_account)"
	}
	var b strings.Builder
	b.WriteString("[Bot identity]\n")
	b.WriteString("Platform: " + platform + "\n")
	b.WriteString("Sender ID: " + userID + "\n")
	b.WriteString("Auth mode: " + modeLabel + "\n")

	access, err := h.resolveRobotAccess(platform, userID)
	if err != nil {
		if mode == config.RobotAuthModeServiceAccount {
			b.WriteString("Auth status: denied (sender is not on the allowlist, or the service account is unavailable)")
		} else {
			b.WriteString("Auth status: not bound\n")
			b.WriteString("Tip: generate a binding code in the web UI, then send \"bind XXXX-XXXX\"")
		}
		return b.String()
	}

	name := strings.TrimSpace(access.User.DisplayName)
	if name == "" {
		name = access.User.Username
	}
	roleNames := make([]string, 0, len(access.Roles))
	for _, role := range access.Roles {
		roleNames = append(roleNames, role.Name)
	}
	if len(roleNames) == 0 {
		roleNames = append(roleNames, "No role assigned")
	}
	b.WriteString("Auth status: authorized\n")
	b.WriteString("Effective identity: " + name + " (" + access.User.Username + ")\n")
	b.WriteString("RBAC User ID: " + access.User.ID + "\n")
	b.WriteString("Platform roles: " + strings.Join(roleNames, ", ") + "\n")
	b.WriteString("Resource scope: " + access.Scope + "\n")
	b.WriteString(fmt.Sprintf("Effective permissions: %d", len(access.Permissions)))
	return b.String()
}

func robotCommandPermission(text string) (string, bool) {
	switch {
	case text == robotCmdHelp || text == "help" || text == "？" || text == "?", text == robotCmdVersion || text == "version", text == robotCmdIdentity || text == "whoami":
		return "", true
	case text == robotCmdList || text == robotCmdListAlt || text == "list",
		strings.HasPrefix(text, robotCmdSwitch+" "), strings.HasPrefix(text, robotCmdContinue+" "),
		strings.HasPrefix(text, "switch "), strings.HasPrefix(text, "continue "),
		text == robotCmdStatus || text == "status", text == robotCmdTask || text == "task":
		return "chat:read", true
	case text == robotCmdNew || text == "new", text == robotCmdClear || text == "clear",
		strings.HasPrefix(text, robotCmdRename+" "), strings.HasPrefix(text, "rename "):
		return "chat:write", true
	case strings.HasPrefix(text, robotCmdDelete+" "), strings.HasPrefix(text, "delete "):
		return "chat:delete", true
	case text == robotCmdStop || text == "stop":
		return "agent:execute", true
	case text == robotCmdRoles || text == robotCmdRolesList || text == "roles",
		strings.HasPrefix(text, robotCmdRoles+" "), strings.HasPrefix(text, robotCmdSwitchRole+" "), strings.HasPrefix(text, "role "):
		return "roles:read", true
	case text == robotCmdModes || text == robotCmdModesList || text == "modes",
		strings.HasPrefix(text, robotCmdModes+" "), strings.HasPrefix(text, robotCmdSwitchMode+" "), strings.HasPrefix(text, "mode "):
		return "agent:execute", true
	case text == robotCmdPermissions || text == "permissions":
		return "", true
	case text == robotCmdConfirm || text == "confirm", text == robotCmdCancel || text == "cancel":
		return "", true
	case text == robotCmdDoctor || text == "doctor":
		return "config:read", true
	case text == robotCmdProjects || text == robotCmdProjectsList || text == "projects":
		return "project:read", true
	case text == robotCmdVulnAlerts || strings.HasPrefix(text, robotCmdVulnAlerts+" "),
		text == "vuln alerts" || strings.HasPrefix(text, "vuln alerts "):
		return "vulnerability:read", true
	case text == robotCmdUnbindProject || text == "unbind project",
		strings.HasPrefix(text, robotCmdNewProject+" "), strings.HasPrefix(text, "new project "),
		strings.HasPrefix(text, robotCmdBindProject+" "), strings.HasPrefix(text, "bind project "):
		return "project:write", true
	default:
		return "", false
	}
}

func (h *RobotHandler) cmdBindUser(platform, userID, code string) string {
	if h.config.Robots.AuthorizationFor(platform).EffectiveMode() != config.RobotAuthModeUserBinding {
		return "This bot uses controlled service account mode and does not accept user binding."
	}
	code = normalizeRobotBindingCode(code)
	if code == "" {
		return "Provide a binding code, for example: bind ABCD-1234"
	}
	user, err := h.db.ConsumeRobotBindingCode(platform, userID, hashRobotBindingCode(code))
	if err != nil {
		return "Binding failed: the binding code is invalid, already used or expired. Generate a new one in the web UI."
	}
	// Never carry an old synthetic-owner conversation into the RBAC identity.
	sk := h.sessionKey(platform, userID)
	h.mu.Lock()
	delete(h.sessions, sk)
	delete(h.sessionRoles, sk)
	delete(h.sessionModes, sk)
	h.mu.Unlock()
	h.deleteSessionBinding(sk)
	name := strings.TrimSpace(user.DisplayName)
	if name == "" {
		name = user.Username
	}
	if h.audit != nil {
		hint := sha256.Sum256([]byte(userID))
		h.audit.RecordSystem(audit.Entry{
			Category: "auth", Action: "robot_bind", Result: "success", Actor: user.Username,
			ResourceType: "robot_binding", ResourceID: platform + ":" + fmt.Sprintf("%x", hint[:4]), Message: "Bot platform account bound successfully",
		})
	}
	return fmt.Sprintf("Bound successfully; current identity: %s. Subsequent operations will use this user's RBAC permissions in real time.", name)
}

func (h *RobotHandler) cmdUnbindUser(platform, userID string) string {
	if h.config.Robots.AuthorizationFor(platform).EffectiveMode() != config.RobotAuthModeUserBinding {
		return "This bot uses controlled service account mode and does not need user unbinding."
	}
	_, accessErr := h.resolveRobotAccess(platform, userID)
	if accessErr != nil {
		return "The current platform account is not yet bound."
	}
	h.setPendingConfirmation(platform, userID, "unbind_user", "")
	return "⚠️ About to unbind the current platform account. Send \"confirm\" within 2 minutes to continue, or send \"cancel\"."
}

func (h *RobotHandler) executeUnbindUser(platform, userID string) string {
	access, accessErr := h.resolveRobotAccess(platform, userID)
	if accessErr != nil {
		return "The current platform account is not yet bound."
	}
	if err := h.db.DeleteRobotIdentityBinding(platform, userID); err != nil {
		return "Unbinding failed; please try again later."
	}
	sk := h.sessionKey(platform, userID)
	h.mu.Lock()
	delete(h.sessions, sk)
	delete(h.sessionRoles, sk)
	delete(h.sessionModes, sk)
	h.mu.Unlock()
	h.deleteSessionBinding(sk)
	if h.audit != nil {
		hint := sha256.Sum256([]byte(userID))
		h.audit.RecordSystem(audit.Entry{
			Category: "auth", Action: "robot_unbind", Result: "success", Actor: access.User.Username,
			ResourceType: "robot_binding", ResourceID: platform + ":" + fmt.Sprintf("%x", hint[:4]), Message: "Bot platform account unbound successfully",
		})
	}
	return "Unbound the current platform account from its CyberStrikeAI user."
}

func (h *RobotHandler) setPendingConfirmation(platform, userID, action, target string) {
	sk := h.sessionKey(platform, userID)
	now := time.Now()
	h.mu.Lock()
	for key, pending := range h.pendingConfirmations {
		if now.After(pending.ExpiresAt) {
			delete(h.pendingConfirmations, key)
		}
	}
	h.pendingConfirmations[sk] = robotPendingConfirmation{Action: action, Target: target, ExpiresAt: now.Add(2 * time.Minute)}
	h.mu.Unlock()
}

func (h *RobotHandler) cmdConfirm(platform, userID string) string {
	sk := h.sessionKey(platform, userID)
	h.mu.Lock()
	pending, ok := h.pendingConfirmations[sk]
	delete(h.pendingConfirmations, sk)
	h.mu.Unlock()
	if !ok || time.Now().After(pending.ExpiresAt) {
		return "There is no operation pending confirmation, or the confirmation has timed out."
	}
	switch pending.Action {
	case "delete_conversation":
		return h.executeDelete(platform, userID, pending.Target)
	case "unbind_user":
		return h.executeUnbindUser(platform, userID)
	default:
		return "The pending operation is invalid and was cancelled."
	}
}

func (h *RobotHandler) cmdCancelConfirmation(platform, userID string) string {
	sk := h.sessionKey(platform, userID)
	h.mu.Lock()
	_, ok := h.pendingConfirmations[sk]
	delete(h.pendingConfirmations, sk)
	h.mu.Unlock()
	if !ok {
		return "There is no operation pending confirmation."
	}
	return "Cancelled the pending operation."
}

// handleRobotCommand handles the bot's built-in commands; if a command matches, it returns (reply text, true), otherwise ("", false)
func (h *RobotHandler) handleRobotCommand(platform, userID, text string) (string, bool) {
	if (strings.HasPrefix(text, robotCmdBindUser+" ") || strings.HasPrefix(text, "bind ")) && !strings.HasPrefix(text, "bind project ") {
		parts := strings.SplitN(text, " ", 2)
		return h.cmdBindUser(platform, userID, strings.TrimSpace(parts[1])), true
	}
	if text == robotCmdUnbindUser || text == "unbind" {
		return h.cmdUnbindUser(platform, userID), true
	}
	if permission, recognized := robotCommandPermission(text); recognized && permission != "" {
		access, err := h.resolveRobotAccess(platform, userID)
		if err != nil {
			return h.robotAccessDeniedMessage(platform), true
		}
		if !access.Permissions[permission] {
			return fmt.Sprintf("Insufficient permissions: missing %s permission.", permission), true
		}
	}
	switch {
	case text == robotCmdVulnAlerts || text == "vuln alerts":
		return h.cmdVulnerabilityAlerts(platform, userID, ""), true
	case strings.HasPrefix(text, robotCmdVulnAlerts+" "):
		return h.cmdVulnerabilityAlerts(platform, userID, strings.TrimSpace(text[len(robotCmdVulnAlerts)+1:])), true
	case strings.HasPrefix(text, "vuln alerts "):
		return h.cmdVulnerabilityAlerts(platform, userID, strings.TrimSpace(text[len("vuln alerts "):])), true
	case text == robotCmdHelp || text == "help" || text == "？" || text == "?":
		return h.cmdHelp(platform, userID), true
	case text == robotCmdIdentity || text == "whoami":
		return h.cmdIdentity(platform, userID), true
	case text == robotCmdConfirm || text == "confirm":
		return h.cmdConfirm(platform, userID), true
	case text == robotCmdCancel || text == "cancel":
		return h.cmdCancelConfirmation(platform, userID), true
	case text == robotCmdList || text == robotCmdListAlt || text == "list":
		return h.cmdList(platform, userID), true
	case strings.HasPrefix(text, robotCmdSwitch+" ") || strings.HasPrefix(text, robotCmdContinue+" ") || strings.HasPrefix(text, "switch ") || strings.HasPrefix(text, "continue "):
		var id string
		switch {
		case strings.HasPrefix(text, robotCmdSwitch+" "):
			id = strings.TrimSpace(text[len(robotCmdSwitch)+1:])
		case strings.HasPrefix(text, robotCmdContinue+" "):
			id = strings.TrimSpace(text[len(robotCmdContinue)+1:])
		case strings.HasPrefix(text, "switch "):
			id = strings.TrimSpace(text[7:])
		default:
			id = strings.TrimSpace(text[9:])
		}
		return h.cmdSwitch(platform, userID, id), true
	case text == robotCmdNew || text == "new":
		return h.cmdNew(platform, userID), true
	case text == robotCmdClear || text == "clear":
		return h.cmdClear(platform, userID), true
	case text == robotCmdStatus || text == "status":
		return h.cmdStatus(platform, userID), true
	case text == robotCmdTask || text == "task":
		return h.cmdTask(platform, userID), true
	case strings.HasPrefix(text, robotCmdRename+" ") || strings.HasPrefix(text, "rename "):
		var title string
		if strings.HasPrefix(text, robotCmdRename+" ") {
			title = strings.TrimSpace(text[len(robotCmdRename)+1:])
		} else {
			title = strings.TrimSpace(text[len("rename "):])
		}
		return h.cmdRename(platform, userID, title), true
	case text == robotCmdStop || text == "stop":
		return h.cmdStop(platform, userID), true
	case text == robotCmdRoles || text == robotCmdRolesList || text == "roles":
		return h.cmdRoles(), true
	case strings.HasPrefix(text, robotCmdRoles+" ") || strings.HasPrefix(text, robotCmdSwitchRole+" ") || strings.HasPrefix(text, "role "):
		var roleName string
		switch {
		case strings.HasPrefix(text, robotCmdRoles+" "):
			roleName = strings.TrimSpace(text[len(robotCmdRoles)+1:])
		case strings.HasPrefix(text, robotCmdSwitchRole+" "):
			roleName = strings.TrimSpace(text[len(robotCmdSwitchRole)+1:])
		default:
			roleName = strings.TrimSpace(text[5:])
		}
		return h.cmdSwitchRole(platform, userID, roleName), true
	case text == robotCmdModes || text == robotCmdModesList || text == "modes":
		return h.cmdModes(platform, userID), true
	case strings.HasPrefix(text, robotCmdModes+" ") || strings.HasPrefix(text, robotCmdSwitchMode+" ") || strings.HasPrefix(text, "mode "):
		var mode string
		switch {
		case strings.HasPrefix(text, robotCmdModes+" "):
			mode = strings.TrimSpace(text[len(robotCmdModes)+1:])
		case strings.HasPrefix(text, robotCmdSwitchMode+" "):
			mode = strings.TrimSpace(text[len(robotCmdSwitchMode)+1:])
		default:
			mode = strings.TrimSpace(text[5:])
		}
		return h.cmdSwitchMode(platform, userID, mode), true
	case text == robotCmdPermissions || text == "permissions":
		return h.cmdPermissions(platform, userID), true
	case text == robotCmdDoctor || text == "doctor":
		return h.cmdDoctor(), true
	case strings.HasPrefix(text, robotCmdDelete+" ") || strings.HasPrefix(text, "delete "):
		var convID string
		if strings.HasPrefix(text, robotCmdDelete+" ") {
			convID = strings.TrimSpace(text[len(robotCmdDelete)+1:])
		} else {
			convID = strings.TrimSpace(text[7:])
		}
		return h.cmdDelete(platform, userID, convID), true
	case text == robotCmdVersion || text == "version":
		return h.cmdVersion(), true
	case text == robotCmdProjects || text == robotCmdProjectsList || text == "projects":
		return h.cmdProjects(platform, userID), true
	case text == robotCmdUnbindProject || text == "unbind project":
		return h.cmdUnbindProject(platform, userID), true
	case strings.HasPrefix(text, robotCmdNewProject+" ") || strings.HasPrefix(text, "new project "):
		var name string
		if strings.HasPrefix(text, robotCmdNewProject+" ") {
			name = strings.TrimSpace(text[len(robotCmdNewProject)+1:])
		} else {
			name = strings.TrimSpace(text[len("new project "):])
		}
		return h.cmdNewProject(platform, userID, name), true
	case strings.HasPrefix(text, robotCmdBindProject+" ") || strings.HasPrefix(text, "bind project "):
		var idOrName string
		if strings.HasPrefix(text, robotCmdBindProject+" ") {
			idOrName = strings.TrimSpace(text[len(robotCmdBindProject)+1:])
		} else {
			idOrName = strings.TrimSpace(text[len("bind project "):])
		}
		return h.cmdBindProject(platform, userID, idOrName), true
	default:
		return "", false
	}
}

// —————— WeCom ——————

// wecomXML is the WeCom callback XML (a simplified structure for plaintext mode; encrypted mode must decrypt before parsing)
type wecomXML struct {
	ToUserName   string `xml:"ToUserName"`
	FromUserName string `xml:"FromUserName"`
	CreateTime   int64  `xml:"CreateTime"`
	MsgType      string `xml:"MsgType"`
	Content      string `xml:"Content"`
	MsgID        string `xml:"MsgId"`
	AgentID      int64  `xml:"AgentID"`
	Encrypt      string `xml:"Encrypt"` // In encrypted mode the message is here
}

// wecomReplyXML is the passive reply XML (kept only for compatibility; the current code builds the XML by hand)
type wecomReplyXML struct {
	XMLName      xml.Name `xml:"xml"`
	ToUserName   string   `xml:"ToUserName"`
	FromUserName string   `xml:"FromUserName"`
	CreateTime   int64    `xml:"CreateTime"`
	MsgType      string   `xml:"MsgType"`
	Content      string   `xml:"Content"`
}

// wecomRequireToken: a WeCom callback must have a Token configured; without one the request is rejected, to prevent unauthorized triggering of the Agent.
func (h *RobotHandler) wecomRequireToken(c *gin.Context) (string, bool) {
	token := strings.TrimSpace(h.config.Robots.Wecom.Token)
	if token == "" {
		h.logger.Warn("WeCom is enabled but no token is configured; callback rejected (set robots.wecom.token in the configuration)")
		c.String(http.StatusForbidden, "")
		return "", false
	}
	return token, true
}

// HandleWecomGET handles the WeCom URL verification (GET)
func (h *RobotHandler) HandleWecomGET(c *gin.Context) {
	if !h.config.Robots.Wecom.Enabled {
		c.String(http.StatusNotFound, "")
		return
	}
	token, ok := h.wecomRequireToken(c)
	if !ok {
		return
	}
	// Gin's Query() URL-decodes automatically, so what we get is the correct base64 string
	echostr := c.Query("echostr")
	msgSignature := c.Query("msg_signature")
	timestamp := c.Query("timestamp")
	nonce := c.Query("nonce")

	// Verify the signature: sort the token, timestamp, nonce and echostr parameters, concatenate them, and compute the SHA1
	signature := h.signWecomRequest(token, timestamp, nonce, echostr)
	if signature != msgSignature {
		h.logger.Warn("WeCom URL verification signature failed", zap.String("expected", msgSignature), zap.String("got", signature))
		c.String(http.StatusBadRequest, "invalid signature")
		return
	}

	if echostr == "" {
		c.String(http.StatusBadRequest, "missing echostr")
		return
	}

	// If EncodingAESKey is configured, this is encrypted mode, and echostr must be decrypted
	if h.config.Robots.Wecom.EncodingAESKey != "" {
		decrypted, err := wecomDecrypt(h.config.Robots.Wecom.EncodingAESKey, echostr)
		if err != nil {
			h.logger.Warn("WeCom echostr decryption failed", zap.Error(err))
			c.String(http.StatusBadRequest, "decrypt failed")
			return
		}
		c.String(http.StatusOK, string(decrypted))
		return
	}

	// In plaintext mode, return echostr directly
	c.String(http.StatusOK, echostr)
}

// signWecomRequest generates the WeCom request signature
// WeCom signature algorithm: sort the token, timestamp, nonce and echostr values, concatenate them into a string, then compute the SHA1
func (h *RobotHandler) signWecomRequest(token, timestamp, nonce, echostr string) string {
	strs := []string{token, timestamp, nonce, echostr}
	sort.Strings(strs)
	s := strings.Join(strs, "")
	hash := sha1.Sum([]byte(s))
	return fmt.Sprintf("%x", hash)
}

// wecomDecrypt decrypts a WeCom message (AES-256-CBC, PKCS7; plaintext format: 16 random bytes + 4-byte length + message + corpID)
func wecomDecrypt(encodingAESKey, encryptedB64 string) ([]byte, error) {
	key, err := base64.StdEncoding.DecodeString(encodingAESKey + "=")
	if err != nil {
		return nil, err
	}
	if len(key) != 32 {
		return nil, fmt.Errorf("encoding_aes_key must be 32 bytes after decoding")
	}
	ciphertext, err := base64.StdEncoding.DecodeString(encryptedB64)
	if err != nil {
		return nil, err
	}
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	iv := key[:16]
	mode := cipher.NewCBCDecrypter(block, iv)
	if len(ciphertext)%aes.BlockSize != 0 {
		return nil, fmt.Errorf("Ciphertext length is not a multiple of the block size")
	}
	plain := make([]byte, len(ciphertext))
	mode.CryptBlocks(plain, ciphertext)
	// Remove PKCS7 padding
	n := int(plain[len(plain)-1])
	if n < 1 || n > 32 {
		return nil, fmt.Errorf("Invalid PKCS7 padding")
	}
	plain = plain[:len(plain)-n]
	// WeCom format: 16 random bytes + 4-byte length (big-endian) + message + corpID
	if len(plain) < 20 {
		return nil, fmt.Errorf("Plaintext is too short")
	}
	msgLen := binary.BigEndian.Uint32(plain[16:20])
	if int(20+msgLen) > len(plain) {
		return nil, fmt.Errorf("Message length out of range")
	}
	return plain[20 : 20+msgLen], nil
}

// wecomEncrypt encrypts a WeCom message (AES-256-CBC, PKCS7; plaintext format: 16 random bytes + 4-byte length + message + corpID)
func wecomEncrypt(encodingAESKey, message, corpID string) (string, error) {
	key, err := base64.StdEncoding.DecodeString(encodingAESKey + "=")
	if err != nil {
		return "", err
	}
	if len(key) != 32 {
		return "", fmt.Errorf("encoding_aes_key must be 32 bytes after decoding")
	}
	// Build the plaintext: 16 random bytes + 4-byte length (big-endian) + message + corpID
	random := make([]byte, 16)
	if _, err := rand.Read(random); err != nil {
		// Fallback: generate the random bytes from a timestamp
		for i := range random {
			random[i] = byte(time.Now().UnixNano() % 256)
		}
	}
	msgLen := len(message)
	msgBytes := []byte(message)
	corpBytes := []byte(corpID)
	plain := make([]byte, 16+4+msgLen+len(corpBytes))
	copy(plain[:16], random)
	binary.BigEndian.PutUint32(plain[16:20], uint32(msgLen))
	copy(plain[20:20+msgLen], msgBytes)
	copy(plain[20+msgLen:], corpBytes)
	// PKCS7 padding
	padding := aes.BlockSize - len(plain)%aes.BlockSize
	pad := bytes.Repeat([]byte{byte(padding)}, padding)
	plain = append(plain, pad...)
	// AES-256-CBC encryption
	block, err := aes.NewCipher(key)
	if err != nil {
		return "", err
	}
	iv := key[:16]
	ciphertext := make([]byte, len(plain))
	mode := cipher.NewCBCEncrypter(block, iv)
	mode.CryptBlocks(ciphertext, plain)
	return base64.StdEncoding.EncodeToString(ciphertext), nil
}

// HandleWecomPOST handles WeCom message callbacks (POST), supporting both plaintext and encrypted modes
func (h *RobotHandler) HandleWecomPOST(c *gin.Context) {
	if !h.config.Robots.Wecom.Enabled {
		h.logger.Debug("WeCom bot is not enabled; skipping request")
		c.String(http.StatusOK, "")
		return
	}
	// Get the signature parameters from the URL (needed when replying in encrypted mode)
	timestamp := c.Query("timestamp")
	nonce := c.Query("nonce")
	msgSignature := c.Query("msg_signature")

	// Read the request body first; parsing and signature verification both need it later
	bodyRaw, err := io.ReadAll(c.Request.Body)
	if err != nil {
		h.logger.Warn("WeCom POST failed to read request body", zap.Error(err))
		c.String(http.StatusOK, "")
		return
	}
	h.logger.Debug("WeCom POST request received", zap.String("body", string(bodyRaw)))

	// Verify the request signature to prevent forgery. The WeCom signature algorithm is the same as for URL verification, using the token, timestamp, nonce and Encrypt fields.
	// When WeCom is enabled, a token must be configured and the signature verified, to keep unauthorized requests from triggering the Agent.
	token, ok := h.wecomRequireToken(c)
	if !ok {
		return
	}
	if msgSignature == "" {
		h.logger.Warn("WeCom POST has no signature; rejected (make sure the callback carries msg_signature)")
		c.String(http.StatusOK, "")
		return
	}
	var tmp wecomXML
	if err := xml.Unmarshal(bodyRaw, &tmp); err != nil {
		h.logger.Warn("WeCom POST failed to parse XML before signature verification", zap.Error(err))
		c.String(http.StatusOK, "")
		return
	}
	expected := h.signWecomRequest(token, timestamp, nonce, tmp.Encrypt)
	if expected != msgSignature {
		h.logger.Warn("WeCom POST signature verification failed", zap.String("expected", expected), zap.String("got", msgSignature))
		c.String(http.StatusOK, "")
		return
	}
	if !h.acceptFreshWecomRequest(timestamp, nonce, msgSignature) {
		h.logger.Warn("WeCom POST timestamp expired or request replayed; rejected")
		c.String(http.StatusOK, "")
		return
	}

	var body wecomXML
	if err := xml.Unmarshal(bodyRaw, &body); err != nil {
		h.logger.Warn("WeCom POST failed to parse XML", zap.Error(err))
		c.String(http.StatusOK, "")
		return
	}
	h.logger.Debug("WeCom XML parsed successfully", zap.String("ToUserName", body.ToUserName), zap.String("FromUserName", body.FromUserName), zap.String("MsgType", body.MsgType), zap.String("Content", body.Content), zap.String("Encrypt", body.Encrypt))

	// Save the enterprise ID (used when replying in plaintext mode)
	enterpriseID := body.ToUserName

	// When EncodingAESKey is configured, messages must be encrypted; reject plaintext XML so it cannot bypass this
	if strings.TrimSpace(h.config.Robots.Wecom.EncodingAESKey) != "" && strings.TrimSpace(body.Encrypt) == "" {
		h.logger.Warn("WeCom is configured for encrypted mode but received a plaintext message; rejected")
		c.String(http.StatusOK, "")
		return
	}

	// Encrypted mode: decrypt first, then parse the inner XML
	if body.Encrypt != "" && h.config.Robots.Wecom.EncodingAESKey != "" {
		h.logger.Debug("WeCom entering encrypted-mode decryption flow")
		decrypted, err := wecomDecrypt(h.config.Robots.Wecom.EncodingAESKey, body.Encrypt)
		if err != nil {
			h.logger.Warn("WeCom message decryption failed", zap.Error(err))
			c.String(http.StatusOK, "")
			return
		}
		h.logger.Debug("WeCom decrypted successfully", zap.String("decrypted", string(decrypted)))
		if err := xml.Unmarshal(decrypted, &body); err != nil {
			h.logger.Warn("WeCom failed to parse XML after decryption", zap.Error(err))
			c.String(http.StatusOK, "")
			return
		}
		h.logger.Debug("WeCom inner XML parsed successfully", zap.String("FromUserName", body.FromUserName), zap.String("Content", body.Content))
	}

	tenantKey := strings.TrimSpace(enterpriseID)
	if tenantKey == "" {
		tenantKey = strings.TrimSpace(h.config.Robots.Wecom.CorpID)
	}
	if tenantKey == "" {
		tenantKey = "default"
	}
	rawUserID := strings.TrimSpace(body.FromUserName)
	replyUserID := rawUserID
	userID := ""
	if rawUserID != "" {
		userID = "t:" + tenantKey + "|u:" + rawUserID
	}
	text := strings.TrimSpace(body.Content)
	if userID == "" {
		h.logger.Warn("WeCom message has no usable user identifier; ignored")
		c.String(http.StatusOK, "success")
		return
	}

	// Limit the reply length (WeCom limits it to 2048 bytes)
	maxReplyLen := 2000
	limitReply := func(s string) string {
		if len(s) > maxReplyLen {
			return s[:maxReplyLen] + "\n\n(content too long, truncated)"
		}
		return s
	}

	if body.MsgType != "text" {
		h.logger.Debug("WeCom received a non-text message", zap.String("MsgType", body.MsgType))
		h.sendWecomReply(c, replyUserID, enterpriseID, limitReply("Only text messages are supported for now; please send text."), timestamp, nonce)
		return
	}

	// Text message: first check whether it is a built-in command (such as help, list, new conversation); these commands are fast, so they can be answered passively without relying on the active send API.
	if cmdReply, ok := h.handleRobotCommand("wecom", userID, text); ok {
		h.logger.Debug("WeCom received a command message; using passive reply", zap.String("userID", userID), zap.String("text", text))
		h.sendWecomReply(c, replyUserID, enterpriseID, limitReply(cmdReply), timestamp, nonce)
		return
	}

	h.logger.Debug("WeCom started processing the message (async AI)", zap.String("userID", userID), zap.String("text", text))

	// WeCom passive replies have a 5-second timeout, while AI calls usually take longer than that.
	// The recommended approach here: return success (or an empty string) immediately, then push the full reply through the active send interface.
	c.String(http.StatusOK, "success")

	// Process the message asynchronously and send the result through the WeCom active message interface
	go func() {
		reply := h.HandleMessage("wecom", userID, text)
		reply = limitReply(reply)
		h.logger.Debug("WeCom message processing completed", zap.String("userID", userID), zap.String("reply", reply))
		// Call the WeCom API to actively send the message
		h.sendWecomMessageViaAPI(rawUserID, enterpriseID, reply)
	}()
}

// sendWecomReply sends a WeCom reply (automatically encrypts in encrypted mode)
// Parameters: toUser = user ID, fromUser = enterprise ID (plaintext mode) / CorpID (encrypted mode), content = reply content, timestamp/nonce = request parameters
func (h *RobotHandler) sendWecomReply(c *gin.Context, toUser, fromUser, content, timestamp, nonce string) {
	// Encrypted mode: check whether EncodingAESKey is configured
	if h.config.Robots.Wecom.EncodingAESKey != "" {
		// Encrypted mode encrypts with the CorpID
		corpID := h.config.Robots.Wecom.CorpID
		if corpID == "" {
			h.logger.Warn("WeCom encrypted mode is missing the CorpID configuration")
			c.String(http.StatusOK, "")
			return
		}

		// Build the complete plaintext XML reply (the format strictly follows the WeCom documentation)
		plainResp := fmt.Sprintf(`<xml>
<ToUserName><![CDATA[%s]]></ToUserName>
<FromUserName><![CDATA[%s]]></FromUserName>
<CreateTime>%d</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[%s]]></Content>
</xml>`, toUser, fromUser, time.Now().Unix(), content)

		encrypted, err := wecomEncrypt(h.config.Robots.Wecom.EncodingAESKey, plainResp, corpID)
		if err != nil {
			h.logger.Warn("WeCom reply encryption failed", zap.Error(err))
			c.String(http.StatusOK, "")
			return
		}
		// Generate the signature with the timestamp/nonce from the request (WeCom requires the reply to use the same timestamp and nonce as the request)
		msgSignature := h.signWecomRequest(h.config.Robots.Wecom.Token, timestamp, nonce, encrypted)

		h.logger.Debug("WeCom sending encrypted reply",
			zap.String("Encrypt", encrypted[:50]+"..."),
			zap.String("MsgSignature", msgSignature),
			zap.String("TimeStamp", timestamp),
			zap.String("Nonce", nonce))

		// Encrypted mode returns only the 4 core fields (required by WeCom's official documentation)
		xmlResp := fmt.Sprintf(`<xml><Encrypt><![CDATA[%s]]></Encrypt><MsgSignature><![CDATA[%s]]></MsgSignature><TimeStamp><![CDATA[%s]]></TimeStamp><Nonce><![CDATA[%s]]></Nonce></xml>`, encrypted, msgSignature, timestamp, nonce)
		// also log the final response body so we can cross-check with the
		// network traffic or developer console
		h.logger.Debug("WeCom encrypted reply packet", zap.String("xml", xmlResp))
		// for additional confidence, decrypt the payload ourselves and log it
		if dec, err2 := wecomDecrypt(h.config.Robots.Wecom.EncodingAESKey, encrypted); err2 == nil {
			h.logger.Debug("WeCom encrypted reply decryption check", zap.String("plain", string(dec)))
		} else {
			h.logger.Warn("WeCom encrypted reply decryption check failed", zap.Error(err2))
		}

		// Write the response directly with c.Writer.Write, to avoid the escaping problem of c.String
		c.Writer.WriteHeader(http.StatusOK)
		// use text/xml as that's what WeCom examples show
		c.Writer.Header().Set("Content-Type", "text/xml; charset=utf-8")
		_, _ = c.Writer.Write([]byte(xmlResp))
		h.logger.Debug("WeCom encrypted reply sent")
		return
	}

	// Plaintext mode
	h.logger.Debug("WeCom sending plaintext reply", zap.String("ToUserName", toUser), zap.String("FromUserName", fromUser), zap.String("Content", content[:50]+"..."))

	// Build the XML response by hand (wrap all fields in CDATA and include AgentID)
	xmlResp := fmt.Sprintf(`<xml>
<ToUserName><![CDATA[%s]]></ToUserName>
<FromUserName><![CDATA[%s]]></FromUserName>
<CreateTime>%d</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[%s]]></Content>
</xml>`, toUser, fromUser, time.Now().Unix(), content)

	// log the exact plaintext response for debugging
	h.logger.Debug("WeCom plaintext reply packet", zap.String("xml", xmlResp))

	// use text/xml as recommended by WeCom docs
	c.Header("Content-Type", "text/xml; charset=utf-8")
	c.String(http.StatusOK, xmlResp)
	h.logger.Debug("WeCom plaintext reply sent")
}

// —————— Test endpoint (requires login; used to verify bot logic without a DingTalk/Lark client) ——————

// CreateRobotBindingCode creates a short-lived, single-use secret for the
// currently authenticated RBAC user. Only its hash is persisted.
func (h *RobotHandler) CreateRobotBindingCode(c *gin.Context) {
	session, ok := security.CurrentSession(c)
	if !ok || strings.TrimSpace(session.UserID) == "" {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized access"})
		return
	}
	random := make([]byte, 5)
	if _, err := rand.Read(random); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate binding code"})
		return
	}
	raw := base32.StdEncoding.WithPadding(base32.NoPadding).EncodeToString(random)
	code := raw[:4] + "-" + raw[4:]
	expiresAt := time.Now().Add(robotBindingCodeTTL)
	if err := h.db.CreateRobotBindingCode(session.UserID, hashRobotBindingCode(code), expiresAt); err != nil {
		h.logger.Warn("Failed to create bot binding code", zap.String("user_id", session.UserID), zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to generate binding code"})
		return
	}
	if h.audit != nil {
		h.audit.Record(c, audit.Entry{Category: "auth", Action: "robot_binding_code_create", Result: "success", ResourceType: "user", ResourceID: session.UserID, Message: "Generate a one-time bot binding code"})
	}
	c.Header("Cache-Control", "no-store")
	c.JSON(http.StatusOK, gin.H{
		"code": code, "expires_at": expiresAt.UTC().Format(time.RFC3339), "expires_in_seconds": int(robotBindingCodeTTL.Seconds()),
	})
}

func (h *RobotHandler) ListMyRobotBindings(c *gin.Context) {
	session, ok := security.CurrentSession(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized access"})
		return
	}
	bindings, err := h.db.ListRobotUserBindings(session.UserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get bot binding"})
		return
	}
	items := make([]gin.H, 0, len(bindings))
	for _, binding := range bindings {
		sum := sha256.Sum256([]byte(binding.ExternalUserID))
		items = append(items, gin.H{
			"id": binding.ID, "platform": binding.Platform, "external_user_hint": fmt.Sprintf("%x", sum[:4]),
			"enabled": binding.Enabled, "created_at": binding.CreatedAt, "updated_at": binding.UpdatedAt,
		})
	}
	c.JSON(http.StatusOK, gin.H{"bindings": items})
}

func (h *RobotHandler) DeleteMyRobotBinding(c *gin.Context) {
	session, ok := security.CurrentSession(c)
	if !ok {
		c.JSON(http.StatusUnauthorized, gin.H{"error": "Unauthorized access"})
		return
	}
	if err := h.db.DeleteRobotUserBindingForUser(c.Param("id"), session.UserID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Binding not found"})
		return
	}
	if h.audit != nil {
		h.audit.Record(c, audit.Entry{Category: "auth", Action: "robot_binding_revoke", Result: "success", ResourceType: "robot_binding", ResourceID: c.Param("id"), Message: "Revoke bot platform account binding"})
	}
	c.Status(http.StatusNoContent)
}

// RobotTestRequest simulates a bot message request
type RobotTestRequest struct {
	Platform string `json:"platform"` // For example "dingtalk", "lark", "wecom"
	UserID   string `json:"user_id"`
	Text     string `json:"text"`
}

// HandleRobotTest is for local verification: POST JSON { "platform", "user_id", "text" }, returns { "reply": "..." }
func (h *RobotHandler) HandleRobotTest(c *gin.Context) {
	var req RobotTestRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Request body must be JSON containing platform, user_id, and text"})
		return
	}
	platform := strings.TrimSpace(req.Platform)
	if platform == "" {
		platform = "test"
	}
	userID := strings.TrimSpace(req.UserID)
	if userID == "" {
		userID = "test_user"
	}
	reply := h.HandleMessage(platform, userID, req.Text)
	c.JSON(http.StatusOK, gin.H{"reply": reply})
}

// sendWecomMessageViaAPI actively sends a message through the WeCom API (used to send the result after asynchronous processing)
func (h *RobotHandler) sendWecomMessageViaAPI(toUser, toParty, content string) {
	if !h.config.Robots.Wecom.Enabled {
		return
	}

	secret := h.config.Robots.Wecom.Secret
	corpID := h.config.Robots.Wecom.CorpID
	agentID := h.config.Robots.Wecom.AgentID

	if secret == "" || corpID == "" {
		h.logger.Warn("WeCom active API is missing the secret or corpID configuration")
		return
	}

	// Step 1: get the access_token
	tokenURL := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=%s&corpsecret=%s", corpID, secret)
	resp, err := http.Get(tokenURL)
	if err != nil {
		h.logger.Warn("WeCom failed to get token", zap.Error(err))
		return
	}
	defer resp.Body.Close()

	var tokenResp struct {
		AccessToken string `json:"access_token"`
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
	}
	if err := json.NewDecoder(resp.Body).Decode(&tokenResp); err != nil {
		h.logger.Warn("WeCom failed to parse token response", zap.Error(err))
		return
	}
	if tokenResp.ErrCode != 0 {
		h.logger.Warn("WeCom token error", zap.String("errmsg", tokenResp.ErrMsg), zap.Int("errcode", tokenResp.ErrCode))
		return
	}

	// Step 2: build the send-message request
	msgReq := map[string]interface{}{
		"touser":  toUser,
		"msgtype": "text",
		"agentid": agentID,
		"text": map[string]interface{}{
			"content": content,
		},
	}

	msgBody, err := json.Marshal(msgReq)
	if err != nil {
		h.logger.Warn("WeCom failed to serialize message", zap.Error(err))
		return
	}

	// Step 3: send the message
	sendURL := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=%s", tokenResp.AccessToken)
	msgResp, err := http.Post(sendURL, "application/json", bytes.NewReader(msgBody))
	if err != nil {
		h.logger.Warn("WeCom failed to send message proactively", zap.Error(err))
		return
	}
	defer msgResp.Body.Close()

	var sendResp struct {
		ErrCode     int    `json:"errcode"`
		ErrMsg      string `json:"errmsg"`
		InvalidUser string `json:"invaliduser"`
		MsgID       string `json:"msgid"`
	}
	if err := json.NewDecoder(msgResp.Body).Decode(&sendResp); err != nil {
		h.logger.Warn("WeCom failed to parse send response", zap.Error(err))
		return
	}

	if sendResp.ErrCode == 0 {
		h.logger.Debug("WeCom sent message proactively", zap.String("msgid", sendResp.MsgID))
	} else {
		h.logger.Warn("WeCom failed to send message proactively", zap.String("errmsg", sendResp.ErrMsg), zap.Int("errcode", sendResp.ErrCode), zap.String("invaliduser", sendResp.InvalidUser))
	}
}

// —————— DingTalk ——————

// HandleDingtalkPOST handles DingTalk event callbacks (stream access, etc.); currently a placeholder that returns 200
func (h *RobotHandler) HandleDingtalkPOST(c *gin.Context) {
	if !h.config.Robots.Dingtalk.Enabled {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	// The DingTalk stream/event callback format must be parsed and replied to asynchronously per the official documentation; this only returns 200
	c.JSON(http.StatusOK, gin.H{"message": "ok"})
}

// —————— Lark ——————

// HandleLarkPOST handles Lark event callbacks; currently a placeholder that returns 200; verification requires returning the challenge
func (h *RobotHandler) HandleLarkPOST(c *gin.Context) {
	if !h.config.Robots.Lark.Enabled {
		c.JSON(http.StatusOK, gin.H{})
		return
	}
	var body struct {
		Challenge string `json:"challenge"`
	}
	if err := c.ShouldBindJSON(&body); err == nil && body.Challenge != "" {
		c.JSON(http.StatusOK, gin.H{"challenge": body.Challenge})
		return
	}
	c.JSON(http.StatusOK, gin.H{})
}
