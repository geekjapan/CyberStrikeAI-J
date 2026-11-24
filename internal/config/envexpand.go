package config

import (
	"maps"
	"os"
	"slices"
	"strings"
)

// expandEnvVar expands ${VAR} and ${VAR:-default} environment variable references in a string.
// Consistent with the official MCP config format (Claude Desktop / Cursor / VS Code all support this syntax).
func expandEnvVar(s string) string {
	var b strings.Builder
	i := 0
	for i < len(s) {
		// Find ${
		idx := strings.Index(s[i:], "${")
		if idx < 0 {
			b.WriteString(s[i:])
			break
		}
		b.WriteString(s[i : i+idx])
		i += idx + 2 // skip ${

		// Find the matching }
		end := strings.IndexByte(s[i:], '}')
		if end < 0 {
			// No }, keep as-is
			b.WriteString("${")
			continue
		}
		expr := s[i : i+end]
		i += end + 1 // skip }

		// Parse VAR:-default
		varName := expr
		defaultVal := ""
		hasDefault := false
		if colonIdx := strings.Index(expr, ":-"); colonIdx >= 0 {
			varName = expr[:colonIdx]
			defaultVal = expr[colonIdx+2:]
			hasDefault = true
		}

		val := os.Getenv(varName)
		if val == "" && hasDefault {
			val = defaultVal
		}
		b.WriteString(val)
	}
	return b.String()
}

// ExpandConfigEnv expands all environment-variable-capable fields in ExternalMCPServerConfig.
// Expansion scope: Command, Args, Env values, URL, Headers values.
func ExpandConfigEnv(cfg *ExternalMCPServerConfig) {
	// Config structs are passed by value to background MCP connections. Their
	// slices and maps still share storage; expansion must not mutate that storage.
	cfg.Args = slices.Clone(cfg.Args)
	cfg.Env = maps.Clone(cfg.Env)
	cfg.Headers = maps.Clone(cfg.Headers)
	cfg.Command = expandEnvVar(cfg.Command)
	for i, arg := range cfg.Args {
		cfg.Args[i] = expandEnvVar(arg)
	}
	for k, v := range cfg.Env {
		cfg.Env[k] = expandEnvVar(v)
	}
	cfg.URL = expandEnvVar(cfg.URL)
	for k, v := range cfg.Headers {
		cfg.Headers[k] = expandEnvVar(v)
	}
}

// ExpandHeaderMap returns a copy of headers with ${VAR} / ${VAR:-default} references expanded.
// Kept consistent with the header expansion rules of the MCP config.
func ExpandHeaderMap(headers map[string]string) map[string]string {
	if len(headers) == 0 {
		return nil
	}
	out := make(map[string]string, len(headers))
	for k, v := range headers {
		out[expandEnvVar(k)] = expandEnvVar(v)
	}
	return out
}
