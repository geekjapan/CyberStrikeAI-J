package multiagent

import (
	"strings"
	"time"

	"cyberstrike-ai/internal/config"
)

const defaultEmptyResponseContinueMaxAttempts = 5

// IsEmptyResponseResult reports whether a Run ended with the "no captured assistant text" placeholder (not a real user-visible reply).
func IsEmptyResponseResult(result *RunResult) bool {
	if result == nil {
		return false
	}
	return isEmptyResponseText(result.Response)
}

func isEmptyResponseText(s string) bool {
	s = strings.TrimSpace(s)
	if s == "" {
		return false
	}
	return strings.Contains(s, "no assistant text was captured") ||
		strings.Contains(s, "未捕获到助手文本输出")
}

// HasResumeTrace: the trace is non-empty, so a resume has context to restore.
func HasResumeTrace(result *RunResult) bool {
	if result == nil {
		return false
	}
	s := strings.TrimSpace(result.LastAgentTraceInput)
	return s != "" && s != "[]" && s != "null"
}

// EmptyResponseContinueMaxAttemptsFromConfig is the Handler-layer backoff limit for auto-continue when there is no assistant text; 0 = default 5.
func EmptyResponseContinueMaxAttemptsFromConfig(mw *config.AgentTuningConfig) int {
	if mw != nil && mw.EmptyResponseContinueMaxAttempts > 0 {
		return mw.EmptyResponseContinueMaxAttempts
	}
	return defaultEmptyResponseContinueMaxAttempts
}

// EmptyResponseContinueBackoff uses the same exponential backoff as run_retry (2s, 4s, 8s... capped).
func EmptyResponseContinueBackoff(attempt int, mw *config.AgentTuningConfig) time.Duration {
	maxBackoff := defaultRunRetryMaxBackoff
	if mw != nil && mw.RunRetryMaxBackoffSec > 0 {
		maxBackoff = time.Duration(mw.RunRetryMaxBackoffSec) * time.Second
	}
	return transientRetryBackoff(attempt, maxBackoff)
}

// FormatEmptyResponseContinueUserMessage is the user turn injected by the system's automatic continue (not written to the messages table as a bubble).
func FormatEmptyResponseContinueUserMessage() string {
	return strings.TrimSpace(`[System auto resume]
The previous Agent session produced no visible assistant text (the stream may have been interrupted, or only tool calls completed). Continue based on the existing trace and tool results, and give a progress summary; do not repeat completed steps.`)
}
