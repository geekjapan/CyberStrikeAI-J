package handler

import (
	"strings"

	"cyberstrike-ai/internal/config"
)

// effectiveProjectID: an explicit project on the request or queue takes priority, otherwise config.project.default_project_id is used.
func effectiveProjectID(cfg *config.Config, explicit string) string {
	if pid := strings.TrimSpace(explicit); pid != "" {
		return pid
	}
	if cfg != nil {
		return strings.TrimSpace(cfg.Project.DefaultProjectID)
	}
	return ""
}
