package handler

import (
	"strings"
	"testing"

	"cyberstrike-ai/internal/database"
)

func TestBuildWebshellAssistantContext_WindowsExplicit(t *testing.T) {
	conn := &database.WebShellConnection{
		ID:       "ws_win01",
		Remark:   "IIS Windows target host",
		URL:      "http://example.com/shell.php",
		Type:     "php",
		OS:       "windows",
		Encoding: "gbk",
	}
	got := BuildWebshellAssistantContext(conn, WebshellSkillHintDefault, "List the current directory and tell me where the flag is")

	mustContain(t, got,
		"[WebShell assistant context]",
		"ws_win01",
		"IIS Windows target host",
		"- Target OS: Windows",
		"dir /a",
		"move /y",
		"avoid Unix commands such as ls / cat / rm",
		"- Response encoding: GBK",
		"the backend already transcodes to UTF-8",
		"set connection_id to \"ws_win01\"",
		"webshell_exec, webshell_file_list",
		WebshellSkillHintDefault,
		"User request: List the current directory and tell me where the flag is",
	)
	// The Windows scenario must not recommend Linux commands
	mustNotContain(t, got, "recommended sh/bash")
}

func TestBuildWebshellAssistantContext_LinuxAutoFromPHP(t *testing.T) {
	conn := &database.WebShellConnection{
		ID:       "ws_lnx01",
		Remark:   "", // when the remark is empty, fall back to the URL
		URL:      "http://example.com/a.php",
		Type:     "php",
		OS:       "auto", // auto + php → linux
		Encoding: "",     // auto encoding is not mentioned explicitly
	}
	got := BuildWebshellAssistantContext(conn, WebshellSkillHintDefault, "Take a look at /etc/passwd")

	mustContain(t, got,
		"Connection ID: ws_lnx01",
		"remark: http://example.com/a.php", // falls back to the URL when the remark is empty
		"- Target OS: Linux/Unix",
		"ls -la",
		"mkdir -p",
		"avoid Windows commands such as dir, type, del, move",
		"User request: Take a look at /etc/passwd",
	)
	// encoding=auto must not emit the "Response encoding:" line
	mustNotContain(t, got, "Response encoding:")
	// The Linux scenario must not recommend Windows commands
	mustNotContain(t, got, "recommended cmd/PowerShell")
}

func TestBuildWebshellAssistantContext_AutoFromASPDefaultsToWindows(t *testing.T) {
	// Backward compatibility: an old connection without os configured is treated as Windows when shellType=asp
	conn := &database.WebShellConnection{
		ID:       "ws_asp01",
		Remark:   "Legacy ASP target",
		Type:     "asp",
		OS:       "", // an empty string is the same as auto
		Encoding: "gb18030",
	}
	got := BuildWebshellAssistantContext(conn, WebshellSkillHintMultiAgent, "Check the current user")

	mustContain(t, got,
		"- Target OS: Windows",
		"- Response encoding: GB18030",
		"the backend already transcodes to UTF-8 on return",
		WebshellSkillHintMultiAgent,
	)
	// The multi-agent skill text has no DeepAgent and must not mix in the default text
	mustNotContain(t, got, "DeepAgent")
}

func TestBuildWebshellAssistantContext_MultiAgentSkillHint(t *testing.T) {
	conn := &database.WebShellConnection{ID: "ws_m1", Remark: "x", Type: "php", OS: "linux"}
	got := BuildWebshellAssistantContext(conn, WebshellSkillHintMultiAgent, "hi")
	mustContain(t, got, WebshellSkillHintMultiAgent)
	mustNotContain(t, got, "DeepAgent")
}

func TestBuildWebshellAssistantContext_DefaultSkillHintFallback(t *testing.T) {
	conn := &database.WebShellConnection{ID: "ws_d1", Remark: "x", Type: "php", OS: "linux"}
	// An empty skillHint must fall back to the default
	got := BuildWebshellAssistantContext(conn, "", "hi")
	mustContain(t, got, WebshellSkillHintDefault)
}

func TestBuildWebshellAssistantContext_UTF8EncodingIsAnnotated(t *testing.T) {
	conn := &database.WebShellConnection{
		ID: "ws_u1", Remark: "u", Type: "jsp", OS: "linux", Encoding: "utf-8",
	}
	got := BuildWebshellAssistantContext(conn, WebshellSkillHintDefault, "hi")
	mustContain(t, got, "Response encoding: UTF-8", "natively UTF-8")
}

func TestBuildWebshellAssistantContext_NilConnReturnsUserMsg(t *testing.T) {
	// Defensive: conn == nil must not panic and returns the original message
	got := BuildWebshellAssistantContext(nil, WebshellSkillHintDefault, "just the message")
	if got != "just the message" {
		t.Errorf("nil conn should return userMsg as-is, got %q", got)
	}
}

func TestDescribeTargetOSForPrompt(t *testing.T) {
	cases := map[string][]string{
		"windows": {"Windows", "dir /a", "move /y", "PowerShell"},
		"linux":   {"Linux/Unix", "ls -la", "mkdir -p"},
		"":        {"Unknown", "uname"}, // defensive branch
	}
	for in, wants := range cases {
		got := describeTargetOSForPrompt(in)
		for _, w := range wants {
			if !strings.Contains(got, w) {
				t.Errorf("describeTargetOSForPrompt(%q) should contain %q, got: %s", in, w, got)
			}
		}
	}
}

func TestDescribeEncodingForPrompt(t *testing.T) {
	cases := map[string]string{
		"utf-8":   "UTF-8",
		"gbk":     "GBK",
		"gb18030": "GB18030",
		"auto":    "",
		"":        "",
	}
	for in, want := range cases {
		got := describeEncodingForPrompt(in)
		if want == "" && got != "" {
			t.Errorf("describeEncodingForPrompt(%q) should return empty string, got: %s", in, got)
		}
		if want != "" && !strings.Contains(got, want) {
			t.Errorf("describeEncodingForPrompt(%q) should contain %q, got: %s", in, want, got)
		}
	}
}

// ---- helpers ----

func mustContain(t *testing.T, text string, substrings ...string) {
	t.Helper()
	for _, s := range substrings {
		if !strings.Contains(text, s) {
			t.Errorf("expected text to contain %q\n--- text ---\n%s", s, text)
		}
	}
}

func mustNotContain(t *testing.T, text string, substrings ...string) {
	t.Helper()
	for _, s := range substrings {
		if strings.Contains(text, s) {
			t.Errorf("text should not contain %q\n--- text ---\n%s", s, text)
		}
	}
}
