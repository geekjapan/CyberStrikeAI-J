package multiagent

import "cyberstrike-ai/internal/config"

const defaultAgentMaxIterations = 3000

// agentMaxIterations is the global cap: only config.agent.max_iterations is used; when <= 0 it matches the config default of 3000.
func agentMaxIterations(appCfg *config.Config) int {
	if appCfg != nil && appCfg.Agent.MaxIterations > 0 {
		return appCfg.Agent.MaxIterations
	}
	return defaultAgentMaxIterations
}

// resolveMaxIterations is the unified iteration cap: max_iterations > 0 in Markdown/sub-agent front matter can override it individually, otherwise agent.max_iterations is used.
// multi_agent.max_iteration and sub_agent_max_iterations are deprecated and no longer used in calculations.
func resolveMaxIterations(appCfg *config.Config, markdownOverride int) int {
	if markdownOverride > 0 {
		return markdownOverride
	}
	return agentMaxIterations(appCfg)
}
