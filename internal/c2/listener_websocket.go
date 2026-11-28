package c2

import (
	"context"
	"crypto/subtle"
	"encoding/json"
	"errors"
	"fmt"
	"net"
	"net/http"
	"sync"
	"time"

	"cyberstrike-ai/internal/database"

	"github.com/gorilla/websocket"
	"go.uber.org/zap"
)

// WebSocketListener provides a low-latency bidirectional WebSocket Beacon.
// Compared with HTTP Beacon:
//   - Beacons maintain a persistent connection without polling so new tasks arrive immediately;
//   - Suitable for interactive, low-latency workflows (e.g. live input / streaming output);
//   - Payloads still use AES-256-GCM and the handshake validates X-Implant-Token;
//   - A single listener serves one WebSocket path (default /ws) and multiplexes concurrent implants.
//
// Frame protocol (encrypted base64 strings sent as TextMessage):
//
//	client -> server: {"type":"checkin"|"result", "data": <ImplantCheckInRequest|TaskResultReport>}
//	server -> client: {"type":"task", "data": <TaskEnvelope>} or {"type":"sleep","data":{"sleep":N,"jitter":J}}
type WebSocketListener struct {
	rec     *database.C2Listener
	cfg     *ListenerConfig
	manager *Manager
	logger  *zap.Logger

	srv      *http.Server
	upgrader websocket.Upgrader

	mu      sync.Mutex
	conns   map[string]*wsConn // session_id -> connection
	stopped bool
	stopCh  chan struct{}
}

// wsConn holds in-memory state for a single WebSocket implant.
type wsConn struct {
	sessionID string
	ws        *websocket.Conn
	writeMu   sync.Mutex // gorilla/websocket allows only one concurrent writer per connection
}

// NewWebSocketListener is the factory registered under ListenerRegistry["websocket"].
func NewWebSocketListener(ctx ListenerCreationCtx) (Listener, error) {
	return &WebSocketListener{
		rec:     ctx.Listener,
		cfg:     ctx.Config,
		manager: ctx.Manager,
		logger:  ctx.Logger,
		stopCh:  make(chan struct{}),
		conns:   make(map[string]*wsConn),
		upgrader: websocket.Upgrader{
			ReadBufferSize:  4096,
			WriteBufferSize: 4096,
			// Allow any Origin since implants may omit or customize it.
			CheckOrigin: func(r *http.Request) bool { return true },
		},
	}, nil
}

// Type returns the listener type string.
func (l *WebSocketListener) Type() string { return string(ListenerTypeWebSocket) }

// Start launches the HTTP server to accept WebSocket upgrades.
func (l *WebSocketListener) Start() error {
	mux := http.NewServeMux()
	wsPath := l.cfg.BeaconCheckInPath
	if wsPath == "" || wsPath == "/check_in" {
		// Use a dedicated default path for WebSocket to avoid colliding with HTTP Beacon's default.
		wsPath = "/ws"
	}
	mux.HandleFunc(wsPath, l.handleWS)

	addr := fmt.Sprintf("%s:%d", l.rec.BindHost, l.rec.BindPort)
	ln, err := net.Listen("tcp", addr)
	if err != nil {
		if isAddrInUse(err) {
			return ErrPortInUse
		}
		return err
	}
	l.srv = &http.Server{
		Addr:              addr,
		Handler:           mux,
		ReadHeaderTimeout: 15 * time.Second,
	}
	go func() {
		if err := l.srv.Serve(ln); err != nil && !errors.Is(err, http.ErrServerClosed) {
			l.logger.Warn("websocket Serve exited", zap.Error(err))
		}
	}()
	go l.taskDispatcherLoop()
	return nil
}

// Stop gracefully closes all connected WebSocket clients and shuts down the HTTP server.
func (l *WebSocketListener) Stop() error {
	l.mu.Lock()
	if l.stopped {
		l.mu.Unlock()
		return nil
	}
	l.stopped = true
	close(l.stopCh)
	conns := make([]*wsConn, 0, len(l.conns))
	for _, c := range l.conns {
		conns = append(conns, c)
	}
	l.conns = make(map[string]*wsConn)
	l.mu.Unlock()
	for _, c := range conns {
		_ = c.ws.WriteControl(websocket.CloseMessage,
			websocket.FormatCloseMessage(websocket.CloseGoingAway, "shutdown"),
			time.Now().Add(time.Second))
		_ = c.ws.Close()
	}
	if l.srv != nil {
		ctx, cancel := contextWithTimeout(5 * time.Second)
		defer cancel()
		_ = l.srv.Shutdown(ctx)
	}
	return nil
}

func (l *WebSocketListener) handleWS(w http.ResponseWriter, r *http.Request) {
	got := r.Header.Get("X-Implant-Token")
	if got == "" || l.rec.ImplantToken == "" ||
		subtle.ConstantTimeCompare([]byte(got), []byte(l.rec.ImplantToken)) != 1 {
		http.NotFound(w, r)
		return
	}
	ws, err := l.upgrader.Upgrade(w, r, nil)
	if err != nil {
		l.logger.Warn("websocket upgrade failed", zap.Error(err))
		return
	}
	go l.handleConn(ws)
}

// handleConn manages the lifecycle of a WebSocket connection: initial checkin -> session registration -> read loop.
func (l *WebSocketListener) handleConn(ws *websocket.Conn) {
	ws.SetReadLimit(64 << 20)
	ws.SetReadDeadline(time.Now().Add(60 * time.Second))
	ws.SetPongHandler(func(string) error {
		ws.SetReadDeadline(time.Now().Add(60 * time.Second))
		return nil
	})

	// First frame must be a checkin.
	frameType, body, err := readEncryptedFrame(ws, l.rec.EncryptionKey)
	if err != nil || frameType != "checkin" {
		_ = ws.Close()
		return
	}
	var req ImplantCheckInRequest
	if err := json.Unmarshal(body, &req); err != nil {
		_ = ws.Close()
		return
	}
	if req.SleepSeconds <= 0 {
		req.SleepSeconds = l.cfg.DefaultSleep
	}
	session, err := l.manager.IngestCheckIn(l.rec.ID, req)
	if err != nil {
		_ = ws.Close()
		return
	}
	conn := &wsConn{sessionID: session.ID, ws: ws}
	l.mu.Lock()
	l.conns[session.ID] = conn
	l.mu.Unlock()
	defer func() {
		l.detachConnection(conn)
		_ = ws.Close()
	}()

	// Keepalive ping goroutine.
	pingTicker := time.NewTicker(20 * time.Second)
	defer pingTicker.Stop()
	connDone := make(chan struct{})
	defer close(connDone)
	go func() {
		for {
			select {
			case <-l.stopCh:
				return
			case <-connDone:
				return
			case <-pingTicker.C:
				conn.writeMu.Lock()
				_ = ws.WriteControl(websocket.PingMessage, nil, time.Now().Add(5*time.Second))
				conn.writeMu.Unlock()
			}
		}
	}()

	// Main read loop: handle result and heartbeat frames.
	for {
		frameType, body, err := readEncryptedFrame(ws, l.rec.EncryptionKey)
		if err != nil {
			return
		}
		switch frameType {
		case "result":
			var report TaskResultReport
			if err := json.Unmarshal(body, &report); err == nil {
				_ = l.manager.IngestTaskResultFromListener(l.rec.ID, conn.sessionID, report)
			}
		case "checkin":
			// Heartbeat refresh sent periodically by the beacon.
			var hb ImplantCheckInRequest
			if err := json.Unmarshal(body, &hb); err == nil {
				_ = l.manager.DB().TouchC2Session(session.ID, string(SessionActive), time.Now())
			}
		}
	}
}

// detachConnection only retires the connection that still owns this session.
func (l *WebSocketListener) detachConnection(conn *wsConn) {
	l.mu.Lock()
	defer l.mu.Unlock()
	if l.conns[conn.sessionID] == conn {
		delete(l.conns, conn.sessionID)
		_ = l.manager.MarkSessionDead(conn.sessionID)
	}
}

// taskDispatcherLoop periodically polls active WebSocket sessions and pushes queued tasks.
func (l *WebSocketListener) taskDispatcherLoop() {
	t := time.NewTicker(500 * time.Millisecond)
	defer t.Stop()
	for {
		select {
		case <-l.stopCh:
			return
		case <-t.C:
			l.mu.Lock()
			snapshot := make([]*wsConn, 0, len(l.conns))
			for _, c := range l.conns {
				snapshot = append(snapshot, c)
			}
			l.mu.Unlock()
			for _, c := range snapshot {
				envelopes, err := l.manager.PopTasksForBeacon(c.sessionID, 20)
				if err != nil || len(envelopes) == 0 {
					continue
				}
				for _, env := range envelopes {
					l.sendTaskFrame(c, env)
				}
			}
		}
	}
}

func (l *WebSocketListener) sendTaskFrame(c *wsConn, env TaskEnvelope) {
	frame := map[string]interface{}{"type": "task", "data": env}
	body, err := json.Marshal(frame)
	if err != nil {
		return
	}
	enc, err := EncryptAESGCM(l.rec.EncryptionKey, body)
	if err != nil {
		return
	}
	c.writeMu.Lock()
	defer c.writeMu.Unlock()
	_ = c.ws.SetWriteDeadline(time.Now().Add(10 * time.Second))
	_ = c.ws.WriteMessage(websocket.TextMessage, []byte(enc))
}

// readEncryptedFrame reads one encrypted WebSocket frame and returns its type and decrypted data payload.
func readEncryptedFrame(ws *websocket.Conn, key string) (string, []byte, error) {
	mt, raw, err := ws.ReadMessage()
	if err != nil {
		return "", nil, err
	}
	if mt != websocket.TextMessage && mt != websocket.BinaryMessage {
		return "", nil, errors.New("unexpected ws frame type")
	}
	plain, err := DecryptAESGCM(key, string(raw))
	if err != nil {
		return "", nil, err
	}
	var env struct {
		Type string          `json:"type"`
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(plain, &env); err != nil {
		return "", nil, err
	}
	return env.Type, env.Data, nil
}

// contextWithTimeout is a small helper to avoid repeated context imports across listener files.
func contextWithTimeout(d time.Duration) (context.Context, context.CancelFunc) {
	return context.WithTimeout(context.Background(), d)
}
