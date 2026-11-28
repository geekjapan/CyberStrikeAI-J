package projectprompt

// ShellExecExecuteGuidanceSection is appended to single/multi-agent system prompts: division of work between exec and execute (kept short).
func ShellExecExecuteGuidanceSection() string {
	return `Shell (exec/execute): when a dedicated MCP tool exists, prefer it; use exec for system commands (pipes, workdir, background &); use execute for scripts under skills/ (together with read_file, skill); split multi-step scans into separate calls, and never chain several scanners in one shell command. Long scripts, request bodies or payloads must first be written to the session working directory with write_file, and then run with short exec/execute commands; do not embed long content in command. Downloads/temporary files must be written to the "session working directory" in the system prompt; do not use /tmp.`
}

// ShellExecExecuteGuidanceReconSuffix is an optional one-line suffix appended for reconnaissance sub-agents.
func ShellExecExecuteGuidanceReconSuffix() string {
	return `For enumeration, prefer dedicated MCPs such as subfinder and amass; do not chain long commands through exec/execute.`
}
