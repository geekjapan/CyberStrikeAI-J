package handler

import (
	"strings"

	"cyberstrike-ai/internal/apimsg"
	"cyberstrike-ai/internal/project"
	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// agentSessionContextBlock injects the session working directory and the project blackboard (appended as a system prompt block).
// User input is carried by message history; after compression, the summarization instructions keep the key constraints.
func (h *AgentHandler) agentSessionContextBlock(conversationID string) string {
	var parts []string
	if ws := h.buildWorkspaceBlock(conversationID); ws != "" {
		parts = append(parts, ws)
	}
	if bb := h.projectBlackboardBlock(conversationID); bb != "" {
		parts = append(parts, bb)
	}
	return strings.Join(parts, "\n\n")
}

func (h *AgentHandler) buildWorkspaceBlock(conversationID string) string {
	if h == nil || h.config == nil {
		return ""
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ""
	}
	projectID := h.conversationProjectID(conversationID)
	rel := project.WorkspaceRootDir(h.config.Agent.WorkspaceRootDir, projectID, conversationID)
	abs, err := project.EnsureWorkspace(rel)
	if err != nil {
		if h.logger != nil {
			h.logger.Warn("Failed to create session working directory",
				zap.String("conversationId", conversationID),
				zap.String("projectId", projectID),
				zap.String("path", rel),
				zap.Error(err))
		}
		return ""
	}
	return project.BuildWorkspaceBlock(abs) + "\n\n" + project.BuildWorkspaceInventoryBlock(abs)
}

// projectBlackboardBlock builds the project fact index block for a conversation ID (injected into the system prompt).
func (h *AgentHandler) projectBlackboardBlock(conversationID string) string {
	if h == nil || h.db == nil || h.config == nil {
		return ""
	}
	if !h.config.Project.Enabled {
		return ""
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ""
	}
	projectID, err := h.db.GetConversationProjectID(conversationID)
	if err != nil || projectID == "" {
		return ""
	}
	block, err := project.BuildProjectBlackboardBlock(h.db, projectID, h.config.Project, conversationID)
	if err != nil {
		h.logger.Warn("Failed to build project blackboard index", zap.String("conversationId", conversationID), zap.Error(err))
		return ""
	}
	return strings.TrimSpace(block)
}

// conversationProjectID returns the project ID bound to the conversation; returns an empty string if it is unbound or the lookup fails.
func (h *AgentHandler) conversationProjectID(conversationID string) string {
	if h == nil || h.db == nil {
		return ""
	}
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ""
	}
	projectID, err := h.db.GetConversationProjectID(conversationID)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(projectID)
}

// chatPromptExtra is the per-run system prompt block of a chat request: the
// session context plus the output language of the UI that sent it.
func (h *AgentHandler) chatPromptExtra(conversationID string, req *ChatRequest) string {
	lang := ""
	if req != nil {
		lang = req.OutputLanguage
	}
	return project.AppendSystemPromptBlock(h.agentSessionContextBlock(conversationID), outputLanguageBlock(lang))
}

// requestOutputLanguage returns the UI language a chat request carries, or ""
// when it names none, so API clients that send no language keep the prompts'
// "the user's language" behaviour.
func requestOutputLanguage(c *gin.Context) string {
	if c == nil || (strings.TrimSpace(c.Query("lang")) == "" && strings.TrimSpace(c.GetHeader("Accept-Language")) == "") {
		return ""
	}
	return apimsg.Lang(c)
}

var outputLanguageNames = map[string]string{"ja": "Japanese", "en": "English"}

// outputLanguageBlock pins the language the agent writes in. The prompts only
// ask for "the user's language", which a message that is just a target (an IP
// or a URL) does not reveal, and the model then picks one on its own.
func outputLanguageBlock(lang string) string {
	name, ok := outputLanguageNames[lang]
	if !ok {
		return ""
	}
	return "Output language: write every explanation, plan, progress note, summary, report and recorded finding (titles, descriptions, reproduction steps, impact, remediation) in " + name +
		". This holds even when the user's message, tool output or retrieved documents are in another language. Keep commands, code, payloads, file paths, identifiers and CVE IDs unchanged."
}
