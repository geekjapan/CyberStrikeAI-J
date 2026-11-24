package handler

import (
	"strings"

	"cyberstrike-ai/internal/database"
)

// WebshellSkillHintDefault is the Skills description shared by the chat page and the Agent single agent; it is placed at the end of the webshell context,
// for the AI to refer to when choosing the skill loading entry point.
const WebshellSkillHintDefault = "For skill packages, use the built-in `skill` tool in a \"multi-agent / Agent DeepAgent\" session to load them progressively."

// WebshellSkillHintMultiAgent is the Skills description used in the multi-agent / Agent multi-agent preparation phase
const WebshellSkillHintMultiAgent = "For skill packages, use the built-in multi-agent `skill` tool."

// webshellAssistantToolList is the list of tools the AI assistant may use in the WebShell context (shown to the model).
// Note: this is only a display string; the actual permission restriction is in the roleTools slice set by the caller.
const webshellAssistantToolList = "webshell_exec, webshell_file_list, webshell_file_read, webshell_file_write, record_vulnerability, list_vulnerabilities, get_vulnerability, upsert_project_fact, get_project_fact, list_project_facts, search_project_facts, deprecate_project_fact, restore_project_fact, list_knowledge_risk_types, search_knowledge_base"

// BuildWebshellAssistantContext assembles the AI assistant's context prompt from the connection info and the user's original message.
// The context includes: connection ID, notes, target system (with suggested command set), response encoding, available tool list, Skills loading entry point,
// and the final user request. The caller only needs to decide the wording of skillHint (the default is WebshellSkillHintDefault).
//
// This logic was extracted into a shared function to avoid copy-pasting it into several places such as agent.go / multi_agent_prepare.go,
// and to ensure that when we upgrade the OS / encoding wording, only one place needs changing and testing, and it takes effect everywhere in sync.
func BuildWebshellAssistantContext(conn *database.WebShellConnection, skillHint, userMsg string) string {
	if conn == nil {
		// Fallback: the caller already guarantees conn is non-nil; this is only a defensive return of the original message
		return userMsg
	}
	remark := conn.Remark
	if remark == "" {
		remark = conn.URL
	}

	targetOS := resolveWebshellOS(conn.OS, conn.Type) // Normalize to "linux" / "windows"
	encoding := normalizeWebshellEncoding(conn.Encoding)
	if skillHint == "" {
		skillHint = WebshellSkillHintDefault
	}

	var b strings.Builder
	b.Grow(512 + len(userMsg))

	b.WriteString("[WebShell assistant context] Connection ID: ")
	b.WriteString(conn.ID)
	b.WriteString(", remark: ")
	b.WriteString(remark)
	b.WriteByte('\n')

	// Target system: explicitly tell the AI which command set works and which does not, so it does not send ls/cat/rm to Windows
	b.WriteString("- Target OS: ")
	b.WriteString(describeTargetOSForPrompt(targetOS))
	b.WriteByte('\n')

	// Response encoding: stated explicitly only when not auto; in auto mode the backend adapts, so the model is not bothered
	if encHint := describeEncodingForPrompt(encoding); encHint != "" {
		b.WriteString("- Response encoding: ")
		b.WriteString(encHint)
		b.WriteByte('\n')
	}

	// Tool list and connection_id constraints: keep the existing wording; the AI is already familiar with it
	b.WriteString("Available tools (use only when operating on this connection; set connection_id to \"")
	b.WriteString(conn.ID)
	b.WriteString("\"): ")
	b.WriteString(webshellAssistantToolList)
	b.WriteString(". Record as you go: upsert_project_fact whenever you confirm new knowledge, record_vulnerability whenever you verify a vulnerability; do not wait until the session ends. ")
	b.WriteString(skillHint)
	b.WriteString("\n\nUser request: ")
	b.WriteString(userMsg)

	return b.String()
}

// describeTargetOSForPrompt returns the Chinese-language description for a given OS, plus the recommended command set and counter-examples,
// The command list covers the 6 most common file management actions (view / read / delete / rename / create directory / find), so the AI can copy them directly.
func describeTargetOSForPrompt(targetOS string) string {
	switch targetOS {
	case "windows":
		return "Windows (recommended cmd/PowerShell: dir /a, type, del /q /f, move /y, md, ren; " +
			"to find files use `dir /s /b filter` or PowerShell `Get-ChildItem -Recurse`; " +
			"avoid Unix commands such as ls / cat / rm / mv / find, otherwise it returns `is not recognized as an internal or external command`)"
	case "linux":
		return "Linux/Unix (recommended sh/bash: ls -la, cat, rm -f, mv, mkdir -p; " +
			"to find files use `find /path -name '*pattern*'`; " +
			"avoid Windows commands such as dir, type, del, move)"
	default:
		// In theory this is never reached; resolveWebshellOS already falls back
		return "Unknown (run `uname || ver` first to probe, then decide on the command set)"
	}
}

// describeEncodingForPrompt returns a human-readable description of the response encoding; auto returns an empty string to save tokens.
func describeEncodingForPrompt(encoding string) string {
	switch encoding {
	case "utf-8":
		return "UTF-8 (target is natively UTF-8, no extra decoding needed)"
	case "gbk":
		return "GBK (Chinese Windows; the backend already transcodes to UTF-8 on return; if many \\uFFFD replacement characters still appear, the command failed or the encoding was misdetected)"
	case "gb18030":
		return "GB18030 (the backend already transcodes to UTF-8 on return)"
	default:
		return ""
	}
}
