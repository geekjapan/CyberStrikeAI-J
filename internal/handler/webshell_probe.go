package handler

import (
	"bytes"
	"io"
	"net/http"
	"strings"

	"go.uber.org/zap"
)

// webshellOSProbeCommand is the probe command: it relies on the difference in how Windows cmd and POSIX shell expand `%OS%` to decide the OS.
//   - Windows cmd: `%OS%` expands to `Windows_NT`, echoing `:OSPROBE_Windows_NT:END`
//   - POSIX sh/bash: `%OS%` is not variable syntax and is kept literally, echoing `:OSPROBE_%OS%:END`
//
// One command yields a clear, mutually exclusive signal, avoiding the probing cost (compared with sending two commands).
// The colons on each side avoid string matching failing when some shells output extra whitespace or a BOM.
const webshellOSProbeCommand = "echo :OSPROBE_%OS%:END"

// probeWebshellOSViaExec infers the target operating system from the echo of a single command execution.
//
// Return values:
//   - "windows" / "linux": identified successfully
//   - "": cannot be determined (the caller should keep its existing fallback logic)
//
// The input execFn is a closure that "sends a command and gets the echo back"; this lets the HTTP entry point and the MCP entry point share the same probing logic
// without caring how the underlying packets are sent.
func probeWebshellOSViaExec(execFn func(cmd string) (output string, ok bool)) string {
	if execFn == nil {
		return ""
	}
	out, ok := execFn(webshellOSProbeCommand)
	if !ok {
		return ""
	}
	return classifyWebshellOSProbeOutput(out)
}

// classifyWebshellOSProbeOutput is a pure function: it decides the OS from the echo of the probe command.
// It is split out so unit tests can cover every branch directly, without a real HTTP call.
func classifyWebshellOSProbeOutput(out string) string {
	if out == "" {
		return ""
	}
	lower := strings.ToLower(out)

	// Strong Windows signal: cmd.exe successfully expanded the %OS% variable
	if strings.Contains(out, "Windows_NT") {
		return "windows"
	}
	// Fault tolerance: some old Windows versions may expand `%OS%` to something else (very rare), so look at secondary clues such as PATH/OS
	if strings.Contains(lower, "microsoft windows") {
		return "windows"
	}

	// Linux/Unix strong signal: the `%OS%` literal was echoed back as is, which means the shell is not cmd.exe
	if strings.Contains(out, "%OS%") {
		return "linux"
	}

	// Secondary clue: some webshells on Linux may run under other shells (such as zsh/ash),
	// but they also do not expand `%OS%`; if the OSPROBE header is hit but no %OS% literal is obtained,
	// the echo was truncated or filtered midway, so conservatively return empty and let the upper layer fall back.
	return ""
}

// newHTTPExecFn builds, for the HTTP FileOp path, the closure that "sends a command and gets the echo back", for reuse by probing.
// The parameters come from the HTTP request; reuse the two existing command builders buildExecURL / buildExecBody,
// ensuring the probe packet and the actual file operation packet follow exactly the same webshell protocol (GET/POST, parameter name, encoding).
func (h *WebShellHandler) newHTTPExecFn(targetURL, password, shellType, method, cmdParam, encoding string) func(string) (string, bool) {
	useGET := strings.ToUpper(strings.TrimSpace(method)) == "GET"
	if strings.TrimSpace(cmdParam) == "" {
		cmdParam = "cmd"
	}
	return func(cmd string) (string, bool) {
		var (
			httpReq *http.Request
			err     error
		)
		if useGET {
			u := h.buildExecURL(targetURL, shellType, password, cmdParam, cmd)
			httpReq, err = http.NewRequest(http.MethodGet, u, nil)
		} else {
			body := h.buildExecBody(shellType, password, cmdParam, cmd)
			httpReq, err = http.NewRequest(http.MethodPost, targetURL, bytes.NewReader(body))
			if err == nil {
				httpReq.Header.Set("Content-Type", "application/x-www-form-urlencoded")
			}
		}
		if err != nil {
			return "", false
		}
		httpReq.Header.Set("User-Agent", "Mozilla/5.0 (compatible; CyberStrikeAI-WebShell/1.0)")
		resp, err := h.client.Do(httpReq)
		if err != nil {
			return "", false
		}
		defer resp.Body.Close()
		raw, _ := io.ReadAll(resp.Body)
		return decodeWebshellOutput(raw, encoding), resp.StatusCode == http.StatusOK
	}
}

// persistDetectedOS writes the probe result back to the connection table; on failure it only logs and does not block the main flow.
// By design it only triggers an UPDATE and never creates a record, so even if connectionID does not exist it is quietly dropped.
func (h *WebShellHandler) persistDetectedOS(connectionID, detected string) {
	connectionID = strings.TrimSpace(connectionID)
	detected = normalizeWebshellOS(detected)
	if connectionID == "" || detected == "" || detected == "auto" {
		return
	}
	conn, err := h.db.GetWebshellConnection(connectionID)
	if err != nil || conn == nil {
		// Not every caller can provide a valid ID (for example a temporary test), so return silently here
		return
	}
	if normalizeWebshellOS(conn.OS) != "auto" {
		// The user has already explicitly chosen an OS; respect that choice and do not overwrite it automatically
		return
	}
	conn.OS = detected
	if err := h.db.UpdateWebshellConnection(conn); err != nil {
		h.logger.Warn("Failed to persist webshell probe result", zap.String("id", connectionID), zap.String("os", detected), zap.Error(err))
		return
	}
	h.logger.Info("webshell auto OS probe succeeded and was persisted", zap.String("id", connectionID), zap.String("os", detected))
}
