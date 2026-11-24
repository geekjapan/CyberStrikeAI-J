package multiagent

import "errors"

// ErrInterruptContinue is used as context.CancelCause: when the user chooses "interrupt and continue" and no MCP tool is currently running,
// cancel the current reasoning/streaming output and, within the same session task, automatically continue into the next round carrying the user's supplementary note (similar to a Hermes-style human-in-the-loop turn).
var ErrInterruptContinue = errors.New("agent interrupt: continue with user-supplied context")
