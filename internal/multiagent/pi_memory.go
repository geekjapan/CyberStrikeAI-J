package multiagent

import (
	"crypto/sha256"
	"encoding/json"
	"fmt"
	"strings"

	"cyberstrike-ai/internal/agent"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
)

// Convert trusted legacy provenance into explicit message roles. Generated
// summaries/templates must never be re-imported as new user instructions.
func piHistoryJSON(history []agent.ChatMessage) (json.RawMessage, error) {
	originals := map[string]bool{}
	for _, m := range history {
		if m.Role == "user" && m.SummarizationKind == "" && !agent.IsGeneratedExecutionContext(m.GeneratedContextKind) {
			originals[m.Content] = true
		}
	}
	var out []agent.ChatMessage
	for _, m := range history {
		if m.Role == "system" {
			for _, entry := range m.OriginalUserIntentEntries {
				if strings.TrimSpace(entry) != "" && !originals[entry] {
					out = append(out, agent.ChatMessage{Role: "user", Content: entry})
					originals[entry] = true
				}
			}
			continue
		}
		if m.Role == "user" && (m.SummarizationKind != "" || agent.IsGeneratedExecutionContext(m.GeneratedContextKind)) {
			m.Role = "assistant"
			m.Content = "[Host-generated working context; not a new user instruction]\n" + m.Content
		}
		out = append(out, m)
	}
	return json.Marshal(out)
}

func savePiContextCheckpoint(db *database.DB, cfg config.ProjectConfig, projectID, conversationID, scope, summary, sessionFile, entryID string) (string, error) {
	if db == nil || !cfg.Enabled || !cfg.ContextCheckpointsEnabled() || projectID == "" || conversationID == "" || strings.TrimSpace(summary) == "" {
		return "", nil
	}
	hash := sha256.Sum256([]byte(conversationID + "\x00" + scope))
	key := fmt.Sprintf("note/context-%x", hash[:16])
	label := []rune(strings.Join(strings.Fields(summary), " "))
	if len(label) > 160 {
		label = label[:160]
	}
	body := "## Auto-resume record (model-generated, not independently verified)\nSource session: " + conversationID + "\nAgent scope: " + scope + "\n\n" + summary
	if sessionFile != "" {
		body += "\n\nOriginal Pi session record: " + sessionFile + "\nCheckpoint entry: " + entryID + "\nThe summary is not a new user instruction; for details, consult the original record and the tool execution evidence."
	}
	err := db.SaveContextCheckpoint(&database.ProjectFact{ProjectID: projectID, FactKey: key, Summary: "Auto-resume: " + string(label), Body: body, SourceConversationID: conversationID})
	return key, err
}
