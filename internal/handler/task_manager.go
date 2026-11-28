package handler

import (
	"context"
	"encoding/json"
	"errors"
	"sort"
	"strings"
	"sync"
	"time"

	"cyberstrike-ai/internal/multiagent"
	"cyberstrike-ai/internal/openai"
	"cyberstrike-ai/internal/runlease"
	"cyberstrike-ai/internal/security"
)

// ErrTaskCancelled is the error when the user cancels a task
var ErrTaskCancelled = errors.New("agent task cancelled by user")

// ErrTaskAlreadyRunning means a task is already executing in the session
var ErrTaskAlreadyRunning = errors.New("agent task already running for conversation")

// shouldPersistAgentAgentTraceAfterRunError: when an Agent-related Run returns a non-success result, decides whether to still write last_react_* for loadHistoryFromAgentTrace in the next turn.
// Current policy: whether the run ends normally, abnormally, or is stopped by the user, the last usable trace is kept where possible,
// so that continuing in the same session can resume from the original context, instead of falling back to message-text history only.
func shouldPersistAgentAgentTraceAfterRunError(baseCtx context.Context) bool {
	return true
}

type taskCleanupAttempt struct {
	done chan struct{}
	err  error
}

// AgentTask describes a running Agent task
type AgentTask struct {
	RunID            string `json:"runId"`
	CleanupError     string `json:"cleanupError,omitempty"`
	processes        *security.ProcessScope
	workers          *runlease.Scope
	IsolationBackend string `json:"isolationBackend,omitempty"`
	finishing        *taskCleanupAttempt
	stopping         chan struct{}
	cancelRequested  bool
	finalStatus      string
	ConversationID   string    `json:"conversationId"`
	Title            string    `json:"title,omitempty"`
	Message          string    `json:"message,omitempty"`
	StartedAt        time.Time `json:"startedAt"`
	Status           string    `json:"status"`
	CancellingAt     time.Time `json:"-"` // The time the task entered the cancelling state, used to clean up tasks stuck for a long time

	// ActiveMCPExecutionID is the executionId of the MCP tool currently executing (memory only; used by "interrupt and continue" to stop only the current tool)
	ActiveMCPExecutionID string `json:"-"`

	// InterruptContinueNote is the extra note the user enters in the dialog for "interrupt and continue" when there is no MCP (written before Cancel; read and cleared by the continuation turn)
	InterruptContinueNote string `json:"-"`

	// activeAgentExecuteCancel is the cancel function of the Agent filesystem execute in progress (runs in parallel with MCP tools; used for interrupt and continue)
	activeAgentExecuteCancel context.CancelFunc
	// activeAgentExecuteAbortNote is the user note written by AbortActiveAgentExecute, merged into the tool result when execute finishes
	activeAgentExecuteAbortNote string

	// hitlCognition is the context for the current run that the HITL/audit Agent reads (the user's original words + thinking; excludes session history)
	hitlCognition *hitlCognitionState

	// agentRuntimeCancel wraps the current Pi native AgentCancelFunc; when cancelling a task, it is triggered first, with the context as a fallback.
	agentRuntimeCancel        func(error) bool
	agentRuntimeCancelVersion uint64

	// agentTurnLoopInterrupt is the current Agent TurnLoop's hook for pushing user supplements; on interrupt-and-continue, the supplement is preferably queued as a new turn item.
	agentTurnLoopInterrupt        func(string) bool
	agentTurnLoopInterruptVersion uint64

	cancel func(error)
}

// RegisterRunningTool implements mcp.ToolRunRegistry: when a tool starts, record the current executionId for this session.
func (m *AgentTaskManager) RegisterRunningTool(conversationID, executionID string) {
	conversationID = strings.TrimSpace(conversationID)
	executionID = strings.TrimSpace(executionID)
	if conversationID == "" || executionID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		t.ActiveMCPExecutionID = executionID
	}
}

// UnregisterRunningTool clears the record when the tool ends (only if the id still matches, to avoid concurrent mix-ups).
func (m *AgentTaskManager) UnregisterRunningTool(conversationID, executionID string) {
	conversationID = strings.TrimSpace(conversationID)
	executionID = strings.TrimSpace(executionID)
	if conversationID == "" || executionID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		if t.ActiveMCPExecutionID == executionID {
			t.ActiveMCPExecutionID = ""
		}
	}
}

// RegisterActiveAgentExecute records an in-progress Agent filesystem execute (only one per session at a time).
func (m *AgentTaskManager) RegisterActiveAgentExecute(conversationID string, cancel context.CancelFunc) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || cancel == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		t.activeAgentExecuteCancel = cancel
		t.activeAgentExecuteAbortNote = ""
	}
}

// UnregisterActiveAgentExecute clears the record after the execute finishes normally or has been cancelled.
func (m *AgentTaskManager) UnregisterActiveAgentExecute(conversationID string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		t.activeAgentExecuteCancel = nil
		t.activeAgentExecuteAbortNote = ""
	}
}

// ConversationIDForActiveMCPExecution looks up the session ID from the currently recorded tool executionId (for the MCP monitoring page to terminate by executionId).
func (m *AgentTaskManager) ConversationIDForActiveMCPExecution(executionID string) string {
	executionID = strings.TrimSpace(executionID)
	if executionID == "" {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	for convID, t := range m.tasks {
		if t != nil && t.ActiveMCPExecutionID == executionID {
			return convID
		}
	}
	return ""
}

// ConversationIDForActiveAgentExecute returns the session ID of the only session currently running an Agent execute; returns empty when multiple sessions run in parallel.
func (m *AgentTaskManager) ConversationIDForActiveAgentExecute() (string, bool) {
	m.mu.Lock()
	defer m.mu.Unlock()
	var found string
	count := 0
	for convID, t := range m.tasks {
		if t != nil && t.activeAgentExecuteCancel != nil {
			found = convID
			count++
		}
	}
	if count == 1 {
		return found, true
	}
	return "", false
}

// AbortActiveAgentExecute terminates the current Agent execute and stages the user note (consistent with MCP tool termination).
func (m *AgentTaskManager) AbortActiveAgentExecute(conversationID, note string) bool {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return false
	}
	m.mu.Lock()
	t, ok := m.tasks[conversationID]
	if !ok || t == nil || t.activeAgentExecuteCancel == nil {
		m.mu.Unlock()
		return false
	}
	t.activeAgentExecuteAbortNote = strings.TrimSpace(note)
	cancel := t.activeAgentExecuteCancel
	m.mu.Unlock()
	cancel()
	return true
}

// TakeAgentExecuteAbortNote reads and clears the execute abort note (called once when the execute wraps up).
func (m *AgentTaskManager) TakeAgentExecuteAbortNote(conversationID string) string {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		n := t.activeAgentExecuteAbortNote
		t.activeAgentExecuteAbortNote = ""
		return n
	}
	return ""
}

// SetInterruptContinueNote writes the user supplement before initiating the ErrInterruptContinue cancel (memory only).
func (m *AgentTaskManager) SetInterruptContinueNote(conversationID, note string) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		t.InterruptContinueNote = note
	}
}

// TakeInterruptContinueNote reads and clears the supplement note (called once when continuation starts).
func (m *AgentTaskManager) TakeInterruptContinueNote(conversationID string) string {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ""
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		n := t.InterruptContinueNote
		t.InterruptContinueNote = ""
		return n
	}
	return ""
}

// BindTaskCancel replaces the cancel function bound to the context within the same running task (used to switch to a new baseCtx when continuing after an interrupt).
func (m *AgentTaskManager) BindTaskCancel(conversationID string, cancel context.CancelCauseFunc) {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || cancel == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		t.cancel = func(err error) {
			cancel(err)
		}
	}
}

// BindAgentRuntimeCancel records the native Agent cancel hook for the current run segment.
func (m *AgentTaskManager) BindAgentRuntimeCancel(conversationID string, cancel func(error) bool) func() {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || cancel == nil {
		return func() {}
	}
	m.mu.Lock()
	t, ok := m.tasks[conversationID]
	if !ok || t == nil {
		m.mu.Unlock()
		return func() {}
	}
	t.agentRuntimeCancelVersion++
	version := t.agentRuntimeCancelVersion
	t.agentRuntimeCancel = cancel
	m.mu.Unlock()

	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if cur, exists := m.tasks[conversationID]; exists && cur != nil && cur.agentRuntimeCancelVersion == version {
			cur.agentRuntimeCancel = nil
		}
	}
}

// BindAgentTurnLoopInterrupt records the Agent TurnLoop hook that queues user supplements for the current running task.
func (m *AgentTaskManager) BindAgentTurnLoopInterrupt(conversationID string, push func(string) bool) func() {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" || push == nil {
		return func() {}
	}
	m.mu.Lock()
	t, ok := m.tasks[conversationID]
	if !ok || t == nil {
		m.mu.Unlock()
		return func() {}
	}
	t.agentTurnLoopInterruptVersion++
	version := t.agentTurnLoopInterruptVersion
	t.agentTurnLoopInterrupt = push
	m.mu.Unlock()

	return func() {
		m.mu.Lock()
		defer m.mu.Unlock()
		if cur, exists := m.tasks[conversationID]; exists && cur != nil && cur.agentTurnLoopInterruptVersion == version {
			cur.agentTurnLoopInterrupt = nil
		}
	}
}

// ActiveMCPExecutionID returns the executionId of the tool in progress for the current session, or an empty string if none.
func (m *AgentTaskManager) ActiveMCPExecutionID(conversationID string) string {
	conversationID = strings.TrimSpace(conversationID)
	if conversationID == "" {
		return ""
	}
	m.mu.RLock()
	defer m.mu.RUnlock()
	if t, ok := m.tasks[conversationID]; ok && t != nil {
		return strings.TrimSpace(t.ActiveMCPExecutionID)
	}
	return ""
}

// CompletedTask is a completed task (for history)
type CompletedTask struct {
	CleanupError     string    `json:"cleanupError,omitempty"`
	IsolationBackend string    `json:"isolationBackend,omitempty"`
	RunID            string    `json:"runId"`
	ConversationID   string    `json:"conversationId"`
	Title            string    `json:"title,omitempty"`
	Message          string    `json:"message,omitempty"`
	StartedAt        time.Time `json:"startedAt"`
	CompletedAt      time.Time `json:"completedAt"`
	Status           string    `json:"status"`
}

// AgentTaskManager manages running Agent tasks
type AgentTaskManager struct {
	mu               sync.RWMutex
	tasks            map[string]*AgentTask
	completedTasks   []*CompletedTask // Recently completed task history
	maxHistorySize   int              // Maximum number of history records
	historyRetention time.Duration    // History retention time
	eventBus         *TaskEventBus    // Optional: close the mirrored SSE subscriptions when the task ends
	// toolCanceler terminates the MCP tools still running in the session when the user stops the whole turn or the session ends (not "interrupt and continue").
	toolCanceler func(conversationID string)
	shuttingDown bool
	shutdown     chan struct{}
	shutdownOnce sync.Once
}

const (
	// cancellingStuckThreshold: if a task stays in the "cancelling" state longer than this, it is forcibly removed from the running list. A normal cancel returns within the current step,
	// if it does not, it is treated as stuck and the session is released as soon as possible. Common practice is to release within 30–60s.
	cancellingStuckThreshold = 45 * time.Second
	// cancellingStuckThresholdLegacy is the fallback duration used with StartedAt when CancellingAt was not recorded
	cancellingStuckThresholdLegacy = 2 * time.Minute
	cleanupInterval                = 15 * time.Second // Together with the threshold above, removal happens within about 60s at most
)

// NewAgentTaskManager creates the task manager
func NewAgentTaskManager() *AgentTaskManager {
	m := &AgentTaskManager{
		tasks:            make(map[string]*AgentTask),
		shutdown:         make(chan struct{}),
		completedTasks:   make([]*CompletedTask, 0),
		maxHistorySize:   50,             // Keep at most 50 history records
		historyRetention: 24 * time.Hour, // Keep for 24 hours
	}
	go m.runStuckCancellingCleanup()
	return m
}

// SetTaskEventBus sets the task event bus (shares the same instance with AgentHandler).
func (m *AgentTaskManager) SetTaskEventBus(b *TaskEventBus) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.eventBus = b
}

// SetToolCanceler sets the callback that terminates the MCP tools still running when the whole turn is stopped or the session ends (injected by AgentHandler).
func (m *AgentTaskManager) SetToolCanceler(fn func(conversationID string)) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.toolCanceler = fn
}

// GetTask returns the running task (nil if none).
func (m *AgentTaskManager) GetTask(conversationID string) *AgentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.tasks[conversationID]
}

// GetTaskSnapshot returns a read-only copy of a running task for status display, avoiding reads of mutable task fields outside the lock.
func (m *AgentTaskManager) GetTaskSnapshot(conversationID string) *AgentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()
	task := m.tasks[conversationID]
	if task == nil {
		return nil
	}
	snapshot := *task
	snapshot.IsolationBackend = task.processes.IsolationBackend()
	return &snapshot
}

// runStuckCancellingCleanup periodically forcibly ends tasks that have been in the "cancelling" state for a long time, so they do not block sending new messages
func (m *AgentTaskManager) runStuckCancellingCleanup() {
	ticker := time.NewTicker(cleanupInterval)
	defer ticker.Stop()
	for {
		select {
		case <-m.shutdown:
			return
		case <-ticker.C:
			m.cleanupStuckCancelling()
		}
	}
}

func (m *AgentTaskManager) cleanupStuckCancelling() {
	m.mu.Lock()
	type pendingFinish struct{ id, runID, status string }
	var toFinish []pendingFinish
	now := time.Now()
	for id, task := range m.tasks {
		if task.Status == "cleanup_failed" {
			toFinish = append(toFinish, pendingFinish{id, task.RunID, task.finalStatus})
			continue
		}
		if task.Status != "cancelling" {
			continue
		}
		var elapsed time.Duration
		if !task.CancellingAt.IsZero() {
			elapsed = now.Sub(task.CancellingAt)
			if elapsed < cancellingStuckThreshold {
				continue
			}
		} else {
			elapsed = now.Sub(task.StartedAt)
			if elapsed < cancellingStuckThresholdLegacy {
				continue
			}
		}
		toFinish = append(toFinish, pendingFinish{id, task.RunID, "cancelled"})
	}
	m.mu.Unlock()
	for _, pending := range toFinish {
		_ = m.FinishTaskRun(pending.id, pending.runID, pending.status)
	}
}

// StartTask registers and starts a new task
func (m *AgentTaskManager) StartTask(conversationID, message string, cancel context.CancelCauseFunc) (*AgentTask, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.shuttingDown {
		return nil, errors.New("task manager is shutting down")
	}
	if _, exists := m.tasks[conversationID]; exists {
		return nil, ErrTaskAlreadyRunning
	}

	scope := security.NewProcessScope()
	task := &AgentTask{
		RunID: scope.ID, processes: scope, workers: runlease.New(),
		ConversationID: conversationID,
		Message:        message,
		StartedAt:      time.Now(),
		Status:         "running",
		cancel: func(err error) {
			if cancel != nil {
				cancel(err)
			}
		},
	}

	m.tasks[conversationID] = task
	task.hitlCognition = &hitlCognitionState{UserMessage: strings.TrimSpace(message)}
	return task, nil
}

// CancelTask cancels the task for the given session. If the task is already cancelling, still return (true, nil) so the API is idempotent and the frontend does not show an error.
func (m *AgentTaskManager) CancelTask(conversationID string, cause error) (bool, error) {
	m.mu.Lock()
	task, exists := m.tasks[conversationID]
	if !exists {
		m.mu.Unlock()
		return false, nil
	}

	// If cancellation is already in progress, treat it as success (idempotent), so repeated clicks in the frontend do not report 'task not found'
	if task.Status == "cancelling" || task.finishing != nil {
		m.mu.Unlock()
		return true, nil
	}

	if cause == nil || errors.Is(cause, ErrTaskCancelled) {
		task.cancelRequested = true
		task.finalStatus = "cancelled"
	}

	// ErrInterruptContinue: only cuts off the current reasoning step; the handler then continues the run, and the task does not enter a long "cancelling" state.
	if cause != nil && errors.Is(cause, multiagent.ErrInterruptContinue) {
		task.Status = "running"
	} else {
		task.Status = "cancelling"
		task.CancellingAt = time.Now()
	}
	if cause != nil && errors.Is(cause, ErrTaskCancelled) {
		task.InterruptContinueNote = ""
	}
	cancel := task.cancel
	if cause == nil {
		cause = ErrTaskCancelled
	}
	interruptPush := task.agentTurnLoopInterrupt
	interruptNote := task.InterruptContinueNote
	runtimeCancel := task.agentRuntimeCancel
	activeExecuteCancel := task.activeAgentExecuteCancel
	if !errors.Is(cause, multiagent.ErrInterruptContinue) {
		task.processes.Seal()
		task.workers.Seal()
		task.stopping = make(chan struct{})
		defer close(task.stopping)
	}
	var toolCanceler func(string)
	if errors.Is(cause, ErrTaskCancelled) {
		toolCanceler = m.toolCanceler
	}
	m.mu.Unlock()

	if errors.Is(cause, multiagent.ErrInterruptContinue) && interruptPush != nil && interruptPush(interruptNote) {
		m.mu.Lock()
		if cur, exists := m.tasks[conversationID]; exists && cur != nil {
			cur.InterruptContinueNote = ""
		}
		m.mu.Unlock()
		return true, nil
	}

	runtimeHandled := false
	if runtimeCancel != nil {
		runtimeHandled = runtimeCancel(cause)
	}
	// A "full stop" must also cancel the host context: even if the native Agent Cancel has been accepted,
	// it may only return at a safe point or report a timeout, so it cannot be used to keep the whole task alive.
	// Interrupt-and-continue keeps its original semantics: when the native cancel has been handled, the runtime is responsible for recovery.
	if cancel != nil && (!runtimeHandled || errors.Is(cause, ErrTaskCancelled)) {
		cancel(cause)
	}
	if toolCanceler != nil {
		toolCanceler(conversationID)
	}
	if !errors.Is(cause, multiagent.ErrInterruptContinue) {
		task.workers.Cancel()
		if activeExecuteCancel != nil {
			activeExecuteCancel()
		}
		return true, task.processes.Close()
	}
	return true, nil
}

// UpdateTaskStatus updates the task status without deleting the task (used to update the status before sending an event)
func (m *AgentTaskManager) UpdateTaskStatus(conversationID string, status string) {
	m.mu.Lock()
	defer m.mu.Unlock()

	task, exists := m.tasks[conversationID]
	if !exists {
		return
	}

	if task.finishing != nil || task.Status == "cleanup_failed" {
		return
	}
	if task.cancelRequested {
		status = "cancelled"
	}
	switch status {
	case "completed", "cancelled", "failed", "timeout":
		task.finalStatus = status
		task.Status = "cleaning"
		task.processes.Seal()
		task.workers.Seal()
	default:
		if status != "" {
			task.Status = status
		}
	}
}

// BindProcessScope snapshots ownership once at task start. Continuations must
// derive from this context, never resolve ownership again using conversation ID.
func (m *AgentTaskManager) BindProcessScope(ctx context.Context, conversationID, runID string) context.Context {
	// Put the conversation ID into ctx: the %session_id% placeholder in custom request headers is replaced based on it,
	// so the x-opencode-session headers sent for each conversation match the current session.
	ctx = openai.WithSessionID(ctx, conversationID)
	m.mu.RLock()
	defer m.mu.RUnlock()
	if task := m.tasks[conversationID]; task != nil && task.RunID == runID {
		return runlease.WithScope(security.WithProcessScope(ctx, task.processes), task.workers)
	}
	// Fail closed if a task disappeared before its execution context was bound.
	scope := security.NewProcessScope()
	scope.Seal()
	workers := runlease.New()
	workers.Seal()
	return runlease.WithScope(security.WithProcessScope(ctx, scope), workers)
}

// FinishTask is retained for callers that operate on the current task. Owners
// use FinishTaskRun, so a delayed defer cannot finish a newer conversation run.
func (m *AgentTaskManager) FinishTask(conversationID string, finalStatus string) {
	m.mu.RLock()
	task := m.tasks[conversationID]
	m.mu.RUnlock()
	if task != nil {
		_ = m.FinishTaskRun(conversationID, task.RunID, finalStatus)
	}
}

func (m *AgentTaskManager) FinishTaskRun(conversationID, runID, finalStatus string) error {
	m.mu.Lock()
	task := m.tasks[conversationID]
	if task == nil || task.RunID != runID {
		m.mu.Unlock()
		return nil
	}
	if task.stopping != nil {
		select {
		case <-task.stopping:
		default:
			stopping := task.stopping
			m.mu.Unlock()
			<-stopping
			return m.FinishTaskRun(conversationID, runID, finalStatus)
		}
	}
	if task.finishing != nil {
		attempt := task.finishing
		m.mu.Unlock()
		<-attempt.done
		return attempt.err
	}
	if task.cancelRequested {
		finalStatus = "cancelled"
	}
	attempt := &taskCleanupAttempt{done: make(chan struct{})}
	task.finishing = attempt
	task.finalStatus = finalStatus
	task.Status = "cleaning"
	task.processes.Seal()
	task.workers.Seal()
	toolCanceler := m.toolCanceler
	activeCancel := task.activeAgentExecuteCancel
	cancel := task.cancel
	bus := m.eventBus
	m.mu.Unlock()

	// Keep the conversation occupied throughout cleanup, including callbacks.
	if cancel != nil {
		cancel(nil)
	}
	if toolCanceler != nil {
		toolCanceler(conversationID)
	}
	if activeCancel != nil {
		activeCancel()
	}
	task.workers.Cancel()
	processErr := task.processes.Close()
	waitCtx, waitCancel := context.WithTimeout(context.Background(), 3*time.Second)
	workerErr := task.workers.Wait(waitCtx)
	waitCancel()
	cleanupErr := taskCleanupResult(processErr, workerErr)
	unconfirmed := taskCleanupStatus(cleanupErr) == "cleanup_unconfirmed"
	if unconfirmed {
		finalStatus = "cleanup_unconfirmed"
	}
	cleanupMessage := ""
	if cleanupErr != nil {
		cleanupMessage = cleanupErr.Error()
	}
	if (cleanupErr == nil || unconfirmed) && bus != nil {
		// Publish the verified result or the explicit cleanup uncertainty.
		publish := func(event StreamEvent) {
			payload, _ := json.Marshal(event)
			bus.Publish(conversationID, append(append([]byte("data: "), payload...), '\n', '\n'))
		}
		if unconfirmed {
			publish(taskCleanupEvent(cleanupErr))
		}
		publish(StreamEvent{Type: "done", Data: map[string]interface{}{"conversationId": conversationID, "runId": runID, "status": finalStatus, "cleanupError": cleanupMessage}})
		bus.CloseConversation(conversationID)
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	defer close(attempt.done)
	attempt.err = cleanupErr
	if cleanupErr != nil && !unconfirmed {
		task.Status = "cleanup_failed"
		task.CleanupError = cleanupErr.Error()
		task.finishing = nil
		return cleanupErr
	}
	task.CleanupError = ""
	if unconfirmed {
		task.CleanupError = cleanupErr.Error()
	}
	task.Status = finalStatus
	m.completedTasks = append(m.completedTasks, &CompletedTask{
		RunID: task.RunID, CleanupError: task.CleanupError, IsolationBackend: task.processes.IsolationBackend(), ConversationID: task.ConversationID, Message: task.Message,
		StartedAt: task.StartedAt, CompletedAt: time.Now(), Status: finalStatus,
	})
	m.cleanupHistory()
	delete(m.tasks, conversationID)
	return cleanupErr
}

// Shutdown rejects new tasks before cancelling and reaping existing task jobs.
func (m *AgentTaskManager) Shutdown() {
	m.mu.Lock()
	m.shuttingDown = true
	m.shutdownOnce.Do(func() { close(m.shutdown) })
	tasks := make([]*AgentTask, 0, len(m.tasks))
	for _, task := range m.tasks {
		tasks = append(tasks, task)
		task.processes.Seal()
		task.workers.Seal()
	}
	m.mu.Unlock()
	var wg sync.WaitGroup
	for _, task := range tasks {
		wg.Add(1)
		go func(task *AgentTask) {
			defer wg.Done()
			_, _ = m.CancelTask(task.ConversationID, ErrTaskCancelled)
			_ = m.FinishTaskRun(task.ConversationID, task.RunID, "cancelled")
		}(task)
	}
	wg.Wait()
}

// cleanupHistory cleans up expired history records
func (m *AgentTaskManager) cleanupHistory() {
	now := time.Now()
	cutoffTime := now.Add(-m.historyRetention)

	// Filter out expired records
	validTasks := make([]*CompletedTask, 0, len(m.completedTasks))
	for _, task := range m.completedTasks {
		if task.CompletedAt.After(cutoffTime) {
			validTasks = append(validTasks, task)
		}
	}

	// If the count still exceeds the maximum, keep only the newest
	if len(validTasks) > m.maxHistorySize {
		// Sort by completion time and keep the newest
		// Since entries are appended, the newest are at the end, so just take the last N
		start := len(validTasks) - m.maxHistorySize
		validTasks = validTasks[start:]
	}

	m.completedTasks = validTasks
}

// GetActiveTasks returns all running tasks
func (m *AgentTaskManager) GetActiveTasks() []*AgentTask {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make([]*AgentTask, 0, len(m.tasks))
	for _, task := range m.tasks {
		result = append(result, &AgentTask{
			RunID: task.RunID, CleanupError: task.CleanupError, IsolationBackend: task.processes.IsolationBackend(),
			ConversationID: task.ConversationID,
			Message:        task.Message,
			StartedAt:      task.StartedAt,
			Status:         task.Status,
		})
	}
	sort.Slice(result, func(i, j int) bool {
		if result[i].StartedAt.Equal(result[j].StartedAt) {
			return result[i].ConversationID < result[j].ConversationID
		}
		return result[i].StartedAt.Before(result[j].StartedAt)
	})
	return result
}

// GetCompletedTasks returns the recently completed task history
func (m *AgentTaskManager) GetCompletedTasks() []*CompletedTask {
	m.mu.RLock()
	defer m.mu.RUnlock()

	// Clean up expired records (read lock, does not affect other operations)
	// Note: cleanupHistory cannot be called directly here, because it needs the write lock
	// So filter out expired records on return
	now := time.Now()
	cutoffTime := now.Add(-m.historyRetention)

	result := make([]*CompletedTask, 0, len(m.completedTasks))
	for _, task := range m.completedTasks {
		if task.CompletedAt.After(cutoffTime) {
			result = append(result, task)
		}
	}

	// Sort by completion time, descending (newest first)
	// Since entries are appended, the newest are at the end, so reverse the order
	for i, j := 0, len(result)-1; i < j; i, j = i+1, j-1 {
		result[i], result[j] = result[j], result[i]
	}

	// Limit the number returned
	if len(result) > m.maxHistorySize {
		result = result[:m.maxHistorySize]
	}

	return result
}
