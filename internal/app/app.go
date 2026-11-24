package app

import (
	"context"
	"crypto/subtle"
	"crypto/tls"
	"database/sql"
	"fmt"
	"net"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"cyberstrike-ai/internal/agent"
	"cyberstrike-ai/internal/agentruntime"
	"cyberstrike-ai/internal/apimsg"
	"cyberstrike-ai/internal/audit"
	"cyberstrike-ai/internal/authctx"
	"cyberstrike-ai/internal/c2"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/database"
	"cyberstrike-ai/internal/handler"
	"cyberstrike-ai/internal/hitl"
	"cyberstrike-ai/internal/knowledge"
	"cyberstrike-ai/internal/logger"
	"cyberstrike-ai/internal/mcp"
	"cyberstrike-ai/internal/mcp/builtin"
	"cyberstrike-ai/internal/monitor"

	"cyberstrike-ai/internal/robot"
	"cyberstrike-ai/internal/security"
	"cyberstrike-ai/internal/skillpackage"
	"cyberstrike-ai/internal/storage"
	"cyberstrike-ai/internal/toolguard"

	"github.com/gin-gonic/gin"
	"github.com/google/uuid"
	"go.uber.org/zap"
	"golang.org/x/net/http2"
)

// App application
type App struct {
	shutdownOnce       sync.Once
	config             *config.Config
	configDir          string
	logger             *logger.Logger
	router             *gin.Engine
	mcpServer          *mcp.Server
	externalMCPMgr     *mcp.ExternalMCPManager
	agent              *agent.Agent
	executor           *security.Executor
	db                 *database.DB
	knowledgeDB        *database.DB // Knowledge base database connection (if using a separate database)
	auth               *security.AuthManager
	knowledgeManager   *knowledge.Manager        // Knowledge base manager (for dynamic initialization)
	knowledgeRetriever *knowledge.Retriever      // Knowledge base retriever (for dynamic initialization)
	knowledgeIndexer   *knowledge.Indexer        // Knowledge base indexer (for dynamic initialization)
	knowledgeHandler   *handler.KnowledgeHandler // Knowledge base handler (for dynamic initialization)
	agentHandler       *handler.AgentHandler     // Agent handler (for updating the knowledge base manager)
	robotHandler       *handler.RobotHandler     // Bot handler (DingTalk / Lark / WeCom, etc.)
	robotMu            sync.Mutex                // Cancel function that keeps the bot long connections alive
	dingCancel         context.CancelFunc        // DingTalk Stream cancel function, used to restart on config change
	larkCancel         context.CancelFunc        // Lark long-connection cancel function, used to restart on config change
	wechatCancel       context.CancelFunc        // WeChat iLink long-polling cancel function
	telegramCancel     context.CancelFunc        // Telegram long-polling cancel function
	slackCancel        context.CancelFunc        // Slack Socket Mode cancel function
	discordCancel      context.CancelFunc        // Discord Gateway cancel function
	qqCancel           context.CancelFunc        // QQ WebSocket cancel function
	alertCancel        context.CancelFunc        // Vulnerability reminder persistent delivery worker
	c2Manager          *c2.Manager               // C2 manager (nil when C2 is not enabled)
	c2Watchdog         *c2.SessionWatchdog       // C2 session watchdog
	c2WatchdogCancel   context.CancelFunc        // Watchdog cancel function
	c2Handler          *handler.C2Handler        // C2 REST (lifecycle synced with the Manager)
	storageHandler     *handler.StorageHandler   // Runspace occupancy statistics and garbage cleanup
	auditSvc           *audit.Service
}

// New creates a new application
func New(cfg *config.Config, log *logger.Logger, configPath, updateActivation string) (*App, error) {
	if err := cfg.AgentRuntime.Validate(); err != nil {
		return nil, err
	}
	prepareCtx, cancelPrepare := context.WithTimeout(context.Background(), 5*time.Minute)
	prepareErr := agentruntime.EnsurePiRuntime(prepareCtx, cfg.AgentRuntime.NodePath, cfg.AgentRuntime.WorkerPath)
	cancelPrepare()
	if prepareErr != nil {
		return nil, prepareErr
	}
	toolGuard, err := toolguard.NewManager(cfg.EffectiveToolGuard())
	if err != nil {
		return nil, fmt.Errorf("Failed to initialize call interception rules: %w", err)
	}

	gin.SetMode(gin.ReleaseMode)
	router := gin.Default()

	// CORS middleware
	router.Use(corsMiddleware(cfg.Server.CORSAllowedOrigins))
	// Translates the error / message text in JSON error responses according to the request language.
	router.Use(apimsg.Middleware())

	// Initialize database
	dbPath := cfg.Database.Path
	if dbPath == "" {
		dbPath = "data/conversations.db"
	}

	// Ensure directory exists
	if err := os.MkdirAll(filepath.Dir(dbPath), 0755); err != nil {
		return nil, fmt.Errorf("Failed to create database directory: %w", err)
	}

	db, err := database.NewDB(dbPath, log.Logger)
	if err != nil {
		return nil, fmt.Errorf("Failed to initialize database: %w", err)
	}

	// Auth manager (RBAC is mounted after database initialization)
	authManager := security.NewAuthManager(cfg.Auth.SessionDurationHours)
	if generatedPassword, err := authManager.AttachRBACStore(db); err != nil {
		return nil, fmt.Errorf("Failed to initialize RBAC: %w", err)
	} else if generatedPassword != "" {
		config.PrintBootstrapAdminPassword(generatedPassword)
	}
	for platform, userID := range cfg.Robots.ServiceAccountUserIDs() {
		user, userErr := db.GetRBACUserByID(userID)
		if userErr != nil || !user.Enabled {
			return nil, fmt.Errorf("robots.%s.auth.service_user_id must point to an enabled RBAC user", platform)
		}
	}

	auditSvc := audit.NewService(db, cfg, log.Logger)
	audit.RegisterConversationCreateHook(auditSvc)
	auditSvc.PurgeExpired()
	audit.StartRetentionLoop(auditSvc, log.Logger)
	if err := db.PurgeWorkflowPackageLifecycle(time.Now().UTC()); err != nil {
		log.Logger.Warn("Failed to clean up expired workflow package records", zap.Error(err))
	}
	go func() {
		ticker := time.NewTicker(time.Hour)
		defer ticker.Stop()
		for range ticker.C {
			if err := db.PurgeWorkflowPackageLifecycle(time.Now().UTC()); err != nil {
				log.Logger.Warn("Failed to clean up expired workflow package records", zap.Error(err))
			}
		}
	}()

	monitorRetention := monitor.NewService(db, cfg, log.Logger)
	monitorRetention.PurgeExpired()
	monitor.StartRetentionLoop(monitorRetention, log.Logger)

	if err := handler.NewHITLManager(db, log.Logger).EnsureSchema(); err != nil {
		log.Logger.Warn("Failed to initialize HITL table", zap.Error(err))
	}
	hitlRetention := hitl.NewService(db, cfg, log.Logger)
	hitlRetention.PurgeExpired()
	hitl.StartRetentionLoop(hitlRetention, log.Logger)

	// Create MCP server (with database persistence)
	mcpServer := mcp.NewServerWithStorage(log.Logger, db)
	mcpServer.SetToolAuthorizer(mcpToolAuthorizer(db))
	mcpServer.SetToolGuard(toolGuard)
	mcpServer.ConfigureHTTPToolCallTimeoutFromAgentMinutes(cfg.Agent.ToolTimeoutMinutes)
	mcpServer.ConfigureToolWaitTimeoutSeconds(cfg.Agent.ToolWaitTimeoutSeconds)
	mcpServer.ConfigureToolResultMaxBytes(cfg.MultiAgent.Runtime.ReductionMaxLengthForTruncEffective())
	mcpServer.ConfigureToolResultSpillRoot(cfg.MultiAgent.Runtime.ReductionRootDir)

	// Create security tool executor
	executor := security.NewExecutor(&cfg.Security, mcpServer, log.Logger)
	executor.SetShellNoOutputTimeoutSeconds(cfg.Agent.ShellNoOutputTimeoutSeconds)
	executor.SetToolOutputMaxBytes(cfg.MultiAgent.Runtime.ReductionMaxLengthForTruncEffective())
	executor.SetToolOutputSpillRoot(cfg.MultiAgent.Runtime.ReductionRootDir)

	// Register tools
	executor.RegisterTools(mcpServer)

	// Register vulnerability record tool
	registerVulnerabilityTools(mcpServer, db, log.Logger)
	registerAssetTools(mcpServer, db, log.Logger)
	registerProjectFactTools(mcpServer, db, cfg, log.Logger)
	registerVisionTools(mcpServer, cfg, log.Logger)

	// Create external MCP manager (using the same storage as the internal MCP server)
	externalMCPMgr := mcp.NewExternalMCPManagerWithStorage(log.Logger, db)
	externalMCPMgr.SetToolAuthorizer(externalMCPToolAuthorizer())
	externalMCPMgr.SetToolGuard(toolGuard)
	externalMCPMgr.ConfigureToolWaitTimeoutSeconds(cfg.Agent.ToolWaitTimeoutSeconds)
	externalMCPMgr.ConfigureToolResultMaxBytes(cfg.MultiAgent.Runtime.ReductionMaxLengthForTruncEffective())
	externalMCPMgr.ConfigureToolResultSpillRoot(cfg.MultiAgent.Runtime.ReductionRootDir)
	externalMCPMgr.ConfigureResilience(mcp.ExternalMCPResilienceConfig{
		MaxConcurrentPerServer:  cfg.Agent.ExternalMCPMaxConcurrentPerServer,
		MaxConcurrentTotal:      cfg.Agent.ExternalMCPMaxConcurrentTotal,
		CircuitFailureThreshold: cfg.Agent.ExternalMCPCircuitFailureThreshold,
		CircuitCooldown:         time.Duration(cfg.Agent.ExternalMCPCircuitCooldownSeconds) * time.Second,
	})
	mcp.RegisterExecutionControlTools(mcpServer, externalMCPMgr)
	if cfg.ExternalMCP.Servers != nil {
		externalMCPMgr.LoadConfigs(&cfg.ExternalMCP)
		// Start all enabled external MCP clients
		externalMCPMgr.StartAllEnabled()
	}

	execReconciler := monitor.NewExecutionReconciler(db, mcpServer, externalMCPMgr, log.Logger)
	execReconciler.ReconcileOnStartup()
	monitor.StartStaleRunningReconcileLoop(execReconciler, log.Logger)

	// Create Agent
	maxIterations := cfg.Agent.MaxIterations
	if maxIterations <= 0 {
		maxIterations = 30 // Default values
	}
	agent := agent.NewAgent(&cfg.OpenAI, &cfg.Agent, mcpServer, externalMCPMgr, log.Logger, maxIterations)
	agent.UpdateToolDescriptionMode(cfg.Security.ToolDescriptionMode)

	// Initialize knowledge base module (if enabled)
	var knowledgeManager *knowledge.Manager
	var knowledgeRetriever *knowledge.Retriever
	var knowledgeIndexer *knowledge.Indexer
	var knowledgeHandler *handler.KnowledgeHandler

	var knowledgeDBConn *database.DB
	log.Logger.Debug("Checking knowledge base configuration", zap.Bool("enabled", cfg.Knowledge.Enabled))
	if cfg.Knowledge.Enabled {
		// Determine knowledge base database path
		knowledgeDBPath := cfg.Database.KnowledgeDBPath
		var knowledgeDB *sql.DB

		if knowledgeDBPath != "" {
			// Use a separate knowledge base database
			// Ensure directory exists
			if err := os.MkdirAll(filepath.Dir(knowledgeDBPath), 0755); err != nil {
				return nil, fmt.Errorf("Failed to create knowledge base database directory: %w", err)
			}

			var err error
			knowledgeDBConn, err = database.NewKnowledgeDB(knowledgeDBPath, log.Logger)
			if err != nil {
				return nil, fmt.Errorf("Failed to initialize knowledge base database: %w", err)
			}
			knowledgeDB = knowledgeDBConn.DB
			log.Logger.Info("Using a separate knowledge base database", zap.String("path", knowledgeDBPath))
		} else {
			// Backward compatibility: use the session database
			knowledgeDB = db.DB
			log.Logger.Info("Using the session database to store knowledge base data (configure knowledge_db_path to separate the data)")
		}

		// Create knowledge base manager
		knowledgeManager = knowledge.NewManager(knowledgeDB, cfg.Knowledge.BasePath, log.Logger)

		// Create embedder
		// Use the OpenAI config API Key (if not specified in the knowledge base config)
		if cfg.Knowledge.Embedding.APIKey == "" {
			cfg.Knowledge.Embedding.APIKey = cfg.OpenAI.APIKey
		}
		if cfg.Knowledge.Embedding.BaseURL == "" {
			cfg.Knowledge.Embedding.BaseURL = cfg.OpenAI.BaseURL
		}

		embedder, err := knowledge.NewEmbedder(context.Background(), &cfg.Knowledge, &cfg.OpenAI, log.Logger)
		if err != nil {
			return nil, fmt.Errorf("Failed to initialize knowledge base embedder: %w", err)
		}

		// Create retriever (Agent MultiQuery + rerank pipeline)
		retrievalConfig := knowledge.RetrievalConfigFromYAML(cfg.Knowledge.Retrieval)
		knowledgeRetriever = knowledge.NewRetriever(knowledgeDB, embedder, retrievalConfig, log.Logger)
		if err := knowledge.WireRetrieverPipeline(context.Background(), knowledgeRetriever, &cfg.OpenAI); err != nil {
			return nil, fmt.Errorf("Failed to initialize knowledge base retrieval pipeline: %w", err)
		}

		// Create indexer (Agent Compose chain)
		knowledgeIndexer, err = knowledge.NewIndexer(context.Background(), knowledgeDB, embedder, log.Logger, &cfg.Knowledge)
		if err != nil {
			return nil, fmt.Errorf("Failed to initialize knowledge base indexer: %w", err)
		}

		// Register the knowledge retrieval tool with the MCP server
		knowledge.RegisterKnowledgeTool(mcpServer, knowledgeRetriever, knowledgeManager, log.Logger)

		// Create knowledge base API handler
		knowledgeHandler = handler.NewKnowledgeHandler(knowledgeManager, knowledgeRetriever, knowledgeIndexer, db, log.Logger)
		knowledgeHandler.SetAudit(auditSvc)
		log.Logger.Info("Knowledge base module initialized", zap.Bool("handler_created", knowledgeHandler != nil))

		// Scan the knowledge base and build the index (async)
		go func() {
			itemsToIndex, err := knowledgeManager.ScanKnowledgeBase()
			if err != nil {
				log.Logger.Warn("Failed to scan the knowledge base", zap.Error(err))
				return
			}

			// Check whether an index already exists
			hasIndex, err := knowledgeIndexer.HasIndex()
			if err != nil {
				log.Logger.Warn("Failed to check index status", zap.Error(err))
				return
			}

			if hasIndex {
				// If an index already exists, only index newly added or updated items
				if len(itemsToIndex) > 0 {
					log.Logger.Info("Existing knowledge base index detected, starting incremental indexing", zap.Int("count", len(itemsToIndex)))
					ctx := context.Background()
					consecutiveFailures := 0
					var firstFailureItemID string
					var firstFailureError error
					failedCount := 0

					for _, itemID := range itemsToIndex {
						if err := knowledgeIndexer.IndexItem(ctx, itemID); err != nil {
							failedCount++
							consecutiveFailures++

							if consecutiveFailures == 1 {
								firstFailureItemID = itemID
								firstFailureError = err
								log.Logger.Warn("Failed to index knowledge item", zap.String("itemId", itemID), zap.Error(err))
							}

							// If it fails 2 times in a row, stop incremental indexing immediately
							if consecutiveFailures >= 2 {
								log.Logger.Error("Too many consecutive indexing failures, stopping incremental indexing immediately",
									zap.Int("consecutiveFailures", consecutiveFailures),
									zap.Int("totalItems", len(itemsToIndex)),
									zap.String("firstFailureItemId", firstFailureItemID),
									zap.Error(firstFailureError),
								)
								break
							}
							continue
						}

						// Reset the consecutive failure count on success
						if consecutiveFailures > 0 {
							consecutiveFailures = 0
							firstFailureItemID = ""
							firstFailureError = nil
						}
					}
					log.Logger.Info("Incremental indexing complete", zap.Int("totalItems", len(itemsToIndex)), zap.Int("failedCount", failedCount))
				} else {
					log.Logger.Info("Existing knowledge base index detected, no new or updated items to index")
				}
				return
			}

			// Cold start: only build indexes for knowledge items that do not have vectors yet (consistent with IndexMissing semantics)
			log.Logger.Info("No knowledge base index detected, starting automatic index build")
			ctx := context.Background()
			if err := knowledgeIndexer.IndexMissing(ctx); err != nil {
				log.Logger.Warn("Failed to automatically build the knowledge base index", zap.Error(err))
			}
		}()
	}

	// The config file path must be passed in by the entry point (consistent with the -config flag). Do not use os.Args[1] anymore, otherwise ./cyberstrike-ai --https would treat --https as the path.
	configPath = strings.TrimSpace(configPath)
	if configPath == "" {
		configPath = "config.yaml"
	}

	skillsDir := skillpackage.SkillsRootFromConfig(cfg.SkillsDir, configPath)
	log.Logger.Debug("Skills directory (Pi skill middleware + web management API)", zap.String("skillsDir", skillsDir))
	configDir := filepath.Dir(configPath)
	plantaskRel := strings.TrimSpace(cfg.MultiAgent.Runtime.PlantaskRelDir)
	if plantaskRel == "" {
		plantaskRel = ".pi/plantask"
	}
	plantaskBase := filepath.Join(skillsDir, plantaskRel)
	// Keep the old checkpoint directory for cleanup of pre-migration task data.
	checkpointBase := strings.TrimSpace(cfg.MultiAgent.Runtime.CheckpointDir)
	reductionRoot := strings.TrimSpace(cfg.MultiAgent.Runtime.ReductionRootDir)
	workspaceRoot := strings.TrimSpace(cfg.Agent.WorkspaceRootDir)
	db.SetAgentConversationDirs(plantaskBase, checkpointBase, reductionRoot, workspaceRoot)
	if err := db.SetAgentSessionDir(cfg.AgentSessionDir()); err != nil {
		return nil, fmt.Errorf("register Pi session root: %w", err)
	}

	// Runspace garbage cleanup: the root directories always reuse the same set of values resolved above,
	// to avoid re-deriving them inside the storage package, which could make the cleaned directory differ from the one actually written to.
	workspaceRootDir := strings.TrimSpace(workspaceRoot)
	if workspaceRootDir == "" {
		workspaceRootDir = filepath.Join("tmp", "workspace")
	}
	reductionRootDir := strings.TrimSpace(reductionRoot)
	if reductionRootDir == "" {
		reductionRootDir = filepath.Join("tmp", "reduction")
	}
	diagnosticLogDir := strings.TrimSpace(cfg.Log.DiagnosticDir)
	if diagnosticLogDir == "" {
		diagnosticLogDir = "log"
	}
	// chat_uploads and tmp/c2 are currently fixed paths relative to the process working directory
	// (see handler.chatUploadsRootDirName and c2.NewManager in app/c2_lifecycle.go).
	chatUploadsRoot := "chat_uploads"
	c2Root := filepath.Join("tmp", "c2")
	// Make DeleteConversation also delete uploaded attachments: their chat_upload_artifacts rows are already removed by
	// ON DELETE CASCADE, so the files on disk would otherwise be left behind permanently.
	db.SetChatUploadsDir(chatUploadsRoot)
	storageCleaner := storage.NewCleaner(storage.Options{
		Config: cfg,
		Paths: storage.Paths{
			Workspace:            workspaceRootDir,
			Reduction:            reductionRootDir,
			ConversationArtifact: db.ConversationArtifactsBaseDir(),
			Plantask:             plantaskBase,
			C2:                   c2Root,
			ChatUploads:          chatUploadsRoot,
			WorkflowCheckpoints:  filepath.Join(filepath.Dir(dbPath), "workflow-checkpoints"),
			DiagnosticLogs:       diagnosticLogDir,
		},
		Activity: db,
		Logger:   log.Logger,
	})
	storageService := storage.NewService(storageCleaner, cfg, log.Logger)
	storage.StartRetentionLoop(storageService, log.Logger)
	storageHandler := handler.NewStorageHandler(storageCleaner, cfg, log.Logger)
	storageHandler.SetAudit(auditSvc)

	agent.SetPromptBaseDir(configDir)

	agentsDir := cfg.AgentsDir
	if agentsDir == "" {
		agentsDir = "agents"
	}
	if !filepath.IsAbs(agentsDir) {
		agentsDir = filepath.Join(configDir, agentsDir)
	}
	if err := os.MkdirAll(agentsDir, 0755); err != nil {
		log.Logger.Warn("Failed to create agents directory", zap.String("path", agentsDir), zap.Error(err))
	}
	markdownAgentsHandler := handler.NewMarkdownAgentsHandler(agentsDir)
	markdownAgentsHandler.SetAudit(auditSvc)
	log.Logger.Debug("Multi-agent Markdown sub-agent directory", zap.String("agentsDir", agentsDir))

	// Create handler
	agentHandler := handler.NewAgentHandler(agent, db, cfg, log.Logger)
	agentHandler.SetAudit(auditSvc)
	agentHandler.SetAgentsMarkdownDir(agentsDir)
	// If the knowledge base is enabled, set the knowledge base manager on AgentHandler so retrieval logs can be recorded
	if knowledgeManager != nil {
		agentHandler.SetKnowledgeManager(knowledgeManager)
	}
	monitorHandler := handler.NewMonitorHandler(mcpServer, executor, db, log.Logger)
	monitorHandler.SetAudit(auditSvc)
	monitorHandler.SetMonitorRetention(monitorRetention)
	monitorHandler.SetExternalMCPManager(externalMCPMgr) // Set the external MCP manager so external MCP execution records can be fetched
	monitorHandler.SetTaskManager(agentHandler.TaskManager())
	monitorHandler.SetAgentHandler(agentHandler)
	notificationHandler := handler.NewNotificationHandler(db, agentHandler, log.Logger)
	authHandler := handler.NewAuthHandler(authManager, cfg, configPath, log.Logger)
	authHandler.SetAudit(auditSvc)
	attackChainHandler := handler.NewAttackChainHandler(db, &cfg.OpenAI, log.Logger)
	vulnerabilityHandler := handler.NewVulnerabilityHandler(db, log.Logger)
	vulnerabilityHandler.SetTaskStateProvider(agentHandler)
	assetHandler := handler.NewAssetHandler(db, log.Logger)
	projectHandler := handler.NewProjectHandler(db, log.Logger)
	rbacHandler := handler.NewRBACHandler(db, log.Logger)
	rbacHandler.SetAudit(auditSvc)
	rbacHandler.SetAuthManager(authManager)
	workflowHandler := handler.NewWorkflowHandler(db, log.Logger)
	workflowHandler.SetAudit(auditSvc)
	workflowHandler.SetRuntime(agent, cfg)
	vulnerabilityHandler.SetAudit(auditSvc)
	webshellHandler := handler.NewWebShellHandler(log.Logger, db)
	webshellHandler.SetAudit(auditSvc)
	chatUploadsHandler := handler.NewChatUploadsHandler(log.Logger, db)
	chatUploadsHandler.SetAudit(auditSvc)
	registerWebshellTools(mcpServer, db, webshellHandler, log.Logger)
	registerWebshellManagementTools(mcpServer, db, webshellHandler, log.Logger)
	configHandler := handler.NewConfigHandler(configPath, cfg, mcpServer, executor, agent, attackChainHandler, externalMCPMgr, log.Logger)
	configHandler.SetDB(db)
	configHandler.SetToolGuard(toolGuard)
	configHandler.SetAudit(auditSvc)
	agentHandler.SetHitlToolWhitelistSaver(configHandler)
	agentHandler.SetHitlAuditStrategySaver(configHandler)
	agentHandler.SetHitlDefaultReviewerSaver(configHandler)
	externalMCPHandler := handler.NewExternalMCPHandler(externalMCPMgr, cfg, configPath, log.Logger)
	externalMCPHandler.SetAudit(auditSvc)
	roleHandler := handler.NewRoleHandler(cfg, configPath, log.Logger)
	roleHandler.SetDB(db)
	roleHandler.SetAudit(auditSvc)
	skillsHandler := handler.NewSkillsHandler(cfg, configPath, log.Logger)
	skillsHandler.SetAudit(auditSvc)
	fofaHandler := handler.NewFofaHandler(cfg, log.Logger)
	terminalHandler := handler.NewTerminalHandler(log.Logger)
	if db != nil {
		skillsHandler.SetDB(db) // Set the database connection so call statistics can be fetched
	}

	// ============================================================================
	// Initialize the C2 module (can be turned off by config, to save resources on this machine)
	// ============================================================================
	c2Manager, c2Watchdog, watchdogCancel := setupC2Runtime(cfg, db, agentHandler, log.Logger)
	if c2Manager != nil {
		registerC2Tools(mcpServer, c2Manager, log.Logger, cfg.Server.Port)
	}
	c2Handler := handler.NewC2Handler(c2Manager, log.Logger)
	c2Handler.SetAudit(auditSvc)

	// Create OpenAPI handler
	conversationHandler := handler.NewConversationHandler(db, log.Logger)
	conversationHandler.SetAudit(auditSvc)
	conversationHandler.SetTaskStopper(agentHandler)
	conversationHandler.SetTaskStateProvider(agentHandler)
	auditHandler := handler.NewAuditHandler(db, auditSvc, log.Logger)
	robotHandler := handler.NewRobotHandler(cfg, db, agentHandler, log.Logger)
	robotHandler.SetAudit(auditSvc)
	db.SetVulnerabilityCreatedHook(robotHandler.NotifyNewVulnerability)
	openAPIHandler := handler.NewOpenAPIHandler(db, log.Logger, conversationHandler, agentHandler)

	// Create App instance (some fields are populated later)
	app := &App{
		config:             cfg,
		configDir:          configDir,
		logger:             log,
		router:             router,
		mcpServer:          mcpServer,
		externalMCPMgr:     externalMCPMgr,
		agent:              agent,
		executor:           executor,
		db:                 db,
		knowledgeDB:        knowledgeDBConn,
		auth:               authManager,
		knowledgeManager:   knowledgeManager,
		knowledgeRetriever: knowledgeRetriever,
		knowledgeIndexer:   knowledgeIndexer,
		knowledgeHandler:   knowledgeHandler,
		agentHandler:       agentHandler,
		robotHandler:       robotHandler,
		c2Manager:          c2Manager,
		c2Watchdog:         c2Watchdog,
		c2WatchdogCancel:   watchdogCancel,
		c2Handler:          c2Handler,
		storageHandler:     storageHandler,
		auditSvc:           auditSvc,
	}
	// Feishu/DingTalk long connections (no public network needed); started in the background when enabled. Later, when the frontend applies config, they are restarted via RestartRobotConnections
	app.startRobotConnections()
	alertCtx, alertCancel := context.WithCancel(context.Background())
	app.alertCancel = alertCancel
	go robotHandler.RunVulnerabilityAlertWorker(alertCtx)

	// Set the vulnerability tool registrar (built-in tool, must be set)
	vulnerabilityRegistrar := func() error {
		registerVulnerabilityTools(mcpServer, db, log.Logger)
		registerAssetTools(mcpServer, db, log.Logger)
		registerProjectFactTools(mcpServer, db, cfg, log.Logger)
		registerVisionTools(mcpServer, cfg, log.Logger)
		return nil
	}
	configHandler.SetVulnerabilityToolRegistrar(vulnerabilityRegistrar)

	// Set the WebShell tool registrar (tools are re-registered on ApplyConfig)
	webshellRegistrar := func() error {
		registerWebshellTools(mcpServer, db, webshellHandler, log.Logger)
		registerWebshellManagementTools(mcpServer, db, webshellHandler, log.Logger)
		return nil
	}
	configHandler.SetWebshellToolRegistrar(webshellRegistrar)

	// Skills are provided by the Pi skill middleware (multi-agent); MCP-style skill tools are not registered here
	configHandler.SetSkillsToolRegistrar(func() error { return nil })

	handler.RegisterBatchTaskMCPTools(mcpServer, agentHandler, log.Logger)
	batchTaskToolRegistrar := func() error {
		handler.RegisterBatchTaskMCPTools(mcpServer, agentHandler, log.Logger)
		return nil
	}
	configHandler.SetBatchTaskToolRegistrar(batchTaskToolRegistrar)

	// Set the knowledge base initializer (for dynamic initialization; must be set after the App is created)
	configHandler.SetKnowledgeInitializer(func() (*handler.KnowledgeHandler, error) {
		knowledgeHandler, err := initializeKnowledge(cfg, db, knowledgeDBConn, mcpServer, agentHandler, app, log.Logger)
		if err != nil {
			return nil, err
		}

		// After dynamic initialization, set the knowledge base tool registrar and the retriever updater
		// So that tools can be re-registered during later ApplyConfig calls
		if app.knowledgeRetriever != nil && app.knowledgeManager != nil {
			// Create a closure that captures references to knowledgeRetriever and knowledgeManager
			registrar := func() error {
				knowledge.RegisterKnowledgeTool(mcpServer, app.knowledgeRetriever, app.knowledgeManager, log.Logger)
				return nil
			}
			configHandler.SetKnowledgeToolRegistrar(registrar)
			// Set the retriever updater so the retriever config is updated during ApplyConfig
			configHandler.SetRetrieverUpdater(app.knowledgeRetriever)
			log.Logger.Info("Knowledge base tool registrar and retriever updater set after dynamic initialization")
		}

		return knowledgeHandler, nil
	})

	// If the knowledge base is enabled, set the knowledge base tool registrar and the retriever updater
	if cfg.Knowledge.Enabled && knowledgeRetriever != nil && knowledgeManager != nil {
		// Create a closure that captures references to knowledgeRetriever and knowledgeManager
		registrar := func() error {
			knowledge.RegisterKnowledgeTool(mcpServer, knowledgeRetriever, knowledgeManager, log.Logger)
			return nil
		}
		configHandler.SetKnowledgeToolRegistrar(registrar)
		// Set the retriever updater so the retriever config is updated during ApplyConfig
		configHandler.SetRetrieverUpdater(knowledgeRetriever)
	}

	// Set the bot connection restarter, so new DingTalk/Feishu/WeChat config takes effect after the frontend applies it, without restarting the service
	configHandler.SetRobotRestarter(app)

	wechatRobotHandler := handler.NewWechatRobotHandler(cfg, configHandler, log.Logger)

	configHandler.SetC2Runtime(app)
	configHandler.SetC2ToolRegistrar(func() error {
		if app.config.C2.EnabledEffective() && app.c2Manager != nil {
			registerC2Tools(mcpServer, app.c2Manager, log.Logger, app.config.Server.Port)
		}
		return nil
	})

	updateHandler := handler.NewUpdateHandler(configDir, log.Logger, auditSvc,
		app.updateRestart(configDir), updateActivation, configHandler.UpdateSource, configHandler.SetUpdateSource)

	// Set up routes (uses the App instance so the handler can be fetched dynamically)
	setupRoutes(
		router,
		authHandler,
		agentHandler,
		monitorHandler,
		notificationHandler,
		conversationHandler,
		robotHandler,
		wechatRobotHandler,
		configHandler,
		externalMCPHandler,
		attackChainHandler,
		app, // Pass the App instance so knowledgeHandler can be fetched dynamically
		vulnerabilityHandler,
		assetHandler,
		projectHandler,
		workflowHandler,
		webshellHandler,
		chatUploadsHandler,
		roleHandler,
		skillsHandler,
		markdownAgentsHandler,
		fofaHandler,
		terminalHandler,
		app.c2Handler,
		auditHandler,
		auditSvc,
		rbacHandler,
		mcpServer,
		authManager,
		openAPIHandler,
		updateHandler,
	)

	return app, nil

}

// mcpHandlerWithAuth forwards to MCP handling after auth passes; if auth_header is configured, it validates the request header, otherwise it lets the request through
func (a *App) mcpHandlerWithAuth(w http.ResponseWriter, r *http.Request) {
	cfg := a.config.MCP
	if authHeader := strings.TrimSpace(r.Header.Get("Authorization")); len(authHeader) > 7 && strings.EqualFold(authHeader[:7], "Bearer ") {
		if session, ok := a.auth.ValidateToken(strings.TrimSpace(authHeader[7:])); ok && session.Permissions["mcp:execute"] {
			principal := authctx.NewPrincipalWithScopes(session.UserID, session.Username, session.Scope, session.Permissions, session.PermissionScopes)
			a.mcpServer.HandleHTTP(w, r.WithContext(authctx.WithPrincipal(r.Context(), principal)))
			return
		}
	}
	if !cfg.AllowGlobalAccess || strings.TrimSpace(cfg.AuthHeader) == "" || strings.TrimSpace(cfg.AuthHeaderValue) == "" {
		http.Error(w, "use an authorized user bearer token; global MCP service access is disabled", http.StatusUnauthorized)
		return
	}
	if subtle.ConstantTimeCompare([]byte(r.Header.Get(cfg.AuthHeader)), []byte(cfg.AuthHeaderValue)) != 1 {
		a.logger.Logger.Debug("MCP authentication failed: header missing or value mismatch", zap.String("header", cfg.AuthHeader))
		w.Header().Set("Content-Type", "application/json")
		w.WriteHeader(http.StatusUnauthorized)
		w.Write([]byte(`{"error":"unauthorized"}`))
		return
	}
	permissions := make(map[string]bool, len(security.PermissionCatalog))
	for permission := range security.PermissionCatalog {
		permissions[permission] = true
	}
	principal := authctx.NewPrincipal("service:mcp", "mcp-service", database.RBACScopeAll, permissions)
	r = r.WithContext(authctx.WithPrincipal(r.Context(), principal))
	a.mcpServer.HandleHTTP(w, r)
}

// Run starts the application (kept for backward compatibility; does not support graceful shutdown)
func (a *App) Run() error {
	return a.RunWithContext(context.Background())
}

// RestoreUpdateSessions consumes the handoff before the new HTTP listener starts.
func (a *App) RestoreUpdateSessions(handoff *os.File) {
	if handoff == nil {
		return
	}
	defer handoff.Close()
	if err := a.auth.RestoreRestartSessions(handoff); err != nil {
		a.logger.Warn("Unable to restore the login session from before the update", zap.Error(err))
	}
}

// RunWithContext starts the application and supports graceful shutdown via context cancellation
func (a *App) RunWithContext(ctx context.Context) error {
	// Start the MCP server (if enabled)
	var mcpServer *http.Server
	if a.config.MCP.Enabled {
		mcpAddr := fmt.Sprintf("%s:%d", a.config.MCP.Host, a.config.MCP.Port)
		a.logger.Info("Starting MCP server", zap.String("address", mcpAddr))

		mux := http.NewServeMux()
		mux.HandleFunc("/mcp", a.mcpHandlerWithAuth)

		mcpServer = &http.Server{Addr: mcpAddr, Handler: mux}
		go func() {
			if err := mcpServer.ListenAndServe(); err != nil && err != http.ErrServerClosed {
				a.logger.Error("MCP server failed to start", zap.Error(err))
			}
		}()
	}

	// Start the main server (optional HTTPS + HTTP/2, see server.tls_* in config)
	addr := fmt.Sprintf("%s:%d", a.config.Server.Host, a.config.Server.Port)
	tlsMode, tlsConf, certFile, keyFile, tlsErr := prepareMainServerTLS(&a.config.Server, a.configDir)
	if tlsErr != nil {
		return tlsErr
	}

	srv := &http.Server{Addr: addr, Handler: a.router}
	var mainMux *mainServerMux
	httpRedirect := config.ServerHTTPRedirectEnabled(&a.config.Server)
	if tlsMode != mainTLSOff {
		srv.TLSConfig = tlsConf
		if err := http2.ConfigureServer(srv, &http2.Server{}); err != nil {
			return fmt.Errorf("Failed to configure HTTP/2 for the main server: %w", err)
		}
		switch tlsMode {
		case mainTLSFromFiles:
			a.logger.Debug("Starting main HTTPS service (HTTP/2 negotiation enabled)",
				zap.String("address", addr),
				zap.String("cert", certFile),
			)
		case mainTLSAutoSelfSigned:
			a.logger.Debug("Starting main HTTPS service (auto self-signed certificate, testing only; HTTP/2 negotiation enabled)",
				zap.String("address", addr),
			)
		}
		if httpRedirect {
			a.logger.Debug("HTTP→HTTPS automatic redirect enabled (same-port sniffing and splitting)", zap.String("address", addr))
		}
	} else {
		a.logger.Debug("Starting main HTTP service", zap.String("address", addr))
	}

	// Watch for context cancellation and gracefully shut down the HTTP server
	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
		defer cancel()
		if mainMux != nil {
			if err := mainMux.Shutdown(shutdownCtx); err != nil {
				a.logger.Error("Failed to shut down the HTTP/HTTPS splitter server", zap.Error(err))
			}
		} else if err := srv.Shutdown(shutdownCtx); err != nil {
			a.logger.Error("Failed to shut down the HTTP server", zap.Error(err))
		}
		if mcpServer != nil {
			if err := mcpServer.Shutdown(shutdownCtx); err != nil {
				a.logger.Error("Failed to shut down the MCP server", zap.Error(err))
			}
		}
	}()

	var err error
	switch {
	case tlsMode != mainTLSOff && httpRedirect:
		var tlsConfReady *tls.Config
		tlsConfReady, err = ensureMainTLSConfigCerts(tlsMode, tlsConf, certFile, keyFile)
		if err != nil {
			return fmt.Errorf("Failed to load TLS certificate: %w", err)
		}
		srv.TLSConfig = tlsConfReady
		var ln net.Listener
		ln, err = net.Listen("tcp", addr)
		if err != nil {
			return err
		}
		mainMux = newMainServerMux(ln, srv, portFromListenAddr(addr), a.logger.Logger)
		err = mainMux.Serve()
	case tlsMode == mainTLSOff:
		err = srv.ListenAndServe()
	case tlsMode == mainTLSFromFiles:
		err = srv.ListenAndServeTLS(certFile, keyFile)
	case tlsMode == mainTLSAutoSelfSigned:
		var ln net.Listener
		ln, err = tls.Listen("tcp", addr, srv.TLSConfig)
		if err == nil {
			err = srv.Serve(ln)
		}
	default:
		err = srv.ListenAndServe()
	}
	if err != nil && err != http.ErrServerClosed {
		return err
	}
	return nil
}

// Shutdown closes the application
func (a *App) Shutdown() {
	a.shutdownOnce.Do(a.shutdown)
}

func (a *App) shutdown() {
	if a.agentHandler != nil {
		a.agentHandler.ShutdownTasks()
	}
	if a.alertCancel != nil {
		a.alertCancel()
		a.alertCancel = nil
	}

	// Stop the DingTalk/Feishu long connections
	a.robotMu.Lock()
	if a.dingCancel != nil {
		a.dingCancel()
		a.dingCancel = nil
	}
	if a.larkCancel != nil {
		a.larkCancel()
		a.larkCancel = nil
	}
	a.robotMu.Unlock()

	a.shutdownC2()

	// Stop all external MCP clients
	if a.externalMCPMgr != nil {
		a.externalMCPMgr.StopAll()
	}

	// Close the knowledge base database connection (if using a separate database)
	if a.knowledgeDB != nil {
		if err := a.knowledgeDB.Close(); err != nil {
			a.logger.Logger.Warn("Failed to close the knowledge base database connection", zap.Error(err))
		}
	}

	// Close the main database connection
	if a.db != nil {
		if err := a.db.Close(); err != nil {
			a.logger.Logger.Warn("Failed to close the main database connection", zap.Error(err))
		}
	}
}

// startRobotConnections starts the DingTalk/Feishu long connections based on the current config (does not close existing connections first; only for the initial start)
func (a *App) startRobotConnections() {
	a.robotMu.Lock()
	defer a.robotMu.Unlock()
	cfg := a.config
	if cfg.Robots.Lark.Enabled && cfg.Robots.Lark.AppID != "" && cfg.Robots.Lark.AppSecret != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.larkCancel = cancel
		go robot.StartLark(ctx, cfg.Robots, a.robotHandler, a.logger.Logger)
	}
	if cfg.Robots.Dingtalk.Enabled && cfg.Robots.Dingtalk.ClientID != "" && cfg.Robots.Dingtalk.ClientSecret != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.dingCancel = cancel
		go robot.StartDing(ctx, cfg.Robots, a.robotHandler, a.logger.Logger)
	}
	if cfg.Robots.Wechat.Enabled && cfg.Robots.Wechat.BotToken != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.wechatCancel = cancel
		go robot.StartWechat(ctx, cfg.Robots, a.robotHandler, cfg.Version, a.logger.Logger)
	}
	if cfg.Robots.Telegram.Enabled && strings.TrimSpace(cfg.Robots.Telegram.BotToken) != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.telegramCancel = cancel
		go robot.StartTelegram(ctx, cfg.Robots, a.robotHandler, a.logger.Logger)
	}
	if cfg.Robots.Slack.Enabled && strings.TrimSpace(cfg.Robots.Slack.BotToken) != "" && strings.TrimSpace(cfg.Robots.Slack.AppToken) != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.slackCancel = cancel
		go robot.StartSlack(ctx, cfg.Robots, a.robotHandler, a.logger.Logger)
	}
	if cfg.Robots.Discord.Enabled && strings.TrimSpace(cfg.Robots.Discord.BotToken) != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.discordCancel = cancel
		go robot.StartDiscord(ctx, cfg.Robots, a.robotHandler, a.logger.Logger)
	}
	if cfg.Robots.QQ.Enabled && strings.TrimSpace(cfg.Robots.QQ.AppID) != "" && strings.TrimSpace(cfg.Robots.QQ.ClientSecret) != "" {
		ctx, cancel := context.WithCancel(context.Background())
		a.qqCancel = cancel
		go robot.StartQQ(ctx, cfg.Robots, a.robotHandler, a.logger.Logger)
	}
}

// RestartRobotConnections restarts the DingTalk/Feishu/WeChat long connections so frontend config takes effect immediately (implements handler.RobotRestarter)
func (a *App) RestartRobotConnections() {
	a.robotMu.Lock()
	if a.dingCancel != nil {
		a.dingCancel()
		a.dingCancel = nil
	}
	if a.larkCancel != nil {
		a.larkCancel()
		a.larkCancel = nil
	}
	if a.wechatCancel != nil {
		a.wechatCancel()
		a.wechatCancel = nil
	}
	if a.telegramCancel != nil {
		a.telegramCancel()
		a.telegramCancel = nil
	}
	if a.slackCancel != nil {
		a.slackCancel()
		a.slackCancel = nil
	}
	if a.discordCancel != nil {
		a.discordCancel()
		a.discordCancel = nil
	}
	if a.qqCancel != nil {
		a.qqCancel()
		a.qqCancel = nil
	}
	a.robotMu.Unlock()
	// Give old goroutines a moment to exit
	time.Sleep(200 * time.Millisecond)
	a.startRobotConnections()
}

// setupRoutes sets up routes
func setupRoutes(
	router *gin.Engine,
	authHandler *handler.AuthHandler,
	agentHandler *handler.AgentHandler,
	monitorHandler *handler.MonitorHandler,
	notificationHandler *handler.NotificationHandler,
	conversationHandler *handler.ConversationHandler,
	robotHandler *handler.RobotHandler,
	wechatRobotHandler *handler.WechatRobotHandler,
	configHandler *handler.ConfigHandler,
	externalMCPHandler *handler.ExternalMCPHandler,
	attackChainHandler *handler.AttackChainHandler,
	app *App, // Pass the App instance so knowledgeHandler can be fetched dynamically
	vulnerabilityHandler *handler.VulnerabilityHandler,
	assetHandler *handler.AssetHandler,
	projectHandler *handler.ProjectHandler,
	workflowHandler *handler.WorkflowHandler,
	webshellHandler *handler.WebShellHandler,
	chatUploadsHandler *handler.ChatUploadsHandler,
	roleHandler *handler.RoleHandler,
	skillsHandler *handler.SkillsHandler,
	markdownAgentsHandler *handler.MarkdownAgentsHandler,
	fofaHandler *handler.FofaHandler,
	terminalHandler *handler.TerminalHandler,
	c2Handler *handler.C2Handler,
	auditHandler *handler.AuditHandler,
	auditSvc *audit.Service,
	rbacHandler *handler.RBACHandler,
	mcpServer *mcp.Server,
	authManager *security.AuthManager,
	openAPIHandler *handler.OpenAPIHandler,
	updateHandler *handler.UpdateHandler,
) {
	// API routes
	api := router.Group("/api")

	// Authentication routes
	authRoutes := api.Group("/auth")
	loginRL := security.NewRateLimiter(10, 1*time.Minute)
	{
		authRoutes.POST("/login", security.RateLimitMiddleware(loginRL), authHandler.Login)
		authRoutes.POST("/logout", security.AuthMiddleware(authManager), authHandler.Logout)
		authRoutes.POST("/change-password", security.AuthMiddleware(authManager), security.RequirePermission("auth:self"), authHandler.ChangePassword)
		authRoutes.GET("/validate", updateHandler.SetBootHeader, security.AuthMiddleware(authManager), authHandler.Validate)
		authRoutes.POST("/robot-binding-code", security.AuthMiddleware(authManager), security.RequirePermission("auth:self"), robotHandler.CreateRobotBindingCode)
		authRoutes.GET("/robot-bindings", security.AuthMiddleware(authManager), security.RequirePermission("auth:self"), robotHandler.ListMyRobotBindings)
		authRoutes.DELETE("/robot-bindings/:id", security.AuthMiddleware(authManager), security.RequirePermission("auth:self"), robotHandler.DeleteMyRobotBinding)
	}

	// Bot callbacks (no login required; called by WeCom/DingTalk/Feishu servers)
	// Add rate limiting: each IP may make at most 60 requests per minute, to prevent abuse
	robotRL := security.NewRateLimiter(60, 1*time.Minute)
	robotGroup := api.Group("/robot")
	robotGroup.Use(security.RateLimitMiddleware(robotRL))
	{
		robotGroup.GET("/wecom", robotHandler.HandleWecomGET)
		robotGroup.POST("/wecom", robotHandler.HandleWecomPOST)
		robotGroup.POST("/dingtalk", robotHandler.HandleDingtalkPOST)
		robotGroup.POST("/lark", robotHandler.HandleLarkPOST)
	}

	protected := api.Group("")
	protected.Use(security.AuthMiddleware(authManager))
	protected.Use(security.RBACMiddlewareWithDenyHook(app.db, func(c *gin.Context, reason, permission string) {
		if auditSvc != nil {
			auditSvc.Record(c, audit.Entry{
				Level: "warn", Category: "rbac", Action: "access_denied", Result: "failure",
				Message: "RBAC denied access", ResourceType: "route", ResourceID: c.FullPath(),
				Detail: map[string]interface{}{"reason": reason, "permission": permission, "method": c.Request.Method},
			})
		}
	}))
	{
		protected.GET("/rbac/me", rbacHandler.Me)
		protected.GET("/rbac/metadata", rbacHandler.Metadata)
		protected.GET("/rbac/users", rbacHandler.ListUsers)
		protected.POST("/rbac/users", rbacHandler.CreateUser)
		protected.PUT("/rbac/users/:id", rbacHandler.UpdateUser)
		protected.DELETE("/rbac/users/:id", rbacHandler.DeleteUser)
		protected.GET("/rbac/roles", rbacHandler.ListRoles)
		protected.POST("/rbac/roles", rbacHandler.CreateRole)
		protected.PUT("/rbac/roles/:id", rbacHandler.UpdateRole)
		protected.DELETE("/rbac/roles/:id", rbacHandler.DeleteRole)
		protected.GET("/rbac/resource-assignments", rbacHandler.ListResourceAssignments)
		protected.GET("/rbac/resources", rbacHandler.ListAssignableResources)
		protected.POST("/rbac/resource-assignments", rbacHandler.AssignResource)
		protected.DELETE("/rbac/resource-assignments/:id", rbacHandler.DeleteResourceAssignment)

		// Bot test (login required): POST /api/robot/test, body: {"platform":"dingtalk","user_id":"test","text":"help"}, used to verify bot logic
		protected.POST("/robot/test", robotHandler.HandleRobotTest)

		// WeChat iLink QR code binding (login required)
		protected.POST("/robot/wechat/qrcode", wechatRobotHandler.HandleWechatQRCode)
		protected.GET("/robot/wechat/qrcode/status", wechatRobotHandler.HandleWechatQRCodeStatus)
		protected.POST("/robot/wechat/qrcode/verify", wechatRobotHandler.HandleWechatVerifyCode)
		protected.GET("/robot/wechat/status", wechatRobotHandler.HandleWechatStatus)

		// Pi single agent (ChatModelAgent + Runner; does not depend on multi_agent.enabled)
		protected.POST("/agent", agentHandler.SingleAgentLoop)
		protected.POST("/agent/runs", agentHandler.SubmitSingleAgentRun)
		protected.POST("/multi-agent/runs", agentHandler.SubmitMultiAgentRun)
		protected.GET("/agent/runs/:runId", agentHandler.GetAgentRun)
		protected.GET("/multi-agent/runs/:runId", agentHandler.GetAgentRun)
		protected.POST("/agent/stream", agentHandler.SingleAgentLoopStream)
		// Transport aliases for installed older clients; all execute the same Pi handlers.
		protected.POST("/eino-agent", agentHandler.SingleAgentLoop)
		protected.POST("/eino-agent/runs", agentHandler.SubmitSingleAgentRun)
		protected.GET("/eino-agent/runs/:runId", agentHandler.GetAgentRun)
		protected.POST("/eino-agent/stream", agentHandler.SingleAgentLoopStream)
		protected.GET("/hitl/pending", agentHandler.ListHITLPending)
		protected.GET("/hitl/logs", agentHandler.ListHITLLogs)
		protected.DELETE("/hitl/logs", agentHandler.DeleteHITLLogs)
		protected.GET("/hitl/logs/:id", agentHandler.GetHITLLog)
		protected.POST("/hitl/decision", agentHandler.DecideHITLInterrupt)
		protected.POST("/hitl/dismiss", agentHandler.DismissHITLInterrupt)
		protected.GET("/hitl/config/:conversationId", agentHandler.GetHITLConversationConfig)
		protected.PUT("/hitl/config", agentHandler.UpsertHITLConversationConfig)
		protected.GET("/hitl/tool-whitelist", agentHandler.GetHITLGlobalToolWhitelist)
		protected.PUT("/hitl/tool-whitelist", agentHandler.SetHITLGlobalToolWhitelist)
		protected.POST("/hitl/tool-whitelist", agentHandler.MergeHITLGlobalToolWhitelist)
		protected.GET("/hitl/default-config", agentHandler.GetHITLDefaultConfig)
		protected.PUT("/hitl/default-config", agentHandler.UpdateHITLDefaultConfig)
		protected.GET("/hitl/default-reviewer", agentHandler.GetHITLDefaultReviewer)
		protected.PUT("/hitl/default-reviewer", agentHandler.UpdateHITLDefaultReviewer)
		protected.GET("/hitl/audit-strategy", agentHandler.GetHITLAuditStrategy)
		protected.PUT("/hitl/audit-strategy", agentHandler.UpdateHITLAuditStrategy)
		// Agent Loop cancellation and task list
		protected.POST("/agent-loop/cancel", agentHandler.CancelAgentLoop)
		protected.GET("/agent-loop/tasks", agentHandler.ListAgentTasks)
		protected.GET("/agent-loop/task-events", agentHandler.SubscribeAgentTaskEvents)
		protected.GET("/agent-loop/tasks/completed", agentHandler.ListCompletedTasks)

		// Agent DeepAgent multi-agent (coexists with the single agent; requires config.multi_agent.enabled)
		// Multi-agent routes are usually registered; whether they are usable is decided at runtime by h.config.MultiAgent.Enabled (no restart needed after applying config)
		protected.POST("/multi-agent", agentHandler.MultiAgentLoop)
		protected.POST("/multi-agent/stream", agentHandler.MultiAgentLoopStream)
		protected.GET("/multi-agent/markdown-agents", markdownAgentsHandler.ListMarkdownAgents)
		protected.GET("/multi-agent/markdown-agents/:filename", markdownAgentsHandler.GetMarkdownAgent)
		protected.POST("/multi-agent/markdown-agents", markdownAgentsHandler.CreateMarkdownAgent)
		protected.PUT("/multi-agent/markdown-agents/:filename", markdownAgentsHandler.UpdateMarkdownAgent)
		protected.DELETE("/multi-agent/markdown-agents/:filename", markdownAgentsHandler.DeleteMarkdownAgent)

		// Information gathering - FOFA query (backend proxy)
		protected.POST("/fofa/search", fofaHandler.Search)
		// Information gathering - parse natural language into FOFA syntax (needs manual confirmation before querying)
		protected.POST("/fofa/parse", fofaHandler.ParseNaturalLanguage)

		// Asset management
		protected.GET("/assets", assetHandler.List)
		protected.GET("/assets/selection", assetHandler.Selection)
		protected.GET("/assets/stats", assetHandler.Stats)
		protected.POST("/assets/import", assetHandler.Import)
		protected.POST("/assets/scan-links", assetHandler.RecordScans)
		protected.PUT("/assets/bulk", assetHandler.BulkUpdate)
		protected.PUT("/assets/project-binding", assetHandler.UpdateProjectBinding)
		protected.POST("/assets/batch-delete", assetHandler.BatchDelete)
		protected.POST("/assets/merge", security.RequirePermission("asset:write"), assetHandler.Merge)
		protected.PUT("/assets/:id", assetHandler.Update)
		protected.DELETE("/assets/:id", assetHandler.Delete)

		// Batch task management
		protected.POST("/batch-tasks", agentHandler.CreateBatchQueue)
		protected.GET("/batch-tasks", agentHandler.ListBatchQueues)
		protected.GET("/batch-tasks/:queueId", agentHandler.GetBatchQueue)
		protected.POST("/batch-tasks/:queueId/start", agentHandler.StartBatchQueue)
		protected.POST("/batch-tasks/:queueId/rerun", agentHandler.RerunBatchQueue)
		protected.POST("/batch-tasks/:queueId/pause", agentHandler.PauseBatchQueue)
		protected.PUT("/batch-tasks/:queueId/metadata", agentHandler.UpdateBatchQueueMetadata)
		protected.PUT("/batch-tasks/:queueId/schedule", agentHandler.UpdateBatchQueueSchedule)
		protected.PUT("/batch-tasks/:queueId/schedule-enabled", agentHandler.SetBatchQueueScheduleEnabled)
		protected.DELETE("/batch-tasks/:queueId", agentHandler.DeleteBatchQueue)
		protected.PUT("/batch-tasks/:queueId/tasks/:taskId", agentHandler.UpdateBatchTask)
		protected.POST("/batch-tasks/:queueId/tasks/:taskId/run", agentHandler.RunSingleBatchTask)
		protected.POST("/batch-tasks/:queueId/tasks", agentHandler.AddBatchTask)
		protected.DELETE("/batch-tasks/:queueId/tasks/:taskId", agentHandler.DeleteBatchTask)

		// Conversation history
		protected.GET("/usage/tokens", conversationHandler.GetTokenUsageStats)
		protected.POST("/conversations", conversationHandler.CreateConversation)
		protected.GET("/conversations", conversationHandler.ListConversations)
		protected.GET("/conversations/:id", conversationHandler.GetConversation)
		protected.GET("/conversations/:id/token-usage", conversationHandler.GetConversationTokenUsageStats)
		protected.GET("/conversations/:id/plan-tasks", conversationHandler.GetConversationPlanTasks)
		protected.GET("/messages/:id/process-details", conversationHandler.GetMessageProcessDetails)
		protected.GET("/process-details/:id", conversationHandler.GetProcessDetail)
		protected.PUT("/conversations/:id", conversationHandler.UpdateConversation)
		protected.PUT("/conversations/:id/project", conversationHandler.SetConversationProject)
		protected.DELETE("/conversations/:id", conversationHandler.DeleteConversation)
		protected.POST("/conversations/:id/delete-turn", conversationHandler.DeleteConversationTurn)
		protected.PUT("/conversations/:id/pinned", conversationHandler.UpdateConversationPinned)

		// Monitoring
		protected.GET("/monitor", monitorHandler.Monitor)
		protected.GET("/monitor/execution/:id", monitorHandler.GetExecution)
		protected.POST("/monitor/execution/:id/cancel", monitorHandler.CancelExecution)
		protected.POST("/monitor/executions/names", monitorHandler.BatchGetToolNames)
		protected.DELETE("/monitor/execution/:id", monitorHandler.DeleteExecution)
		protected.DELETE("/monitor/executions", monitorHandler.DeleteExecutions)
		protected.GET("/monitor/stats", monitorHandler.GetStats)
		protected.GET("/monitor/calls-timeline", monitorHandler.GetCallsTimeline)
		protected.GET("/notifications/summary", notificationHandler.GetSummary)
		protected.POST("/notifications/read", notificationHandler.MarkRead)

		// Configuration management
		protected.GET("/config", configHandler.GetConfig)
		protected.GET("/tool-guard", configHandler.GetToolGuard)
		protected.PUT("/tool-guard", configHandler.UpdateToolGuard)
		protected.POST("/tool-guard/test", configHandler.TestToolGuard)
		protected.GET("/config/tools", configHandler.GetTools)
		protected.GET("/config/tools/:name/schema", configHandler.GetToolSchema)
		protected.PUT("/config", configHandler.UpdateConfig)
		protected.POST("/config/apply", configHandler.ApplyConfig)
		protected.POST("/config/test-openai", configHandler.TestOpenAI)
		protected.POST("/config/detect-context", configHandler.DetectContext)
		protected.POST("/config/test-typesafe", configHandler.TestTypeSafe)
		protected.POST("/config/test-audit-model", configHandler.TestAuditModel)
		protected.POST("/config/test-vision", configHandler.TestVision)
		protected.POST("/config/list-models", configHandler.ListModels)

		// System update (keeps this installation's own source up to date: view, check, apply, progress, rollback, connect, update source)
		protected.GET("/system/update", updateHandler.GetStatus)
		protected.GET("/system/update/job", updateHandler.Job)
		protected.POST("/system/update/check", updateHandler.Check)
		protected.POST("/system/update/apply", updateHandler.Apply)
		protected.POST("/system/update/restart", updateHandler.Restart)
		protected.POST("/system/update/rollback", updateHandler.Rollback)
		protected.POST("/system/update/adopt", updateHandler.Adopt)
		protected.POST("/system/update/source", updateHandler.SaveSource)

		// System settings - terminal (run commands, to improve operations efficiency)
		protected.POST("/terminal/run", terminalHandler.RunCommand)
		protected.POST("/terminal/run/stream", terminalHandler.RunCommandStream)
		protected.GET("/terminal/ws", terminalHandler.RunCommandWS)

		// Platform audit logs
		protected.GET("/audit/meta", auditHandler.Meta)
		protected.GET("/audit/summary", auditHandler.Summary)
		protected.GET("/audit/logs", auditHandler.ListLogs)
		protected.GET("/audit/logs/export", auditHandler.ExportLogs)
		protected.GET("/audit/logs/:id", auditHandler.GetLog)

		// Runspace occupancy and garbage cleanup
		protected.GET("/storage/meta", app.storageHandler.Meta)
		protected.GET("/storage/status", app.storageHandler.Status)
		protected.POST("/storage/cleanup", app.storageHandler.Cleanup)

		// External MCP management
		protected.GET("/external-mcp", externalMCPHandler.GetExternalMCPs)
		protected.GET("/external-mcp/stats", externalMCPHandler.GetExternalMCPStats)
		protected.GET("/external-mcp/:name", externalMCPHandler.GetExternalMCP)
		protected.PUT("/external-mcp/:name", externalMCPHandler.AddOrUpdateExternalMCP)
		protected.DELETE("/external-mcp/:name", externalMCPHandler.DeleteExternalMCP)
		protected.POST("/external-mcp/:name/start", externalMCPHandler.StartExternalMCP)
		protected.POST("/external-mcp/:name/stop", externalMCPHandler.StopExternalMCP)

		// Attack chain visualization
		protected.GET("/attack-chain/:conversationId", attackChainHandler.GetAttackChain)
		protected.POST("/attack-chain/:conversationId/regenerate", attackChainHandler.RegenerateAttackChain)

		// Knowledge base management (routes are always registered; handler is fetched dynamically via the App instance)
		knowledgeRoutes := protected.Group("/knowledge")
		{
			knowledgeRoutes.GET("/categories", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"categories": []string{},
						"enabled":    false,
						"message":    "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.GetCategories(c)
			})
			knowledgeRoutes.GET("/items", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"items":   []interface{}{},
						"enabled": false,
						"message": "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.GetItems(c)
			})
			knowledgeRoutes.GET("/items/:id", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"message": "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.GetItem(c)
			})
			knowledgeRoutes.POST("/items", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"error":   "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.CreateItem(c)
			})
			knowledgeRoutes.PUT("/items/:id", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"error":   "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.UpdateItem(c)
			})
			knowledgeRoutes.DELETE("/items/:id", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"error":   "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.DeleteItem(c)
			})
			knowledgeRoutes.GET("/index-status", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled":          false,
						"total_items":      0,
						"indexed_items":    0,
						"progress_percent": 0,
						"is_complete":      false,
						"message":          "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.GetIndexStatus(c)
			})
			knowledgeRoutes.POST("/index", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"error":   "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.StartIndex(c)
			})
			knowledgeRoutes.POST("/scan", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"error":   "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.ScanKnowledgeBase(c)
			})
			knowledgeRoutes.GET("/retrieval-logs", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"logs":    []interface{}{},
						"enabled": false,
						"message": "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.GetRetrievalLogs(c)
			})
			knowledgeRoutes.DELETE("/retrieval-logs/:id", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled": false,
						"error":   "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.DeleteRetrievalLog(c)
			})
			knowledgeRoutes.POST("/search", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"results": []interface{}{},
						"enabled": false,
						"message": "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.Search(c)
			})
			knowledgeRoutes.GET("/stats", func(c *gin.Context) {
				if app.knowledgeHandler == nil {
					c.JSON(http.StatusOK, gin.H{
						"enabled":          false,
						"total_categories": 0,
						"total_items":      0,
						"message":          "Knowledge base is not enabled. Enable knowledge retrieval in system settings",
					})
					return
				}
				app.knowledgeHandler.GetStats(c)
			})
		}

		// Vulnerability management
		protected.GET("/vulnerabilities", vulnerabilityHandler.ListVulnerabilities)
		protected.GET("/vulnerabilities/export", vulnerabilityHandler.ExportVulnerabilities)
		protected.DELETE("/vulnerabilities/batch", vulnerabilityHandler.BatchDeleteVulnerabilities)
		protected.GET("/vulnerabilities/filter-options", vulnerabilityHandler.GetVulnerabilityFilterOptions)
		protected.GET("/vulnerabilities/stats", vulnerabilityHandler.GetVulnerabilityStats)
		protected.POST("/vulnerabilities/cases", vulnerabilityHandler.MergeVulnerabilities)
		protected.POST("/vulnerabilities/cases/:caseID/split", vulnerabilityHandler.DissolveVulnerabilityCase)
		protected.GET("/vulnerability-alerts/subscription", vulnerabilityHandler.GetMyAlertSubscription)
		protected.PUT("/vulnerability-alerts/subscription", vulnerabilityHandler.UpdateMyAlertSubscription)
		protected.GET("/vulnerabilities/:id", vulnerabilityHandler.GetVulnerability)
		protected.GET("/vulnerabilities/:id/context", vulnerabilityHandler.VulnerabilityContext)
		protected.GET("/vulnerabilities/:id/download", vulnerabilityHandler.DownloadVulnerability)
		protected.POST("/vulnerabilities", vulnerabilityHandler.CreateVulnerability)
		protected.POST("/vulnerabilities/:id/retest", vulnerabilityHandler.CreateRetest)
		protected.PUT("/vulnerabilities/:id", vulnerabilityHandler.UpdateVulnerability)
		protected.DELETE("/vulnerabilities/:id", vulnerabilityHandler.DeleteVulnerability)

		// Project management and fact blackboard
		protected.GET("/projects/dashboard-summary", projectHandler.GetDashboardSummary)
		protected.GET("/projects", projectHandler.ListProjects)
		protected.POST("/projects", projectHandler.CreateProject)
		protected.GET("/projects/:id/stats", projectHandler.GetProjectStats)
		protected.GET("/projects/:id/conversations", projectHandler.ListProjectConversations)
		protected.GET("/projects/:id", projectHandler.GetProject)
		protected.PUT("/projects/:id", projectHandler.UpdateProject)
		protected.DELETE("/projects/:id", projectHandler.DeleteProject)
		protected.GET("/projects/:id/fact-graph", projectHandler.GetFactGraph)
		protected.GET("/projects/:id/fact-edges", projectHandler.ListFactEdges)
		protected.POST("/projects/:id/fact-edges", projectHandler.CreateFactEdge)
		protected.DELETE("/projects/:id/fact-edges/:edgeId", projectHandler.DeleteFactEdge)
		protected.POST("/projects/:id/promote-attack-chain/:conversationId", projectHandler.PromoteAttackChain)
		protected.GET("/projects/:id/facts", projectHandler.ListFacts)
		protected.POST("/projects/:id/facts", projectHandler.CreateFact)
		protected.PUT("/projects/:id/facts/:factId", projectHandler.UpdateFact)
		protected.DELETE("/projects/:id/facts/:factId", projectHandler.DeleteFact)
		protected.POST("/projects/:id/facts/deprecate", projectHandler.DeprecateFact)
		protected.POST("/projects/:id/facts/restore", projectHandler.RestoreFact)

		// WebShell management (proxied execution + connection config stored in SQLite)
		protected.GET("/webshell/connections", webshellHandler.ListConnections)
		protected.POST("/webshell/connections", webshellHandler.CreateConnection)
		protected.GET("/webshell/connections/:id/ai-history", webshellHandler.GetAIHistory)
		protected.GET("/webshell/connections/:id/ai-conversations", webshellHandler.ListAIConversations)
		protected.GET("/webshell/connections/:id/state", webshellHandler.GetConnectionState)
		protected.PUT("/webshell/connections/:id", webshellHandler.UpdateConnection)
		protected.PUT("/webshell/connections/:id/state", webshellHandler.SaveConnectionState)
		protected.DELETE("/webshell/connections/:id", webshellHandler.DeleteConnection)
		protected.POST("/webshell/exec", webshellHandler.Exec)
		protected.POST("/webshell/file", webshellHandler.FileOp)

		// C2 management (returns 503 when not enabled, to avoid a nil pointer in the Handler)
		c2Routes := protected.Group("/c2")
		c2Routes.Use(func(c *gin.Context) {
			if app.c2Manager == nil {
				c.AbortWithStatusJSON(http.StatusServiceUnavailable, gin.H{
					"error":   "c2_disabled",
					"message": "C2 is turned off in system settings",
					"enabled": false,
				})
				return
			}
			c.Next()
		})
		c2Routes.GET("/listeners", c2Handler.ListListeners)
		c2Routes.POST("/listeners", c2Handler.CreateListener)
		c2Routes.GET("/listeners/:id", c2Handler.GetListener)
		c2Routes.PUT("/listeners/:id", c2Handler.UpdateListener)
		c2Routes.DELETE("/listeners/:id", c2Handler.DeleteListener)
		c2Routes.POST("/listeners/:id/start", c2Handler.StartListener)
		c2Routes.POST("/listeners/:id/stop", c2Handler.StopListener)
		c2Routes.GET("/sessions", c2Handler.ListSessions)
		c2Routes.DELETE("/sessions", c2Handler.DeleteSessions)
		c2Routes.GET("/sessions/:id", c2Handler.GetSession)
		c2Routes.DELETE("/sessions/:id", c2Handler.DeleteSession)
		c2Routes.PUT("/sessions/:id/sleep", c2Handler.SetSessionSleep)
		c2Routes.PUT("/sessions/:id/note", c2Handler.SetSessionNote)
		c2Routes.GET("/tasks", c2Handler.ListTasks)
		c2Routes.DELETE("/tasks", c2Handler.DeleteTasks)
		c2Routes.GET("/tasks/:id", c2Handler.GetTask)
		c2Routes.POST("/tasks", c2Handler.CreateTask)
		c2Routes.POST("/tasks/:id/cancel", c2Handler.CancelTask)
		c2Routes.GET("/tasks/:id/wait", c2Handler.WaitTask)
		c2Routes.POST("/sessions/:id/tasks", c2Handler.CreateTask)
		c2Routes.POST("/payloads/oneliner", c2Handler.PayloadOneliner)
		c2Routes.POST("/payloads/build", c2Handler.PayloadBuild)
		c2Routes.GET("/payloads/:id/download", c2Handler.PayloadDownload)
		c2Routes.GET("/events", c2Handler.ListEvents)
		c2Routes.DELETE("/events", c2Handler.DeleteEvents)
		c2Routes.GET("/events/stream", c2Handler.EventStream)
		c2Routes.POST("/files/upload", c2Handler.UploadFileForImplant)
		c2Routes.GET("/files", c2Handler.ListFiles)
		c2Routes.GET("/tasks/:id/result-file", c2Handler.DownloadResultFile)
		c2Routes.GET("/profiles", c2Handler.ListProfiles)
		c2Routes.GET("/profiles/:id", c2Handler.GetProfile)
		c2Routes.POST("/profiles", c2Handler.CreateProfile)
		c2Routes.PUT("/profiles/:id", c2Handler.UpdateProfile)
		c2Routes.DELETE("/profiles/:id", c2Handler.DeleteProfile)

		// Conversation attachment (chat_uploads) management
		protected.GET("/chat-uploads", chatUploadsHandler.List)
		protected.GET("/chat-uploads/export", chatUploadsHandler.Export)
		protected.GET("/chat-uploads/download", chatUploadsHandler.Download)
		protected.GET("/chat-uploads/path", chatUploadsHandler.ResolvePath)
		protected.GET("/chat-uploads/content", chatUploadsHandler.GetContent)
		protected.POST("/chat-uploads", chatUploadsHandler.Upload)
		protected.POST("/chat-uploads/mkdir", chatUploadsHandler.Mkdir)
		protected.DELETE("/chat-uploads", chatUploadsHandler.Delete)
		protected.PUT("/chat-uploads/rename", chatUploadsHandler.Rename)
		protected.PUT("/chat-uploads/content", chatUploadsHandler.PutContent)

		// Role management
		protected.GET("/roles", roleHandler.GetRoles)
		protected.GET("/roles/:name", roleHandler.GetRole)
		protected.POST("/roles", roleHandler.CreateRole)
		protected.PUT("/roles/:name", roleHandler.UpdateRole)
		protected.DELETE("/roles/:name", roleHandler.DeleteRole)

		// Workflow definitions (fixed graph structure; business fields are stored in graph_json)
		protected.GET("/workflows/runs/pending", workflowHandler.ListPendingRuns)
		protected.GET("/workflows/runs/:runId/replay", workflowHandler.ReplayRun)
		protected.GET("/workflows/runs/:runId", workflowHandler.GetRun)
		protected.POST("/workflows/runs/:runId/resume", workflowHandler.ResumeRun)
		protected.POST("/workflows/validate", workflowHandler.Validate)
		protected.POST("/workflows/dry-run", workflowHandler.DryRun)
		protected.POST("/workflows/generate-draft", workflowHandler.GenerateDraft)
		protected.GET("/workflows/:id/package", workflowHandler.ExportPackage)
		protected.POST("/workflow-package-inspections", workflowHandler.CreatePackageInspection)
		protected.GET("/workflow-package-inspections/:inspectionId", workflowHandler.GetPackageInspection)
		protected.POST("/workflow-package-imports", workflowHandler.ApplyPackageImport)
		protected.GET("/workflow-package-imports/:importId", workflowHandler.GetPackageImport)
		protected.GET("/workflows", workflowHandler.List)
		protected.GET("/workflows/:id", workflowHandler.Get)
		protected.POST("/workflows", workflowHandler.Create)
		protected.PUT("/workflows/:id", workflowHandler.Update)
		protected.DELETE("/workflows/:id", workflowHandler.Delete)

		// Skills management (specific paths must be registered before /skills/:name)
		protected.GET("/skills", skillsHandler.GetSkills)
		protected.GET("/skills/stats", skillsHandler.GetSkillStats)
		protected.DELETE("/skills/stats", skillsHandler.ClearSkillStats)
		protected.GET("/skills/:name/files", skillsHandler.ListSkillPackageFiles)
		protected.GET("/skills/:name/file", skillsHandler.GetSkillPackageFile)
		protected.PUT("/skills/:name/file", skillsHandler.PutSkillPackageFile)
		protected.GET("/skills/:name/bound-roles", skillsHandler.GetSkillBoundRoles)
		protected.POST("/skills", skillsHandler.CreateSkill)
		protected.PUT("/skills/:name", skillsHandler.UpdateSkill)
		protected.DELETE("/skills/:name", skillsHandler.DeleteSkill)
		protected.DELETE("/skills/:name/stats", skillsHandler.ClearSkillStatsByName)
		protected.GET("/skills/:name", skillsHandler.GetSkill)

		// MCP endpoint
		protected.POST("/mcp", func(c *gin.Context) {
			mcpServer.HandleHTTP(c.Writer, c.Request)
		})

		// OpenAPI result aggregation endpoint (optional; used to get the full result of a conversation)
		protected.GET("/conversations/:id/results", openAPIHandler.GetConversationResults)
	}

	// OpenAPI spec (requires authentication, to avoid exposing API structure information)
	protected.GET("/openapi/spec", openAPIHandler.GetOpenAPISpec)

	registerFrontendRoutes(router)
}

func registerFrontendRoutes(router *gin.Engine) {
	// An in-place upgrade can leave classic assets on disk.
	router.Static("/static/app", "./web/static/app")
	router.Static("/static/i18n", "./web/static/i18n")
	router.StaticFile("/static/favicon.ico", "./web/static/favicon.ico")
	router.StaticFile("/static/logo.png", "./web/static/logo.png")
	router.StaticFile("/static/site.webmanifest", "./web/static/site.webmanifest")
	router.GET("/", func(c *gin.Context) {
		c.Header("Cache-Control", "no-cache")
		c.File("./web/static/app/index.html")
	})
	router.GET("/classic", func(c *gin.Context) {
		// Browsers carry the original hash to a redirect without a fragment.
		c.Redirect(http.StatusFound, "/")
	})
	router.GET("/api-docs", func(c *gin.Context) {
		c.Redirect(http.StatusFound, "/#/api-docs")
	})
}

// registerWebshellTools registers WebShell-related MCP tools, so the AI assistant can run commands and file operations on the specified connections
func registerWebshellTools(mcpServer *mcp.Server, db *database.DB, webshellHandler *handler.WebShellHandler, logger *zap.Logger) {
	if db == nil || webshellHandler == nil {
		logger.Warn("Skipping WebShell tool registration: db or webshellHandler is nil")
		return
	}

	// webshell_exec
	execTool := mcp.Tool{
		Name:             builtin.ToolWebshellExec,
		Description:      "Run one system command on the specified WebShell connection and return its standard output. connection_id is chosen by the user in the AI assistant context.",
		ShortDescription: "Run a command on a WebShell connection",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{
					"type":        "string",
					"description": "WebShell connection ID (e.g. ws_xxx)",
				},
				"command": map[string]interface{}{
					"type":        "string",
					"description": "System command to run",
				},
			},
			"required": []string{"connection_id", "command"},
		},
	}
	execHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		cid, _ := args["connection_id"].(string)
		cmd, _ := args["command"].(string)
		if cid == "" || cmd == "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "connection_id and command are both required"}}, IsError: true}, nil
		}
		conn, err := db.GetWebshellConnection(cid)
		if err != nil || conn == nil {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "WebShell connection not found or query failed"}}, IsError: true}, nil
		}
		output, ok, errMsg := webshellHandler.ExecWithConnection(conn, cmd)
		if errMsg != "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: errMsg}}, IsError: true}, nil
		}
		if !ok {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "HTTP status is not 200, output:\n" + output}}, IsError: false}, nil
		}
		return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: output}}, IsError: false}, nil
	}
	mcpServer.RegisterTool(execTool, execHandler)

	// webshell_file_list
	listTool := mcp.Tool{
		Name:             builtin.ToolWebshellFileList,
		Description:      "List directory contents on the specified WebShell connection. path defaults to the current directory (.).",
		ShortDescription: "List a directory on a WebShell",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{"type": "string", "description": "WebShell connection ID"},
				"path":          map[string]interface{}{"type": "string", "description": "Directory path, default ."},
			},
			"required": []string{"connection_id"},
		},
	}
	listHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		cid, _ := args["connection_id"].(string)
		path, _ := args["path"].(string)
		if cid == "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "connection_id is required"}}, IsError: true}, nil
		}
		conn, err := db.GetWebshellConnection(cid)
		if err != nil || conn == nil {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "WebShell connection not found"}}, IsError: true}, nil
		}
		output, ok, errMsg := webshellHandler.FileOpWithConnection(conn, "list", path, "", "")
		if errMsg != "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: errMsg}}, IsError: true}, nil
		}
		return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: output}}, IsError: !ok}, nil
	}
	mcpServer.RegisterTool(listTool, listHandler)

	// webshell_file_read
	readTool := mcp.Tool{
		Name:             builtin.ToolWebshellFileRead,
		Description:      "Read file contents on the specified WebShell connection.",
		ShortDescription: "Read a file on a WebShell",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{"type": "string", "description": "WebShell connection ID"},
				"path":          map[string]interface{}{"type": "string", "description": "File path"},
			},
			"required": []string{"connection_id", "path"},
		},
	}
	readHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		cid, _ := args["connection_id"].(string)
		path, _ := args["path"].(string)
		if cid == "" || path == "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "connection_id 和 path 必填"}}, IsError: true}, nil
		}
		conn, err := db.GetWebshellConnection(cid)
		if err != nil || conn == nil {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "WebShell connection not found"}}, IsError: true}, nil
		}
		output, ok, errMsg := webshellHandler.FileOpWithConnection(conn, "read", path, "", "")
		if errMsg != "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: errMsg}}, IsError: true}, nil
		}
		return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: output}}, IsError: !ok}, nil
	}
	mcpServer.RegisterTool(readTool, readHandler)

	// webshell_file_write
	writeTool := mcp.Tool{
		Name:             builtin.ToolWebshellFileWrite,
		Description:      "在指定 WebShell 连接上写入文件内容（会覆盖已有文件）。",
		ShortDescription: "在 WebShell 上写入文件",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{"type": "string", "description": "WebShell connection ID"},
				"path":          map[string]interface{}{"type": "string", "description": "File path"},
				"content":       map[string]interface{}{"type": "string", "description": "要写入的内容"},
			},
			"required": []string{"connection_id", "path", "content"},
		},
	}
	writeHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		cid, _ := args["connection_id"].(string)
		path, _ := args["path"].(string)
		content, _ := args["content"].(string)
		if cid == "" || path == "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "connection_id 和 path 必填"}}, IsError: true}, nil
		}
		conn, err := db.GetWebshellConnection(cid)
		if err != nil || conn == nil {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "WebShell connection not found"}}, IsError: true}, nil
		}
		output, ok, errMsg := webshellHandler.FileOpWithConnection(conn, "write", path, content, "")
		if errMsg != "" {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: errMsg}}, IsError: true}, nil
		}
		if !ok {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "写入可能失败，输出:\n" + output}}, IsError: false}, nil
		}
		return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "写入成功\n" + output}}, IsError: false}, nil
	}
	mcpServer.RegisterTool(writeTool, writeHandler)

	logger.Debug("WebShell 工具注册成功")
}

// registerWebshellManagementTools registers the WebShell connection management MCP tools
func registerWebshellManagementTools(mcpServer *mcp.Server, db *database.DB, webshellHandler *handler.WebShellHandler, logger *zap.Logger) {
	if db == nil {
		logger.Warn("跳过 WebShell 管理工具注册：db 为空")
		return
	}
	projectIDFromToolArgs := func(ctx context.Context, args map[string]interface{}) string {
		projectID, _ := args["project_id"].(string)
		projectID = strings.TrimSpace(projectID)
		if projectID == "" {
			projectID = strings.TrimSpace(mcp.MCPProjectIDFromContext(ctx))
		}
		return projectID
	}
	explicitProjectIDFromToolArgs := func(args map[string]interface{}) string {
		projectID, _ := args["project_id"].(string)
		return strings.TrimSpace(projectID)
	}
	authorizeWebshellToolProject := func(principal authctx.Principal, permission, projectID string) *mcp.ToolResult {
		projectID = strings.TrimSpace(projectID)
		if projectID == "" {
			return nil
		}
		if projectID == database.ProjectFilterUnbound {
			return nil
		}
		if !db.UserCanAccessResource(principal.UserID, principal.ScopeFor(permission), "project", projectID) {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "无权访问项目: " + projectID}},
				IsError: true,
			}
		}
		return nil
	}

	// manage_webshell_list - list all webshell connections
	listTool := mcp.Tool{
		Name:             builtin.ToolManageWebshellList,
		Description:      "列出已保存的 WebShell 连接，返回连接ID、URL、类型、所属项目、备注等信息。默认按当前对话项目边界过滤：项目对话看本项目，未绑定项目的对话看未绑定连接；显式传 project_id 时按指定项目过滤。",
		ShortDescription: "列出所有 WebShell 连接",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"project_id": map[string]interface{}{
					"type":        "string",
					"description": "项目 ID；不填时在项目会话中默认使用当前项目。",
				},
			},
		},
	}
	listHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		connections := []database.WebShellConnection{}
		var err error
		if principal, ok := authctx.PrincipalFromContext(ctx); ok {
			projectID := explicitProjectIDFromToolArgs(args)
			if projectID == "" {
				projectID = mcpEffectiveProjectFilter(ctx, db)
			}
			if result := authorizeWebshellToolProject(principal, "webshell:read", projectID); result != nil {
				return result, nil
			}
			connections, err = db.ListWebshellConnectionsForAccess(principal.UserID, principal.ScopeFor("webshell:read"), projectID)
		} else {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "缺少认证身份"}}, IsError: true}, nil
		}
		if err != nil {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "获取连接列表失败: " + err.Error()}},
				IsError: true,
			}, nil
		}
		if len(connections) == 0 {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "暂无 WebShell 连接"}},
				IsError: false,
			}, nil
		}
		var sb strings.Builder
		sb.WriteString(fmt.Sprintf("找到 %d 个 WebShell 连接：\n\n", len(connections)))
		for _, conn := range connections {
			sb.WriteString(fmt.Sprintf("ID: %s\n", conn.ID))
			sb.WriteString(fmt.Sprintf("  URL: %s\n", conn.URL))
			sb.WriteString(fmt.Sprintf("  类型: %s\n", conn.Type))
			sb.WriteString(fmt.Sprintf("  请求方式: %s\n", conn.Method))
			sb.WriteString(fmt.Sprintf("  命令参数: %s\n", conn.CmdParam))
			if conn.ProjectID != "" {
				sb.WriteString(fmt.Sprintf("  项目ID: %s\n", conn.ProjectID))
			} else {
				sb.WriteString("  项目: 未绑定\n")
			}
			if conn.Remark != "" {
				sb.WriteString(fmt.Sprintf("  备注: %s\n", conn.Remark))
			}
			sb.WriteString(fmt.Sprintf("  创建时间: %s\n", conn.CreatedAt.Format("2006-01-02 15:04:05")))
			sb.WriteString("\n")
		}
		return &mcp.ToolResult{
			Content: []mcp.Content{{Type: "text", Text: sb.String()}},
			IsError: false,
		}, nil
	}
	mcpServer.RegisterTool(listTool, listHandler)

	// manage_webshell_add - add a new webshell connection
	addTool := mcp.Tool{
		Name:             builtin.ToolManageWebshellAdd,
		Description:      "添加新的 WebShell 连接到管理系统。支持 PHP、ASP、ASPX、JSP 等类型的一句话木马。",
		ShortDescription: "添加 WebShell 连接",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"url": map[string]interface{}{
					"type":        "string",
					"description": "Shell 地址，如 http://target.com/shell.php（必填）",
				},
				"password": map[string]interface{}{
					"type":        "string",
					"description": "连接密码/密钥，如冰蝎/蚁剑的连接密码",
				},
				"type": map[string]interface{}{
					"type":        "string",
					"description": "Shell 类型：php、asp、aspx、jsp，默认为 php",
					"enum":        []string{"php", "asp", "aspx", "jsp"},
				},
				"method": map[string]interface{}{
					"type":        "string",
					"description": "请求方式：GET 或 POST，默认为 POST",
					"enum":        []string{"GET", "POST"},
				},
				"cmd_param": map[string]interface{}{
					"type":        "string",
					"description": "命令参数名，不填默认为 cmd",
				},
				"remark": map[string]interface{}{
					"type":        "string",
					"description": "备注，便于识别的备注名",
				},
			},
			"required": []string{"url"},
		},
	}
	addHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		urlStr, _ := args["url"].(string)
		if urlStr == "" {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "错误: url 参数必填"}},
				IsError: true,
			}, nil
		}

		password, _ := args["password"].(string)
		shellType, _ := args["type"].(string)
		if shellType == "" {
			shellType = "php"
		}
		method, _ := args["method"].(string)
		if method == "" {
			method = "post"
		}
		cmdParam, _ := args["cmd_param"].(string)
		if cmdParam == "" {
			cmdParam = "cmd"
		}
		remark, _ := args["remark"].(string)
		principal, ok := authctx.PrincipalFromContext(ctx)
		if !ok {
			return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "缺少认证身份"}}, IsError: true}, nil
		}
		projectID := projectIDFromToolArgs(ctx, args)
		if result := authorizeWebshellToolProject(principal, "webshell:write", projectID); result != nil {
			return result, nil
		}

		// Generate connection ID
		connID := "ws_" + strings.ReplaceAll(uuid.New().String(), "-", "")[:12]
		conn := &database.WebShellConnection{
			ID:        connID,
			URL:       urlStr,
			Password:  password,
			Type:      strings.ToLower(shellType),
			Method:    strings.ToLower(method),
			CmdParam:  cmdParam,
			Remark:    remark,
			ProjectID: projectID,
			CreatedAt: time.Now(),
		}

		if err := db.CreateWebshellConnection(conn); err != nil {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "添加 WebShell 连接失败: " + err.Error()}},
				IsError: true,
			}, nil
		}
		_ = db.SetResourceOwner("webshell", conn.ID, principal.UserID)
		_ = db.AssignResourceToUser(principal.UserID, "webshell", conn.ID)
		projectLine := "项目: 未绑定"
		if conn.ProjectID != "" {
			projectLine = "项目ID: " + conn.ProjectID
		}

		return &mcp.ToolResult{
			Content: []mcp.Content{{
				Type: "text",
				Text: fmt.Sprintf("WebShell 连接添加成功！\n\n连接ID: %s\nURL: %s\n类型: %s\n请求方式: %s\n命令参数: %s\n%s", conn.ID, conn.URL, conn.Type, conn.Method, conn.CmdParam, projectLine),
			}},
			IsError: false,
		}, nil
	}
	mcpServer.RegisterTool(addTool, addHandler)

	// manage_webshell_update - update a webshell connection
	updateTool := mcp.Tool{
		Name:             builtin.ToolManageWebshellUpdate,
		Description:      "更新已存在的 WebShell 连接信息。",
		ShortDescription: "更新 WebShell 连接",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{
					"type":        "string",
					"description": "要更新的 WebShell 连接 ID（必填）",
				},
				"url": map[string]interface{}{
					"type":        "string",
					"description": "新的 Shell 地址",
				},
				"password": map[string]interface{}{
					"type":        "string",
					"description": "新的连接密码/密钥",
				},
				"type": map[string]interface{}{
					"type":        "string",
					"description": "新的 Shell 类型：php、asp、aspx、jsp",
					"enum":        []string{"php", "asp", "aspx", "jsp"},
				},
				"method": map[string]interface{}{
					"type":        "string",
					"description": "新的请求方式：GET 或 POST",
					"enum":        []string{"GET", "POST"},
				},
				"cmd_param": map[string]interface{}{
					"type":        "string",
					"description": "新的命令参数名",
				},
				"remark": map[string]interface{}{
					"type":        "string",
					"description": "新的备注",
				},
				"project_id": map[string]interface{}{
					"type":        "string",
					"description": "新的所属项目 ID；传空字符串可取消绑定。",
				},
			},
			"required": []string{"connection_id"},
		},
	}
	updateHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		connID, _ := args["connection_id"].(string)
		if connID == "" {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "错误: connection_id 参数必填"}},
				IsError: true,
			}, nil
		}

		// Get the existing connection
		existing, err := db.GetWebshellConnection(connID)
		if err != nil || existing == nil {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "未找到指定的 WebShell 连接: " + connID}},
				IsError: true,
			}, nil
		}

		// Update fields (if new values are provided)
		if urlStr, ok := args["url"].(string); ok && urlStr != "" {
			existing.URL = urlStr
		}
		if password, ok := args["password"].(string); ok {
			existing.Password = password
		}
		if shellType, ok := args["type"].(string); ok && shellType != "" {
			existing.Type = strings.ToLower(shellType)
		}
		if method, ok := args["method"].(string); ok && method != "" {
			existing.Method = strings.ToLower(method)
		}
		if cmdParam, ok := args["cmd_param"].(string); ok && cmdParam != "" {
			existing.CmdParam = cmdParam
		}
		if remark, ok := args["remark"].(string); ok {
			existing.Remark = remark
		}
		if projectID, ok := args["project_id"].(string); ok {
			projectID = strings.TrimSpace(projectID)
			if projectID != "" {
				principal, ok := authctx.PrincipalFromContext(ctx)
				if !ok {
					return &mcp.ToolResult{Content: []mcp.Content{{Type: "text", Text: "缺少认证身份"}}, IsError: true}, nil
				}
				if result := authorizeWebshellToolProject(principal, "webshell:write", projectID); result != nil {
					return result, nil
				}
			}
			existing.ProjectID = projectID
		}

		if err := db.UpdateWebshellConnection(existing); err != nil {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "更新 WebShell 连接失败: " + err.Error()}},
				IsError: true,
			}, nil
		}

		return &mcp.ToolResult{
			Content: []mcp.Content{{
				Type: "text",
				Text: fmt.Sprintf("WebShell 连接更新成功！\n\n连接ID: %s\nURL: %s\n类型: %s\n请求方式: %s\n命令参数: %s\n项目ID: %s\n备注: %s", existing.ID, existing.URL, existing.Type, existing.Method, existing.CmdParam, existing.ProjectID, existing.Remark),
			}},
			IsError: false,
		}, nil
	}
	mcpServer.RegisterTool(updateTool, updateHandler)

	// manage_webshell_delete - delete a webshell connection
	deleteTool := mcp.Tool{
		Name:             builtin.ToolManageWebshellDelete,
		Description:      "删除指定的 WebShell 连接。",
		ShortDescription: "删除 WebShell 连接",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{
					"type":        "string",
					"description": "要删除的 WebShell 连接 ID（必填）",
				},
			},
			"required": []string{"connection_id"},
		},
	}
	deleteHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		connID, _ := args["connection_id"].(string)
		if connID == "" {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "错误: connection_id 参数必填"}},
				IsError: true,
			}, nil
		}

		if err := db.DeleteWebshellConnection(connID); err != nil {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "删除 WebShell 连接失败: " + err.Error()}},
				IsError: true,
			}, nil
		}

		return &mcp.ToolResult{
			Content: []mcp.Content{{
				Type: "text",
				Text: fmt.Sprintf("WebShell 连接 %s 已成功删除", connID),
			}},
			IsError: false,
		}, nil
	}
	mcpServer.RegisterTool(deleteTool, deleteHandler)

	// manage_webshell_test - test a webshell connection
	testTool := mcp.Tool{
		Name:             builtin.ToolManageWebshellTest,
		Description:      "测试指定的 WebShell 连接是否可用，会尝试执行一个简单的命令（如 whoami 或 dir）。",
		ShortDescription: "测试 WebShell 连接",
		InputSchema: map[string]interface{}{
			"type": "object",
			"properties": map[string]interface{}{
				"connection_id": map[string]interface{}{
					"type":        "string",
					"description": "要测试的 WebShell 连接 ID（必填）",
				},
				"command": map[string]interface{}{
					"type":        "string",
					"description": "测试命令，默认为 whoami（Linux）或 dir（Windows）",
				},
			},
			"required": []string{"connection_id"},
		},
	}
	testHandler := func(ctx context.Context, args map[string]interface{}) (*mcp.ToolResult, error) {
		connID, _ := args["connection_id"].(string)
		if connID == "" {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "错误: connection_id 参数必填"}},
				IsError: true,
			}, nil
		}

		// Get connection
		conn, err := db.GetWebshellConnection(connID)
		if err != nil || conn == nil {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: "未找到指定的 WebShell 连接: " + connID}},
				IsError: true,
			}, nil
		}

		// Determine the test command
		testCmd, _ := args["command"].(string)
		if testCmd == "" {
			// Choose the default command based on the shell type
			if conn.Type == "asp" || conn.Type == "aspx" {
				testCmd = "dir"
			} else {
				testCmd = "whoami"
			}
		}

		// Run the test command
		output, ok, errMsg := webshellHandler.ExecWithConnection(conn, testCmd)
		if errMsg != "" {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: fmt.Sprintf("连接测试失败！\n\n连接ID: %s\nURL: %s\n错误: %s", connID, conn.URL, errMsg)}},
				IsError: true,
			}, nil
		}

		if !ok {
			return &mcp.ToolResult{
				Content: []mcp.Content{{Type: "text", Text: fmt.Sprintf("连接测试失败！HTTP 非 200\n\n连接ID: %s\nURL: %s\n输出: %s", connID, conn.URL, output)}},
				IsError: true,
			}, nil
		}

		return &mcp.ToolResult{
			Content: []mcp.Content{{
				Type: "text",
				Text: fmt.Sprintf("连接测试成功！\n\n连接ID: %s\nURL: %s\n类型: %s\n\n测试命令: %s\n输出结果:\n%s", connID, conn.URL, conn.Type, testCmd, output),
			}},
			IsError: false,
		}, nil
	}
	mcpServer.RegisterTool(testTool, testHandler)

	logger.Debug("WebShell 管理工具注册成功")
}

// initializeKnowledge initializes the knowledge base components (for dynamic initialization)
func initializeKnowledge(
	cfg *config.Config,
	db *database.DB,
	knowledgeDBConn *database.DB,
	mcpServer *mcp.Server,
	agentHandler *handler.AgentHandler,
	app *App, // Pass the App reference so the knowledge base components can be updated
	logger *zap.Logger,
) (*handler.KnowledgeHandler, error) {
	// Determine knowledge base database path
	knowledgeDBPath := cfg.Database.KnowledgeDBPath
	var knowledgeDB *sql.DB

	if knowledgeDBPath != "" {
		// Use a separate knowledge base database
		// Ensure directory exists
		if err := os.MkdirAll(filepath.Dir(knowledgeDBPath), 0755); err != nil {
			return nil, fmt.Errorf("Failed to create knowledge base database directory: %w", err)
		}

		var err error
		knowledgeDBConn, err = database.NewKnowledgeDB(knowledgeDBPath, logger)
		if err != nil {
			return nil, fmt.Errorf("Failed to initialize knowledge base database: %w", err)
		}
		knowledgeDB = knowledgeDBConn.DB
		logger.Info("Using a separate knowledge base database", zap.String("path", knowledgeDBPath))
	} else {
		// Backward compatibility: use the session database
		knowledgeDB = db.DB
		logger.Info("Using the session database to store knowledge base data (configure knowledge_db_path to separate the data)")
	}

	// Create knowledge base manager
	knowledgeManager := knowledge.NewManager(knowledgeDB, cfg.Knowledge.BasePath, logger)

	// Create embedder
	// Use the OpenAI config API Key (if not specified in the knowledge base config)
	if cfg.Knowledge.Embedding.APIKey == "" {
		cfg.Knowledge.Embedding.APIKey = cfg.OpenAI.APIKey
	}
	if cfg.Knowledge.Embedding.BaseURL == "" {
		cfg.Knowledge.Embedding.BaseURL = cfg.OpenAI.BaseURL
	}

	embedder, err := knowledge.NewEmbedder(context.Background(), &cfg.Knowledge, &cfg.OpenAI, logger)
	if err != nil {
		return nil, fmt.Errorf("Failed to initialize knowledge base embedder: %w", err)
	}

	// Create retriever (Agent MultiQuery + rerank pipeline)
	retrievalConfig := knowledge.RetrievalConfigFromYAML(cfg.Knowledge.Retrieval)
	knowledgeRetriever := knowledge.NewRetriever(knowledgeDB, embedder, retrievalConfig, logger)
	if err := knowledge.WireRetrieverPipeline(context.Background(), knowledgeRetriever, &cfg.OpenAI); err != nil {
		return nil, fmt.Errorf("Failed to initialize knowledge base retrieval pipeline: %w", err)
	}

	// Create indexer (Agent Compose chain)
	knowledgeIndexer, err := knowledge.NewIndexer(context.Background(), knowledgeDB, embedder, logger, &cfg.Knowledge)
	if err != nil {
		return nil, fmt.Errorf("Failed to initialize knowledge base indexer: %w", err)
	}

	// Register the knowledge retrieval tool with the MCP server
	knowledge.RegisterKnowledgeTool(mcpServer, knowledgeRetriever, knowledgeManager, logger)

	// Create knowledge base API handler
	knowledgeHandler := handler.NewKnowledgeHandler(knowledgeManager, knowledgeRetriever, knowledgeIndexer, db, logger)
	if app != nil && app.auditSvc != nil {
		knowledgeHandler.SetAudit(app.auditSvc)
	}
	logger.Info("Knowledge base module initialized", zap.Bool("handler_created", knowledgeHandler != nil))

	// Set the knowledge base manager on AgentHandler so retrieval logs can be recorded
	agentHandler.SetKnowledgeManager(knowledgeManager)

	// Update the knowledge base components in the App (if App is not nil, this is a dynamic initialization)
	if app != nil {
		app.knowledgeManager = knowledgeManager
		app.knowledgeRetriever = knowledgeRetriever
		app.knowledgeIndexer = knowledgeIndexer
		app.knowledgeHandler = knowledgeHandler
		// If using a separate database, update knowledgeDB
		if knowledgeDBPath != "" {
			app.knowledgeDB = knowledgeDBConn
		}
		logger.Info("App 中的知识库组件已更新")
	}

	// Scan the knowledge base and build the index (async)
	go func() {
		itemsToIndex, err := knowledgeManager.ScanKnowledgeBase()
		if err != nil {
			logger.Warn("Failed to scan the knowledge base", zap.Error(err))
			return
		}

		// Check whether an index already exists
		hasIndex, err := knowledgeIndexer.HasIndex()
		if err != nil {
			logger.Warn("Failed to check index status", zap.Error(err))
			return
		}

		if hasIndex {
			// If an index already exists, only index newly added or updated items
			if len(itemsToIndex) > 0 {
				logger.Info("Existing knowledge base index detected, starting incremental indexing", zap.Int("count", len(itemsToIndex)))
				ctx := context.Background()
				consecutiveFailures := 0
				var firstFailureItemID string
				var firstFailureError error
				failedCount := 0

				for _, itemID := range itemsToIndex {
					if err := knowledgeIndexer.IndexItem(ctx, itemID); err != nil {
						failedCount++
						consecutiveFailures++

						if consecutiveFailures == 1 {
							firstFailureItemID = itemID
							firstFailureError = err
							logger.Warn("Failed to index knowledge item", zap.String("itemId", itemID), zap.Error(err))
						}

						// If it fails 2 times in a row, stop incremental indexing immediately
						if consecutiveFailures >= 2 {
							logger.Error("Too many consecutive indexing failures, stopping incremental indexing immediately",
								zap.Int("consecutiveFailures", consecutiveFailures),
								zap.Int("totalItems", len(itemsToIndex)),
								zap.String("firstFailureItemId", firstFailureItemID),
								zap.Error(firstFailureError),
							)
							break
						}
						continue
					}

					// Reset the consecutive failure count on success
					if consecutiveFailures > 0 {
						consecutiveFailures = 0
						firstFailureItemID = ""
						firstFailureError = nil
					}
				}
				logger.Info("Incremental indexing complete", zap.Int("totalItems", len(itemsToIndex)), zap.Int("failedCount", failedCount))
			} else {
				logger.Info("Existing knowledge base index detected, no new or updated items to index")
			}
			return
		}

		// Cold start: only build indexes for knowledge items that do not have vectors yet (consistent with IndexMissing semantics)
		logger.Info("No knowledge base index detected, starting automatic index build")
		ctx := context.Background()
		if err := knowledgeIndexer.IndexMissing(ctx); err != nil {
			logger.Warn("Failed to automatically build the knowledge base index", zap.Error(err))
		}
	}()

	return knowledgeHandler, nil
}

// corsMiddleware allows same-origin requests, valid Chromium extension
// origins, and exact origins explicitly configured by the operator. CORS is
// not an authentication boundary; API access still requires a valid session.
func corsMiddleware(configuredOrigins []string) gin.HandlerFunc {
	allowedOrigins := make(map[string]struct{}, len(configuredOrigins))
	for _, origin := range configuredOrigins {
		if normalized, ok := normalizeCORSOrigin(origin); ok {
			allowedOrigins[normalized] = struct{}{}
		}
	}

	return func(c *gin.Context) {
		origin := strings.TrimSpace(c.GetHeader("Origin"))
		if origin != "" {
			c.Writer.Header().Add("Vary", "Origin")
			normalized, valid := normalizeCORSOrigin(origin)
			_, explicitlyAllowed := allowedOrigins[normalized]
			parsed, _ := url.Parse(origin)
			sameHost := valid && strings.EqualFold(parsed.Host, c.Request.Host)
			browserExtension := valid && isChromiumExtensionOrigin(parsed)
			if !sameHost && !browserExtension && !explicitlyAllowed {
				c.AbortWithStatusJSON(http.StatusForbidden, gin.H{"error": "cross-origin request denied"})
				return
			}
			c.Writer.Header().Set("Access-Control-Allow-Origin", origin)
			c.Writer.Header().Set("Access-Control-Allow-Credentials", "true")
		}
		c.Writer.Header().Set("Access-Control-Allow-Headers", "Content-Type, Content-Length, Accept-Encoding, X-CSRF-Token, Authorization, accept, origin, Cache-Control, X-Requested-With")
		c.Writer.Header().Set("Access-Control-Allow-Methods", "POST, OPTIONS, GET, PUT, DELETE")
		c.Writer.Header().Set("Access-Control-Max-Age", "600")

		if c.Request.Method == "OPTIONS" {
			c.AbortWithStatus(204)
			return
		}

		c.Next()
	}
}

// isChromiumExtensionOrigin accepts only Chrome's canonical 32-character
// extension IDs (letters a-p). It does not allow arbitrary custom schemes or
// web origins, and the extension must separately obtain host permission.
func isChromiumExtensionOrigin(origin *url.URL) bool {
	if origin == nil || !strings.EqualFold(origin.Scheme, "chrome-extension") || origin.Port() != "" {
		return false
	}
	id := strings.ToLower(origin.Hostname())
	if len(id) != 32 {
		return false
	}
	for _, ch := range id {
		if ch < 'a' || ch > 'p' {
			return false
		}
	}
	return true
}

// normalizeCORSOrigin validates and canonicalizes a serialized origin. CORS
// origins never contain credentials, paths, query strings, or fragments.
func normalizeCORSOrigin(raw string) (string, bool) {
	raw = strings.TrimSpace(raw)
	if raw == "" || raw == "*" || strings.EqualFold(raw, "null") {
		return "", false
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Scheme == "" || parsed.Host == "" || parsed.User != nil ||
		(parsed.Path != "" && parsed.Path != "/") || parsed.RawQuery != "" || parsed.Fragment != "" {
		return "", false
	}
	return strings.ToLower(parsed.Scheme) + "://" + strings.ToLower(parsed.Host), true
}
