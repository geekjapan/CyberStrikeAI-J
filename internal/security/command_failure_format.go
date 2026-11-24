package security

import (
	"errors"
	"fmt"
	"os/exec"
	"strings"
)

// FormatCommandFailureResult matches the wording of the exec tool's ToolResult (without ToolErrorPrefix).
func FormatCommandFailureResult(exitCode int, output string) string {
	output = strings.TrimSpace(output)
	errMsg := fmt.Sprintf("exit status %d", exitCode)
	if output == "" {
		return fmt.Sprintf("Command failed: %s", errMsg)
	}
	if strings.HasPrefix(output, "Command failed:") {
		return output
	}
	return fmt.Sprintf("Command failed: %s\nOutput: %s", errMsg, output)
}

// FormatCommandFailureFromErr builds the unified failure text (IsError body) from the error returned by exec/execute.
func FormatCommandFailureFromErr(err error, output string) string {
	if err == nil {
		return strings.TrimSpace(output)
	}
	var exitError *exec.ExitError
	if errors.As(err, &exitError) {
		return FormatCommandFailureResult(exitError.ExitCode(), output)
	}
	output = strings.TrimSpace(output)
	if output == "" {
		return fmt.Sprintf("Command failed: %v", err)
	}
	if strings.HasPrefix(output, "Command failed:") {
		return output
	}
	return fmt.Sprintf("Command failed: %v\nOutput: %s", err, output)
}

// ExecuteFailureStatusLine is the single status line appended when a streaming execute finishes (the output body has already been pushed in the stream).
func ExecuteFailureStatusLine(exitCode int) string {
	return fmt.Sprintf("\nCommand failed: exit status %d", exitCode)
}

// IsCommandFailureResult reports whether the tool result body indicates a non-zero command exit (used to align execute/exec isError).
func IsCommandFailureResult(content string) bool {
	return strings.Contains(content, "Command failed:")
}

// IsLegacyShellExitNoise filters the redundant exit code lines in the legacy shell stream.
func IsLegacyShellExitNoise(s string) bool {
	trimmed := strings.TrimSpace(s)
	return strings.HasPrefix(trimmed, "command exited with non-zero code ")
}
