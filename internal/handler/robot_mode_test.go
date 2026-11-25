package handler

import (
	"strings"
	"testing"

	"cyberstrike-ai/internal/config"

	"go.uber.org/zap"
)

func TestRobotModeSwitch(t *testing.T) {
	h := NewRobotHandler(&config.Config{MultiAgent: config.MultiAgentConfig{Enabled: true}}, nil, nil, zap.NewNop())

	if got := h.cmdSwitchMode("lark", "user-1", "plan-execute"); !strings.Contains(got, "Plan-Execute") {
		t.Fatalf("unexpected switch response: %s", got)
	}
	if got := h.getAgentMode("lark", "user-1"); got != "plan_execute" {
		t.Fatalf("mode = %q, want plan_execute", got)
	}
	if got := h.cmdModes("lark", "user-1"); !strings.Contains(got, "Current mode: Plan-Execute") {
		t.Fatalf("unexpected modes response: %s", got)
	}
}

func TestRobotModeRejectsUnavailableMultiAgent(t *testing.T) {
	h := NewRobotHandler(&config.Config{}, nil, nil, zap.NewNop())

	if got := h.cmdSwitchMode("lark", "user-1", "deep"); !strings.Contains(got, "enable Agent multi-agent") {
		t.Fatalf("unexpected rejection: %s", got)
	}
	if got := h.getAgentMode("lark", "user-1"); got != "single" {
		t.Fatalf("mode changed after rejection: %q", got)
	}
}

func TestParseRobotAgentModeRejectsUnknownMode(t *testing.T) {
	if mode, ok := parseRobotAgentMode("unknown"); ok || mode != "" {
		t.Fatalf("parseRobotAgentMode returned (%q, %v), want empty,false", mode, ok)
	}
}

func TestRobotStatusCommandPermission(t *testing.T) {
	for _, command := range []string{"status"} {
		permission, recognized := robotCommandPermission(command)
		if !recognized || permission != "chat:read" {
			t.Fatalf("command %q returned permission=%q recognized=%v", command, permission, recognized)
		}
	}
	for _, removed := range []string{"current"} {
		if _, recognized := robotCommandPermission(removed); recognized {
			t.Fatalf("removed command %q is still recognized", removed)
		}
	}
}

func TestRobotBestPracticeCommandPermissions(t *testing.T) {
	cases := map[string]string{
		"task":     "chat:read",
		"rename x": "chat:write",
		"doctor":   "config:read",
	}
	for command, want := range cases {
		permission, recognized := robotCommandPermission(command)
		if !recognized || permission != want {
			t.Fatalf("command %q returned permission=%q recognized=%v, want %q,true", command, permission, recognized, want)
		}
	}
}

func TestRobotConfirmationCanBeCancelled(t *testing.T) {
	h := NewRobotHandler(&config.Config{}, nil, nil, zap.NewNop())
	h.setPendingConfirmation("lark", "user-1", "delete_conversation", "conv-1")
	if got := h.cmdCancelConfirmation("lark", "user-1"); got != "Cancelled the pending operation." {
		t.Fatalf("unexpected cancel response: %s", got)
	}
	if got := h.cmdConfirm("lark", "user-1"); !strings.Contains(got, "no operation pending confirmation") {
		t.Fatalf("confirmation survived cancellation: %s", got)
	}
}

func TestRobotDoctorSeparatesInternalToolsFromHTTPMCP(t *testing.T) {
	h := NewRobotHandler(&config.Config{
		Security: config.SecurityConfig{Tools: []config.ToolConfig{
			{Name: "enabled-tool", Enabled: true},
			{Name: "disabled-tool", Enabled: false},
		}},
		MCP: config.MCPConfig{Enabled: false},
	}, nil, nil, zap.NewNop())

	got := h.cmdDoctor()
	if !strings.Contains(got, "Built-in MCP tools: 1/2 enabled") {
		t.Fatalf("internal tool status missing: %s", got)
	}
	if !strings.Contains(got, "HTTP MCP service: Disabled") {
		t.Fatalf("HTTP MCP status missing: %s", got)
	}
}

// Every command word of earlier versions still resolves to the English command
// and permission it had before the English base. The expectations are written
// out by hand (taken from the pre-English-base handler), not read from
// legacyRobotCommands, so deleting a table entry fails this test.
// The Chinese inputs stay on purpose: they are legacy user input that must
// keep working.
func TestLegacyRobotCommandsStillWork(t *testing.T) {
	cases := []struct {
		input      string // legacy Chinese input
		canonical  string
		permission string
		recognized bool // false: handled before the permission check (bind, unbind)
	}{
		// Words that stand alone.
		{"漏洞提醒", "vuln alerts", "vulnerability:read", true},
		{"对话列表", "list", "chat:read", true},
		{"角色列表", "roles", "roles:read", true},
		{"模式列表", "modes", "agent:execute", true},
		{"项目列表", "projects", "project:read", true},
		{"解除项目", "unbind project", "project:write", true},
		{"新对话", "new", "chat:write", true},
		{"帮助", "help", "", true},
		{"列表", "list", "chat:read", true},
		{"清空", "clear", "chat:write", true},
		{"状态", "status", "chat:read", true},
		{"停止", "stop", "agent:execute", true},
		{"角色", "roles", "roles:read", true},
		{"模式", "modes", "agent:execute", true},
		{"版本", "version", "", true},
		{"项目", "projects", "project:read", true},
		{"解绑", "unbind", "", false},
		{"身份", "whoami", "", true},
		{"任务", "task", "chat:read", true},
		{"权限", "permissions", "", true},
		{"诊断", "doctor", "config:read", true},
		{"确认", "confirm", "", true},
		{"取消", "cancel", "", true},
		{"？", "help", "", true}, // full-width question mark
		// Words followed by an argument.
		{"漏洞提醒 on", "vuln alerts on", "vulnerability:read", true},
		{"切换角色 admin", "role admin", "roles:read", true},
		{"切换模式 deep", "mode deep", "agent:execute", true},
		{"绑定项目 P1", "bind project P1", "project:write", true},
		{"新建项目 My project", "new project My project", "project:write", true},
		{"重命名 New title", "rename New title", "chat:write", true},
		{"切换 conv-1", "switch conv-1", "chat:read", true},
		{"继续 conv-1", "continue conv-1", "chat:read", true},
		{"角色 admin", "role admin", "roles:read", true},
		{"模式 deep", "mode deep", "agent:execute", true},
		{"删除 conv-1", "delete conv-1", "chat:delete", true},
		{"绑定 ABCD-1234", "bind ABCD-1234", "", false},
	}
	for _, c := range cases {
		if got := canonicalRobotCommand(c.input); got != c.canonical {
			t.Errorf("canonicalRobotCommand(%q) = %q, want %q", c.input, got, c.canonical)
		}
		permission, recognized := robotCommandPermission(c.input)
		if permission != c.permission || recognized != c.recognized {
			t.Errorf("robotCommandPermission(%q) = (%q, %v), want (%q, %v)", c.input, permission, recognized, c.permission, c.recognized)
		}
	}

	// Not commands: unchanged text, not recognized.
	for _, input := range []string{
		"当前",               // "current" was never a command
		"切换",               // an argument is required
		"绑定",               // an argument is required
		"解绑 x",             // unbind takes no argument
		"scan example.com", // free text goes to the agent
	} {
		if got := canonicalRobotCommand(input); got != input {
			t.Errorf("canonicalRobotCommand(%q) rewrote non-command to %q", input, got)
		}
		if _, recognized := robotCommandPermission(input); recognized {
			t.Errorf("%q must not be a recognized command", input)
		}
	}
}
