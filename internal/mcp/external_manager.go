package mcp

import (
	"context"
	"errors"
	"fmt"
	"strings"
	"sync"
	"sync/atomic"
	"time"

	"cyberstrike-ai/internal/authctx"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/toolguard"

	"go.uber.org/zap"
)

const (
	// externalToolListCacheTTL is the validity period of the cached tool list for a connected external MCP, to avoid a remote ListTools on every API request.
	externalToolListCacheTTL = 60 * time.Second
	// externalToolCountRefreshInterval is the interval for refreshing tool counts in the background (refreshes only clients whose cache has expired or is missing).
	externalToolCountRefreshInterval = 60 * time.Second
)

// toolListCacheEntry is a cache entry for an external MCP tool list
type toolListCacheEntry struct {
	tools     []Tool
	updatedAt time.Time
}

// listToolsInflight merges concurrent ListTools requests to the same MCP
type listToolsInflight struct {
	done  chan struct{}
	tools []Tool
	err   error
}

type ExternalMCPResilienceConfig struct {
	MaxConcurrentPerServer  int
	MaxConcurrentTotal      int
	CircuitFailureThreshold int
	CircuitCooldown         time.Duration
}

type externalMCPServerRuntime struct {
	semaphore           chan struct{}
	consecutiveFailures int
	circuitOpenUntil    time.Time
}

// ExternalMCPManager external MCP manager
type ExternalMCPManager struct {
	clients            map[string]ExternalMCPClient
	configs            map[string]config.ExternalMCPServerConfig
	logger             *zap.Logger
	storage            MonitorStorage                // Optional persistent storage
	executions         map[string]*ToolExecution     // Execution record
	stats              map[string]*ToolStats         // Tool statistics
	errors             map[string]string             // Error message
	toolCounts         map[string]int                // Tool count cache
	toolCountsMu       sync.RWMutex                  // Lock for the tool count cache
	toolCache          map[string]toolListCacheEntry // Tool list cache: MCP name -> tool list
	toolCacheMu        sync.RWMutex                  // Lock for the tool list cache
	listToolsMu        sync.Mutex
	listToolsInflight  map[string]*listToolsInflight
	stopRefresh        chan struct{}  // Signal to stop the background refresh
	refreshWg          sync.WaitGroup // Wait for the background refresh goroutine to finish
	refreshing         atomic.Bool    // Prevent refreshToolCounts from piling up concurrently
	mu                 sync.RWMutex
	runningCancels     map[string]context.CancelFunc
	abortUserNotes     map[string]string
	reconnectMu        sync.Mutex
	reconnecting       map[string]bool
	reconnectLastTry   map[string]time.Time
	reconnectAttempts  map[string]int
	toolAuthorizer     func(context.Context, string, map[string]interface{}) error
	toolGuard          *toolguard.Manager
	executionService   *ExecutionService
	toolWaitTimeout    time.Duration
	toolResultMaxBytes int
	spillRootDir       string
	resilience         ExternalMCPResilienceConfig
	serverRuntimes     map[string]*externalMCPServerRuntime
	globalSemaphore    chan struct{}
}

// NewExternalMCPManager creates the external MCP manager
func NewExternalMCPManager(logger *zap.Logger) *ExternalMCPManager {
	return NewExternalMCPManagerWithStorage(logger, nil)
}

// SetToolAuthorizer installs the policy decision point for all external MCP
// invocations. App wiring configures this before any Agent can call a tool.
func (m *ExternalMCPManager) SetToolAuthorizer(authorizer func(context.Context, string, map[string]interface{}) error) {
	m.mu.Lock()
	m.toolAuthorizer = authorizer
	m.mu.Unlock()
}

// SetToolGuard installs safety rules evaluated before dispatch to external MCPs.
func (m *ExternalMCPManager) SetToolGuard(guard *toolguard.Manager) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.toolGuard = guard
	m.mu.Unlock()
}

func (m *ExternalMCPManager) checkToolGuard(toolName string, args map[string]interface{}) *ToolResult {
	m.mu.RLock()
	guard := m.toolGuard
	m.mu.RUnlock()
	return toolGuardBlockedResult(guard, toolName, args)
}

// NewExternalMCPManagerWithStorage creates the external MCP manager (with persistent storage)
func NewExternalMCPManagerWithStorage(logger *zap.Logger, storage MonitorStorage) *ExternalMCPManager {
	manager := &ExternalMCPManager{
		clients:            make(map[string]ExternalMCPClient),
		configs:            make(map[string]config.ExternalMCPServerConfig),
		logger:             logger,
		storage:            storage,
		executions:         make(map[string]*ToolExecution),
		stats:              make(map[string]*ToolStats),
		errors:             make(map[string]string),
		toolCounts:         make(map[string]int),
		toolCache:          make(map[string]toolListCacheEntry),
		listToolsInflight:  make(map[string]*listToolsInflight),
		stopRefresh:        make(chan struct{}),
		runningCancels:     make(map[string]context.CancelFunc),
		abortUserNotes:     make(map[string]string),
		reconnecting:       make(map[string]bool),
		reconnectLastTry:   make(map[string]time.Time),
		reconnectAttempts:  make(map[string]int),
		toolWaitTimeout:    60 * time.Second,
		toolResultMaxBytes: DefaultToolResultMaxBytes,
		resilience: ExternalMCPResilienceConfig{
			MaxConcurrentPerServer:  2,
			MaxConcurrentTotal:      16,
			CircuitFailureThreshold: 3,
			CircuitCooldown:         60 * time.Second,
		},
		serverRuntimes:  make(map[string]*externalMCPServerRuntime),
		globalSemaphore: make(chan struct{}, 16),
	}
	manager.executionService = NewExecutionService(storage, logger)
	// Start the goroutine that refreshes tool counts in the background
	manager.startToolCountRefresh()
	return manager
}

func (m *ExternalMCPManager) ConfigureToolResultMaxBytes(maxBytes int) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.toolResultMaxBytes = maxBytes
	m.mu.Unlock()
	if m.executionService != nil {
		m.executionService.ConfigureToolResultMaxBytes(maxBytes)
	}
}

// ConfigureToolResultSpillRoot sets the local directory root used when oversized
// tool results are spilled (aligned with reduction_root_dir; empty → tmp/reduction).
func (m *ExternalMCPManager) ConfigureToolResultSpillRoot(rootDir string) {
	if m == nil {
		return
	}
	m.mu.Lock()
	m.spillRootDir = strings.TrimSpace(rootDir)
	m.mu.Unlock()
	if m.executionService != nil {
		m.executionService.ConfigureToolResultSpillRoot(rootDir)
	}
}

// ConfigureToolWaitTimeoutSeconds controls how long an agent-facing tool call
// waits for an external MCP execution before returning an execution_id that can
// be polled with wait_tool_execution. seconds<=0 waits until completion.
func (m *ExternalMCPManager) ConfigureToolWaitTimeoutSeconds(seconds int) {
	if m == nil {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if seconds <= 0 {
		m.toolWaitTimeout = 0
		return
	}
	m.toolWaitTimeout = time.Duration(seconds) * time.Second
}

func (m *ExternalMCPManager) ConfigureResilience(cfg ExternalMCPResilienceConfig) {
	if m == nil {
		return
	}
	normalized := normalizeExternalMCPResilienceConfig(cfg)
	m.mu.Lock()
	defer m.mu.Unlock()
	m.resilience = normalized
	m.serverRuntimes = make(map[string]*externalMCPServerRuntime)
	if normalized.MaxConcurrentTotal > 0 {
		m.globalSemaphore = make(chan struct{}, normalized.MaxConcurrentTotal)
	} else {
		m.globalSemaphore = nil
	}
}

func normalizeExternalMCPResilienceConfig(cfg ExternalMCPResilienceConfig) ExternalMCPResilienceConfig {
	if cfg.MaxConcurrentPerServer == 0 {
		cfg.MaxConcurrentPerServer = 2
	}
	if cfg.MaxConcurrentTotal == 0 {
		cfg.MaxConcurrentTotal = 16
	}
	if cfg.CircuitFailureThreshold == 0 {
		cfg.CircuitFailureThreshold = 3
	}
	if cfg.CircuitCooldown <= 0 {
		cfg.CircuitCooldown = 60 * time.Second
	}
	if cfg.MaxConcurrentPerServer < 0 {
		cfg.MaxConcurrentPerServer = 0
	}
	if cfg.MaxConcurrentTotal < 0 {
		cfg.MaxConcurrentTotal = 0
	}
	return cfg
}

// LoadConfigs loads the configs
func (m *ExternalMCPManager) LoadConfigs(cfg *config.ExternalMCPConfig) {
	m.mu.Lock()
	defer m.mu.Unlock()

	if cfg == nil || cfg.Servers == nil {
		return
	}

	m.configs = make(map[string]config.ExternalMCPServerConfig)
	for name, serverCfg := range cfg.Servers {
		m.configs[name] = serverCfg
	}
}

// GetConfigs gets all configs
func (m *ExternalMCPManager) GetConfigs() map[string]config.ExternalMCPServerConfig {
	m.mu.RLock()
	defer m.mu.RUnlock()

	result := make(map[string]config.ExternalMCPServerConfig)
	for k, v := range m.configs {
		result[k] = v
	}
	return result
}

// AddOrUpdateConfig adds or updates a config
func (m *ExternalMCPManager) AddOrUpdateConfig(name string, serverCfg config.ExternalMCPServerConfig) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// If a client already exists, close it first
	if client, exists := m.clients[name]; exists {
		client.Close()
		delete(m.clients, name)
	}

	m.configs[name] = serverCfg

	// If enabled, connect automatically
	if m.isEnabled(serverCfg) {
		go m.connectClient(name, serverCfg)
	}

	return nil
}

// RemoveConfig removes a config
func (m *ExternalMCPManager) RemoveConfig(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	// Close the client
	if client, exists := m.clients[name]; exists {
		client.Close()
		delete(m.clients, name)
	}

	delete(m.configs, name)
	m.clearReconnectState(name)

	// Clean up the tool count cache
	m.toolCountsMu.Lock()
	delete(m.toolCounts, name)
	m.toolCountsMu.Unlock()

	// Clean up the tool list cache
	m.toolCacheMu.Lock()
	delete(m.toolCache, name)
	m.toolCacheMu.Unlock()

	return nil
}

// StartClient starts the client (user-initiated start; a failed connection is not retried automatically)
func (m *ExternalMCPManager) StartClient(name string) error {
	return m.startClient(name, false)
}

// startClient starts the client. When autoReconnect is true it is used for self-healing after a disconnect: it respects the disabled state and keeps retrying with backoff after failures.
func (m *ExternalMCPManager) startClient(name string, autoReconnect bool) error {
	m.mu.Lock()
	serverCfg, exists := m.configs[name]
	m.mu.Unlock()

	if !exists {
		return fmt.Errorf("Configuration not found: %s", name)
	}

	if autoReconnect && !m.isEnabled(serverCfg) {
		return nil
	}

	// Check whether there is already a connected client
	m.mu.RLock()
	existingClient, hasClient := m.clients[name]
	m.mu.RUnlock()

	if hasClient {
		// Check whether the client is connected
		if existingClient.IsConnected() {
			// The client is already connected; return success directly (the target state has been reached)
			if !autoReconnect {
				m.mu.Lock()
				serverCfg.ExternalMCPEnable = true
				serverCfg.Disabled = false
				m.configs[name] = serverCfg
				m.mu.Unlock()
			}
			return nil
		}
		// If there is a client but it is not connected, close it first
		existingClient.Close()
		m.mu.Lock()
		delete(m.clients, name)
		m.mu.Unlock()
	}

	if autoReconnect {
		m.mu.RLock()
		serverCfg, exists = m.configs[name]
		enabled := exists && m.isEnabled(serverCfg)
		m.mu.RUnlock()
		if !enabled {
			return nil
		}
	}

	// Update the config to enabled
	m.mu.Lock()
	serverCfg.ExternalMCPEnable = true
	serverCfg.Disabled = false
	m.configs[name] = serverCfg
	// Clear the previous error message (on restart)
	delete(m.errors, name)
	m.mu.Unlock()

	// Create the client immediately and set it to "connecting", so the frontend can see the status right away
	client := m.createClient(serverCfg)
	if client == nil {
		return fmt.Errorf("Unable to create client: unsupported transport mode")
	}

	// Set the status to connecting
	m.setClientStatus(client, "connecting")

	// Save the client immediately, so the frontend sees the "connecting" status when it queries
	m.mu.Lock()
	m.clients[name] = client
	m.mu.Unlock()

	// Perform the actual connection asynchronously in the background
	go func(reconnect bool) {
		if err := m.doConnect(name, serverCfg, client); err != nil {
			m.logger.Error("Failed to connect external MCP client",
				zap.String("name", name),
				zap.Bool("auto_reconnect", reconnect),
				zap.Error(err),
			)
			// Connection failed: set the status to error and save the error message
			m.setClientStatus(client, "error")
			m.mu.Lock()
			m.errors[name] = err.Error()
			m.mu.Unlock()
			// Trigger a tool count refresh (connection failed, so the tool count should be 0)
			m.triggerToolCountRefresh()
			if reconnect {
				m.scheduleReconnectAfterFailure(name)
			}
		} else {
			// Connection succeeded: clear the error message
			m.mu.Lock()
			delete(m.errors, name)
			m.mu.Unlock()
			m.onClientConnected(name)
			// Asynchronously fetch the tool list (singleflight de-duplication; the result is written to both toolCache and toolCounts)
			go m.refreshToolCache(name, client)
		}
	}(autoReconnect)

	return nil
}

// StopClient stops the client
func (m *ExternalMCPManager) StopClient(name string) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	serverCfg, exists := m.configs[name]
	if !exists {
		return fmt.Errorf("Configuration not found: %s", name)
	}

	// Close the client
	if client, exists := m.clients[name]; exists {
		client.Close()
		delete(m.clients, name)
	}

	// Clear the error message
	delete(m.errors, name)

	// Update the tool count cache (the tool count is 0 after stopping)
	m.toolCountsMu.Lock()
	m.toolCounts[name] = 0
	m.toolCountsMu.Unlock()

	m.toolCacheMu.Lock()
	delete(m.toolCache, name)
	m.toolCacheMu.Unlock()

	// Update the config to disabled
	serverCfg.ExternalMCPEnable = false
	serverCfg.Disabled = true
	m.configs[name] = serverCfg

	m.clearReconnectState(name)

	return nil
}

// GetClient gets the client
func (m *ExternalMCPManager) GetClient(name string) (ExternalMCPClient, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	client, exists := m.clients[name]
	return client, exists
}

// GetError gets the error message
func (m *ExternalMCPManager) GetError(name string) string {
	m.mu.RLock()
	defer m.mu.RUnlock()

	return m.errors[name]
}

// GetAllTools gets the tools of all external MCPs
// Prefer fetching from connected clients; if the connection is down, return the cached tool list
// Policy:
//   - error status: do not use the cache; skip directly (configuration error or service unavailable)
//   - disconnected/connecting status: use the cache (temporary disconnect)
//   - connected status: fetch normally; fall back to the cache on failure
func (m *ExternalMCPManager) GetAllTools(ctx context.Context) ([]Tool, error) {
	m.mu.RLock()
	clients := make(map[string]ExternalMCPClient)
	for k, v := range m.clients {
		clients[k] = v
	}
	m.mu.RUnlock()

	var allTools []Tool
	var hasError bool
	var lastError error

	// Use a shorter timeout for a quick check (3 seconds), to avoid blocking
	quickCtx, quickCancel := context.WithTimeout(ctx, 3*time.Second)
	defer quickCancel()

	for name, client := range clients {
		tools, err := m.getToolsForClient(name, client, quickCtx)
		if err != nil {
			// Log the error, but keep processing the other clients
			hasError = true
			if lastError == nil {
				lastError = err
			}
			continue
		}

		// Add a prefix to the tools to avoid conflicts
		for _, tool := range tools {
			tool.Name = fmt.Sprintf("%s::%s", name, tool.Name)
			allTools = append(allTools, tool)
		}
	}

	// If there are errors but at least some tools were returned, do not return an error (partial success)
	if hasError && len(allTools) == 0 {
		return nil, fmt.Errorf("Failed to get external MCP tools: %w", lastError)
	}

	return allTools, nil
}

// getToolsForClient gets the tool list of the given client
// Returns the tool list and an error (if it cannot be obtained at all)
func (m *ExternalMCPManager) getToolsForClient(name string, client ExternalMCPClient, ctx context.Context) ([]Tool, error) {
	status := client.GetStatus()

	// error status: do not use the cache; return the error directly
	if status == "error" {
		m.logger.Debug("Skipping external MCP whose connection failed (cache not used)",
			zap.String("name", name),
			zap.String("status", status),
		)
		return nil, fmt.Errorf("External MCP connection failed: %s", name)
	}

	// Connected: cache first; only send a remote ListTools when the cache is missing or expired
	if client.IsConnected() {
		if tools, ok := m.getFreshCachedTools(name); ok {
			return tools, nil
		}
		if tools, ok := m.getAnyCachedTools(name); ok {
			m.triggerToolListRefresh(name, client)
			return tools, nil
		}
		tools, err := m.listToolsDeduped(ctx, name, client)
		if err != nil {
			return m.getCachedTools(name, "Connection is healthy but fetching failed", err)
		}
		return tools, nil
	}

	// Not connected: decide whether to use the cache based on the status
	if status == "disconnected" || status == "connecting" {
		return m.getCachedTools(name, fmt.Sprintf("Client temporarily disconnected (status: %s)", status), nil)
	}

	// Other unknown status: do not use the cache
	m.logger.Debug("Skipping external MCP (unknown status)",
		zap.String("name", name),
		zap.String("status", status),
	)
	return nil, fmt.Errorf("External MCP status unknown: %s (status: %s)", name, status)
}

// getCachedTools gets the cached tool list (including cached empty lists)
func (m *ExternalMCPManager) getCachedTools(name, reason string, originalErr error) ([]Tool, error) {
	if tools, ok := m.getAnyCachedTools(name); ok {
		m.logger.Debug("Using cached tool list",
			zap.String("name", name),
			zap.String("reason", reason),
			zap.Int("count", len(tools)),
			zap.Error(originalErr),
		)
		return tools, nil
	}

	if originalErr != nil {
		return nil, fmt.Errorf("Failed to get external MCP tools and no cache available: %w", originalErr)
	}
	return nil, fmt.Errorf("External MCP has no cached tools: %s", name)
}

func (m *ExternalMCPManager) isToolCacheFresh(updatedAt time.Time) bool {
	return !updatedAt.IsZero() && time.Since(updatedAt) < externalToolListCacheTTL
}

func cloneTools(tools []Tool) []Tool {
	if len(tools) == 0 {
		return nil
	}
	out := make([]Tool, len(tools))
	copy(out, tools)
	return out
}

func (m *ExternalMCPManager) getFreshCachedTools(name string) ([]Tool, bool) {
	m.toolCacheMu.RLock()
	entry, ok := m.toolCache[name]
	m.toolCacheMu.RUnlock()
	if !ok || !m.isToolCacheFresh(entry.updatedAt) {
		return nil, false
	}
	return cloneTools(entry.tools), true
}

func (m *ExternalMCPManager) getAnyCachedTools(name string) ([]Tool, bool) {
	m.toolCacheMu.RLock()
	entry, ok := m.toolCache[name]
	m.toolCacheMu.RUnlock()
	if !ok {
		return nil, false
	}
	return cloneTools(entry.tools), true
}

// listToolsDeduped merges concurrent ListTools calls for the same MCP, and updates toolCache / toolCounts.
func (m *ExternalMCPManager) listToolsDeduped(ctx context.Context, name string, client ExternalMCPClient) ([]Tool, error) {
	m.listToolsMu.Lock()
	if inflight, exists := m.listToolsInflight[name]; exists {
		m.listToolsMu.Unlock()
		select {
		case <-inflight.done:
			if inflight.err != nil {
				return nil, inflight.err
			}
			return cloneTools(inflight.tools), nil
		case <-ctx.Done():
			return nil, ctx.Err()
		}
	}
	inflight := &listToolsInflight{done: make(chan struct{})}
	m.listToolsInflight[name] = inflight
	m.listToolsMu.Unlock()

	inflight.tools, inflight.err = client.ListTools(ctx)
	if inflight.err == nil {
		m.updateToolCache(name, inflight.tools)
	}

	m.listToolsMu.Lock()
	delete(m.listToolsInflight, name)
	close(inflight.done)
	m.listToolsMu.Unlock()

	if inflight.err != nil {
		m.handleConnectionDead(name, client, inflight.err)
		return nil, inflight.err
	}
	return cloneTools(inflight.tools), nil
}

// InvalidateToolCache clears the tool list cache for the given external MCP (used for manual refresh)
func (m *ExternalMCPManager) InvalidateToolCache(name string) {
	m.toolCacheMu.Lock()
	delete(m.toolCache, name)
	m.toolCacheMu.Unlock()
}

// InvalidateAllToolCaches clears all external MCP tool list caches
func (m *ExternalMCPManager) InvalidateAllToolCaches() {
	m.toolCacheMu.Lock()
	m.toolCache = make(map[string]toolListCacheEntry)
	m.toolCacheMu.Unlock()
}

func (m *ExternalMCPManager) triggerToolListRefresh(name string, client ExternalMCPClient) {
	go func() {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		_, _ = m.listToolsDeduped(ctx, name, client)
	}()
}

// updateToolCache updates the tool list cache and the tool count
func (m *ExternalMCPManager) updateToolCache(name string, tools []Tool) {
	stored := cloneTools(tools)
	m.toolCacheMu.Lock()
	m.toolCache[name] = toolListCacheEntry{tools: stored, updatedAt: time.Now()}
	m.toolCacheMu.Unlock()

	m.toolCountsMu.Lock()
	m.toolCounts[name] = len(stored)
	m.toolCountsMu.Unlock()

	if len(stored) == 0 {
		m.logger.Warn("External MCP returned an empty tool list",
			zap.String("name", name),
			zap.String("hint", "The service may be temporarily unavailable, the tool list is empty"),
		)
	} else {
		m.logger.Debug("Tool list cache updated",
			zap.String("name", name),
			zap.Int("count", len(stored)),
		)
	}
}

// CallTool calls an external MCP tool (returns the execution ID)
func (m *ExternalMCPManager) CallTool(ctx context.Context, toolName string, args map[string]interface{}) (*ToolResult, string, error) {
	if m.executionService == nil {
		m.executionService = NewExecutionService(m.storage, m.logger)
		m.executionService.ConfigureToolResultMaxBytes(m.toolResultMaxBytes)
		m.executionService.ConfigureToolResultSpillRoot(m.spillRootDir)
	}
	var ownerUserID string
	if principal, ok := authctx.PrincipalFromContext(ctx); ok {
		ownerUserID = principal.UserID
	}
	var mcpName, actualToolName string
	var client ExternalMCPClient
	var blockedByGuard bool
	handle, err := m.executionService.Submit(ctx, ExecutionRequest{
		ConfirmCancellation: func(confirmCtx context.Context) error {
			if confirmer, ok := client.(ExternalCancellationConfirmer); ok {
				return confirmer.ConfirmToolCancellation(confirmCtx, actualToolName, args)
			}
			return fmt.Errorf("external MCP client has no cancellation acknowledgement")
		},
		Remote:         true,
		ToolName:       toolName,
		Arguments:      args,
		ConversationID: MCPConversationIDFromContext(ctx),
		OwnerUserID:    ownerUserID,
		PreRun: func(runCtx context.Context, exec *ToolExecution) (func(), error) {
			_, authenticated := authctx.PrincipalFromContext(runCtx)
			m.mu.RLock()
			authorizer := m.toolAuthorizer
			m.mu.RUnlock()
			if authorizer != nil {
				if err := authorizer(runCtx, toolName, args); err != nil {
					return nil, fmt.Errorf("external tool authorization denied: %w", err)
				}
			} else if authenticated {
				return nil, fmt.Errorf("external tool authorization policy is not configured")
			}
			if blocked := m.checkToolGuard(toolName, args); blocked != nil {
				blockedByGuard = true
				return nil, &toolGuardBlockError{result: blocked}
			}

			// Parse the tool name: name::toolName
			if idx := findSubstring(toolName, "::"); idx > 0 {
				mcpName = toolName[:idx]
				actualToolName = toolName[idx+2:]
			} else {
				return nil, fmt.Errorf("Invalid tool name format: %s", toolName)
			}

			var exists bool
			client, exists = m.GetClient(mcpName)
			if !exists {
				return nil, fmt.Errorf("External MCP client not found: %s", mcpName)
			}
			if err := m.checkExternalMCPCircuit(mcpName); err != nil {
				return nil, err
			}

			// Check the connection status; if it is not connected or the status is error, the call is not allowed
			if !client.IsConnected() {
				status := client.GetStatus()
				if status == "error" {
					// Get the error message (if any)
					errorMsg := m.GetError(mcpName)
					if errorMsg != "" {
						return nil, fmt.Errorf("External MCP connection failed: %s (error: %s)", mcpName, errorMsg)
					}
					return nil, fmt.Errorf("External MCP connection failed: %s", mcpName)
				}
				return nil, fmt.Errorf("External MCP client is not connected: %s (status: %s)", mcpName, status)
			}

			release, acquireErr := m.acquireExternalMCPCallSlot(runCtx, mcpName)
			if acquireErr != nil {
				return nil, acquireErr
			}
			return release, nil
		},
		Run: func(runCtx context.Context) (*ToolResult, error) {
			// Rules may have changed while this execution waited for a slot.
			if blocked := m.checkToolGuard(toolName, args); blocked != nil {
				blockedByGuard = true
				return blocked, nil
			}
			result, callErr := client.CallTool(runCtx, actualToolName, args)
			if callErr != nil {
				m.handleConnectionDead(mcpName, client, callErr)
			}
			return result, callErr
		},
		OnDone: func(exec *ToolExecution) {
			failed := exec != nil && executionStatusCountsAsFailed(exec.Status)
			if mcpName != "" && !blockedByGuard && (exec == nil || exec.Status != ToolExecutionStatusBlocked) {
				m.recordExternalMCPResult(mcpName, failed)
			}
			if exec != nil {
				m.updateStats(toolName, exec.Status)
			}
		},
	})
	if err != nil {
		return nil, "", err
	}

	m.mu.RLock()
	waitTimeout := m.toolWaitTimeout
	m.mu.RUnlock()
	snapshot, waitErr := m.executionService.Wait(ctx, handle.ID, waitTimeout)
	if errors.Is(waitErr, ErrExecutionWaitTimeout) {
		return externalMCPWaitTimeoutResult(snapshot, waitTimeout), handle.ID, nil
	}
	if waitErr != nil {
		return nil, handle.ID, waitErr
	}
	if snapshot == nil || snapshot.Execution == nil {
		return &ToolResult{Content: []Content{{Type: "text", Text: "Tool execution completed but returned no execution snapshot"}}, IsError: true}, handle.ID, nil
	}
	if snapshot.Execution.Result != nil {
		return snapshot.Execution.Result, handle.ID, nil
	}
	if snapshot.Execution.Error != "" {
		return nil, handle.ID, errors.New(snapshot.Execution.Error)
	}
	return &ToolResult{Content: []Content{{Type: "text", Text: "Tool execution completed but returned no result"}}, IsError: false}, handle.ID, nil
}

func externalMCPWaitTimeoutResult(snapshot *ExecutionSnapshot, waitTimeout time.Duration) *ToolResult {
	execID := ""
	status := ToolExecutionStatusRunning
	toolName := ""
	elapsed := time.Duration(0)
	if snapshot != nil && snapshot.Execution != nil {
		execID = snapshot.Execution.ID
		status = snapshot.Execution.Status
		toolName = snapshot.Execution.ToolName
		elapsed = time.Since(snapshot.Execution.StartTime).Round(time.Second)
	}
	waitText := "unbounded"
	if waitTimeout > 0 {
		waitText = waitTimeout.Round(time.Second).String()
	}
	msg := fmt.Sprintf(`The tool was submitted to run in the background, but this wait reached its limit.

execution_id: %s
tool: %s
status: %s
wait_timeout: %s
elapsed: %s

You can keep reasoning, switch to other tools, or call wait_tool_execution to keep waiting on this execution_id; you can also call cancel_tool_execution to cancel it.`, execID, toolName, status, waitText, elapsed)
	return &ToolResult{Content: []Content{{Type: "text", Text: msg}}, IsError: true}
}

func (m *ExternalMCPManager) checkExternalMCPCircuit(mcpName string) error {
	if m == nil {
		return nil
	}
	name := strings.TrimSpace(mcpName)
	if name == "" {
		return nil
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.resilience.CircuitFailureThreshold < 0 {
		return nil
	}
	rt := m.externalMCPRuntimeLocked(name)
	if rt == nil || rt.circuitOpenUntil.IsZero() {
		return nil
	}
	now := time.Now()
	if now.Before(rt.circuitOpenUntil) {
		return fmt.Errorf("External MCP service %s is temporarily circuit-broken; retry in about %s", name, time.Until(rt.circuitOpenUntil).Round(time.Second))
	}
	rt.circuitOpenUntil = time.Time{}
	return nil
}

func (m *ExternalMCPManager) acquireExternalMCPCallSlot(ctx context.Context, mcpName string) (func(), error) {
	if m == nil {
		return func() {}, nil
	}
	name := strings.TrimSpace(mcpName)
	m.mu.Lock()
	rt := m.externalMCPRuntimeLocked(name)
	serverSem := chan struct{}(nil)
	if rt != nil {
		serverSem = rt.semaphore
	}
	globalSem := m.globalSemaphore
	m.mu.Unlock()

	releaseGlobal := false
	if globalSem != nil {
		select {
		case globalSem <- struct{}{}:
			releaseGlobal = true
		case <-ctxDone(ctx):
			return func() {}, contextErr(ctx)
		}
	}
	releaseServer := false
	if serverSem != nil {
		select {
		case serverSem <- struct{}{}:
			releaseServer = true
		case <-ctxDone(ctx):
			if releaseGlobal {
				<-globalSem
			}
			return func() {}, contextErr(ctx)
		}
	}
	return func() {
		if releaseServer {
			<-serverSem
		}
		if releaseGlobal {
			<-globalSem
		}
	}, nil
}

func contextErr(ctx context.Context) error {
	if ctx == nil || ctx.Err() == nil {
		return context.Canceled
	}
	return ctx.Err()
}

func (m *ExternalMCPManager) recordExternalMCPResult(mcpName string, failed bool) {
	if m == nil || strings.TrimSpace(mcpName) == "" {
		return
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	rt := m.externalMCPRuntimeLocked(mcpName)
	if rt == nil {
		return
	}
	if !failed {
		rt.consecutiveFailures = 0
		rt.circuitOpenUntil = time.Time{}
		return
	}
	if m.resilience.CircuitFailureThreshold < 0 {
		return
	}
	rt.consecutiveFailures++
	if rt.consecutiveFailures >= m.resilience.CircuitFailureThreshold {
		rt.circuitOpenUntil = time.Now().Add(m.resilience.CircuitCooldown)
		m.logger.Warn("External MCP service tripped the circuit breaker",
			zap.String("name", mcpName),
			zap.Int("consecutiveFailures", rt.consecutiveFailures),
			zap.Duration("cooldown", m.resilience.CircuitCooldown),
		)
	}
}

func (m *ExternalMCPManager) externalMCPRuntimeLocked(mcpName string) *externalMCPServerRuntime {
	if m.serverRuntimes == nil {
		m.serverRuntimes = make(map[string]*externalMCPServerRuntime)
	}
	name := strings.TrimSpace(mcpName)
	if name == "" {
		return nil
	}
	if rt := m.serverRuntimes[name]; rt != nil {
		return rt
	}
	var sem chan struct{}
	if m.resilience.MaxConcurrentPerServer > 0 {
		sem = make(chan struct{}, m.resilience.MaxConcurrentPerServer)
	}
	rt := &externalMCPServerRuntime{semaphore: sem}
	m.serverRuntimes[name] = rt
	return rt
}

func (m *ExternalMCPManager) applyAbortUserNoteToCancelledToolResult(executionID string, result **ToolResult, err *error) (cancelledWithUserNote bool) {
	note := strings.TrimSpace(m.readAbortUserNote(executionID))
	if note == "" {
		return false
	}
	hasErr := err != nil && *err != nil
	hasRes := result != nil && *result != nil
	if hasRes && (*result).Blocked {
		return false
	}
	if !hasErr && !hasRes {
		return false
	}
	_ = m.takeAbortUserNote(executionID)
	partial := ""
	if hasRes {
		partial = ToolResultPlainText(*result)
	}
	if partial == "" && hasErr {
		partial = (*err).Error()
	}
	merged := MergePartialToolOutputAndAbortNote(partial, note)
	*err = nil
	*result = &ToolResult{Content: []Content{{Type: "text", Text: merged}}, IsError: true}
	return true
}

func (m *ExternalMCPManager) readAbortUserNote(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.abortUserNotes == nil {
		return ""
	}
	return m.abortUserNotes[id]
}

func (m *ExternalMCPManager) takeAbortUserNote(id string) string {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.abortUserNotes == nil {
		return ""
	}
	n := m.abortUserNotes[id]
	delete(m.abortUserNotes, id)
	return n
}

// cleanupOldExecutions cleans up old execution records (keeps the number of in-memory records within the limit)
func (m *ExternalMCPManager) cleanupOldExecutions() {
	const maxExecutionsInMemory = 1000
	if len(m.executions) <= maxExecutionsInMemory {
		return
	}

	// Sort by start time and delete the oldest records
	type execTime struct {
		id        string
		startTime time.Time
	}
	var execs []execTime
	for id, exec := range m.executions {
		execs = append(execs, execTime{id: id, startTime: exec.StartTime})
	}

	// Sort by time
	for i := 0; i < len(execs)-1; i++ {
		for j := i + 1; j < len(execs); j++ {
			if execs[i].startTime.After(execs[j].startTime) {
				execs[i], execs[j] = execs[j], execs[i]
			}
		}
	}

	// Delete the oldest records
	toDelete := len(m.executions) - maxExecutionsInMemory
	for i := 0; i < toDelete && i < len(execs); i++ {
		delete(m.executions, execs[i].id)
	}
}

// GetExecution gets an execution record (looks in memory first, then in the database)
func (m *ExternalMCPManager) GetExecution(id string) (*ToolExecution, bool) {
	if m.executionService != nil {
		if snap, err := m.executionService.Get(id); err == nil && snap != nil && snap.Execution != nil {
			return snap.Execution, true
		}
	}
	m.mu.RLock()
	exec, exists := m.executions[id]
	m.mu.RUnlock()

	if exists {
		return exec, true
	}

	if m.storage != nil {
		exec, err := m.storage.GetToolExecution(id)
		if err == nil {
			return exec, true
		}
	}

	return nil, false
}

func (m *ExternalMCPManager) registerRunningCancel(id string, cancel context.CancelFunc) {
	m.mu.Lock()
	m.runningCancels[id] = cancel
	m.mu.Unlock()
}

func (m *ExternalMCPManager) unregisterRunningCancel(id string) {
	m.mu.Lock()
	delete(m.runningCancels, id)
	m.mu.Unlock()
}

// CancelToolExecutionWithNote cancels an external MCP tool; when note is non-empty it is merged with the output already returned and handed to the model.
func (m *ExternalMCPManager) CancelToolExecutionWithNote(id string, note string) bool {
	if m.executionService != nil && m.executionService.Cancel(id, note) {
		return true
	}
	m.mu.Lock()
	cancel, ok := m.runningCancels[id]
	if !ok || cancel == nil {
		m.mu.Unlock()
		return false
	}
	if strings.TrimSpace(note) != "" {
		if m.abortUserNotes == nil {
			m.abortUserNotes = make(map[string]string)
		}
		m.abortUserNotes[id] = strings.TrimSpace(note)
	}
	m.mu.Unlock()
	cancel()
	return true
}

// CancelToolExecution cancels an external MCP tool in progress (no user note).
func (m *ExternalMCPManager) CancelToolExecution(id string) bool {
	return m.CancelToolExecutionWithNote(id, "")
}

// ActiveRunningExecutionIDs returns a snapshot of the external MCP executionIds that are still registered with cancel in this process.
func (m *ExternalMCPManager) ActiveRunningExecutionIDs() map[string]struct{} {
	if m == nil {
		return nil
	}
	if m.executionService != nil {
		if ids := m.executionService.ActiveRunningExecutionIDs(); len(ids) > 0 {
			return ids
		}
	}
	m.mu.Lock()
	defer m.mu.Unlock()
	if len(m.runningCancels) == 0 {
		return nil
	}
	out := make(map[string]struct{}, len(m.runningCancels))
	for id := range m.runningCancels {
		out[id] = struct{}{}
	}
	return out
}

// updateStats updates the statistics
func (m *ExternalMCPManager) updateStats(toolName string, status string) {
	now := time.Now()
	if m.storage != nil {
		totalCalls := 1
		successCalls := 0
		failedCalls := 0
		if executionStatusCountsAsFailed(status) {
			failedCalls = 1
		} else if status == ToolExecutionStatusCompleted {
			successCalls = 1
		}
		if err := m.storage.UpdateToolStats(toolName, totalCalls, successCalls, failedCalls, &now); err != nil {
			m.logger.Warn("Failed to save statistics to the database", zap.Error(err))
		}
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if m.stats[toolName] == nil {
		m.stats[toolName] = &ToolStats{
			ToolName: toolName,
		}
	}

	stats := m.stats[toolName]
	stats.TotalCalls++
	stats.LastCallTime = &now

	if executionStatusCountsAsFailed(status) {
		stats.FailedCalls++
	} else if status == ToolExecutionStatusCompleted {
		stats.SuccessCalls++
	} else if status == ToolExecutionStatusBlocked {
		stats.BlockedCalls++
	}
}

// GetStats gets the MCP server statistics
func (m *ExternalMCPManager) GetStats() map[string]interface{} {
	m.mu.RLock()
	defer m.mu.RUnlock()

	total := len(m.configs)
	enabled := 0
	disabled := 0
	connected := 0

	for name, cfg := range m.configs {
		if m.isEnabled(cfg) {
			enabled++
			if client, exists := m.clients[name]; exists && client.IsConnected() {
				connected++
			}
		} else {
			disabled++
		}
	}

	return map[string]interface{}{
		"total":     total,
		"enabled":   enabled,
		"disabled":  disabled,
		"connected": connected,
	}
}

// GetToolStats gets the tool statistics (merges memory and database)
// Return only the statistics for external MCP tools (tool names containing "::")
func (m *ExternalMCPManager) GetToolStats() map[string]*ToolStats {
	result := make(map[string]*ToolStats)

	// Load the statistics from the database (if database storage is used)
	if m.storage != nil {
		dbStats, err := m.storage.LoadToolStats()
		if err == nil {
			// Keep only the statistics for external MCP tools (tool names containing "::")
			for k, v := range dbStats {
				if findSubstring(k, "::") > 0 {
					result[k] = v
				}
			}
		} else {
			m.logger.Warn("Failed to load statistics from the database", zap.Error(err))
		}
	}

	// Merge the in-memory statistics
	m.mu.RLock()
	for k, v := range m.stats {
		// If the database already has statistics for this tool, merge them
		if existing, exists := result[k]; exists {
			// Create a new statistics object, to avoid modifying the shared object
			merged := &ToolStats{
				ToolName:     k,
				TotalCalls:   existing.TotalCalls + v.TotalCalls,
				SuccessCalls: existing.SuccessCalls + v.SuccessCalls,
				FailedCalls:  existing.FailedCalls + v.FailedCalls,
			}
			// Use the latest call time
			if v.LastCallTime != nil && (existing.LastCallTime == nil || v.LastCallTime.After(*existing.LastCallTime)) {
				merged.LastCallTime = v.LastCallTime
			} else if existing.LastCallTime != nil {
				timeCopy := *existing.LastCallTime
				merged.LastCallTime = &timeCopy
			}
			result[k] = merged
		} else {
			// If the database has none, use the in-memory statistics directly
			statCopy := *v
			result[k] = &statCopy
		}
	}
	m.mu.RUnlock()

	return result
}

// GetToolCount gets the tool count for the given external MCP (read from the cache, non-blocking)
func (m *ExternalMCPManager) GetToolCount(name string) (int, error) {
	// Read from the cache first
	m.toolCountsMu.RLock()
	if count, exists := m.toolCounts[name]; exists {
		m.toolCountsMu.RUnlock()
		return count, nil
	}
	m.toolCountsMu.RUnlock()

	// If it is not in the cache, check the client status
	client, exists := m.GetClient(name)
	if !exists {
		return 0, fmt.Errorf("Client not found: %s", name)
	}

	if !client.IsConnected() {
		// Not connected; cached count is 0
		m.toolCountsMu.Lock()
		m.toolCounts[name] = 0
		m.toolCountsMu.Unlock()
		return 0, nil
	}

	// If connected but not in the cache, trigger an asynchronous refresh and return 0 (to avoid blocking)
	m.triggerToolCountRefresh()
	return 0, nil
}

// GetToolCounts gets the tool counts of all external MCPs (read from the cache, non-blocking)
func (m *ExternalMCPManager) GetToolCounts() map[string]int {
	m.toolCountsMu.RLock()
	defer m.toolCountsMu.RUnlock()

	// Return a copy of the cache, to avoid external modification
	result := make(map[string]int)
	for k, v := range m.toolCounts {
		result[k] = v
	}
	return result
}

// refreshToolCounts refreshes the tool count cache (runs asynchronously in the background)
// Use an atomic flag to prevent concurrent pile-up: if the previous refresh has not finished, this trigger is skipped directly.
func (m *ExternalMCPManager) refreshToolCounts() {
	if !m.refreshing.CompareAndSwap(false, true) {
		return // The previous refresh has not finished; skip
	}
	defer m.refreshing.Store(false)

	m.mu.RLock()
	clients := make(map[string]ExternalMCPClient)
	for k, v := range m.clients {
		clients[k] = v
	}
	m.mu.RUnlock()

	newCounts := make(map[string]int)

	// Use goroutines to fetch each client's tool count concurrently, to avoid serial blocking
	type countResult struct {
		name  string
		count int
	}
	resultChan := make(chan countResult, len(clients))

	for name, client := range clients {
		go func(n string, c ExternalMCPClient) {
			if !c.IsConnected() {
				resultChan <- countResult{name: n, count: 0}
				return
			}

			// If the cache is still fresh, reuse it directly, to avoid duplicating remote requests made by GetAllTools
			if _, fresh := m.getFreshCachedTools(n); fresh {
				m.toolCountsMu.RLock()
				count := m.toolCounts[n]
				m.toolCountsMu.RUnlock()
				resultChan <- countResult{name: n, count: count}
				return
			}

			ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
			tools, err := m.listToolsDeduped(ctx, n, c)
			cancel()

			if err != nil {
				if !isConnectionDeadError(err) {
					m.logger.Warn("Failed to get external MCP tool count, check the connection or the server's tools/list",
						zap.String("name", n),
						zap.Error(err),
					)
				}
				resultChan <- countResult{name: n, count: -1}
				return
			}

			resultChan <- countResult{name: n, count: len(tools)}
		}(name, client)
	}

	// Collect results
	m.toolCountsMu.RLock()
	oldCounts := make(map[string]int)
	for k, v := range m.toolCounts {
		oldCounts[k] = v
	}
	m.toolCountsMu.RUnlock()

	for i := 0; i < len(clients); i++ {
		result := <-resultChan
		if result.count >= 0 {
			newCounts[result.name] = result.count
		} else {
			// Fetch failed; keep the old value
			if oldCount, exists := oldCounts[result.name]; exists {
				newCounts[result.name] = oldCount
			} else {
				newCounts[result.name] = 0
			}
		}
	}

	// Update the cache
	m.toolCountsMu.Lock()
	// Update all the values fetched
	for name, count := range newCounts {
		m.toolCounts[name] = count
	}
	// For disconnected clients, set to 0
	for name, client := range clients {
		if !client.IsConnected() {
			m.toolCounts[name] = 0
		}
	}
	m.toolCountsMu.Unlock()
}

// refreshToolCache refreshes the tool list cache of the given MCP
func (m *ExternalMCPManager) refreshToolCache(name string, client ExternalMCPClient) {
	if !client.IsConnected() {
		return
	}
	if client.GetStatus() == "error" {
		m.logger.Debug("Skipping tool list cache refresh (connection failed)",
			zap.String("name", name),
		)
		return
	}

	ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
	defer cancel()
	if _, err := m.listToolsDeduped(ctx, name, client); err != nil {
		m.logger.Debug("Failed to refresh tool list cache",
			zap.String("name", name),
			zap.Error(err),
		)
	}
}

// startToolCountRefresh starts the goroutine that refreshes tool counts in the background
func (m *ExternalMCPManager) startToolCountRefresh() {
	m.refreshWg.Add(1)
	go func() {
		defer m.refreshWg.Done()
		ticker := time.NewTicker(externalToolCountRefreshInterval)
		defer ticker.Stop()

		// Run one refresh immediately
		m.refreshToolCounts()

		for {
			select {
			case <-ticker.C:
				m.refreshToolCounts()
			case <-m.stopRefresh:
				return
			}
		}
	}()
}

// triggerToolCountRefresh triggers an immediate refresh of tool counts (asynchronously)
func (m *ExternalMCPManager) triggerToolCountRefresh() {
	go m.refreshToolCounts()
}

// createClient creates a client (without connecting). It uniformly uses the official MCP Go SDK's lazy client; the connection is made at Initialize.
func (m *ExternalMCPManager) createClient(serverCfg config.ExternalMCPServerConfig) ExternalMCPClient {
	transport := serverCfg.GetTransportType()

	switch transport {
	case "http":
		if serverCfg.URL == "" {
			return nil
		}
		return newLazySDKClient(serverCfg, m.logger)
	case "stdio":
		if serverCfg.Command == "" {
			return nil
		}
		return newLazySDKClient(serverCfg, m.logger)
	case "sse":
		if serverCfg.URL == "" {
			return nil
		}
		return newLazySDKClient(serverCfg, m.logger)
	default:
		if transport == "" {
			return nil
		}
		// For unknown transport types, also try the lazy client
		return newLazySDKClient(serverCfg, m.logger)
	}
}

// doConnect performs the actual connection
func (m *ExternalMCPManager) doConnect(name string, serverCfg config.ExternalMCPServerConfig, client ExternalMCPClient) error {
	timeout := time.Duration(serverCfg.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	// Initialize the connection
	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if err := client.Initialize(ctx); err != nil {
		return err
	}

	m.logger.Info("External MCP client connected",
		zap.String("name", name),
	)

	return nil
}

// setClientStatus sets the client status (via type assertion)
func (m *ExternalMCPManager) setClientStatus(client ExternalMCPClient, status string) {
	if c, ok := client.(*lazySDKClient); ok {
		c.setStatus(status)
	}
}

// connectClient connects the client (asynchronously) - kept for backward compatibility
func (m *ExternalMCPManager) connectClient(name string, serverCfg config.ExternalMCPServerConfig) error {
	client := m.createClient(serverCfg)
	if client == nil {
		return fmt.Errorf("Unable to create client: unsupported transport mode")
	}

	// Set the status to connecting
	m.setClientStatus(client, "connecting")

	// Initialize the connection
	timeout := time.Duration(serverCfg.Timeout) * time.Second
	if timeout <= 0 {
		timeout = 30 * time.Second
	}

	ctx, cancel := context.WithTimeout(context.Background(), timeout)
	defer cancel()

	if err := client.Initialize(ctx); err != nil {
		m.logger.Error("Failed to initialize external MCP client",
			zap.String("name", name),
			zap.Error(err),
		)
		return err
	}

	// Save the client
	m.mu.Lock()
	m.clients[name] = client
	m.mu.Unlock()

	m.logger.Info("External MCP client connected",
		zap.String("name", name),
	)

	m.onClientConnected(name)

	// Connection succeeded: trigger a tool count refresh and a tool list cache refresh
	m.triggerToolCountRefresh()
	m.mu.RLock()
	if client, exists := m.clients[name]; exists {
		m.refreshToolCache(name, client)
	}
	m.mu.RUnlock()

	return nil
}

// isEnabled checks whether it is enabled
func (m *ExternalMCPManager) isEnabled(cfg config.ExternalMCPServerConfig) bool {
	return cfg.ExternalMCPEnable
}

// findSubstring finds a substring (simple implementation)
func findSubstring(s, substr string) int {
	for i := 0; i <= len(s)-len(substr); i++ {
		if s[i:i+len(substr)] == substr {
			return i
		}
	}
	return -1
}

// StartAllEnabled starts all enabled clients
func (m *ExternalMCPManager) StartAllEnabled() {
	m.mu.RLock()
	configs := make(map[string]config.ExternalMCPServerConfig)
	for k, v := range m.configs {
		configs[k] = v
	}
	m.mu.RUnlock()

	for name, cfg := range configs {
		if m.isEnabled(cfg) {
			go func(n string, c config.ExternalMCPServerConfig) {
				if err := m.connectClient(n, c); err != nil {
					// Check whether this is a connection-refused error (the service may not have started yet)
					errStr := strings.ToLower(err.Error())
					isConnectionRefused := strings.Contains(errStr, "connection refused") ||
						strings.Contains(errStr, "dial tcp") ||
						strings.Contains(errStr, "connect: connection refused")

					if isConnectionRefused {
						// Connection refused means the target service may not have started yet; this is normal
						// Use the Warn level to tell the user this is normal; they can start it manually or wait for the service to start and then connect automatically
						fields := []zap.Field{
							zap.String("name", n),
							zap.String("message", "The target service may not be running yet, which is normal. After it starts, connect manually from the UI, or wait for automatic retry"),
							zap.Error(err),
						}

						transport := c.GetTransportType()

						if transport == "http" && c.URL != "" {
							fields = append(fields, zap.String("url", c.URL))
						} else if transport == "stdio" && c.Command != "" {
							fields = append(fields, zap.String("command", c.Command))
						}

						m.logger.Warn("External MCP service not ready yet", fields...)
					} else {
						// Other errors: use the Error level
						m.logger.Error("Failed to start external MCP client",
							zap.String("name", n),
							zap.Error(err),
						)
					}
				}
			}(name, cfg)
		}
	}
}

// StopAll stops all clients
func (m *ExternalMCPManager) StopAll() {
	if m.executionService != nil {
		m.executionService.CancelAll("External MCP manager is stopping")
	}
	clients := make(map[string]ExternalMCPClient)
	m.mu.Lock()
	for name, client := range m.clients {
		clients[name] = client
		delete(m.clients, name)
	}
	m.mu.Unlock()

	for name, client := range clients {
		if client != nil {
			_ = client.Close()
		}
		m.clearReconnectState(name)
	}

	// Clean up all tool count caches
	m.toolCountsMu.Lock()
	m.toolCounts = make(map[string]int)
	m.toolCountsMu.Unlock()

	// Clean up all tool list caches
	m.toolCacheMu.Lock()
	m.toolCache = make(map[string]toolListCacheEntry)
	m.toolCacheMu.Unlock()

	// Stop the background refresh (uses select to avoid closing the channel twice)
	select {
	case <-m.stopRefresh:
		// Already closed; no need to close it again
	default:
		close(m.stopRefresh)
	}
	m.refreshWg.Wait()
}

// ExternalCancellationConfirmer is an optional adapter contract for MCP
// servers with server-side cancellation receipts or lease/task status APIs.
// Ordinary notifications/cancelled must never be treated as confirmation.
type ExternalCancellationConfirmer interface {
	ConfirmToolCancellation(context.Context, string, map[string]interface{}) error
}
