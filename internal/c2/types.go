// Package c2 implements CyberStrikeAI's built-in Command & Control (C2) framework.
//
// Architecture overview:
//   - Manager is the single entry point instantiated by internal/app and injected into every component
//     that controls C2 (HTTP handlers, MCP tools, HITL bridge, attack-chain recorder, etc.).
//   - Listener is an abstract interface implemented by each transport (tcp_reverse, http_beacon,
//     https_beacon, websocket) and created through ListenerRegistry factories.
//   - Task scheduling combines SQLite persistence (c2_tasks table) with an in-memory EventBus:
//     - SQLite persists state transitions and audit history across restarts;
//     - EventBus pushes real-time notifications (e.g. task results) to SSE/WS subscribers without polling.
//   - The crypto layer uses AES-256-GCM with a per-listener 32-byte key held server-side and injected
//     into compiled implants; plaintext keys are never exported over event streams.
package c2

import (
	"errors"
	"strings"
	"time"
)

// ListenerType identifies the listener transport, matching c2_listeners.type.
type ListenerType string

const (
	ListenerTypeTCPReverse  ListenerType = "tcp_reverse"
	ListenerTypeHTTPBeacon  ListenerType = "http_beacon"
	ListenerTypeHTTPSBeacon ListenerType = "https_beacon"
	ListenerTypeWebSocket   ListenerType = "websocket"
)

// AllListenerTypes lists all supported listener types for validation and UI enumeration.
func AllListenerTypes() []ListenerType {
	return []ListenerType{
		ListenerTypeTCPReverse,
		ListenerTypeHTTPBeacon,
		ListenerTypeHTTPSBeacon,
		ListenerTypeWebSocket,
	}
}

// IsValidListenerType validates whether t is a supported listener type from UI/MCP input.
func IsValidListenerType(t string) bool {
	t = strings.ToLower(strings.TrimSpace(t))
	for _, lt := range AllListenerTypes() {
		if string(lt) == t {
			return true
		}
	}
	return false
}

// SessionStatus matches c2_sessions.status.
type SessionStatus string

const (
	SessionActive   SessionStatus = "active"
	SessionSleeping SessionStatus = "sleeping"
	SessionDead     SessionStatus = "dead"
	SessionKilled   SessionStatus = "killed"
)

// TaskStatus matches c2_tasks.status.
type TaskStatus string

const (
	TaskQueued    TaskStatus = "queued"
	TaskSent      TaskStatus = "sent"
	TaskRunning   TaskStatus = "running"
	TaskSuccess   TaskStatus = "success"
	TaskFailed    TaskStatus = "failed"
	TaskCancelled TaskStatus = "cancelled"
)

// TaskType identifies a C2 task kind negotiated between server and beacon.
type TaskType string

const (
	// Common tasks
	TaskTypeExec       TaskType = "exec"        // execute an arbitrary command (shell -c)
	TaskTypeShell      TaskType = "shell"       // interactive command preserving cwd
	TaskTypePwd        TaskType = "pwd"         // print working directory
	TaskTypeCd         TaskType = "cd"          // change working directory
	TaskTypeLs         TaskType = "ls"          // list directory entries
	TaskTypePs         TaskType = "ps"          // list running processes
	TaskTypeKillProc   TaskType = "kill_proc"   // terminate a process by PID
	TaskTypeUpload     TaskType = "upload"      // push a file to the target
	TaskTypeDownload   TaskType = "download"    // pull a file from the target
	TaskTypeScreenshot TaskType = "screenshot"  // capture a screenshot
	TaskTypeSleep      TaskType = "sleep"       // adjust heartbeat interval and jitter
	TaskTypeExit       TaskType = "exit"        // exit the implant without deleting its binary
	TaskTypeSelfDelete TaskType = "self_delete" // exit and delete the implant binary (cleanup)
	// Advanced tasks
	TaskTypePortFwd      TaskType = "port_fwd"
	TaskTypeSocksStart   TaskType = "socks_start"
	TaskTypeSocksStop    TaskType = "socks_stop"
	TaskTypeLoadAssembly TaskType = "load_assembly"
	TaskTypePersist      TaskType = "persist"
)

// AllTaskTypes returns all supported task types for tool schema enumeration.
func AllTaskTypes() []TaskType {
	return []TaskType{
		TaskTypeExec, TaskTypeShell,
		TaskTypePwd, TaskTypeCd, TaskTypeLs, TaskTypePs, TaskTypeKillProc,
		TaskTypeUpload, TaskTypeDownload, TaskTypeScreenshot,
		TaskTypeSleep, TaskTypeExit, TaskTypeSelfDelete,
		TaskTypePortFwd, TaskTypeSocksStart, TaskTypeSocksStop, TaskTypeLoadAssembly,
		TaskTypePersist,
	}
}

// IsDangerousTaskType reports whether a task type requires HITL confirmation,
// mirroring tool_whitelist in internal/handler/hitl.go (non-allowlisted operations require approval).
func IsDangerousTaskType(t TaskType) bool {
	switch t {
	case TaskTypeKillProc, TaskTypeUpload, TaskTypeSelfDelete,
		TaskTypePortFwd, TaskTypeSocksStart, TaskTypeLoadAssembly, TaskTypePersist:
		return true
	}
	return false
}

// ListenerConfig holds decoded runtime configuration from c2_listeners.config_json.
type ListenerConfig struct {
	// Common HTTP/HTTPS Beacon paths
	BeaconCheckInPath string `json:"beacon_check_in_path,omitempty"` // default "/check_in"
	BeaconTasksPath   string `json:"beacon_tasks_path,omitempty"`    // default "/tasks"
	BeaconResultPath  string `json:"beacon_result_path,omitempty"`   // default "/result"
	BeaconUploadPath  string `json:"beacon_upload_path,omitempty"`   // default "/upload"
	BeaconFilePath    string `json:"beacon_file_path,omitempty"`     // default "/file/"
	// HTTPS-specific settings
	TLSCertPath     string `json:"tls_cert_path,omitempty"`
	TLSKeyPath      string `json:"tls_key_path,omitempty"`
	TLSAutoSelfSign bool   `json:"tls_auto_self_sign,omitempty"` // when true, generate a self-signed cert if none is provided
	// Default implant timing (initial values in c2_sessions; beacons may override on initial check-in)
	DefaultSleep  int `json:"default_sleep,omitempty"`  // seconds, default 5
	DefaultJitter int `json:"default_jitter,omitempty"` // 0-100, default 0
	// OPSEC: optional command deny-list regex patterns
	CommandDenyRegex []string `json:"command_deny_regex,omitempty"`
	// Maximum concurrent queued/sent tasks per session (0 means unlimited)
	MaxConcurrentTasks int `json:"max_concurrent_tasks,omitempty"`
	// CallbackHost is an optional callback hostname for implants/payloads, decoupled from bind_host for NAT/cloud setups.
	CallbackHost string `json:"callback_host,omitempty"`
	// AllowLegacyShell, when true, allows unencrypted bash/nc reverse shells on tcp_reverse (default false; strongly discouraged on public networks).
	AllowLegacyShell bool `json:"allow_legacy_shell,omitempty"`
}

// ApplyDefaults populates unset fields with default values; callers should re-marshal when persisting.
func (c *ListenerConfig) ApplyDefaults() {
	if strings.TrimSpace(c.BeaconCheckInPath) == "" {
		c.BeaconCheckInPath = "/check_in"
	}
	if strings.TrimSpace(c.BeaconTasksPath) == "" {
		c.BeaconTasksPath = "/tasks"
	}
	if strings.TrimSpace(c.BeaconResultPath) == "" {
		c.BeaconResultPath = "/result"
	}
	if strings.TrimSpace(c.BeaconUploadPath) == "" {
		c.BeaconUploadPath = "/upload"
	}
	if strings.TrimSpace(c.BeaconFilePath) == "" {
		c.BeaconFilePath = "/file/"
	}
	if c.DefaultSleep <= 0 {
		c.DefaultSleep = 5
	}
	if c.DefaultJitter < 0 {
		c.DefaultJitter = 0
	}
	if c.DefaultJitter > 100 {
		c.DefaultJitter = 100
	}
}

// ImplantCheckInRequest is the decrypted registration/heartbeat payload sent from beacon to server.
type ImplantCheckInRequest struct {
	ImplantUUID   string                 `json:"uuid"`
	Hostname      string                 `json:"hostname"`
	Username      string                 `json:"username"`
	OS            string                 `json:"os"`
	Arch          string                 `json:"arch"`
	PID           int                    `json:"pid"`
	ProcessName   string                 `json:"process_name"`
	IsAdmin       bool                   `json:"is_admin"`
	InternalIP    string                 `json:"internal_ip"`
	UserAgent     string                 `json:"user_agent,omitempty"`
	SleepSeconds  int                    `json:"sleep_seconds"`
	JitterPercent int                    `json:"jitter_percent"`
	Metadata      map[string]interface{} `json:"metadata,omitempty"`
}

// ImplantCheckInResponse is the server reply to a beacon check-in.
type ImplantCheckInResponse struct {
	SessionID  string `json:"session_id"`
	NextSleep  int    `json:"next_sleep"`
	NextJitter int    `json:"next_jitter"`
	HasTasks   bool   `json:"has_tasks"`
	ServerTime int64  `json:"server_time"`
}

// TaskEnvelope is the task dispatch payload sent from server to beacon.
type TaskEnvelope struct {
	TaskID   string                 `json:"task_id"`
	TaskType string                 `json:"task_type"`
	Payload  map[string]interface{} `json:"payload"`
}

// TaskResultReport is the task execution result reported from beacon to server.
type TaskResultReport struct {
	TaskID     string `json:"task_id"`
	Success    bool   `json:"success"`
	Output     string `json:"output,omitempty"`
	OutputB64  string `json:"output_b64,omitempty"` // raw console bytes in base64 to preserve non-UTF-8 output across JSON
	Error      string `json:"error,omitempty"`
	ErrorB64   string `json:"error_b64,omitempty"`
	BlobBase64 string `json:"blob_b64,omitempty"`    // e.g. screenshot binary
	BlobSuffix string `json:"blob_suffix,omitempty"` // e.g. ".png"
	StartedAt  int64  `json:"started_at"`
	EndedAt    int64  `json:"ended_at"`
}

// CommonError is the shared C2 error type that maps directly to HTTP status codes in handlers.
type CommonError struct {
	Code    string
	Message string
	HTTP    int
}

func (e *CommonError) Error() string {
	if e == nil {
		return ""
	}
	return e.Message
}

// Sentinel errors for errors.Is comparisons.
var (
	ErrListenerNotFound = &CommonError{Code: "listener_not_found", Message: "Listener not found", HTTP: 404}
	ErrSessionNotFound  = &CommonError{Code: "session_not_found", Message: "Session not found", HTTP: 404}
	ErrTaskNotFound     = &CommonError{Code: "task_not_found", Message: "Task not found", HTTP: 404}
	ErrProfileNotFound  = &CommonError{Code: "profile_not_found", Message: "Profile not found", HTTP: 404}
	ErrInvalidInput     = &CommonError{Code: "invalid_input", Message: "Invalid parameters", HTTP: 400}
	ErrAuthFailed       = &CommonError{Code: "auth_failed", Message: "Authentication failed", HTTP: 401}
	ErrPortInUse        = &CommonError{Code: "port_in_use", Message: "Port already in use", HTTP: 409}
	ErrListenerRunning  = &CommonError{Code: "listener_running", Message: "Listener is already running", HTTP: 409}
	ErrListenerStopped  = &CommonError{Code: "listener_stopped", Message: "Listener is not running", HTTP: 409}
	ErrUnsupportedType  = &CommonError{Code: "unsupported_type", Message: "Unsupported listener type", HTTP: 400}
)

// SafeBindPort validates that port is within 1..65535.
func SafeBindPort(port int) error {
	if port < 1 || port > 65535 {
		return errors.New("port must be in 1..65535")
	}
	return nil
}

// NowUnixMillis returns the current Unix timestamp in milliseconds.
func NowUnixMillis() int64 {
	return time.Now().UnixNano() / int64(time.Millisecond)
}
