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

// Every command word of earlier versions still resolves to a recognized
// English command, alone or with an argument.
func TestLegacyRobotCommandsStillWork(t *testing.T) {
	for _, c := range legacyRobotCommands {
		if c.alone != "" {
			if got := canonicalRobotCommand(c.word); got != c.alone {
				t.Errorf("%q -> %q, want %q", c.word, got, c.alone)
			}
			if _, ok := robotCommandPermission(c.word); !ok && c.alone != "unbind" {
				t.Errorf("%q is not a recognized command", c.word)
			}
		}
		if c.withArg != "" {
			if got := canonicalRobotCommand(c.word + " x y"); got != c.withArg+" x y" {
				t.Errorf("%q with an argument -> %q, want %q", c.word, got, c.withArg+" x y")
			}
			if _, ok := robotCommandPermission(c.word + " x"); !ok && c.withArg != "bind" {
				t.Errorf("%q with an argument is not a recognized command", c.word)
			}
		}
	}
	if got := canonicalRobotCommand("scan example.com"); got != "scan example.com" {
		t.Errorf("free text was rewritten to %q", got)
	}
}
