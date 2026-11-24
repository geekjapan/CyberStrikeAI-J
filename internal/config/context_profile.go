package config

import "strings"

const (
	// DefaultMaxTotalTokens is the general context budget when not explicitly configured.
	DefaultMaxTotalTokens = 120000
	// DefaultLocalContextWindow is the conservative window used by the local tier when no context_window is provided.
	DefaultLocalContextWindow = 32768
	// DeepSeek's official /models response reports this total input and output window.
	deepSeekContextWindow = 1048576
	// LocalContextBudgetPercent is the ratio the local tier uses to convert the native window into a prompt budget.
	LocalContextBudgetPercent = 60
	// LocalContextBudgetCap prevents 256K/1M windows from inflating the budget beyond the effective context of a local model.
	LocalContextBudgetCap = 131072
	// Running tool-enabled agents is not recommended below MinLocalContextWindow.
	MinLocalContextWindow = 16384

	ContextWarningLocalWindowUnknown   = "local_context_window_unknown"
	ContextWarningLocalWindowSmall     = "local_context_window_small"
	ContextWarningMaxTotalClamped      = "max_total_tokens_clamped"
	ContextWarningMaxCompletionClamped = "max_completion_tokens_clamped"
)

// NormalizeContextProfile returns an explicit profile, or empty for auto.
func NormalizeContextProfile(raw string) string {
	switch profile := strings.ToLower(strings.TrimSpace(raw)); profile {
	case "local", "local_auto", "economy", "custom":
		return profile
	}
	return ""
}

// IsEconomyContextProfile enables input savings for DeepSeek by default. An
// explicit custom/local profile takes precedence, including on older channels.
func (c OpenAIConfig) IsEconomyContextProfile() bool {
	switch NormalizeContextProfile(c.ContextProfile) {
	case "economy":
		return true
	case "custom", "local", "local_auto":
		return false
	}
	profile := c.Reasoning.ProfileEffective()
	// Model-name detection only selects input savings. The gateway's wire
	// protocol and reasoning parameters still follow its provider profile.
	return c.IsDeepSeekOfficialEndpoint() || profile == "deepseek" || profile == "deepseek_compat" ||
		strings.Contains(strings.ToLower(c.Model), "deepseek")
}

func (c OpenAIConfig) IsLocalContextProfile() bool {
	profile := NormalizeContextProfile(c.ContextProfile)
	return profile == "local" || profile == "local_auto"
}

// OutputLimitField returns the output limit field name. Local endpoints generally only accept the legacy max_tokens field.
func (c OpenAIConfig) OutputLimitField() string {
	if c.IsLocalContextProfile() {
		return "max_tokens"
	}
	return "max_completion_tokens"
}

// EffectiveContextWindow returns the window used to calculate the token budget.
func (c OpenAIConfig) EffectiveContextWindow() int {
	if c.ContextWindow > 0 {
		return c.ContextWindow
	}
	return c.DefaultContextWindow()
}

// DefaultContextWindow is the fallback when the channel has no explicit window.
func (c OpenAIConfig) DefaultContextWindow() int {
	if c.IsLocalContextProfile() {
		return DefaultLocalContextWindow
	}
	if c.IsDeepSeekOfficialEndpoint() {
		switch strings.ToLower(strings.TrimSpace(c.Model)) {
		case "deepseek-flash", "deepseek-v4-pro":
			return deepSeekContextWindow
		}
	}
	return 0
}

// EffectiveMaxTotalTokens tightens max_total_tokens to within the model window.
// The general tier keeps an output reserve; the local tier further scales the window to 60% based on Effective Context experience, capped at 128K.
func (c OpenAIConfig) EffectiveMaxTotalTokens() int {
	configured := c.MaxTotalTokens
	if configured <= 0 {
		configured = DefaultMaxTotalTokens
	}
	window := c.EffectiveContextWindow()
	if window <= 0 {
		return configured
	}

	reserve := c.MaxCompletionTokensEffective()
	if reserve > window/2 {
		reserve = window / 2
	}
	hard := window - reserve
	if hard < 4096 {
		hard = window * 85 / 100
	}
	if hard < 1024 {
		hard = 1024
	}

	budget := configured
	if budget > hard {
		budget = hard
	}
	if c.IsLocalContextProfile() {
		local := window * LocalContextBudgetPercent / 100
		if local > LocalContextBudgetCap {
			local = LocalContextBudgetCap
		}
		if local < 8192 && window >= 8192 {
			local = 8192
		}
		if local > hard {
			local = hard
		}
		if budget > local {
			budget = local
		}
	}
	if budget < 1024 {
		budget = 1024
	}
	if window > 0 && budget > window {
		budget = window
	}
	return budget
}

// ContextBudgetWarnings returns localizable warning codes; it does not build natural-language text directly, to ease multilingual UI and log search.
func (c OpenAIConfig) ContextBudgetWarnings() []string {
	var out []string
	if c.IsLocalContextProfile() {
		if c.ContextWindow <= 0 {
			out = append(out, ContextWarningLocalWindowUnknown)
		} else if c.ContextWindow < MinLocalContextWindow {
			out = append(out, ContextWarningLocalWindowSmall)
		}
	}
	configured := c.MaxTotalTokens
	if configured <= 0 {
		configured = DefaultMaxTotalTokens
	}
	if c.EffectiveContextWindow() > 0 && configured > c.EffectiveMaxTotalTokens() {
		out = append(out, ContextWarningMaxTotalClamped)
	}
	if c.EffectiveContextWindow() > 0 && c.MaxCompletionTokens > c.MaxCompletionTokensEffective() {
		out = append(out, ContextWarningMaxCompletionClamped)
	}
	return out
}

// EffectiveRuntimeForChannel applies input-saving or local-model limits to a
// runtime copy. Explicit custom profiles use the configured runtime settings.
func EffectiveRuntimeForChannel(mw AgentTuningConfig, oa OpenAIConfig) AgentTuningConfig {
	if oa.IsEconomyContextProfile() {
		out := mw
		out.ToolSearchEnable = true
		out.ToolSearchMinTools = tightenInt(mw.ToolSearchMinTools, 16)
		out.ToolSearchAlwaysVisible = tightenInt(mw.ToolSearchAlwaysVisible, 6)
		includeBuiltins := false
		out.ToolSearchIncludeBuiltins = &includeBuiltins
		out.ReductionEnable = true
		out.ReductionMaxLengthForTrunc = tightenInt(mw.ReductionMaxLengthForTruncEffective(), 8000)
		return out
	}
	if !oa.IsLocalContextProfile() {
		return mw
	}
	window := oa.EffectiveContextWindow()
	out := mw

	out.ReductionMaxLengthForTrunc = tightenInt(
		mw.ReductionMaxLengthForTruncEffective(),
		localToolTruncBytes(window),
	)
	out.ReductionEnable = true

	out.ToolSearchEnable = true
	if mw.ToolSearchMinTools <= 0 || mw.ToolSearchMinTools > 8 {
		out.ToolSearchMinTools = 8
	}
	if mw.ToolSearchAlwaysVisible <= 0 || mw.ToolSearchAlwaysVisible > 8 {
		out.ToolSearchAlwaysVisible = 8
	}
	out.ToolSearchAlwaysVisibleTools = trimLocalAlwaysVisibleTools(mw.ToolSearchAlwaysVisibleTools)
	includeBuiltins := false
	out.ToolSearchIncludeBuiltins = &includeBuiltins

	return out
}

func tightenInt(current, ceil int) int {
	if ceil <= 0 {
		return current
	}
	if current <= 0 || current > ceil {
		return ceil
	}
	return current
}

func localToolTruncBytes(window int) int {
	bytes := window / 6
	if bytes < 8192 {
		bytes = 8192
	}
	if bytes > 32768 {
		bytes = 32768
	}
	if window > 0 && bytes > window {
		bytes = window
	}
	return bytes
}

// localCoreToolNames are the tools worth keeping resident in small local windows; the rest are unlocked on demand via tool_search.
var localCoreToolNames = map[string]struct{}{
	"read_file":             {},
	"glob":                  {},
	"grep":                  {},
	"write_file":            {},
	"edit_file":             {},
	"execute":               {},
	"exec":                  {},
	"task":                  {},
	"transfer_to_agent":     {},
	"exit":                  {},
	"write_todos":           {},
	"skill":                 {},
	"tool_search":           {},
	"record_vulnerability":  {},
	"get_tool_execution":    {},
	"wait_tool_execution":   {},
	"analyze_image":         {},
	"search_knowledge_base": {},
	"http-framework-test":   {},
}

func trimLocalAlwaysVisibleTools(in []string) []string {
	if len(in) == 0 {
		return nil
	}
	out := make([]string, 0, len(localCoreToolNames))
	seen := make(map[string]struct{}, len(in))
	for _, raw := range in {
		name := strings.TrimSpace(raw)
		key := strings.ToLower(name)
		if _, ok := localCoreToolNames[key]; !ok {
			continue
		}
		if _, dup := seen[key]; dup {
			continue
		}
		seen[key] = struct{}{}
		out = append(out, name)
	}
	return out
}
