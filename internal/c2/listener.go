package c2

import (
	"strings"
	"sync"

	"cyberstrike-ai/internal/database"

	"go.uber.org/zap"
)

// Listener abstracts a C2 transport listener (TCP/HTTP/HTTPS/WS/DNS).
// Manager remains transport-agnostic and creates instances through ListenerRegistry factories.
type Listener interface {
	// Type returns the listener type string (e.g. "tcp_reverse").
	Type() string
	// Start begins listening; should return ErrPortInUse if the port is occupied.
	Start() error
	// Stop stops listening and releases all associated goroutines without panicking.
	Stop() error
}

// ListenerCreationCtx carries the dependencies passed to a ListenerFactory.
type ListenerCreationCtx struct {
	Listener *database.C2Listener
	Config   *ListenerConfig
	Manager  *Manager
	Logger   *zap.Logger
}

// ListenerFactory creates a Listener instance in the stopped state (not yet started).
type ListenerFactory func(ctx ListenerCreationCtx) (Listener, error)

// ListenerRegistry maps listener type names to factories.
// Concrete implementations are registered during internal/app startup, and tests may inject mocks.
type ListenerRegistry struct {
	mu        sync.RWMutex
	factories map[string]ListenerFactory
}

// NewListenerRegistry creates an empty ListenerRegistry.
func NewListenerRegistry() *ListenerRegistry {
	return &ListenerRegistry{factories: make(map[string]ListenerFactory)}
}

// Register registers a listener factory for typeName.
func (r *ListenerRegistry) Register(typeName string, f ListenerFactory) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.factories[strings.ToLower(strings.TrimSpace(typeName))] = f
}

// Get returns the registered factory for typeName, or nil if unregistered.
func (r *ListenerRegistry) Get(typeName string) ListenerFactory {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return r.factories[strings.ToLower(strings.TrimSpace(typeName))]
}

// RegisteredTypes lists all registered listener types for UI enumeration.
func (r *ListenerRegistry) RegisteredTypes() []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	out := make([]string, 0, len(r.factories))
	for k := range r.factories {
		out = append(out, k)
	}
	return out
}
