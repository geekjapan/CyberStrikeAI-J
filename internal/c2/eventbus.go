package c2

import (
	"sync"
	"sync/atomic"
	"time"
)

// Event is the internal event unit delivered by EventBus and acts as a real-time projection of database.C2Event.
// Key differences:
//   - The database table stores full history for auditing and paginated queries;
//   - EventBus streams live updates to connected SSE/WS subscribers.
type Event struct {
	ID        string                 `json:"id"`
	Level     string                 `json:"level"`
	Category  string                 `json:"category"`
	SessionID string                 `json:"sessionId,omitempty"`
	TaskID    string                 `json:"taskId,omitempty"`
	Message   string                 `json:"message"`
	Data      map[string]interface{} `json:"data,omitempty"`
	CreatedAt time.Time              `json:"createdAt"`
}

// EventBus is a simple in-memory broadcast bus.
// Design notes:
//   - Multiple subscribers: each subscriber owns a buffered channel so slow consumers never block publishers;
//   - Drop when full: publishing never blocks, avoiding stalls in listener accept loops or beacon handlers;
//   - Filtering: subscriptions can scope by SessionID/Category so clients only receive relevant events;
//   - Safe shutdown: Close() closes all subscriber channels to prevent goroutine leaks.
type EventBus struct {
	mu          sync.RWMutex
	subscribers map[string]*Subscription
	closed      bool
}

// Subscription is a handle for an active EventBus subscriber.
type Subscription struct {
	ID         string
	Ch         chan *Event
	SessionID  string // empty means no filter
	Category   string // empty means no filter
	Levels     map[string]struct{}
	dropCount  atomic.Int64
}

// NewEventBus creates a new EventBus.
func NewEventBus() *EventBus {
	return &EventBus{subscribers: make(map[string]*Subscription)}
}

// Subscribe registers a subscriber and returns its Subscription; callers must invoke Unsubscribe when done.
//   - bufferSize: per-subscriber channel capacity (64..256 recommended);
//   - sessionFilter / categoryFilter: empty string means no filter;
//   - levelFilter: e.g. []string{"warn", "critical"}; nil or empty receives all levels.
func (b *EventBus) Subscribe(id string, bufferSize int, sessionFilter, categoryFilter string, levelFilter []string) *Subscription {
	if bufferSize <= 0 {
		bufferSize = 128
	}
	sub := &Subscription{
		ID:        id,
		Ch:        make(chan *Event, bufferSize),
		SessionID: sessionFilter,
		Category:  categoryFilter,
	}
	if len(levelFilter) > 0 {
		sub.Levels = make(map[string]struct{}, len(levelFilter))
		for _, l := range levelFilter {
			sub.Levels[l] = struct{}{}
		}
	}
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		close(sub.Ch)
		return sub
	}
	b.subscribers[id] = sub
	return sub
}

// Unsubscribe removes a subscriber and closes its channel.
func (b *EventBus) Unsubscribe(id string) {
	b.mu.Lock()
	defer b.mu.Unlock()
	if sub, ok := b.subscribers[id]; ok {
		delete(b.subscribers, id)
		close(sub.Ch)
	}
}

// Publish broadcasts an event to all matching subscribers without blocking; full channels drop silently.
func (b *EventBus) Publish(e *Event) {
	if e == nil {
		return
	}
	b.mu.RLock()
	subs := make([]*Subscription, 0, len(b.subscribers))
	for _, s := range b.subscribers {
		if s.matches(e) {
			subs = append(subs, s)
		}
	}
	closed := b.closed
	b.mu.RUnlock()
	if closed {
		return
	}
	for _, s := range subs {
		select {
		case s.Ch <- e:
		default:
			s.dropCount.Add(1)
		}
	}
}

// Close shuts down the bus and closes all active subscriptions.
func (b *EventBus) Close() {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.closed {
		return
	}
	b.closed = true
	for id, s := range b.subscribers {
		close(s.Ch)
		delete(b.subscribers, id)
	}
}

func (s *Subscription) matches(e *Event) bool {
	if s.SessionID != "" && e.SessionID != s.SessionID {
		return false
	}
	if s.Category != "" && e.Category != s.Category {
		return false
	}
	if len(s.Levels) > 0 {
		if _, ok := s.Levels[e.Level]; !ok {
			return false
		}
	}
	return true
}
