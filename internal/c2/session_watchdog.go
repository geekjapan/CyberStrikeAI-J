package c2

import (
	"context"
	"time"

	"cyberstrike-ai/internal/database"

	"go.uber.org/zap"
)

// SessionWatchdog monitors session heartbeats: it periodically scans active/sleeping sessions
// and marks those exceeding (sleep * (1 + jitter%) * graceFactor) (clamped by minGrace) as dead.
//
// Design notes:
//   - Uses a single goroutine + ticker rather than per-session timers, scaling linearly with session count;
//   - Threshold adapts to each session's sleep/jitter (a sleep=300s session is not judged by a sleep=5s threshold);
//   - Global minGrace prevents false positives from misconfigured sleep intervals;
//   - Checks only last_check_in without depending on implant_uuid or listener transport details.
type SessionWatchdog struct {
	manager  *Manager
	logger   *zap.Logger
	interval time.Duration // scan interval, default 15s
	minGrace time.Duration // minimum grace period, default 30s
	gracePct float64       // missed-heartbeat multiplier, default 3.0 (3x sleep interval without check-in)
	stopCh   chan struct{}
}

// NewSessionWatchdog creates a new SessionWatchdog.
func NewSessionWatchdog(m *Manager) *SessionWatchdog {
	return &SessionWatchdog{
		manager:  m,
		logger:   m.Logger().With(zap.String("component", "c2-watchdog")),
		interval: 15 * time.Second,
		minGrace: 30 * time.Second,
		gracePct: 3.0,
		stopCh:   make(chan struct{}),
	}
}

// Run blocks and runs the periodic scan until ctx is canceled or Stop is called.
func (w *SessionWatchdog) Run(ctx context.Context) {
	t := time.NewTicker(w.interval)
	defer t.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-w.stopCh:
			return
		case <-t.C:
			w.tick()
		}
	}
}

// Stop signals the watchdog loop to exit.
func (w *SessionWatchdog) Stop() {
	select {
	case <-w.stopCh:
	default:
		close(w.stopCh)
	}
}

func (w *SessionWatchdog) tick() {
	now := time.Now()
	for _, status := range []string{string(SessionActive), string(SessionSleeping)} {
		sessions, err := w.manager.DB().ListC2Sessions(database.ListC2SessionsFilter{Status: status})
		if err != nil {
			w.logger.Warn("watchdog list query failed", zap.Error(err))
			continue
		}
		for _, s := range sessions {
			if w.isStale(s, now) {
				if err := w.manager.MarkSessionDead(s.ID); err != nil {
					w.logger.Warn("Failed to mark session offline", zap.String("session_id", s.ID), zap.Error(err))
				}
			}
		}
	}
	sessions, err := w.manager.DB().ListC2Sessions(database.ListC2SessionsFilter{Status: string(SessionDead)})
	if err != nil {
		w.logger.Warn("Offline task query failed", zap.Error(err))
		return
	}
	for _, session := range sessions {
		w.expireOfflineCommands(session, now)
	}
}

func (w *SessionWatchdog) expireOfflineCommands(session *database.C2Session, now time.Time) {
	tasks, err := w.manager.DB().ListC2Tasks(database.ListC2TasksFilter{SessionID: session.ID, Status: string(TaskSent)})
	if err != nil {
		w.logger.Warn("Offline command query failed", zap.Error(err))
		return
	}
	for _, task := range tasks {
		if task.TaskType != string(TaskTypeExec) && task.TaskType != string(TaskTypeShell) {
			continue
		}
		if task.SentAt == nil {
			continue
		}
		seconds := 60.0
		if value, ok := task.Payload["timeout_seconds"].(float64); ok && value > 0 {
			seconds = value
		}
		// Invalid huge deadlines remain unexpired rather than wrapping a duration.
		if seconds > float64((1<<63-1)/int64(time.Second)) {
			continue
		}
		if now.Sub(*task.SentAt) <= time.Duration(seconds)*time.Second+w.minGrace {
			continue
		}
		status := string(TaskFailed)
		errText := "Session is offline and the task result exceeded its execution deadline; whether the remote process has terminated is unconfirmed"
		if err := w.manager.DB().UpdateC2Task(task.ID, database.C2TaskUpdate{ExpectedStatus: &task.Status, Status: &status, Error: &errText, CompletedAt: &now}); err != nil {
			w.logger.Warn("Failed to finalize offline command", zap.Error(err))
			continue
		}
		w.manager.publishEvent("warn", "task", session.ID, task.ID, errText, nil)
	}
}

// isStale reports whether a session has exceeded its heartbeat deadline.
func (w *SessionWatchdog) isStale(s *database.C2Session, now time.Time) bool {
	// Fall back to first_seen_at if no heartbeat timestamp is recorded.
	last := s.LastCheckIn
	if last.IsZero() {
		last = s.FirstSeenAt
	}
	sleep := s.SleepSeconds
	if sleep <= 0 {
		// Interactive TCP reverse sessions use sleep=0 -> evaluate against 2x minGrace.
		return now.Sub(last) > w.minGrace*2
	}
	jitter := s.JitterPercent
	if jitter < 0 {
		jitter = 0
	}
	if jitter > 100 {
		jitter = 100
	}
	// Threshold = max(sleep * (1 + jitter%) * gracePct, minGrace).
	expected := time.Duration(float64(sleep)*(1+float64(jitter)/100.0)*w.gracePct) * time.Second
	if expected < w.minGrace {
		expected = w.minGrace
	}
	return now.Sub(last) > expected
}
