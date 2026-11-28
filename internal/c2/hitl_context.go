package c2

import "context"

type hitlRunCtxKey struct{}

// WithHITLRunContext attaches runCtx (typically spanning the full Agent/SSE request lifecycle) onto ctx.
// MCP tool handlers may receive a child context with a per-tool timeout that is canceled when the tool returns;
// dangerous task HITL approvals should use runCtx via HITLUserContext while awaiting human review.
func WithHITLRunContext(ctx, runCtx context.Context) context.Context {
	if ctx == nil || runCtx == nil {
		return ctx
	}
	return context.WithValue(ctx, hitlRunCtxKey{}, runCtx)
}

// HITLUserContext returns the context used to wait for C2 dangerous-task HITL approval:
// if a longer-lived runCtx was injected with WithHITLRunContext it is returned; otherwise ctx is returned.
func HITLUserContext(ctx context.Context) context.Context {
	if ctx == nil {
		return context.Background()
	}
	if v := ctx.Value(hitlRunCtxKey{}); v != nil {
		if run, ok := v.(context.Context); ok && run != nil {
			return run
		}
	}
	return ctx
}
