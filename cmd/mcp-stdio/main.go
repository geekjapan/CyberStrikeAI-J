package main

import (
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/logger"
	"cyberstrike-ai/internal/mcp"
	"cyberstrike-ai/internal/security"
	"cyberstrike-ai/internal/toolguard"
	"flag"
	"fmt"
	"os"

	"go.uber.org/zap"
)

func main() {
	var configPath = flag.String("config", "config.yaml", "Path to the configuration file")
	flag.Parse()

	// Load config
	cfg, err := config.Load(*configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to load configuration: %v\n", err)
		os.Exit(1)
	}

	// Initialize logging (in stdio mode, logs go to stderr to avoid interfering with JSON-RPC communication)
	log := logger.New(cfg.Log.Level, "stderr", logger.DiagnosticOptions{
		Dir:           cfg.Log.DiagnosticDir,
		Disabled:      cfg.Log.DiagnosticDisabled,
		RetentionDays: cfg.Log.DiagnosticRetentionDays,
	})
	defer log.Sync()

	// Create MCP server
	mcpServer := mcp.NewServer(log.Logger)
	guard, err := toolguard.NewManager(cfg.EffectiveToolGuard())
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to initialize call interception: %v\n", err)
		os.Exit(1)
	}
	mcpServer.SetToolGuard(guard)

	// Create security tool executor
	executor := security.NewExecutor(&cfg.Security, mcpServer, log.Logger)

	// Register tools
	executor.RegisterTools(mcpServer)
	mcp.RegisterExecutionControlTools(mcpServer, nil)

	log.Logger.Info("MCP server (stdio mode) started, waiting for messages...")

	// Run stdio loop
	if err := mcpServer.HandleStdio(); err != nil {
		log.Logger.Error("MCP server failed to run", zap.Error(err))
		os.Exit(1)
	}
}
