package multiagent

import "testing"

func TestIsEmptyResponseResult(t *testing.T) {
	cases := []struct {
		name     string
		response string
		want     bool
	}{
		{"english placeholder", "(Pi single-agent session completed but no assistant text was captured. Check process details or logs.)", true},
		// Chinese stays: the placeholder stored by earlier versions; it alone must match.
		{"legacy chinese placeholder", "（Pi 单代理会话已完成，但未捕获到助手文本输出。请查看过程详情或日志。）", true},
		{"real response", "Scan complete; found 2 open ports.", false},
		{"blank", "  \n", false},
	}
	for _, c := range cases {
		if got := IsEmptyResponseResult(&RunResult{Response: c.response}); got != c.want {
			t.Errorf("%s: got %v, want %v", c.name, got, c.want)
		}
	}
	if IsEmptyResponseResult(nil) {
		t.Fatal("nil result should be false")
	}
}

func TestHasResumeTrace(t *testing.T) {
	if HasResumeTrace(nil) {
		t.Fatal("nil")
	}
	if HasResumeTrace(&RunResult{LastAgentTraceInput: "[]"}) {
		t.Fatal("enable resume on empty trace")
	}
	if !HasResumeTrace(&RunResult{LastAgentTraceInput: `[{"role":"user","content":"hi"}]`}) {
		t.Fatal("expected resume trace")
	}
}

func TestEmptyResponseContinueMaxAttemptsFromConfig(t *testing.T) {
	if got := EmptyResponseContinueMaxAttemptsFromConfig(nil); got != defaultEmptyResponseContinueMaxAttempts {
		t.Fatalf("default: got %d want %d", got, defaultEmptyResponseContinueMaxAttempts)
	}
}
