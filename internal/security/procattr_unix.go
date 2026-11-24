//go:build !windows

package security

import (
	"os/exec"
	"syscall"

	"cyberstrike-ai/internal/processguard"
)

// prepareShellCmdSession runs the shell child process in its own session, so that on timeout or cancellation the whole group can be SIGKILLed (including sub-processes).
func prepareShellCmdSession(cmd *exec.Cmd) error {
	if cmd == nil {
		return nil
	}
	if cmd.SysProcAttr == nil {
		cmd.SysProcAttr = &syscall.SysProcAttr{}
	}
	cmd.SysProcAttr.Setsid = true
	return nil
}

// terminateProcessGroup sends SIGKILL to the process group for rootPID; when rootPID is 0 it falls back to cmd.Process.Pid.
func terminateProcessGroup(rootPID int, cmd *exec.Cmd) {
	pid := rootPID
	if pid <= 0 && cmd != nil && cmd.Process != nil {
		pid = cmd.Process.Pid
	}
	if pid <= 0 {
		return
	}
	if err := syscall.Kill(-pid, syscall.SIGKILL); err != nil {
		if cmd != nil && cmd.Process != nil {
			_ = cmd.Process.Kill()
		}
	}
}

// terminateCmdTree makes a best-effort attempt to terminate cmd and its process group (on Unix, after Setsid the PGID equals the first process PID).
func terminateCmdTree(cmd *exec.Cmd) {
	terminateProcessGroup(0, cmd)
}

// stopProcessGroup gives the whole job a grace period to release resources.
func stopProcessGroup(pid int, cmd *exec.Cmd) {
	if pid > 0 {
		_ = syscall.Kill(-pid, syscall.SIGTERM)
	}
}

func processGroupExists(pid int) bool {
	return processguard.ProcessGroupExists(pid)
}
