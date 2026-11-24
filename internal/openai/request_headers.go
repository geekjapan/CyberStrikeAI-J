package openai

import (
	"context"
	"net/http"
	"strings"

	"cyberstrike-ai/internal/config"
)

// sessionHeaderPlaceholder is the placeholder in a custom request header value that stands for the "current conversation ID".
// Example of how it is written (config file or settings page):
//
//	headers:
//	  x-opencode-session: %session_id%
//
// It is replaced with the current conversation's id when actually sent.
// Note: do not use {{...}} syntax; index.html is a Go template and would be parsed as a template function.
const sessionHeaderPlaceholder = "%session_id%"

type sessionIDContextKey struct{}

// WithSessionID injects the current conversation ID into ctx. The handler injects it once when the task starts,
// so that subsequent Agent ChatModel and built-in Client HTTP requests can read it from the request context.
func WithSessionID(ctx context.Context, sessionID string) context.Context {
	if ctx == nil {
		return nil
	}
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return ctx
	}
	return context.WithValue(ctx, sessionIDContextKey{}, id)
}

// SessionIDFromContext reads the conversation ID from ctx; returns an empty string if it was not injected.
func SessionIDFromContext(ctx context.Context) string {
	if ctx == nil {
		return ""
	}
	v, _ := ctx.Value(sessionIDContextKey{}).(string)
	return v
}

// renderHeaderValue replaces %session_id% in the value with the current conversation ID.
// A second return value of false means the header depends on the session ID but it cannot be obtained from context; it should be skipped rather than sent,
// to avoid sending the literal "%session_id%" upstream and causing dirty data.
func renderHeaderValue(value, sessionID string) (string, bool) {
	if !strings.Contains(value, sessionHeaderPlaceholder) {
		return value, true
	}
	id := strings.TrimSpace(sessionID)
	if id == "" {
		return "", false
	}
	return strings.ReplaceAll(value, sessionHeaderPlaceholder, id), true
}

// normalizedCustomHeaders returns the normalized custom request headers:
// trim whitespace from names, drop empty names and values, so they can be safely written into http.Header.
func normalizedCustomHeaders(cfg *config.OpenAIConfig) map[string]string {
	if cfg == nil || len(cfg.Headers) == 0 {
		return nil
	}
	out := make(map[string]string, len(cfg.Headers))
	for name, value := range cfg.Headers {
		name = strings.TrimSpace(name)
		if name == "" || strings.TrimSpace(value) == "" {
			continue
		}
		out[name] = value
	}
	if len(out) == 0 {
		return nil
	}
	return out
}

// applyCustomHeaders writes the custom request headers configured for the channel into the request.
// Built-in headers with the same name (Authorization, Content-Type, etc.) are overridden by the configured values,
// so third-party OpenAI-compatible gateways that accept only a private auth header also work.
// %session_id% in values is replaced with the current conversation ID from the request context.
func applyCustomHeaders(req *http.Request, cfg *config.OpenAIConfig) {
	if req == nil || req.Header == nil {
		return
	}
	headers := normalizedCustomHeaders(cfg)
	if len(headers) == 0 {
		return
	}
	sessionID := SessionIDFromContext(req.Context())
	for name, value := range headers {
		rendered, ok := renderHeaderValue(value, sessionID)
		if !ok {
			continue
		}
		req.Header.Set(name, rendered)
	}
}

// headersRoundTripper injects the channel's custom request headers into requests sent through the Agent ChatModel.
type headersRoundTripper struct {
	base http.RoundTripper
	cfg  *config.OpenAIConfig
}

func (rt *headersRoundTripper) RoundTrip(req *http.Request) (*http.Response, error) {
	base := http.DefaultTransport
	if rt != nil && rt.base != nil {
		base = rt.base
	}
	if rt == nil || req == nil {
		return base.RoundTrip(req)
	}
	cloned := req.Clone(req.Context())
	applyCustomHeaders(cloned, rt.cfg)
	return base.RoundTrip(cloned)
}
