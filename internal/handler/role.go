package handler

import (
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"

	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"

	"gopkg.in/yaml.v3"

	"github.com/gin-gonic/gin"
	"go.uber.org/zap"
)

// RoleHandler role handler
type RoleHandler struct {
	config     *config.Config
	configPath string
	logger     *zap.Logger
	audit      *audit.Service
	db         *database.DB
}

func (h *RoleHandler) SetDB(db *database.DB) { h.db = db }

// SetAudit wires platform audit logging.
func (h *RoleHandler) SetAudit(s *audit.Service) {
	h.audit = s
}

// NewRoleHandler creates a new role handler
func NewRoleHandler(cfg *config.Config, configPath string, logger *zap.Logger) *RoleHandler {
	return &RoleHandler{
		config:     cfg,
		configPath: configPath,
		logger:     logger,
	}
}

// GetRoles gets all roles
func (h *RoleHandler) GetRoles(c *gin.Context) {
	if h.config.Roles == nil {
		h.config.Roles = make(map[string]config.RoleConfig)
	}

	roles := make([]config.RoleConfig, 0, len(h.config.Roles))
	for key, role := range h.config.Roles {
		// Make sure the role's key matches its name
		if role.Name == "" {
			role.Name = key
		}
		roles = append(roles, role)
	}

	c.JSON(http.StatusOK, gin.H{
		"roles": roles,
	})
}

// GetRole gets a single role
func (h *RoleHandler) GetRole(c *gin.Context) {
	roleName := c.Param("name")
	if roleName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role name is required"})
		return
	}

	if h.config.Roles == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Role not found"})
		return
	}

	role, exists := h.config.Roles[roleName]
	if !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Role not found"})
		return
	}

	// Make sure the role's name matches its key
	if role.Name == "" {
		role.Name = roleName
	}

	c.JSON(http.StatusOK, gin.H{
		"role": role,
	})
}

// UpdateRole updates a role
func (h *RoleHandler) UpdateRole(c *gin.Context) {
	roleName := c.Param("name")
	if roleName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role name is required"})
		return
	}

	var req config.RoleConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}

	// Make sure the role name matches the name in the request
	if req.Name == "" {
		req.Name = roleName
	}
	if err := h.validateRole(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}
	if req.Name != roleName {
		if _, exists := h.config.Roles[req.Name]; exists {
			c.JSON(http.StatusConflict, gin.H{"error": "Role already exists"})
			return
		}
	}

	// Initialize the Roles map
	if h.config.Roles == nil {
		h.config.Roles = make(map[string]config.RoleConfig)
	}

	// Delete all old roles whose name equals the role name but whose key differs (to avoid duplicates)
	// Use the role name as the key to ensure uniqueness
	finalKey := req.Name
	keysToDelete := make([]string, 0)
	for key := range h.config.Roles {
		// If the key differs from the final key but the name is the same, mark it for deletion
		if key != finalKey {
			role := h.config.Roles[key]
			// Make sure the role's name field is set correctly
			if role.Name == "" {
				role.Name = key
			}
			if role.Name == req.Name {
				keysToDelete = append(keysToDelete, key)
			}
		}
	}
	// Delete the old role
	for _, key := range keysToDelete {
		delete(h.config.Roles, key)
		h.logger.Info("Deleting duplicate role", zap.String("oldKey", key), zap.String("name", req.Name))
	}

	// If the key being updated differs from the final key, the old one must also be deleted
	if roleName != finalKey {
		delete(h.config.Roles, roleName)
	}

	// If the role name changed, the old file must be deleted
	if roleName != finalKey {
		configDir := filepath.Dir(h.configPath)
		rolesDir := h.config.RolesDir
		if rolesDir == "" {
			rolesDir = "roles" // Default directory
		}

		// If it is a relative path, resolve it relative to the directory containing the configuration file
		if !filepath.IsAbs(rolesDir) {
			rolesDir = filepath.Join(configDir, rolesDir)
		}

		// Delete the old role file
		oldSafeFileName := sanitizeFileName(roleName)
		oldRoleFileYaml := filepath.Join(rolesDir, oldSafeFileName+".yaml")
		oldRoleFileYml := filepath.Join(rolesDir, oldSafeFileName+".yml")

		if _, err := os.Stat(oldRoleFileYaml); err == nil {
			if err := os.Remove(oldRoleFileYaml); err != nil {
				h.logger.Warn("Failed to delete old role config file", zap.String("file", oldRoleFileYaml), zap.Error(err))
			}
		}
		if _, err := os.Stat(oldRoleFileYml); err == nil {
			if err := os.Remove(oldRoleFileYml); err != nil {
				h.logger.Warn("Failed to delete old role config file", zap.String("file", oldRoleFileYml), zap.Error(err))
			}
		}
	}

	// Save using the role name as the key (to ensure uniqueness)
	h.config.Roles[finalKey] = req

	// Save config to file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("Failed to save config", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
		return
	}

	h.logger.Info("Update role", zap.String("oldKey", roleName), zap.String("newKey", finalKey), zap.String("name", req.Name))
	if h.audit != nil {
		h.audit.RecordOK(c, "role", "update", "Update role", "role", finalKey, map[string]interface{}{"name": req.Name})
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Role updated",
		"role":    req,
	})
}

// CreateRole creates a new role
func (h *RoleHandler) CreateRole(c *gin.Context) {
	var req config.RoleConfig
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request parameters: " + err.Error()})
		return
	}

	if err := h.validateRole(req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	// Initialize the Roles map
	if h.config.Roles == nil {
		h.config.Roles = make(map[string]config.RoleConfig)
	}

	// Check whether the role already exists
	if _, exists := h.config.Roles[req.Name]; exists {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role already exists"})
		return
	}

	// Create the role (enabled by default)
	if !req.Enabled {
		req.Enabled = true
	}

	h.config.Roles[req.Name] = req

	// Save config to file
	if err := h.saveConfig(); err != nil {
		h.logger.Error("Failed to save config", zap.Error(err))
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to save config: " + err.Error()})
		return
	}

	h.logger.Info("Create role", zap.String("roleName", req.Name))
	if h.audit != nil {
		h.audit.RecordOK(c, "role", "create", "Create role", "role", req.Name, nil)
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Role created",
		"role":    req,
	})
}

// DeleteRole deletes a role
func (h *RoleHandler) DeleteRole(c *gin.Context) {
	roleName := c.Param("name")
	if roleName == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Role name is required"})
		return
	}

	if h.config.Roles == nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Role not found"})
		return
	}

	if _, exists := h.config.Roles[roleName]; !exists {
		c.JSON(http.StatusNotFound, gin.H{"error": "Role not found"})
		return
	}

	// Deleting the "default" role is not allowed
	if config.IsDefaultRole(roleName) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "The default role cannot be deleted"})
		return
	}

	delete(h.config.Roles, roleName)

	// Delete the corresponding role file
	configDir := filepath.Dir(h.configPath)
	rolesDir := h.config.RolesDir
	if rolesDir == "" {
		rolesDir = "roles" // Default directory
	}

	// If it is a relative path, resolve it relative to the directory containing the configuration file
	if !filepath.IsAbs(rolesDir) {
		rolesDir = filepath.Join(configDir, rolesDir)
	}

	// Try to delete the role file (.yaml and .yml)
	safeFileName := sanitizeFileName(roleName)
	roleFileYaml := filepath.Join(rolesDir, safeFileName+".yaml")
	roleFileYml := filepath.Join(rolesDir, safeFileName+".yml")

	// Delete the .yaml file (if it exists)
	if _, err := os.Stat(roleFileYaml); err == nil {
		if err := os.Remove(roleFileYaml); err != nil {
			h.logger.Warn("Failed to delete role config file", zap.String("file", roleFileYaml), zap.Error(err))
		} else {
			h.logger.Info("Deleted role config file", zap.String("file", roleFileYaml))
		}
	}

	// Delete the .yml file (if it exists)
	if _, err := os.Stat(roleFileYml); err == nil {
		if err := os.Remove(roleFileYml); err != nil {
			h.logger.Warn("Failed to delete role config file", zap.String("file", roleFileYml), zap.Error(err))
		} else {
			h.logger.Info("Deleted role config file", zap.String("file", roleFileYml))
		}
	}

	h.logger.Info("Delete role", zap.String("roleName", roleName))
	if h.audit != nil {
		h.audit.RecordOK(c, "role", "delete", "Delete role", "role", roleName, nil)
	}
	c.JSON(http.StatusOK, gin.H{
		"message": "Role deleted",
	})
}

// saveConfig saves the configuration to files in the directory
func (h *RoleHandler) saveConfig() error {
	configDir := filepath.Dir(h.configPath)
	rolesDir := h.config.RolesDir
	if rolesDir == "" {
		rolesDir = "roles" // Default directory
	}

	// If it is a relative path, resolve it relative to the directory containing the configuration file
	if !filepath.IsAbs(rolesDir) {
		rolesDir = filepath.Join(configDir, rolesDir)
	}

	// Ensure directory exists
	if err := os.MkdirAll(rolesDir, 0755); err != nil {
		return fmt.Errorf("Failed to create role directory: %w", err)
	}

	// Save each role to its own file
	if h.config.Roles != nil {
		for roleName, role := range h.config.Roles {
			// Make sure the role name is set correctly
			if role.Name == "" {
				role.Name = roleName
			}

			// Use the role name as the file name (sanitized, to avoid special characters)
			safeFileName := sanitizeFileName(role.Name)
			roleFile := filepath.Join(rolesDir, safeFileName+".yaml")

			// Serialize the role configuration to YAML
			roleData, err := yaml.Marshal(&role)
			if err != nil {
				h.logger.Error("Failed to serialize role config", zap.String("role", roleName), zap.Error(err))
				continue
			}

			// Handle the icon field: make sure icon values containing \U are wrapped in quotes (YAML needs quotes to parse Unicode escapes correctly)
			roleDataStr := string(roleData)
			if role.Icon != "" && strings.HasPrefix(role.Icon, "\\U") {
				// Match the icon: \UXXXXXXXX format (unquoted), excluding cases that already have quotes
				// Use a negative lookahead to ensure there is no quote after it, or match the unquoted case directly
				re := regexp.MustCompile(`(?m)^(icon:\s+)(\\U[0-9A-F]{8})(\s*)$`)
				roleDataStr = re.ReplaceAllString(roleDataStr, `${1}"${2}"${3}`)
				roleData = []byte(roleDataStr)
			}

			// Write to the file
			if err := os.WriteFile(roleFile, roleData, 0644); err != nil {
				h.logger.Error("Failed to save role config file", zap.String("role", roleName), zap.String("file", roleFile), zap.Error(err))
				continue
			}

			h.logger.Info("Role config saved to file", zap.String("role", roleName), zap.String("file", roleFile))
		}
	}

	return nil
}

// sanitizeFileName converts a role name into a safe file name
func sanitizeFileName(name string) string {
	// Replace characters that may be unsafe
	replacer := map[rune]string{
		'/':  "_",
		'\\': "_",
		':':  "_",
		'*':  "_",
		'?':  "_",
		'"':  "_",
		'<':  "_",
		'>':  "_",
		'|':  "_",
		' ':  "_",
	}

	var result []rune
	for _, r := range name {
		if replacement, ok := replacer[r]; ok {
			result = append(result, []rune(replacement)...)
		} else {
			result = append(result, r)
		}
	}

	fileName := string(result)
	// If the file name is empty, use the default name
	if fileName == "" {
		fileName = "role"
	}

	return fileName
}

// updateRolesConfig updates the role configuration
func updateRolesConfig(doc *yaml.Node, cfg config.RolesConfig) {
	root := doc.Content[0]
	rolesNode := ensureMap(root, "roles")

	// Clear the existing roles
	if rolesNode.Kind == yaml.MappingNode {
		rolesNode.Content = nil
	}

	// Add the new roles (use name as the key to ensure uniqueness)
	if cfg.Roles != nil {
		// First build a map keyed by name to deduplicate (keeps the last one)
		rolesByName := make(map[string]config.RoleConfig)
		for roleKey, role := range cfg.Roles {
			// Make sure the role's name field is set correctly
			if role.Name == "" {
				role.Name = roleKey
			}
			// Use name as the final key; if several keys map to the same name, only the last one is kept
			rolesByName[role.Name] = role
		}

		// Write the deduplicated roles to YAML
		for roleName, role := range rolesByName {
			roleNode := ensureMap(rolesNode, roleName)
			setStringInMap(roleNode, "name", role.Name)
			setStringInMap(roleNode, "description", role.Description)
			setStringInMap(roleNode, "user_prompt", role.UserPrompt)
			if role.Icon != "" {
				setStringInMap(roleNode, "icon", role.Icon)
			}
			setBoolInMap(roleNode, "enabled", role.Enabled)

			// Add the tool list (the tools field takes priority)
			if len(role.Tools) > 0 {
				toolsNode := ensureArray(roleNode, "tools")
				toolsNode.Content = nil
				for _, toolKey := range role.Tools {
					toolNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: toolKey}
					toolsNode.Content = append(toolsNode.Content, toolNode)
				}
			} else if len(role.MCPs) > 0 {
				// Backward compatibility: if there is no tools field but there is mcps, save mcps
				mcpsNode := ensureArray(roleNode, "mcps")
				mcpsNode.Content = nil
				for _, mcpName := range role.MCPs {
					mcpNode := &yaml.Node{Kind: yaml.ScalarNode, Tag: "!!str", Value: mcpName}
					mcpsNode.Content = append(mcpsNode.Content, mcpNode)
				}
			}
		}
	}
}

// ensureArray makes sure the array node for the given key exists in the array
func ensureArray(parent *yaml.Node, key string) *yaml.Node {
	_, valueNode := ensureKeyValue(parent, key)
	if valueNode.Kind != yaml.SequenceNode {
		valueNode.Kind = yaml.SequenceNode
		valueNode.Tag = "!!seq"
		valueNode.Content = nil
	}
	return valueNode
}
