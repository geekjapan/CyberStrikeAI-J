package multiagent

const (
	ReasonModelOutputTruncated = "model_output_truncated"
	ReasonUnfinishedPlan       = "unfinished_plan"
)

type RunResult struct {
	RuntimeStatus           string // immutable runtime outcome; delivery finalization may update Status separately
	RuntimeCompletionReason string
	Response                string
	MCPExecutionIDs         []string
	LastAgentTraceInput     string // Serialized message list (JSON): written by both the native loop and Agents, for restoring context on resume, attack chain, etc.
	LastAgentTraceOutput    string // This turn's assistant-facing display text (summary or final reply)
	Finalized               bool
	Status                  string
	CompletionReason        string
	EvidenceVerified        bool
	EvidenceRefs            []string
	PendingExecutionIDs     []string
	MissingChecks           []string
}
