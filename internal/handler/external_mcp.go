package handler

import (
	"fmt"
	"net/http"
	"os"
	"sync"

	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/mcp"
	"cyberstrike-ai/internal/security"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
	"gopkg.in/yaml.v3"
)

// ExternalMCPHandler external MCP handler
type ExternalMCPHandler struct {
	manager    *mcp.ExternalMCPManager
	config     *config.Config
	configPath string
	logger     *zap.Logger
	audit      *audit.Service
	mu         sync.RWMutex
}

// SetAudit wires platform audit logging.
func (h *ExternalMCPHandler) SetAudit(s *audit.Service) {
	h.audit = s
}

// NewExternalMCPHandler creates an external MCP handler
func NewExternalMCPHandler(manager *mcp.ExternalMCPManager, cfg *config.Config, configPath string, logger *zap.Logger) *ExternalMCPHandler {
	return &ExternalMCPHandler{
		manager:    manager,
		config:     cfg,
		configPath: configPath,
		logger:     logger,
	}
}

// GetExternalMCPs gets all external MCP configurations
func (h *ExternalMCPHandler) GetExternalMCPs(c *gin.Context) {
	h.mu.RLock()
	defer h.mu.RUnlock()

	configs := h.manager.GetConfigs()

	// Get the tool count of all external MCPs
	toolCounts := h.manager.GetToolCounts()

	// Convert to response format
	result := make(map[string]ExternalMCPResponse)
	for name, cfg := range configs {
		client, exists := h.manager.GetClient(name)
		status := "disconnected"
		if exists {
			status = client.GetStatus()
		} else if h.isEnabled(cfg) {
			status = "disconnected"
		} else {
			status = "disabled"
		}

		toolCount := toolCounts[name]
		errorMsg := externalMCPStatusError(h.manager, name, status)

		result[name] = ExternalMCPResponse{
			Config:    externalMCPConfigForResponse(c, cfg),
			Status:    status,
			ToolCount: toolCount,
			Error:     errorMsg,
		}
	}

	c.JSON(http.StatusOK, gin.H{
		"servers": result,
		"stats":   h.manager.GetStats(),
	})
}

// GetExternalMCP gets a single external MCP configuration
func (h *ExternalMCPHandler) GetExternalMCP(c *gin.Context) {
	name := c.Param("name")

	h.mu.RLock()
	defer h.mu.RUnlock()

	configs := h.manager.GetConfigs()
	cfg, exists := configs[name]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "External MCP configuration not found"})
		return
	}

	client, clientExists := h.manager.GetClient(name)
	status := "disconnected"
	if clientExists {
		status = client.GetStatus()
	} else if h.isEnabled(cfg) {
		status = "disconnected"
	} else {
		status = "disabled"
	}

	// Get tool count
	toolCount := 0
	if clientExists && client.IsConnected() {
		if count, err := h.manager.GetToolCount(name); err == nil {
			toolCount = count
		}
	}

	c.JSON(http.StatusOK, ExternalMCPResponse{
		Config:    externalMCPConfigForResponse(c, cfg),
		Status:    status,
		ToolCount: toolCount,
		Error:     externalMCPStatusError(h.manager, name, status),
	})
}

func externalMCPConfigForResponse(c *gin.Context, cfg config.ExternalMCPServerConfig) config.ExternalMCPServerConfig {
	if security.SessionHasPermission(c, "mcp:write") {
		return cfg
	}
	copyCfg := cfg
	if len(cfg.Env) > 0 {
		copyCfg.Env = make(map[string]string, len(cfg.Env))
		for key := range cfg.Env {
			copyCfg.Env[key] = "***"
		}
	}
	if len(cfg.Headers) > 0 {
		copyCfg.Headers = make(map[string]string, len(cfg.Headers))
		for key := range cfg.Headers {
			copyCfg.Headers[key] = "***"
		}
	}
	return copyCfg
}

// externalMCPStatusError returns the most recent error in the error/disconnected state (including the disconnect reason).
func externalMCPStatusError(manager *mcp.ExternalMCPManager, name, status string) string {
	if status != "error" && status != "disconnected" {
		return ""
	}
	return manager.GetError(name)
}

// AddOrUpdateExternalMCP adds or updates an external MCP configuration
func (h *ExternalMCPHandler) AddOrUpdateExternalMCP(c *gin.Context) {
	var req AddOrUpdateExternalMCPRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}

	name := c.Param("name")
	if name == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Validate config
	if err := h.validateConfig(req.Config); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	h.mu.Lock()
	defer h.mu.Unlock()

	// Update the in-memory config
	if h.config.ExternalMCP.Servers == nil {
		h.config.ExternalMCP.Servers = make(map[string]config.ExternalMCPServerConfig)
	}

	cfg := req.Config

	// Editing metadata does not change activation unless the request says so.
	previous, exists := h.manager.GetConfigs()[name]
	cfg.ExternalMCPEnable = req.activation(previous.ExternalMCPEnable, exists)
	cfg.Disabled = !cfg.ExternalMCPEnable

	// Expand ${VAR} environment variables
	config.ExpandConfigEnv(&cfg)

	// Add or update the config
	if err := h.manager.AddOrUpdateConfig(name, cfg); err != nil {
		h.logger.Error("Failed to add or update external MCP configuration", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add or update configuration: " + err.Error()})
		return
	}

	h.config.ExternalMCP.Servers[name] = cfg

	// Save to the config file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("Failed to save config", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
		return
	}

	h.logger.Info("External MCP configuration updated", zap.String("name", name))
	if h.audit != nil {
		h.audit.Record(c, audit.Entry{
			Category:     "external_mcp",
			Action:       "upsert",
			Result:       "success",
			ResourceType: "external_mcp",
			ResourceID:   name,
			Message:      "Update external MCP configuration",
		})
	}
	c.JSON(http.StatusOK, gin.H{"message": "Configuration updated"})
}

// DeleteExternalMCP deletes an external MCP configuration
func (h *ExternalMCPHandler) DeleteExternalMCP(c *gin.Context) {
	name := c.Param("name")

	h.mu.Lock()
	defer h.mu.Unlock()

	// Remove the config
	if err := h.manager.RemoveConfig(name); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Configuration not found"})
		return
	}

	// Delete from the in-memory config
	if h.config.ExternalMCP.Servers != nil {
		delete(h.config.ExternalMCP.Servers, name)
	}

	// Save to the config file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("Failed to save config", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
		return
	}

	h.logger.Info("External MCP configuration deleted", zap.String("name", name))
	if h.audit != nil {
		h.audit.Record(c, audit.Entry{
			Category:     "external_mcp",
			Action:       "delete",
			Result:       "success",
			ResourceType: "external_mcp",
			ResourceID:   name,
			Message:      "Delete external MCP configuration",
		})
	}
	c.JSON(http.StatusOK, gin.H{"message": "Configuration deleted"})
}

// StartExternalMCP starts an external MCP
func (h *ExternalMCPHandler) StartExternalMCP(c *gin.Context) {
	name := c.Param("name")

	h.mu.Lock()
	defer h.mu.Unlock()

	// Update the config to enabled
	if h.config.ExternalMCP.Servers == nil {
		h.config.ExternalMCP.Servers = make(map[string]config.ExternalMCPServerConfig)
	}
	cfg := h.config.ExternalMCP.Servers[name]
	cfg.ExternalMCPEnable = true
	cfg.Disabled = false
	h.config.ExternalMCP.Servers[name] = cfg

	// Save to the config file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("Failed to save config", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
		return
	}

	// Start the client (creates the client immediately and sets its status to connecting; the actual connection happens in the background)
	h.logger.Info("Starting external MCP", zap.String("name", name))
	if err := h.manager.StartClient(name); err != nil {
		h.logger.Error("Failed to start external MCP", zap.String("name", name), zap.Error(err))
		c.JSON(http.StatusBadRequest, gin.H{
			"error":  err.Error(),
			"status": "error",
		})
		return
	}

	// Get client status (should be connecting)
	client, exists := h.manager.GetClient(name)
	status := "connecting"
	if exists {
		status = client.GetStatus()
	}

	// Return immediately, without waiting for the connection to complete
	// The client connects asynchronously in the background; users can check the connection status via the status query endpoint
	c.JSON(http.StatusOK, gin.H{
		"message": "External MCP start request submitted, connecting in the background",
		"status":  status,
	})
}

// StopExternalMCP stops an external MCP
func (h *ExternalMCPHandler) StopExternalMCP(c *gin.Context) {
	name := c.Param("name")

	h.mu.Lock()
	defer h.mu.Unlock()

	// Stop the client
	if err := h.manager.StopClient(name); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Update config
	if h.config.ExternalMCP.Servers == nil {
		h.config.ExternalMCP.Servers = make(map[string]config.ExternalMCPServerConfig)
	}
	cfg := h.config.ExternalMCP.Servers[name]
	cfg.ExternalMCPEnable = false
	cfg.Disabled = true
	h.config.ExternalMCP.Servers[name] = cfg

	// Save to the config file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("Failed to save config", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
		return
	}

	h.logger.Info("External MCP stopped", zap.String("name", name))
	c.JSON(http.StatusOK, gin.H{"message": "External MCP stopped"})
}

// GetExternalMCPStats gets statistics
func (h *ExternalMCPHandler) GetExternalMCPStats(c *gin.Context) {
	stats := h.manager.GetStats()
	c.JSON(http.StatusOK, stats)
}

// validateConfig validates the config (supports both the official type field and the legacy transport field)
func (h *ExternalMCPHandler) validateConfig(cfg config.ExternalMCPServerConfig) error {
	transport := cfg.GetTransportType()
	if transport == "" {
		return fmt.Errorf("Either command (stdio mode) or url + type (http/sse mode) is required")
	}

	switch transport {
	case "http":
		if cfg.URL == "" {
			return fmt.Errorf("url is required in HTTP mode")
		}
	case "stdio":
		if cfg.Command == "" {
			return fmt.Errorf("command is required in stdio mode")
		}
	case "sse":
		if cfg.URL == "" {
			return fmt.Errorf("url is required in SSE mode")
		}
	default:
		return fmt.Errorf("Unsupported transport mode: %s, supported modes: http, stdio, sse", transport)
	}

	return nil
}

// isEnabled checks whether it is enabled
func (h *ExternalMCPHandler) isEnabled(cfg config.ExternalMCPServerConfig) bool {
	return cfg.ExternalMCPEnable
}

// saveConfig saves config to file
func (h *ExternalMCPHandler) saveConfig() error {
	configFileMu.Lock()
	defer configFileMu.Unlock()
	data, err := os.ReadFile(h.configPath)
	if err != nil {
		return fmt.Errorf("Failed to read configuration file: %w", err)
	}

	if err := os.WriteFile(h.configPath+".backup", data, 0644); err != nil {
		h.logger.Warn("Failed to create configuration backup", zap.Error(err))
	}

	root, err := loadYAMLDocument(h.configPath)
	if err != nil {
		return fmt.Errorf("Failed to parse configuration file: %w", err)
	}

	updateExternalMCPConfig(root, h.config.ExternalMCP)

	if err := writeYAMLDocument(h.configPath, root); err != nil {
		return fmt.Errorf("Failed to save configuration file: %w", err)
	}

	h.logger.Info("Configuration saved", zap.String("path", h.configPath))
	return nil
}

// updateExternalMCPConfig updates the external MCP config
func updateExternalMCPConfig(doc *yaml.Node, cfg config.ExternalMCPConfig) {
	root := doc.Content[0]
	externalMCPNode := ensureMap(root, "external_mcp")
	serversNode := ensureMap(externalMCPNode, "servers")

	// Clear the existing server config
	serversNode.Content = nil

	// Add the new server config
	for name, serverCfg := range cfg.Servers {
		nameNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: name}
		serverNode := &yaml.Node{Kind: yaml.MappingNode, Tag: "!!map"}
		serversNode.Content = append(serversNode.Content, nameNode, serverNode)

		// type (official MCP transport type)
		effectiveType := serverCfg.GetTransportType()
		if effectiveType != "" && effectiveType != "stdio" {
			// stdio can be omitted (inferred automatically when command is present)
			setStringInMap(serverNode, "type", effectiveType)
		}
		if serverCfg.Command != "" {
			setStringInMap(serverNode, "command", serverCfg.Command)
		}
		if len(serverCfg.Args) > 0 {
			setStringArrayInMap(serverNode, "args", serverCfg.Args)
		}
		if serverCfg.Env != nil && len(serverCfg.Env) > 0 {
			envNode := ensureMap(serverNode, "env")
			for envKey, envValue := range serverCfg.Env {
				setStringInMap(envNode, envKey, envValue)
			}
		}
		if serverCfg.URL != "" {
			setStringInMap(serverNode, "url", serverCfg.URL)
		}
		if serverCfg.Headers != nil && len(serverCfg.Headers) > 0 {
			headersNode := ensureMap(serverNode, "headers")
			for k, v := range serverCfg.Headers {
				setStringInMap(headersNode, k, v)
			}
		}
		if serverCfg.Description != "" {
			setStringInMap(serverNode, "description", serverCfg.Description)
		}
		if serverCfg.Timeout > 0 {
			setIntInMap(serverNode, "timeout", serverCfg.Timeout)
		}
		// Official standard fields
		if serverCfg.Disabled {
			setBoolInMap(serverNode, "disabled", true)
		}
		if len(serverCfg.AutoApprove) > 0 {
			setStringArrayInMap(serverNode, "autoApprove", serverCfg.AutoApprove)
		}

		// SDK advanced configuration
		if serverCfg.MaxRetries > 0 {
			setIntInMap(serverNode, "max_retries", serverCfg.MaxRetries)
		}
		if serverCfg.TerminateDuration > 0 {
			setIntInMap(serverNode, "terminate_duration", serverCfg.TerminateDuration)
		}
		if serverCfg.KeepAlive > 0 {
			setIntInMap(serverNode, "keep_alive", serverCfg.KeepAlive)
		}

		setBoolInMap(serverNode, "external_mcp_enable", serverCfg.ExternalMCPEnable)
		if serverCfg.ToolEnabled != nil && len(serverCfg.ToolEnabled) > 0 {
			toolEnabledNode := ensureMap(serverNode, "tool_enabled")
			for toolName, enabled := range serverCfg.ToolEnabled {
				setBoolInMap(toolEnabledNode, toolName, enabled)
			}
		}
	}
}

// setStringArrayInMap sets a string array
func setStringArrayInMap(mapNode *yaml.Node, key string, values []string) {
	_, valueNode := ensureKeyValue(mapNode, key)
	valueNode.Kind = yaml.SequenceNode
	valueNode.Tag = "!!seq"
	valueNode.Content = nil
	for _, v := range values {
		itemNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: v}
		valueNode.Content = append(valueNode.Content, itemNode)
	}
}

// AddOrUpdateExternalMCPRequest add or update external MCP request
type AddOrUpdateExternalMCPRequest struct {
	Config   config.ExternalMCPServerConfig `json:"config"`
	enable   *bool
	disabled *bool
}

// ExternalMCPResponse external MCP response
type ExternalMCPResponse struct {
	Config    config.ExternalMCPServerConfig `json:"config"`
	Status    string                         `json:"status"`          // "connected", "disconnected", "disabled", "error", "connecting"
	ToolCount int                            `json:"tool_count"`      // Tool count
	Error     string                         `json:"error,omitempty"` // Error message (present only when status is error)
}
