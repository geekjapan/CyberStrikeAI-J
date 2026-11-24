package config

import (
	"crypto/rand"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io/fs"
	"net/url"
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"strconv"
	"strings"

	"cyberstrike-ai/internal/termout"
	"cyberstrike-ai/internal/toolguard"

	"gopkg.in/yaml.v3"
)

type Config struct {
	Version      string                `yaml:"version,omitempty" json:"version,omitempty"` // Version number shown in the frontend, e.g. v1.3.3
	Server       ServerConfig          `yaml:"server"`
	Log          LogConfig             `yaml:"log"`
	MCP          MCPConfig             `yaml:"mcp"`
	AI           AIConfig              `yaml:"ai,omitempty" json:"ai,omitempty"`
	OpenAI       OpenAIConfig          `yaml:"openai,omitempty" json:"openai,omitempty"`
	FOFA         FofaConfig            `yaml:"fofa,omitempty" json:"fofa,omitempty"`
	ZoomEye      SpaceSearchConfig     `yaml:"zoomeye,omitempty" json:"zoomeye,omitempty"`
	Quake        SpaceSearchConfig     `yaml:"quake,omitempty" json:"quake,omitempty"`
	Shodan       SpaceSearchConfig     `yaml:"shodan,omitempty" json:"shodan,omitempty"`
	Agent        AgentConfig           `yaml:"agent"`
	AgentRuntime AgentRuntimeConfig    `yaml:"agent_runtime,omitempty" json:"agent_runtime,omitempty"`
	Hitl         HitlConfig            `yaml:"hitl,omitempty" json:"hitl,omitempty"`
	ToolGuard    *toolguard.Config     `yaml:"tool_guard,omitempty" json:"tool_guard,omitempty"`
	Security     SecurityConfig        `yaml:"security"`
	Database     DatabaseConfig        `yaml:"database"`
	Auth         AuthConfig            `yaml:"auth"`
	Audit        AuditConfig           `yaml:"audit,omitempty" json:"audit,omitempty"`
	Monitor      MonitorConfig         `yaml:"monitor,omitempty" json:"monitor,omitempty"`
	Storage      StorageConfig         `yaml:"storage,omitempty" json:"storage,omitempty"`
	ExternalMCP  ExternalMCPConfig     `yaml:"external_mcp,omitempty"`
	Knowledge    KnowledgeConfig       `yaml:"knowledge,omitempty"`
	C2           C2Config              `yaml:"c2,omitempty" json:"c2,omitempty"`                 // Master switch for the built-in C2; enabled by default when not configured
	Robots       RobotsConfig          `yaml:"robots,omitempty" json:"robots,omitempty"`         // Bot configuration for WeCom/DingTalk/Lark, etc.
	RolesDir     string                `yaml:"roles_dir,omitempty" json:"roles_dir,omitempty"`   // Role configuration file directory (new approach)
	Roles        map[string]RoleConfig `yaml:"roles,omitempty" json:"roles,omitempty"`           // Backward compatibility: allow roles to be defined in the main configuration file
	SkillsDir    string                `yaml:"skills_dir,omitempty" json:"skills_dir,omitempty"` // Skills configuration file directory
	AgentsDir    string                `yaml:"agents_dir,omitempty" json:"agents_dir,omitempty"` // Multi-agent sub-agent Markdown definition directory (*.md, YAML front matter)
	MultiAgent   MultiAgentConfig      `yaml:"multi_agent,omitempty" json:"multi_agent,omitempty"`
	Project      ProjectConfig         `yaml:"project,omitempty" json:"project,omitempty"`
	Vision       VisionConfig          `yaml:"vision,omitempty" json:"vision,omitempty"`
	Update       UpdateConfig          `yaml:"update,omitempty" json:"update,omitempty"`
}

// UpdateConfig is the update source for one-click update (optional): a repository URL; updates follow that repository's default branch.
// Leave empty for the official repository (internal/update.DefaultRepoURL); to follow a mirror or your own fork, change only this one setting.
type UpdateConfig struct {
	// Repo is the update source repository URL (https/http/ssh/git/file:// or a local absolute path); empty = official repository.
	Repo string `yaml:"repo,omitempty" json:"repo,omitempty"`
}

type EnsureLocalConfigResult struct {
	Created     bool
	ExamplePath string
}

const (
	DefaultMaxCompletionTokens                        = 16384
	DefaultSummarizationUserIntentLedgerMaxRunes      = 96000
	DefaultSummarizationUserIntentLedgerEntryMaxRunes = 16000
	DefaultLatestUserMessageMaxRunes                  = 48000
	DefaultLatestUserMessageHeadRunes                 = 24000
	DefaultLatestUserMessageTailRunes                 = 24000
	DefaultSummarizationOutputReserveTokens           = 40960
)

// ProjectConfig is the project blackboard (facts shared across conversations) configuration.
type ProjectConfig struct {
	ContextCheckpoints      *bool  `yaml:"context_checkpoints,omitempty" json:"context_checkpoints,omitempty"`
	Enabled                 bool   `yaml:"enabled" json:"enabled"`
	DefaultProjectID        string `yaml:"default_project_id,omitempty" json:"default_project_id,omitempty"` // Default project bound when a bot, batch task, etc. has no explicit project
	FactIndexMaxRunes       int    `yaml:"fact_index_max_runes,omitempty" json:"fact_index_max_runes,omitempty"`
	FactIndexPathMaxRunes   int    `yaml:"fact_index_path_max_runes,omitempty" json:"fact_index_path_max_runes,omitempty"`
	FactSummaryMaxRunes     int    `yaml:"fact_summary_max_runes,omitempty" json:"fact_summary_max_runes,omitempty"`
	DefaultInjectDeprecated bool   `yaml:"default_inject_deprecated,omitempty" json:"default_inject_deprecated,omitempty"`
}

// ContextCheckpointsEnabled persists generated continuation notes on compaction.
func (c ProjectConfig) ContextCheckpointsEnabled() bool {
	return c.ContextCheckpoints == nil || *c.ContextCheckpoints
}

// FactIndexMaxRunesEffective is the maximum number of runes in the automatically injected blackboard index.
func (c ProjectConfig) FactIndexMaxRunesEffective() int {
	if c.FactIndexMaxRunes <= 0 {
		// Sized for the English protocol text that shares this budget.
		return 8000
	}
	return c.FactIndexMaxRunes
}

// FactIndexPathMaxRunesEffective is the maximum number of runes in the attack path overview section (reserved from the fact_index_max_runes budget).
func (c ProjectConfig) FactIndexPathMaxRunesEffective() int {
	if c.FactIndexPathMaxRunes <= 0 {
		return 1000
	}
	return c.FactIndexPathMaxRunes
}

// FactSummaryMaxRunesEffective is the maximum number of runes in a summary on upsert (one line of the index; should include verification points).
func (c ProjectConfig) FactSummaryMaxRunesEffective() int {
	if c.FactSummaryMaxRunes <= 0 {
		return 200
	}
	return c.FactSummaryMaxRunes
}

// MultiAgentConfig is multi-agent orchestration based on Pi adk/prebuilt (deep | plan_execute | supervisor).
type MultiAgentConfig struct {
	Enabled               bool   `yaml:"enabled" json:"enabled"`
	RobotDefaultAgentMode string `yaml:"robot_default_agent_mode,omitempty" json:"robot_default_agent_mode,omitempty"` // single | deep | plan_execute | supervisor
	BatchUseMultiAgent    bool   `yaml:"batch_use_multi_agent" json:"batch_use_multi_agent"`                           // When true, each sub-task in the batch task queue runs through the multi-agent Agent
	// Orchestration is deprecated: kept only for compatibility with old config.yaml; orchestration is decided by the orchestration field in the chat/WebShell request body, and defaults to deep when not provided.
	Orchestration string `yaml:"orchestration,omitempty" json:"orchestration,omitempty"`
	// MaxIteration is deprecated: use agent.max_iterations everywhere (the YAML field is kept only for compatibility with old configurations and is not read at runtime).
	MaxIteration int `yaml:"max_iteration,omitempty" json:"max_iteration,omitempty"`
	// PlanExecuteLoopMaxIterations is the upper limit of the outer execute<->replan loop in plan_execute mode; 0 means use the Agent default of 10.
	PlanExecuteLoopMaxIterations int `yaml:"plan_execute_loop_max_iterations,omitempty" json:"plan_execute_loop_max_iterations,omitempty"`
	// SubAgentMaxIterations is deprecated: both sub-agents and the main agent use agent.max_iterations (Markdown max_iterations>0 can override it).
	SubAgentMaxIterations   int    `yaml:"sub_agent_max_iterations,omitempty" json:"sub_agent_max_iterations,omitempty"`
	WithoutGeneralSubAgent  bool   `yaml:"without_general_sub_agent" json:"without_general_sub_agent"`
	WithoutWriteTodos       bool   `yaml:"without_write_todos" json:"without_write_todos"`
	OrchestratorInstruction string `yaml:"orchestrator_instruction" json:"orchestrator_instruction"`
	// OrchestratorInstructionPlanExecute is the system prompt for the plan_execute main agent (planning side); takes effect when it is non-empty and the body of agents/orchestrator-plan-execute.md is empty or the file does not exist. Not to be mixed with Deep's orchestrator_instruction.
	OrchestratorInstructionPlanExecute string `yaml:"orchestrator_instruction_plan_execute,omitempty" json:"orchestrator_instruction_plan_execute,omitempty"`
	// OrchestratorInstructionSupervisor is the system prompt for the supervisor main agent (the transfer/exit instructions are still appended at run time); takes effect when it is non-empty and the body of agents/orchestrator-supervisor.md is empty or the file does not exist.
	OrchestratorInstructionSupervisor string                `yaml:"orchestrator_instruction_supervisor,omitempty" json:"orchestrator_instruction_supervisor,omitempty"`
	SubAgents                         []MultiAgentSubConfig `yaml:"sub_agents" json:"sub_agents"`
	// SubAgentUserContextMaxRunes caps user-context supplement for sub-agent task descriptions.
	// 0 (default) preserves all user turns verbatim; >0 caps total runes; negative disables injection.
	SubAgentUserContextMaxRunes int `yaml:"sub_agent_user_context_max_runes,omitempty" json:"sub_agent_user_context_max_runes,omitempty"`
	// Skills configures native skill loading + optional local filesystem/execute on DeepAgent.
	Skills AgentSkillsConfig `yaml:"skills,omitempty" json:"skills,omitempty"`
	// Runtime wires native tool discovery, task boards, output budgeting and model resilience.
	Runtime AgentTuningConfig `yaml:"runtime,omitempty" json:"runtime,omitempty"`
}

// SubAgentUserContextMaxRunesEffective returns max runes for sub-agent task supplement; 0 = unlimited; negative = disabled.
func (c MultiAgentConfig) SubAgentUserContextMaxRunesEffective() int {
	return c.SubAgentUserContextMaxRunes
}

// AgentTuningConfig optional Pi middleware and Deep / supervisor tuning.
type AgentTuningConfig struct {
	// PatchToolCalls inserts placeholder tool results for dangling assistant tool_calls (nil = enabled).
	PatchToolCalls *bool `yaml:"patch_tool_calls,omitempty" json:"patch_tool_calls,omitempty"`
	// ToolSearch enables dynamictool/toolsearch: hide tail tools until model calls tool_search (reduces prompt tools).
	ToolSearchEnable        bool `yaml:"tool_search_enable,omitempty" json:"tool_search_enable,omitempty"`
	ToolSearchMinTools      int  `yaml:"tool_search_min_tools,omitempty" json:"tool_search_min_tools,omitempty"`           // default 20; applies when len(tools) >= this
	ToolSearchAlwaysVisible int  `yaml:"tool_search_always_visible,omitempty" json:"tool_search_always_visible,omitempty"` // default 12; first N tools stay always visible
	// ToolSearchAlwaysVisibleTools keeps specified tool names always visible (never hidden by tool_search).
	ToolSearchAlwaysVisibleTools []string `yaml:"tool_search_always_visible_tools,omitempty" json:"tool_search_always_visible_tools,omitempty"`
	// ToolSearchIncludeBuiltins keeps backend builtin tools always visible (nil = true).
	ToolSearchIncludeBuiltins *bool `yaml:"tool_search_include_builtins,omitempty" json:"tool_search_include_builtins,omitempty"`
	// Plantask adds TaskCreate/Get/Update/List (file-backed under skills dir); requires skills and its configured directory.
	PlantaskEnable bool `yaml:"plantask_enable,omitempty" json:"plantask_enable,omitempty"`
	// PlantaskRelDir relative to skills_dir for per-conversation task boards (default .pi/plantask).
	PlantaskRelDir string `yaml:"plantask_rel_dir,omitempty" json:"plantask_rel_dir,omitempty"`
	// Reduction truncates/offloads large tool outputs (uses the host output store).
	ReductionEnable            bool     `yaml:"reduction_enable,omitempty" json:"reduction_enable,omitempty"`
	ReductionRootDir           string   `yaml:"reduction_root_dir,omitempty" json:"reduction_root_dir,omitempty"`                         // Non-empty: root directory for persisting to disk (default tmp/reduction); isolated under it by projects/{id} or conversations/{id}
	ReductionMaxLengthForTrunc int      `yaml:"reduction_max_length_for_trunc,omitempty" json:"reduction_max_length_for_trunc,omitempty"` // default 12000
	ReductionMaxTokensForClear int      `yaml:"reduction_max_tokens_for_clear,omitempty" json:"reduction_max_tokens_for_clear,omitempty"` // default 50000
	ReductionClearExclude      []string `yaml:"reduction_clear_exclude,omitempty" json:"reduction_clear_exclude,omitempty"`
	ReductionSubAgents         bool     `yaml:"reduction_sub_agents,omitempty" json:"reduction_sub_agents,omitempty"` // also attach to sub-agents
	// SummarizationTriggerRatio controls summarization trigger threshold as max_total_tokens * ratio (default 0.8).
	SummarizationTriggerRatio float64 `yaml:"summarization_trigger_ratio,omitempty" json:"summarization_trigger_ratio,omitempty"`
	// SummarizationOutputReserveTokens reserves completion headroom for the summarization model call (default 40960).
	SummarizationOutputReserveTokens int `yaml:"summarization_output_reserve_tokens,omitempty" json:"summarization_output_reserve_tokens,omitempty"`
	// SummarizationEmitInternalEvents controls middleware internal event emission (default true).
	SummarizationEmitInternalEvents *bool `yaml:"summarization_emit_internal_events,omitempty" json:"summarization_emit_internal_events,omitempty"`
	// SummarizationUserIntentLedgerMaxRunes caps the DB-backed immutable user input ledger injected into model context.
	SummarizationUserIntentLedgerMaxRunes int `yaml:"summarization_user_intent_ledger_max_runes,omitempty" json:"summarization_user_intent_ledger_max_runes,omitempty"`
	// SummarizationUserIntentLedgerEntryMaxRunes caps each user message entry inside the immutable user input ledger.
	SummarizationUserIntentLedgerEntryMaxRunes int `yaml:"summarization_user_intent_ledger_entry_max_runes,omitempty" json:"summarization_user_intent_ledger_entry_max_runes,omitempty"`
	// LatestUserMessageMaxRunes caps the current user turn inserted into model context; full text is persisted as an artifact when capped.
	LatestUserMessageMaxRunes int `yaml:"latest_user_message_max_runes,omitempty" json:"latest_user_message_max_runes,omitempty"`
	// LatestUserMessageHeadRunes keeps the head preview for an oversized current user turn.
	LatestUserMessageHeadRunes int `yaml:"latest_user_message_head_runes,omitempty" json:"latest_user_message_head_runes,omitempty"`
	// LatestUserMessageTailRunes keeps the tail preview for an oversized current user turn.
	LatestUserMessageTailRunes int `yaml:"latest_user_message_tail_runes,omitempty" json:"latest_user_message_tail_runes,omitempty"`
	// SummarizationRetryMaxAttempts is deprecated: summarization and the Agent's native ModelRetry share model_retry_max_retries and isAgentTransientRunError.
	SummarizationRetryMaxAttempts int `yaml:"summarization_retry_max_attempts,omitempty" json:"summarization_retry_max_attempts,omitempty"`
	// PlanExecuteUserInputBudgetRatio caps planner/replanner/executor userInput prompt budget ratio (default 0.35).
	PlanExecuteUserInputBudgetRatio float64 `yaml:"plan_execute_user_input_budget_ratio,omitempty" json:"plan_execute_user_input_budget_ratio,omitempty"`
	// PlanExecuteExecutedStepsBudgetRatio caps executed_steps prompt budget ratio (default 0.2).
	PlanExecuteExecutedStepsBudgetRatio float64 `yaml:"plan_execute_executed_steps_budget_ratio,omitempty" json:"plan_execute_executed_steps_budget_ratio,omitempty"`
	// PlanExecuteMaxStepResultRunes caps each executed step result length for prompt view (default 4000).
	PlanExecuteMaxStepResultRunes int `yaml:"plan_execute_max_step_result_runes,omitempty" json:"plan_execute_max_step_result_runes,omitempty"`
	// PlanExecuteKeepLastSteps keeps only the tail steps in prompt view (default 8).
	PlanExecuteKeepLastSteps int `yaml:"plan_execute_keep_last_steps,omitempty" json:"plan_execute_keep_last_steps,omitempty"`
	// CheckpointDir is retained for config compatibility. Chat agent runs do
	// not consume it; cross-turn recovery is centralized in conversations.last_react_*.
	CheckpointDir string `yaml:"checkpoint_dir,omitempty" json:"checkpoint_dir,omitempty"`
	// DeepOutputKey passed to deep.Config OutputKey (session final text); empty = off.
	DeepOutputKey string `yaml:"deep_output_key,omitempty" json:"deep_output_key,omitempty"`
	// DeepModelRetryMaxRetries is deprecated: use model_retry_max_retries; the field is kept only for compatibility with old configurations.
	DeepModelRetryMaxRetries int `yaml:"deep_model_retry_max_retries,omitempty" json:"deep_model_retry_max_retries,omitempty"`
	// ModelRetryMaxRetries configures Pi native ChatModel retry attempts; 0=default 4.
	ModelRetryMaxRetries int `yaml:"model_retry_max_retries,omitempty" json:"model_retry_max_retries,omitempty"`
	// ModelRetryMaxBackoffSec caps native model retry backoff seconds; 0=default 30.
	ModelRetryMaxBackoffSec int `yaml:"model_retry_max_backoff_sec,omitempty" json:"model_retry_max_backoff_sec,omitempty"`
	// ModelFailoverChannels lists ai.channels IDs to try after native model retry is exhausted.
	ModelFailoverChannels []string `yaml:"model_failover_channels,omitempty" json:"model_failover_channels,omitempty"`
	// ModelFailoverMaxRetries caps distinct failover channel attempts; 0=all configured failover channels.
	ModelFailoverMaxRetries int `yaml:"model_failover_max_retries,omitempty" json:"model_failover_max_retries,omitempty"`
	// RunRetryMaxAttempts is deprecated: transient model errors are handled by the Agent's native ModelRetry; kept only as a fallback for the non-model-layer run loop and for the legacy summarization field.
	RunRetryMaxAttempts int `yaml:"run_retry_max_attempts,omitempty" json:"run_retry_max_attempts,omitempty"`
	// RunRetryMaxBackoffSec is deprecated: use model_retry_max_backoff_sec; kept only as a fallback for the non-model-layer run loop and for the legacy summarization field.
	RunRetryMaxBackoffSec int `yaml:"run_retry_max_backoff_sec,omitempty" json:"run_retry_max_backoff_sec,omitempty"`
	// EmptyResponseContinueMaxAttempts is the number of backoff continuation attempts at the Handler layer when a Run succeeds but no assistant body was captured; 0 = default 5.
	EmptyResponseContinueMaxAttempts int `yaml:"empty_response_continue_max_attempts,omitempty" json:"empty_response_continue_max_attempts,omitempty"`
	// TaskToolDescriptionPrefix when non-empty sets deep.Config TaskToolDescriptionGenerator (sub-agent names appended).
	TaskToolDescriptionPrefix string `yaml:"task_tool_description_prefix,omitempty" json:"task_tool_description_prefix,omitempty"`
}

func (c AgentTuningConfig) SummarizationTriggerRatioEffective() float64 {
	v := c.SummarizationTriggerRatio
	if v <= 0 {
		return 0.8
	}
	if v < 0.5 {
		return 0.5
	}
	if v > 0.95 {
		return 0.95
	}
	return v
}

func (c AgentTuningConfig) SummarizationOutputReserveTokensEffective() int {
	if c.SummarizationOutputReserveTokens > 0 {
		return c.SummarizationOutputReserveTokens
	}
	return DefaultSummarizationOutputReserveTokens
}

func (c AgentTuningConfig) SummarizationEmitInternalEventsEffective() bool {
	if c.SummarizationEmitInternalEvents != nil {
		return *c.SummarizationEmitInternalEvents
	}
	return true
}

func (c AgentTuningConfig) SummarizationUserIntentLedgerMaxRunesEffective() int {
	if c.SummarizationUserIntentLedgerMaxRunes > 0 {
		return c.SummarizationUserIntentLedgerMaxRunes
	}
	return DefaultSummarizationUserIntentLedgerMaxRunes
}

func (c AgentTuningConfig) SummarizationUserIntentLedgerEntryMaxRunesEffective() int {
	if c.SummarizationUserIntentLedgerEntryMaxRunes > 0 {
		return c.SummarizationUserIntentLedgerEntryMaxRunes
	}
	return DefaultSummarizationUserIntentLedgerEntryMaxRunes
}

func (c AgentTuningConfig) LatestUserMessageMaxRunesEffective() int {
	if c.LatestUserMessageMaxRunes > 0 {
		return c.LatestUserMessageMaxRunes
	}
	return DefaultLatestUserMessageMaxRunes
}

func (c AgentTuningConfig) LatestUserMessageHeadRunesEffective() int {
	if c.LatestUserMessageHeadRunes > 0 {
		return c.LatestUserMessageHeadRunes
	}
	return DefaultLatestUserMessageHeadRunes
}

func (c AgentTuningConfig) LatestUserMessageTailRunesEffective() int {
	if c.LatestUserMessageTailRunes > 0 {
		return c.LatestUserMessageTailRunes
	}
	return DefaultLatestUserMessageTailRunes
}

func (c AgentTuningConfig) PlanExecuteUserInputBudgetRatioEffective() float64 {
	v := c.PlanExecuteUserInputBudgetRatio
	if v <= 0 {
		return 0.35
	}
	if v < 0.1 {
		return 0.1
	}
	if v > 0.6 {
		return 0.6
	}
	return v
}

func (c AgentTuningConfig) PlanExecuteExecutedStepsBudgetRatioEffective() float64 {
	v := c.PlanExecuteExecutedStepsBudgetRatio
	if v <= 0 {
		return 0.2
	}
	if v < 0.08 {
		return 0.08
	}
	if v > 0.5 {
		return 0.5
	}
	return v
}

func (c AgentTuningConfig) PlanExecuteMaxStepResultRunesEffective() int {
	if c.PlanExecuteMaxStepResultRunes > 0 {
		return c.PlanExecuteMaxStepResultRunes
	}
	return 4000
}

func (c AgentTuningConfig) PlanExecuteKeepLastStepsEffective() int {
	if c.PlanExecuteKeepLastSteps > 0 {
		return c.PlanExecuteKeepLastSteps
	}
	return 8
}

func (c AgentTuningConfig) ReductionMaxLengthForTruncEffective() int {
	if c.ReductionMaxLengthForTrunc > 0 {
		return c.ReductionMaxLengthForTrunc
	}
	return 12000
}

func (c AgentTuningConfig) ReductionMaxTokensForClearEffective() int {
	if c.ReductionMaxTokensForClear > 0 {
		return c.ReductionMaxTokensForClear
	}
	return 50000
}

// AgentSkillsConfig toggles Agent official skill progressive disclosure and host filesystem tools.
type AgentSkillsConfig struct {
	// Disable skips skill middleware (and does not attach local FS tools for Deep).
	Disable bool `yaml:"disable" json:"disable"`
	// FilesystemTools registers read_file/glob/grep/write/edit/execute (native Go tools). Nil/omitted = true.
	FilesystemTools *bool `yaml:"filesystem_tools,omitempty" json:"filesystem_tools,omitempty"`
	// SkillToolName overrides the default Agent tool name "skill".
	SkillToolName string `yaml:"skill_tool_name,omitempty" json:"skill_tool_name,omitempty"`
}

// FilesystemToolsEffective returns whether Deep/sub-agents should attach local filesystem + streaming shell.
func (c AgentSkillsConfig) FilesystemToolsEffective() bool {
	if c.FilesystemTools != nil {
		return *c.FilesystemTools
	}
	return true
}

// PatchToolCallsEffective returns whether patchtoolcalls middleware should run (default true).
func (c AgentTuningConfig) PatchToolCallsEffective() bool {
	if c.PatchToolCalls != nil {
		return *c.PatchToolCalls
	}
	return true
}

// ToolSearchIncludeBuiltinsEffective controls whether backend builtin tools bypass tool_search.
func (c AgentTuningConfig) ToolSearchIncludeBuiltinsEffective() bool {
	return c.ToolSearchIncludeBuiltins == nil || *c.ToolSearchIncludeBuiltins
}

// MultiAgentSubConfig is a sub-agent (Pi): under deep it is scheduled by task; under supervisor it is delegated to by transfer; plan_execute does not use the sub-agent list.
type MultiAgentSubConfig struct {
	ID            string   `yaml:"id" json:"id"`
	Name          string   `yaml:"name" json:"name"`
	Description   string   `yaml:"description" json:"description"`
	Instruction   string   `yaml:"instruction" json:"instruction"`
	BindRole      string   `yaml:"bind_role,omitempty" json:"bind_role,omitempty"` // Optional: name of a role in the main configuration roles; when role_tools is not configured, that role's tools are used
	RoleTools     []string `yaml:"role_tools" json:"role_tools"`                   // Same key as the single-agent role tools; empty means all tools (bind_role can fill in tools)
	MaxIterations int      `yaml:"max_iterations" json:"max_iterations"`
	Kind          string   `yaml:"kind,omitempty" json:"kind,omitempty"` // Markdown only: kind=orchestrator marks the Deep main agent (mutually exclusive with orchestrator.md by convention)
}

// MultiAgentPublic is the condensed information returned to the frontend (without the full sub-agent instructions).
type MultiAgentPublic struct {
	Enabled                               bool     `json:"enabled"`
	RobotDefaultAgentMode                 string   `json:"robot_default_agent_mode,omitempty"`
	BatchUseMultiAgent                    bool     `json:"batch_use_multi_agent"`
	SubAgentCount                         int      `json:"sub_agent_count"`
	Orchestration                         string   `json:"orchestration,omitempty"`
	PlanExecuteLoopMaxIterations          int      `json:"plan_execute_loop_max_iterations"`
	ModelRetryMaxRetries                  int      `json:"model_retry_max_retries"`
	ModelRetryMaxBackoffSec               int      `json:"model_retry_max_backoff_sec"`
	ModelFailoverChannels                 []string `json:"model_failover_channels,omitempty"`
	ModelFailoverMaxRetries               int      `json:"model_failover_max_retries"`
	ToolSearchAlwaysVisibleTools          []string `json:"tool_search_always_visible_tools,omitempty"`
	ToolSearchAlwaysVisibleEffectiveTools []string `json:"tool_search_always_visible_effective_tools,omitempty"`
}

// NormalizeAgentMode parses the agent mode (single | deep | plan_execute | supervisor); an empty value defaults to single.
func NormalizeAgentMode(mode string) string {
	s := strings.TrimPrefix(strings.TrimSpace(strings.ToLower(mode)), "eino_")
	switch s {
	case "", "single", "eino_single":
		return "single"
	case "deep":
		return "deep"
	case "plan_execute", "plan-execute", "planexecute", "pe":
		return "plan_execute"
	case "supervisor", "super", "sv":
		return "supervisor"
	default:
		return "single"
	}
}

// NormalizeRobotAgentMode parses the bot's default conversation mode.
func NormalizeRobotAgentMode(ma MultiAgentConfig) string {
	return NormalizeAgentMode(ma.RobotDefaultAgentMode)
}

// NormalizeMultiAgentOrchestration returns deep, plan_execute or supervisor.
func NormalizeMultiAgentOrchestration(s string) string {
	v := strings.TrimSpace(strings.ToLower(s))
	switch v {
	case "plan_execute", "plan-execute", "planexecute", "pe":
		return "plan_execute"
	case "supervisor", "super", "sv":
		return "supervisor"
	default:
		return "deep"
	}
}

// MultiAgentAPIUpdate lets the settings page/API update only the multi-agent scalar fields; blocks such as sub_agents are not overwritten when writing YAML.
type MultiAgentAPIUpdate struct {
	Enabled                      bool      `json:"enabled"`
	RobotDefaultAgentMode        string    `json:"robot_default_agent_mode,omitempty"`
	BatchUseMultiAgent           bool      `json:"batch_use_multi_agent"`
	PlanExecuteLoopMaxIterations *int      `json:"plan_execute_loop_max_iterations,omitempty"`
	ModelRetryMaxRetries         *int      `json:"model_retry_max_retries,omitempty"`
	ModelRetryMaxBackoffSec      *int      `json:"model_retry_max_backoff_sec,omitempty"`
	ModelFailoverChannels        *[]string `json:"model_failover_channels,omitempty"`
	ModelFailoverMaxRetries      *int      `json:"model_failover_max_retries,omitempty"`
	// A pointer distinguishes 'the JSON did not pass this field' from 'an empty array was passed to clear it'; when omitted, the resident tool allowlist in YAML must not be overwritten.
	ToolSearchAlwaysVisibleTools *[]string `json:"tool_search_always_visible_tools,omitempty"`
}

// RobotsConfig is the bot configuration (WeCom, DingTalk, Lark, WeChat iLink, Telegram, Slack, Discord, QQ, etc.)
type RobotsConfig struct {
	Session  RobotSessionConfig  `yaml:"session,omitempty" json:"session,omitempty"`   // Bot session isolation policy
	Wechat   RobotWechatConfig   `yaml:"wechat,omitempty" json:"wechat,omitempty"`     // WeChat (iLink QR code binding)
	Wecom    RobotWecomConfig    `yaml:"wecom,omitempty" json:"wecom,omitempty"`       // WeCom
	Dingtalk RobotDingtalkConfig `yaml:"dingtalk,omitempty" json:"dingtalk,omitempty"` // DingTalk
	Lark     RobotLarkConfig     `yaml:"lark,omitempty" json:"lark,omitempty"`         // Lark
	Telegram RobotTelegramConfig `yaml:"telegram,omitempty" json:"telegram,omitempty"` // Telegram
	Slack    RobotSlackConfig    `yaml:"slack,omitempty" json:"slack,omitempty"`       // Slack
	Discord  RobotDiscordConfig  `yaml:"discord,omitempty" json:"discord,omitempty"`   // Discord
	QQ       RobotQQConfig       `yaml:"qq,omitempty" json:"qq,omitempty"`             // QQ bot
}

// RobotWechatConfig is the WeChat iLink bot configuration (personal WeChat ClawBot / iLink protocol)
type RobotWechatConfig struct {
	Enabled       bool                     `yaml:"enabled" json:"enabled"`
	BotToken      string                   `yaml:"bot_token,omitempty" json:"bot_token,omitempty"`
	ILinkBotID    string                   `yaml:"ilink_bot_id,omitempty" json:"ilink_bot_id,omitempty"`
	ILinkUserID   string                   `yaml:"ilink_user_id,omitempty" json:"ilink_user_id,omitempty"`
	BaseURL       string                   `yaml:"base_url,omitempty" json:"base_url,omitempty"`               // Default https://ilinkai.weixin.qq.com
	BotType       string                   `yaml:"bot_type,omitempty" json:"bot_type,omitempty"`               // get_bot_qrcode parameter, default 3
	BotAgent      string                   `yaml:"bot_agent,omitempty" json:"bot_agent,omitempty"`             // base_info.bot_agent
	GetUpdatesBuf string                   `yaml:"get_updates_buf,omitempty" json:"get_updates_buf,omitempty"` // Long-polling cursor (runtime)
	Auth          RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

const (
	RobotAuthModeUserBinding    = "user_binding"
	RobotAuthModeServiceAccount = "service_account"
)

// RobotAuthorizationConfig controls how a verified platform sender becomes
// an RBAC principal. service_account is intentionally fail-closed unless an
// explicit non-admin service user and sender allowlist are both configured.
type RobotAuthorizationConfig struct {
	Mode                 string   `yaml:"mode,omitempty" json:"mode,omitempty"`
	ServiceUserID        string   `yaml:"service_user_id,omitempty" json:"service_user_id,omitempty"`
	AllowedExternalUsers []string `yaml:"allowed_external_users,omitempty" json:"allowed_external_users,omitempty"`
}

func (c RobotAuthorizationConfig) EffectiveMode() string {
	mode := strings.ToLower(strings.TrimSpace(c.Mode))
	if mode == "" {
		return RobotAuthModeUserBinding
	}
	return mode
}

func (c RobotAuthorizationConfig) ExternalUserAllowed(externalUserID string) bool {
	externalUserID = strings.TrimSpace(externalUserID)
	if externalUserID == "" {
		return false
	}
	for _, allowed := range c.AllowedExternalUsers {
		if strings.TrimSpace(allowed) == externalUserID {
			return true
		}
	}
	return false
}

// RobotSessionConfig is the bot session isolation policy
type RobotSessionConfig struct {
	StrictUserIdentity *bool `yaml:"strict_user_identity,omitempty" json:"strict_user_identity,omitempty"` // When true, only real user identifiers are allowed; falling back to a session/group ID is not allowed
}

// StrictUserIdentityEnabled returns whether strict user identity mode is enabled; defaults to true when not configured.
func (c RobotSessionConfig) StrictUserIdentityEnabled() bool {
	if c.StrictUserIdentity == nil {
		return true
	}
	return *c.StrictUserIdentity
}

// RobotWecomConfig is the WeCom bot configuration
type RobotWecomConfig struct {
	Enabled        bool                     `yaml:"enabled" json:"enabled"`
	Token          string                   `yaml:"token" json:"token"`                       // Token for callback URL verification
	EncodingAESKey string                   `yaml:"encoding_aes_key" json:"encoding_aes_key"` // EncodingAESKey
	CorpID         string                   `yaml:"corp_id" json:"corp_id"`                   // Corp ID
	Secret         string                   `yaml:"secret" json:"secret"`                     // Application Secret
	AgentID        int64                    `yaml:"agent_id" json:"agent_id"`                 // Application AgentId
	Auth           RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

// ValidateWecomConfig validates the WeCom bot configuration; when enabled, a token must be configured, otherwise callbacks cannot be protected against forgery.
func ValidateWecomConfig(w RobotWecomConfig) error {
	if !w.Enabled {
		return nil
	}
	if strings.TrimSpace(w.Token) == "" {
		return fmt.Errorf("robots.wecom.token must be configured when robots.wecom.enabled is true")
	}
	return nil
}

// RobotDingtalkConfig is the DingTalk bot configuration
type RobotDingtalkConfig struct {
	Enabled                     bool                     `yaml:"enabled" json:"enabled"`
	ClientID                    string                   `yaml:"client_id" json:"client_id"`                                           // Application Key (AppKey)
	ClientSecret                string                   `yaml:"client_secret" json:"client_secret"`                                   // Application Secret
	AllowConversationIDFallback bool                     `yaml:"allow_conversation_id_fallback" json:"allow_conversation_id_fallback"` // Whether to allow falling back to the session ID when sender_id is missing
	Auth                        RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

// RobotLarkConfig is the Lark bot configuration
type RobotLarkConfig struct {
	Enabled             bool                     `yaml:"enabled" json:"enabled"`
	AppID               string                   `yaml:"app_id" json:"app_id"`                                 // Application App ID
	AppSecret           string                   `yaml:"app_secret" json:"app_secret"`                         // Application App Secret
	VerifyToken         string                   `yaml:"verify_token" json:"verify_token"`                     // Event subscription Verification Token (optional)
	AllowChatIDFallback bool                     `yaml:"allow_chat_id_fallback" json:"allow_chat_id_fallback"` // Whether to allow falling back to chat_id when the user ID is missing
	Auth                RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

// RobotTelegramConfig is the Telegram bot configuration (Bot API long polling)
type RobotTelegramConfig struct {
	Enabled            bool                     `yaml:"enabled" json:"enabled"`
	BotToken           string                   `yaml:"bot_token" json:"bot_token"`
	BotUsername        string                   `yaml:"bot_username,omitempty" json:"bot_username,omitempty"` // Optional, used to recognize @ mentions in group chats; if empty, getMe is called at startup
	AllowGroupMessages bool                     `yaml:"allow_group_messages" json:"allow_group_messages"`     // In group chats, respond only when the bot is @-mentioned
	UpdateOffset       int64                    `yaml:"update_offset,omitempty" json:"update_offset,omitempty"`
	Auth               RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

// RobotSlackConfig is the Slack bot configuration (Socket Mode, no public callback needed)
type RobotSlackConfig struct {
	Enabled  bool                     `yaml:"enabled" json:"enabled"`
	BotToken string                   `yaml:"bot_token" json:"bot_token"` // xoxb-
	AppToken string                   `yaml:"app_token" json:"app_token"` // xapp- (connections:write)
	Auth     RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

// RobotDiscordConfig is the Discord bot configuration (Gateway WebSocket)
type RobotDiscordConfig struct {
	Enabled            bool                     `yaml:"enabled" json:"enabled"`
	BotToken           string                   `yaml:"bot_token" json:"bot_token"`
	AllowGuildMessages bool                     `yaml:"allow_guild_messages" json:"allow_guild_messages"` // In server channels, respond only when the bot is @-mentioned
	Auth               RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

// RobotQQConfig is the QQ bot configuration (QQ Open Platform WebSocket)
type RobotQQConfig struct {
	Enabled      bool                     `yaml:"enabled" json:"enabled"`
	AppID        string                   `yaml:"app_id" json:"app_id"`
	ClientSecret string                   `yaml:"client_secret" json:"client_secret"`
	Sandbox      bool                     `yaml:"sandbox" json:"sandbox"` // Sandbox environment (pre-release testing)
	Auth         RobotAuthorizationConfig `yaml:"auth,omitempty" json:"auth,omitempty"`
}

func (c RobotsConfig) AuthorizationFor(platform string) RobotAuthorizationConfig {
	switch strings.ToLower(strings.TrimSpace(platform)) {
	case "wechat":
		return c.Wechat.Auth
	case "wecom":
		return c.Wecom.Auth
	case "dingtalk":
		return c.Dingtalk.Auth
	case "lark":
		return c.Lark.Auth
	case "telegram":
		return c.Telegram.Auth
	case "slack":
		return c.Slack.Auth
	case "discord":
		return c.Discord.Auth
	case "qq":
		return c.QQ.Auth
	default:
		return RobotAuthorizationConfig{}
	}
}

func ValidateRobotAuthorization(c RobotAuthorizationConfig, path string) error {
	switch c.EffectiveMode() {
	case RobotAuthModeUserBinding:
		return nil
	case RobotAuthModeServiceAccount:
		serviceUserID := strings.TrimSpace(c.ServiceUserID)
		if serviceUserID == "" {
			return fmt.Errorf("%s.auth.service_user_id is required", path)
		}
		if len(c.AllowedExternalUsers) == 0 {
			return fmt.Errorf("%s.auth.allowed_external_users must contain at least one real sender", path)
		}
		seen := map[string]bool{}
		for _, userID := range c.AllowedExternalUsers {
			userID = strings.TrimSpace(userID)
			if userID == "" || userID == "*" {
				return fmt.Errorf("%s.auth.allowed_external_users must not contain empty values or wildcards", path)
			}
			if seen[userID] {
				return fmt.Errorf("%s.auth.allowed_external_users contains duplicate users", path)
			}
			seen[userID] = true
		}
		return nil
	default:
		return fmt.Errorf("%s.auth.mode must be user_binding or service_account", path)
	}
}

func ValidateRobotsAuthorization(c RobotsConfig) error {
	items := []struct {
		path string
		auth RobotAuthorizationConfig
	}{
		{"robots.wechat", c.Wechat.Auth}, {"robots.wecom", c.Wecom.Auth},
		{"robots.dingtalk", c.Dingtalk.Auth}, {"robots.lark", c.Lark.Auth},
		{"robots.telegram", c.Telegram.Auth}, {"robots.slack", c.Slack.Auth},
		{"robots.discord", c.Discord.Auth}, {"robots.qq", c.QQ.Auth},
	}
	for _, item := range items {
		if err := ValidateRobotAuthorization(item.auth, item.path); err != nil {
			return err
		}
	}
	return nil
}

func (c RobotsConfig) ServiceAccountUserIDs() map[string]string {
	out := map[string]string{}
	for _, platform := range []string{"wechat", "wecom", "dingtalk", "lark", "telegram", "slack", "discord", "qq"} {
		auth := c.AuthorizationFor(platform)
		if auth.EffectiveMode() == RobotAuthModeServiceAccount {
			out[platform] = strings.TrimSpace(auth.ServiceUserID)
		}
	}
	return out
}

type ServerConfig struct {
	Host string `yaml:"host" json:"host"`
	Port int    `yaml:"port" json:"port"`
	// CORSAllowedOrigins contains additional, exact origins that may call the API.
	// Same-origin browser requests are always allowed. Wildcards are intentionally unsupported.
	CORSAllowedOrigins []string `yaml:"cors_allowed_origins,omitempty" json:"cors_allowed_origins,omitempty"`
	// When TLSEnabled is true the main web UI uses HTTPS; modern browsers negotiate HTTP/2 on the same origin, easing the HTTP/1.1 per-origin concurrent connection limit.
	TLSEnabled bool `yaml:"tls_enabled,omitempty" json:"tls_enabled,omitempty"`
	// When TLSCertPath / TLSKeyPath are non-empty, the certificate is loaded from PEM files (recommended for production).
	TLSCertPath string `yaml:"tls_cert_path,omitempty" json:"tls_cert_path,omitempty"`
	TLSKeyPath  string `yaml:"tls_key_path,omitempty" json:"tls_key_path,omitempty"`
	// When TLSAutoSelfSign is true and no certificate path is configured, a self-signed certificate in the install directory is generated and reused (local/testing only).
	TLSAutoSelfSign bool `yaml:"tls_auto_self_sign,omitempty" json:"tls_auto_self_sign,omitempty"`
	// When TLSHTTPRedirect is false, the HTTP->HTTPS redirect is disabled; when omitted or true and HTTPS is enabled, plain HTTP requests are redirected to HTTPS with 308 (same-port protocol sniffing).
	TLSHTTPRedirect *bool `yaml:"tls_http_redirect,omitempty" json:"tls_http_redirect,omitempty"`
}

type LogConfig struct {
	Level                   string `yaml:"level"`
	Output                  string `yaml:"output"`
	DiagnosticDir           string `yaml:"diagnostic_dir"`
	DiagnosticDisabled      bool   `yaml:"diagnostic_disabled"`
	DiagnosticRetentionDays int    `yaml:"diagnostic_retention_days"`
}

type MCPConfig struct {
	Enabled           bool   `yaml:"enabled"`
	Host              string `yaml:"host"`
	Port              int    `yaml:"port"`
	AuthHeader        string `yaml:"auth_header,omitempty"`         // Optional global service credential header; regular calls prefer the user's Bearer Token
	AuthHeaderValue   string `yaml:"auth_header_value,omitempty"`   // Global service credential, accepted only when allow_global_access=true
	AllowGlobalAccess bool   `yaml:"allow_global_access,omitempty"` // Whether the static service key maps to a global service identity (disabled by default)
}

type OpenAIConfig struct {
	Provider            string `yaml:"provider,omitempty" json:"provider,omitempty"` // API provider: "openai" (default) or "claude"; claude uses the Agent's native Anthropic Messages API
	APIKey              string `yaml:"api_key" json:"api_key"`
	BaseURL             string `yaml:"base_url" json:"base_url"`
	Model               string `yaml:"model" json:"model"`
	ImageInput          string `yaml:"image_input,omitempty" json:"image_input,omitempty"`
	MaxTotalTokens      int    `yaml:"max_total_tokens,omitempty" json:"max_total_tokens,omitempty"`
	MaxCompletionTokens int    `yaml:"max_completion_tokens,omitempty" json:"max_completion_tokens,omitempty"`
	// Headers appends or overrides HTTP request headers sent to the model gateway; values support ${ENV_VAR} expansion.
	// Used for compatibility with third-party OpenAI-compatible providers that require private auth headers, version headers, or organization headers.
	Headers map[string]string `yaml:"headers,omitempty" json:"headers,omitempty"`
	// ContextWindow is the model's native context window (tokens); 0 means unknown. Used to validate/compress max_total_tokens.
	ContextWindow int `yaml:"context_window,omitempty" json:"context_window,omitempty"`
	// ContextProfile selects auto, economy, custom or local; local_auto records
	// a local backend identified through the model metadata probe.
	ContextProfile string `yaml:"context_profile,omitempty" json:"context_profile,omitempty"`
	// Reasoning controls thinking / reasoning_effort / output_config and similar settings of the Agent ChatModel (effective on the Agent single/multi-agent paths).
	Reasoning OpenAIReasoningConfig `yaml:"reasoning,omitempty" json:"reasoning,omitempty"`
}

// AIConfig stores first-class model channels. Runtime callers resolve a channel
// into OpenAIConfig at the edge instead of moving API credentials through chat requests.
type AIConfig struct {
	DefaultChannel string                     `yaml:"default_channel,omitempty" json:"default_channel,omitempty"`
	Channels       map[string]AIChannelConfig `yaml:"channels,omitempty" json:"channels,omitempty"`
}

type AIChannelConfig struct {
	Name                string                `yaml:"name,omitempty" json:"name,omitempty"`
	Provider            string                `yaml:"provider,omitempty" json:"provider,omitempty"`
	APIKey              string                `yaml:"api_key" json:"api_key"`
	BaseURL             string                `yaml:"base_url" json:"base_url"`
	Model               string                `yaml:"model" json:"model"`
	ImageInput          string                `yaml:"image_input,omitempty" json:"image_input,omitempty"`
	MaxTotalTokens      int                   `yaml:"max_total_tokens,omitempty" json:"max_total_tokens,omitempty"`
	MaxCompletionTokens int                   `yaml:"max_completion_tokens,omitempty" json:"max_completion_tokens,omitempty"`
	Headers             map[string]string     `yaml:"headers,omitempty" json:"headers,omitempty"`
	ContextWindow       int                   `yaml:"context_window,omitempty" json:"context_window,omitempty"`
	ContextProfile      string                `yaml:"context_profile,omitempty" json:"context_profile,omitempty"`
	Reasoning           OpenAIReasoningConfig `yaml:"reasoning,omitempty" json:"reasoning,omitempty"`
}

func (c AIChannelConfig) ToOpenAIConfig() OpenAIConfig {
	provider := strings.TrimSpace(c.Provider)
	if provider == "" || provider == "openai_compatible" {
		provider = "openai"
	}
	return OpenAIConfig{
		Provider:            provider,
		APIKey:              c.APIKey,
		BaseURL:             c.BaseURL,
		Model:               c.Model,
		ImageInput:          c.ImageInput,
		MaxTotalTokens:      c.MaxTotalTokens,
		MaxCompletionTokens: c.MaxCompletionTokens,
		Headers:             ExpandHeaderMap(c.Headers),
		ContextWindow:       c.ContextWindow,
		ContextProfile:      NormalizeContextProfile(c.ContextProfile),
		Reasoning:           c.Reasoning,
	}
}

func AIChannelFromOpenAI(id, name string, oa OpenAIConfig) AIChannelConfig {
	if strings.TrimSpace(name) == "" {
		name = id
	}
	return AIChannelConfig{
		Name:                name,
		Provider:            oa.Provider,
		APIKey:              oa.APIKey,
		BaseURL:             oa.BaseURL,
		Model:               oa.Model,
		ImageInput:          oa.ImageInput,
		MaxTotalTokens:      oa.MaxTotalTokens,
		MaxCompletionTokens: oa.MaxCompletionTokens,
		Headers:             ExpandHeaderMap(oa.Headers),
		ContextWindow:       oa.ContextWindow,
		ContextProfile:      oa.ContextProfile,
		Reasoning:           oa.Reasoning,
	}
}

func NormalizeAIChannelID(s string) string {
	id := strings.ToLower(strings.TrimSpace(s))
	id = strings.ReplaceAll(id, "_", "-")
	var b strings.Builder
	lastDash := false
	for _, r := range id {
		ok := (r >= 'a' && r <= 'z') || (r >= '0' && r <= '9')
		if ok {
			b.WriteRune(r)
			lastDash = false
			continue
		}
		if !lastDash {
			b.WriteByte('-')
			lastDash = true
		}
	}
	out := strings.Trim(b.String(), "-")
	if out == "" {
		return "default"
	}
	return out
}

func (c *AIConfig) EnsureDefaultFromOpenAI(openAI OpenAIConfig) {
	if c.Channels == nil {
		c.Channels = make(map[string]AIChannelConfig)
	}
	def := NormalizeAIChannelID(c.DefaultChannel)
	if def == "default" && strings.TrimSpace(c.DefaultChannel) == "" {
		def = "default"
	}
	c.DefaultChannel = def
	if _, ok := c.Channels[def]; !ok {
		c.Channels[def] = AIChannelFromOpenAI(def, "Default", openAI)
	}
}

func (c AIConfig) ResolveChannel(channelID string) (OpenAIConfig, string, bool) {
	id := NormalizeAIChannelID(channelID)
	if strings.TrimSpace(channelID) == "" {
		id = NormalizeAIChannelID(c.DefaultChannel)
	}
	if id == "" {
		id = "default"
	}
	if c.Channels != nil {
		if ch, ok := c.Channels[id]; ok {
			return ch.ToOpenAIConfig(), id, true
		}
	}
	return OpenAIConfig{}, id, false
}

func (c *Config) ResolveAIChannel(channelID string) (OpenAIConfig, string, bool) {
	if c == nil {
		return OpenAIConfig{}, "", false
	}
	if oa, id, ok := c.AI.ResolveChannel(channelID); ok {
		return oa, id, true
	}
	return c.OpenAI, NormalizeAIChannelID(channelID), strings.TrimSpace(c.OpenAI.Model) != "" || strings.TrimSpace(c.OpenAI.BaseURL) != ""
}

func (c *Config) ApplyDefaultAIChannel() {
	if c == nil {
		return
	}
	c.NormalizeAIProviderProfiles()
	c.AI.EnsureDefaultFromOpenAI(c.OpenAI)
	if oa, _, ok := c.AI.ResolveChannel(c.AI.DefaultChannel); ok {
		c.OpenAI = oa
	}
	c.NormalizeAIProviderProfiles()
}

func (c OpenAIConfig) MaxCompletionTokensEffective() int {
	out := c.MaxCompletionTokens
	if out <= 0 {
		out = DefaultMaxCompletionTokens
	}
	if window := c.EffectiveContextWindow(); window > 0 && out > window/2 {
		out = window / 2
	}
	return out
}

// IsDeepSeekEndpointOrModel reports whether the channel targets DeepSeek's
// official-compatible API endpoint. The historical name is kept for compatibility;
// model names alone are not enough to infer DeepSeek wire behavior behind
// OpenAI-compatible gateways.
func (c OpenAIConfig) IsDeepSeekEndpointOrModel() bool {
	baseURL := strings.ToLower(strings.TrimSpace(c.BaseURL))
	return strings.Contains(baseURL, "deepseek")
}

func (c OpenAIConfig) IsDeepSeekOfficialEndpoint() bool {
	host := normalizedURLHost(c.BaseURL)
	return host == "api.deepseek.com"
}

func normalizedURLHost(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	parsed, err := url.Parse(raw)
	if err != nil || parsed.Host == "" {
		parsed, err = url.Parse("https://" + strings.TrimLeft(raw, "/"))
		if err != nil {
			return ""
		}
	}
	return strings.ToLower(strings.TrimPrefix(parsed.Hostname(), "www."))
}

func NormalizeOpenAIProviderProfile(oa *OpenAIConfig) {
	if oa == nil {
		return
	}
	if oa.IsDeepSeekOfficialEndpoint() {
		oa.Reasoning.Profile = "deepseek"
	}
}

func (c *Config) NormalizeAIProviderProfiles() {
	if c == nil {
		return
	}
	NormalizeOpenAIProviderProfile(&c.OpenAI)
	if c.AI.Channels != nil {
		for id, ch := range c.AI.Channels {
			oa := ch.ToOpenAIConfig()
			NormalizeOpenAIProviderProfile(&oa)
			ch.Reasoning = oa.Reasoning
			c.AI.Channels[id] = ch
		}
	}
}

// OpenAIReasoningConfig holds the global defaults and gateway profile (the chat page can override them via ChatRequest.reasoning, subject to AllowClientReasoning).
type OpenAIReasoningConfig struct {
	// Mode: auto (default) | on | off | default (same as auto).
	// off sends reasoning_effort=none to official OpenAI models known to support none; the DeepSeek profile sends thinking.type=disabled; other services keep the reasoning fields omitted.
	Mode string `yaml:"mode,omitempty" json:"mode,omitempty"`
	// Effort: low | medium | high | max | xhigh; official OpenAI models known to support none also accept none (equivalent to off). Empty means no separate effort is specified.
	Effort string `yaml:"effort,omitempty" json:"effort,omitempty"`
	// When AllowClientReasoning is false, the reasoning in the request body is ignored; nil or unset is equivalent to true.
	AllowClientReasoning *bool `yaml:"allow_client_reasoning,omitempty" json:"allow_client_reasoning,omitempty"`
	// Profile: auto | deepseek_compat | openai_compat | output_config_effort
	Profile string `yaml:"profile,omitempty" json:"profile,omitempty"`
	// ExtraRequestFields is merged into the root JSON of Chat Completions (for administrators; if a name collides with an automatic field, the latter overrides).
	// When Mode=off, the reasoning control fields in it are removed and other extension fields are kept, then explicit disable parameters are added according to the provider and known model capabilities.
	ExtraRequestFields map[string]interface{} `yaml:"extra_request_fields,omitempty" json:"extra_request_fields,omitempty"`
}

// ModeEffective returns auto when empty or default.
func (c OpenAIReasoningConfig) ModeEffective() string {
	m := strings.ToLower(strings.TrimSpace(c.Mode))
	if m == "" || m == "default" {
		return "auto"
	}
	return m
}

// ProfileEffective returns auto when empty.
func (c OpenAIReasoningConfig) ProfileEffective() string {
	p := strings.ToLower(strings.TrimSpace(c.Profile))
	if p == "" {
		return "auto"
	}
	return p
}

// AllowClientReasoningEffective true when client may send ChatRequest.reasoning.
func (c OpenAIReasoningConfig) AllowClientReasoningEffective() bool {
	if c.AllowClientReasoning == nil {
		return true
	}
	return *c.AllowClientReasoning
}

type FofaConfig struct {
	// APIKey is the FOFA API Key (a read-only Key is recommended)
	APIKey  string `yaml:"api_key,omitempty" json:"api_key,omitempty"`
	BaseURL string `yaml:"base_url,omitempty" json:"base_url,omitempty"` // Default https://fofa.info/api/v1/search/all
}

type SpaceSearchConfig struct {
	APIKey  string `yaml:"api_key,omitempty" json:"api_key,omitempty"`
	BaseURL string `yaml:"base_url,omitempty" json:"base_url,omitempty"`
}

type ProcessIsolationConfig struct {
	Mode           string `yaml:"mode" json:"mode"`
	CgroupRoot     string `yaml:"cgroup_root" json:"cgroup_root"`
	MaxProcesses   int    `yaml:"max_processes" json:"max_processes"`
	MemoryMaxBytes int64  `yaml:"memory_max_bytes" json:"memory_max_bytes"`
	CPUQuotaMicros int64  `yaml:"cpu_quota_micros" json:"cpu_quota_micros"`
}

type SecurityConfig struct {
	ProcessIsolation ProcessIsolationConfig `yaml:"process_isolation,omitempty" json:"process_isolation"`

	Tools               []ToolConfig `yaml:"tools,omitempty"`                 // Backward compatibility: tools may be defined in the main configuration file
	ToolsDir            string       `yaml:"tools_dir,omitempty"`             // Tool configuration file directory (new approach)
	ToolDescriptionMode string       `yaml:"tool_description_mode,omitempty"` // Tool description mode: "short" | "full", default short
}

type DatabaseConfig struct {
	Path            string `yaml:"path"`                        // Session database path
	KnowledgeDBPath string `yaml:"knowledge_db_path,omitempty"` // Knowledge base database path (optional; if empty, the session database is used)
}

type AgentConfig struct {
	TaskTimeoutMinutes                 *int `yaml:"task_timeout_minutes,omitempty" json:"task_timeout_minutes,omitempty"` // nil=600 minutes; 0=unlimited
	MaxIterations                      int  `yaml:"max_iterations" json:"max_iterations"`
	ToolTimeoutMinutes                 int  `yaml:"tool_timeout_minutes" json:"tool_timeout_minutes"`                                     // Maximum duration of a single tool execution (minutes); it is terminated automatically on timeout to prevent long hangs; 0 means no limit (not recommended)
	ToolWaitTimeoutSeconds             int  `yaml:"tool_wait_timeout_seconds" json:"tool_wait_timeout_seconds"`                           // Seconds the tool waits in this round; when it elapses, execution_id is returned and the worker keeps running in the background; 0 means wait until completion
	ExternalMCPMaxConcurrentPerServer  int  `yaml:"external_mcp_max_concurrent_per_server" json:"external_mcp_max_concurrent_per_server"` // Number of tools one external MCP server runs concurrently; 0 means default 2
	ExternalMCPMaxConcurrentTotal      int  `yaml:"external_mcp_max_concurrent_total" json:"external_mcp_max_concurrent_total"`           // Global concurrency across all external MCP tools; 0 means default 16
	ExternalMCPCircuitFailureThreshold int  `yaml:"external_mcp_circuit_failure_threshold" json:"external_mcp_circuit_failure_threshold"` // Number of consecutive failures of a single MCP server before the circuit breaker opens; 0 means default 3; negative disables it
	ExternalMCPCircuitCooldownSeconds  int  `yaml:"external_mcp_circuit_cooldown_seconds" json:"external_mcp_circuit_cooldown_seconds"`   // Cooldown seconds after the circuit breaker opens; 0 means default 60
	// ShellNoOutputTimeoutSeconds is the idle-termination time in seconds when execute/exec produces no stdout/stderr at all (a generic hang guard, no command blacklist is maintained); 0 = default 300 (5 minutes); -1 = disabled.
	ShellNoOutputTimeoutSeconds int `yaml:"shell_no_output_timeout_seconds" json:"shell_no_output_timeout_seconds"`
	// WorkspaceRootDir is the root path of the session working directory (curl/wget downloads, local analysis with read_file/glob/grep); empty = tmp/workspace, isolated below it by projects/{id} or conversations/{id}.
	WorkspaceRootDir string `yaml:"workspace_root_dir,omitempty" json:"workspace_root_dir,omitempty"`
	// SystemPromptPath is the path of the single-agent system prompt Markdown/text file (relative to the directory containing config.yaml, or a writable absolute path). When non-empty and readable it replaces the built-in single-agent prompt; leave empty to use the built-in one.
	SystemPromptPath string `yaml:"system_prompt_path,omitempty" json:"system_prompt_path,omitempty"`
}

// HitlConfig holds the global HITL options; it is merged as a union with the whitelist from the session sidebar/API before being used in decisions.
// tool_whitelist can be merged into config.yaml when "Apply" is clicked in the sidebar and takes effect immediately.
// audit_agent_prompt / audit_agent_prompt_review_edit can be edited on the HITL page and take effect immediately; if empty, the built-in default is used.
type HitlConfig struct {
	// AuditBackend is the audit Agent backend: openai (OpenAI-compatible protocol chat model) or typesafe (Jev structured adjudication). Empty is treated as openai.
	AuditBackend string `yaml:"audit_backend,omitempty" json:"audit_backend,omitempty"`
	// AuditModel is the model dedicated to the audit Agent. With the openai backend, empty fields inherit the main model; with the typesafe backend api_key is required and the main model's key is not inherited.
	AuditModel OpenAIConfig `yaml:"audit_model,omitempty" json:"audit_model,omitempty"`
	// ToolWhitelist is the global list of tool names exempt from approval (tools in the whitelist do not trigger HITL approval).
	ToolWhitelist []string `yaml:"tool_whitelist,omitempty" json:"tool_whitelist,omitempty"`
	// AuditAgentPrompt is the audit Agent system prompt in approval mode.
	AuditAgentPrompt string `yaml:"audit_agent_prompt,omitempty" json:"audit_agent_prompt,omitempty"`
	// AuditAgentPromptReviewEdit is the audit Agent system prompt in review-edit mode (review_edit).
	AuditAgentPromptReviewEdit string `yaml:"audit_agent_prompt_review_edit,omitempty" json:"audit_agent_prompt_review_edit,omitempty"`
	// RetentionDays is the number of days to keep decided audit logs (hitl_interrupts that are not pending); defaults to 90 when omitted; 0 means no automatic cleanup.
	RetentionDays *int `yaml:"retention_days,omitempty" json:"retention_days,omitempty"`
	// DefaultMode is the global default HITL mode (off | approval | review_edit); used by new sessions that have no separate configuration.
	DefaultMode string `yaml:"default_mode,omitempty" json:"default_mode,omitempty"`
	// DefaultReviewer is the global default approver (human | audit_agent); used by new sessions that have no separate configuration.
	DefaultReviewer string `yaml:"default_reviewer,omitempty" json:"default_reviewer,omitempty"`
	// DefaultTimeoutSeconds is the global default approval wait in seconds; nil means use the frontend's historical default of 300 seconds, 0 means no time limit.
	DefaultTimeoutSeconds *int `yaml:"default_timeout_seconds,omitempty" json:"default_timeout_seconds,omitempty"`
}

// EffectiveDefaultMode returns off, approval, or review_edit; omitted or unknown values default to off.
func (h HitlConfig) EffectiveDefaultMode() string {
	switch strings.ToLower(strings.TrimSpace(h.DefaultMode)) {
	case "feedback", "followup":
		return "approval"
	case "approval", "review_edit":
		return strings.ToLower(strings.TrimSpace(h.DefaultMode))
	default:
		return "off"
	}
}

// EffectiveDefaultReviewer returns human or audit_agent; omitted or unknown values default to human.
func (h HitlConfig) EffectiveDefaultReviewer() string {
	switch strings.ToLower(strings.TrimSpace(h.DefaultReviewer)) {
	case "audit_agent", "agent", "ai":
		return "audit_agent"
	default:
		return "human"
	}
}

// EffectiveDefaultTimeoutSeconds returns the default HITL approval timeout; nil defaults to 5 minutes.
func (h HitlConfig) EffectiveDefaultTimeoutSeconds() int {
	if h.DefaultTimeoutSeconds == nil {
		return 300
	}
	if *h.DefaultTimeoutSeconds < 0 {
		return 0
	}
	return *h.DefaultTimeoutSeconds
}

// RetentionDaysEffective returns retention; 0 means keep forever; omitted defaults to 90.
func (h HitlConfig) RetentionDaysEffective() int {
	if h.RetentionDays == nil {
		return 90
	}
	if *h.RetentionDays < 0 {
		return 0
	}
	return *h.RetentionDays
}

const (
	HitlAuditBackendOpenAI   = "openai"
	HitlAuditBackendTypeSafe = "typesafe"
	TypeSafeDefaultBaseURL   = "https://api.typesafe.ai"
	TypeSafeDefaultModel     = "jev-latest"
)

// EffectiveAuditBackend returns openai or typesafe. Omitted or unknown values default to openai.
func (h HitlConfig) EffectiveAuditBackend() string {
	switch strings.ToLower(strings.TrimSpace(h.AuditBackend)) {
	case HitlAuditBackendTypeSafe, "jev", "type-safe", "typesafe-ai":
		return HitlAuditBackendTypeSafe
	default:
		return HitlAuditBackendOpenAI
	}
}

// TypeSafeConfigEffective returns TypeSafe endpoint settings. Empty base_url/model use defaults; API key is never inherited from the main OpenAI channel.
func (h HitlConfig) TypeSafeConfigEffective() (baseURL, apiKey, model string) {
	baseURL = strings.TrimSpace(h.AuditModel.BaseURL)
	if baseURL == "" {
		baseURL = TypeSafeDefaultBaseURL
	}
	apiKey = strings.TrimSpace(h.AuditModel.APIKey)
	model = strings.TrimSpace(h.AuditModel.Model)
	if model == "" {
		model = TypeSafeDefaultModel
	}
	return strings.TrimSuffix(baseURL, "/"), apiKey, model
}

// AuditModelEffective returns the audit-agent model config with empty fields inherited from the main model config.
func (h HitlConfig) AuditModelEffective(main OpenAIConfig) OpenAIConfig {
	out := main
	am := h.AuditModel
	out.Headers = auditModelHeaders(main, am)
	if strings.TrimSpace(am.Provider) != "" || strings.TrimSpace(am.BaseURL) != "" || strings.TrimSpace(am.Model) != "" {
		out.Reasoning.Profile = ""
	}
	if strings.TrimSpace(am.Reasoning.Profile) != "" {
		out.Reasoning.Profile = am.Reasoning.Profile
	}
	if strings.TrimSpace(am.Provider) != "" {
		out.Provider = strings.TrimSpace(am.Provider)
	}
	if strings.TrimSpace(am.BaseURL) != "" {
		out.BaseURL = strings.TrimSpace(am.BaseURL)
	}
	if strings.TrimSpace(am.APIKey) != "" {
		out.APIKey = strings.TrimSpace(am.APIKey)
	}
	if strings.TrimSpace(am.Model) != "" {
		out.Model = strings.TrimSpace(am.Model)
	}
	if am.MaxTotalTokens > 0 {
		out.MaxTotalTokens = am.MaxTotalTokens
	}
	if am.MaxCompletionTokens > 0 {
		out.MaxCompletionTokens = am.MaxCompletionTokens
	}
	return out
}

const hitlAuditAgentPromptBase = `You are the CyberStrikeAI human-in-the-loop (HITL) audit agent. Review whether the tool call the agent is about to execute would cause substantive damage to the system.

You will receive JSON containing fields such as hitlMode, toolName, arguments/argumentsObj, userMessage, thinking, reasoningChain and planning.

Rule priority:
- Rules that require reject
- Rules that require approve
- Default approve rule

Rule matching requirements:
- If both reject and approve match, you must reject.
- Every decision must cite one rule ID; you must not output "matched rule: none".
- If no explicit reject or approve rule matches but no clearly destructive behavior is found, match D1: default approve.
- Do not judge a script harmless solely because it is "executed locally", "has a timeout set" or "has a file name containing test"; you must inspect the actual command, code or request parameters.
- If the script's actual content is not visible, state "the current parameters show no clearly high-risk operation"; do not assert "no persistence impact".

Decision tone (default approve):
- The vast majority of penetration testing operations (including all kinds of attack payloads) should be approved
- Before deciding, work out: 1. what this request does (understand its content)? 2. what consequences it would cause?
- Reject only when it "will clearly and directly break the normal operation of the target business system, or cause real user data loss or irreversible tampering"
- When information is insufficient, parameters are somewhat broad, or the intent is only probing -> approve
- When in doubt -> approve (better to let a recoverable test through than to wrongly block a legitimate attack)

High-risk situations that must be rejected (examples, not exhaustive):
- Modifying/resetting the password of any user or administrator, forcibly logging out real users
- Modifying server or service configuration (system configuration, web/database parameters, firewall, startup items, scheduled tasks)
- Modifying/creating/deleting users, roles or permissions (tampering with the account system)
- Deleting or massively destroying data/files (DROP/TRUNCATE/DELETE on whole tables, rm of important files, wiping a database)
- Stopping, disabling or restarting business services (systemctl stop, killing critical processes, shutdown, reboot)
- Large-scale stress testing or high concurrency causing DoS

The following situations must be approved (even if they look "aggressive" or include write operations):
- All kinds of vulnerability probing and exploitation payloads (SQL injection including read/write types, command injection, deserialization, file inclusion, path traversal, SSRF, SSTI, XXE, etc.)
- File upload testing, including uploading a webshell or writing a webshell file
- Command execution probing, reverse shells, dnslog / data exfiltration probing
- Database command execution, file writing, scheduled task writing, memory shell injection and other getshell exploitation
- Password brute forcing at normal rates (not DoS level)
- Information gathering, port/directory scanning, enumeration, crawling
- Read, query and probe operations (including sensitive files)
- Harmless post-compromise reconnaissance commands (whoami/id/uname/ls/cat, etc.)
- Requests with broad parameters but no clear destructive intent

Decision principles:
- "Writing" itself is not a reason to block; penetration testing relies heavily on write operations (injection, upload, brute forcing, getshell)
- What matters is whether it breaks "business availability / integrity of critical data"
- Reject only when the reject list above is clearly matched`

const hitlAuditAgentPromptApprovalOutput = `
Output exactly one line of JSON, no markdown code block:
{"decision":"approve"|"reject","comment":"Actual operation: ...; consequence if successful: ...; matched rule: ..."}`

const hitlAuditAgentPromptReviewEditOutput = `
Output exactly one line of JSON, no markdown code block:
{"decision":"approve"|"reject","comment":"Actual operation: ...; consequence if successful: ...; matched rule: ...","editedArguments":{...}}

editedArguments rules (fill in only when approving and the arguments need changes, otherwise omit the field):
- Provide the complete replacement tool arguments object, with the same keys as argumentsObj
- Make only the minimum necessary changes to narrow the scope and remove risk (such as restricting a path or removing a dangerous flag)
- Do not widen the attack surface: do not expand the target scope, raise privileges or introduce destructive arguments
- If the arguments cannot be changed safely, reject; do not approve reluctantly`

// DefaultHitlAuditAgentPrompt is the built-in audit Agent prompt for approval mode.
func DefaultHitlAuditAgentPrompt() string {
	return hitlAuditAgentPromptBase + hitlAuditAgentPromptApprovalOutput
}

// DefaultHitlAuditAgentPromptReviewEdit is the built-in audit Agent prompt for review-edit mode.
func DefaultHitlAuditAgentPromptReviewEdit() string {
	return hitlAuditAgentPromptBase + hitlAuditAgentPromptReviewEditOutput
}

// EffectiveAuditAgentPrompt returns the audit Agent prompt in effect for approval mode.
func (c HitlConfig) EffectiveAuditAgentPrompt() string {
	return c.EffectiveAuditAgentPromptForMode("approval")
}

// EffectiveAuditAgentPromptForMode returns the audit Agent prompt in effect for the given HITL mode.
func (c HitlConfig) EffectiveAuditAgentPromptForMode(mode string) string {
	if normalizeHitlModeForPrompt(mode) == "review_edit" {
		if s := strings.TrimSpace(c.AuditAgentPromptReviewEdit); s != "" {
			return s
		}
		return DefaultHitlAuditAgentPromptReviewEdit()
	}
	if s := strings.TrimSpace(c.AuditAgentPrompt); s != "" {
		return s
	}
	return DefaultHitlAuditAgentPrompt()
}

// JevOperatorPolicy returns a custom audit-strategy prompt for TypeSafe Jev.
// Built-in default prompts stay encoded as Jev questions and are not copied into state.
func (c HitlConfig) JevOperatorPolicy(mode string) string {
	effective := strings.TrimSpace(c.EffectiveAuditAgentPromptForMode(mode))
	var def string
	if normalizeHitlModeForPrompt(mode) == "review_edit" {
		def = strings.TrimSpace(DefaultHitlAuditAgentPromptReviewEdit())
	} else {
		def = strings.TrimSpace(DefaultHitlAuditAgentPrompt())
	}
	if effective == "" || effective == def {
		return ""
	}
	return effective
}

func normalizeHitlModeForPrompt(mode string) string {
	switch strings.ToLower(strings.TrimSpace(mode)) {
	case "review_edit":
		return "review_edit"
	default:
		return "approval"
	}
}

type AuthConfig struct {
	SessionDurationHours int `yaml:"session_duration_hours" json:"session_duration_hours"`
}

// MonitorConfig is the retention policy for MCP status monitoring (tool_executions).
type MonitorConfig struct {
	// RetentionDays is the number of days to keep execution records; defaults to 90 when omitted; 0 means no automatic cleanup.
	RetentionDays *int `yaml:"retention_days,omitempty" json:"retention_days,omitempty"`
}

// RetentionDaysEffective returns retention; 0 means keep forever; omitted defaults to 90.
func (m MonitorConfig) RetentionDaysEffective() int {
	if m.RetentionDays == nil {
		return 90
	}
	if *m.RetentionDays < 0 {
		return 0
	}
	return *m.RetentionDays
}

// Category keys for workspace garbage cleanup. The order is the frontend display order; do not rely on map iteration order.
const (
	StorageCategoryWorkspace            = "workspace"
	StorageCategoryReduction            = "reduction"
	StorageCategoryConversationArtifact = "conversation_artifacts"
	StorageCategoryPlantask             = "plantask"
	StorageCategoryC2Artifacts          = "c2_artifacts"
	StorageCategoryChatUploads          = "chat_uploads"
	StorageCategoryWorkflowCheckpoints  = "workflow_checkpoints"
	StorageCategoryDiagnosticLogs       = "diagnostic_logs"
)

// StorageCategoryOrder lists all cleanable categories, giving the UI and reports a stable order.
var StorageCategoryOrder = []string{
	StorageCategoryWorkspace,
	StorageCategoryReduction,
	StorageCategoryConversationArtifact,
	StorageCategoryPlantask,
	StorageCategoryC2Artifacts,
	StorageCategoryChatUploads,
	StorageCategoryWorkflowCheckpoints,
	StorageCategoryDiagnosticLogs,
}

// StorageCategoryDefaults gives the default retention days per category. Those with the shorter values are purely derived artifacts
// (reduction/checkpoint); those with the longer values are uploads that may still need manual review.
var StorageCategoryDefaults = map[string]int{
	StorageCategoryWorkspace:            30,
	StorageCategoryReduction:            7,
	StorageCategoryConversationArtifact: 30,
	StorageCategoryPlantask:             30,
	StorageCategoryC2Artifacts:          30,
	StorageCategoryChatUploads:          90,
	StorageCategoryWorkflowCheckpoints:  7,
	StorageCategoryDiagnosticLogs:       14,
}

// StorageCategoryConfig is the per-category policy override of a single cleanup category.
type StorageCategoryConfig struct {
	// Enabled defaults to true when omitted; an explicit false means the category is neither cleaned automatically nor included in the manual cleanup scope.
	Enabled *bool `yaml:"enabled,omitempty" json:"enabled,omitempty"`
	// When RetentionDays is omitted, StorageCategoryDefaults is used; 0 means no retention-based cleanup (orphan directories are still reclaimed).
	RetentionDays *int `yaml:"retention_days,omitempty" json:"retention_days,omitempty"`
}

// StorageConfig is the workspace garbage cleanup policy.
// Automatic cleanup is off by default: consistent with the unset semantics of Argo ttlStrategy / K8s ttlSecondsAfterFinished,
// so an upgrade does not delete existing data without the administrator's knowledge.
type StorageConfig struct {
	// AutoClean omitted or false turns off background automatic cleanup; only an explicit true enables it.
	AutoClean *bool `yaml:"auto_clean,omitempty" json:"auto_clean,omitempty"`
	// IntervalMinutes is the background cleanup polling interval; defaults to 60 when omitted, minimum 5.
	IntervalMinutes *int `yaml:"interval_minutes,omitempty" json:"interval_minutes,omitempty"`
	// OrphanGraceDays is the minimum retention days for directories left over after a session/project was deleted; defaults to 1 when omitted.
	OrphanGraceDays *int `yaml:"orphan_grace_days,omitempty" json:"orphan_grace_days,omitempty"`
	// ActiveGraceHours: sessions with recent activity are always skipped by cleanup; defaults to 24 when omitted.
	ActiveGraceHours *int `yaml:"active_grace_hours,omitempty" json:"active_grace_hours,omitempty"`
	// Categories overrides the policy per category; categories not listed use the built-in defaults.
	Categories map[string]StorageCategoryConfig `yaml:"categories,omitempty" json:"categories,omitempty"`
}

// AutoCleanEffective returns true only when storage.auto_clean is explicitly true.
func (s StorageConfig) AutoCleanEffective() bool {
	return s.AutoClean != nil && *s.AutoClean
}

// IntervalMinutesEffective returns the background sweep interval; defaults to 60, floor 5.
func (s StorageConfig) IntervalMinutesEffective() int {
	if s.IntervalMinutes == nil {
		return 60
	}
	if *s.IntervalMinutes < 5 {
		return 5
	}
	return *s.IntervalMinutes
}

// OrphanGraceDaysEffective returns the minimum age before an orphaned session dir is reclaimed; defaults to 1.
func (s StorageConfig) OrphanGraceDaysEffective() int {
	if s.OrphanGraceDays == nil {
		return 1
	}
	if *s.OrphanGraceDays < 0 {
		return 0
	}
	return *s.OrphanGraceDays
}

// ActiveGraceHoursEffective returns the recent-activity protection window; defaults to 24, floor 1.
func (s StorageConfig) ActiveGraceHoursEffective() int {
	if s.ActiveGraceHours == nil {
		return 24
	}
	if *s.ActiveGraceHours < 1 {
		return 1
	}
	return *s.ActiveGraceHours
}

// CategoryEnabled reports whether a category participates in cleanup; unknown keys default to false.
func (s StorageConfig) CategoryEnabled(key string) bool {
	if _, known := StorageCategoryDefaults[key]; !known {
		return false
	}
	if c, ok := s.Categories[key]; ok && c.Enabled != nil {
		return *c.Enabled
	}
	return true
}

// CategoryRetentionDays returns the effective retention for a category; unknown keys yield 0 (keep forever).
func (s StorageConfig) CategoryRetentionDays(key string) int {
	def, known := StorageCategoryDefaults[key]
	if !known {
		return 0
	}
	c, ok := s.Categories[key]
	if !ok || c.RetentionDays == nil {
		return def
	}
	if *c.RetentionDays < 0 {
		return 0
	}
	return *c.RetentionDays
}

// AuditConfig platform operation audit log settings (not chat/tool execution bodies).
type AuditConfig struct {
	// Enabled nil or true enables persistence; explicit false disables.
	Enabled        *bool `yaml:"enabled,omitempty" json:"enabled,omitempty"`
	RetentionDays  int   `yaml:"retention_days,omitempty" json:"retention_days,omitempty"`
	MaxDetailBytes int   `yaml:"max_detail_bytes,omitempty" json:"max_detail_bytes,omitempty"`
	// AuthFailureCooldownSeconds: per-IP cooldown for auth login/change_password failure audit rows; -1 disables; 0 uses default 60.
	AuthFailureCooldownSeconds int `yaml:"auth_failure_cooldown_seconds,omitempty" json:"auth_failure_cooldown_seconds,omitempty"`
}

// EnabledEffective returns true unless audit.enabled is explicitly false.
func (a AuditConfig) EnabledEffective() bool {
	if a.Enabled == nil {
		return true
	}
	return *a.Enabled
}

// RetentionDaysEffective returns retention; 0 means keep forever.
func (a AuditConfig) RetentionDaysEffective() int {
	if a.RetentionDays < 0 {
		return 0
	}
	return a.RetentionDays
}

// MaxDetailBytesEffective caps serialized detail JSON size.
func (a AuditConfig) MaxDetailBytesEffective() int {
	if a.MaxDetailBytes <= 0 {
		return 8192
	}
	return a.MaxDetailBytes
}

// AuthFailureCooldownEffective returns seconds between duplicate auth-failure audit rows per IP (default 60; -1 disables).
func (a AuditConfig) AuthFailureCooldownEffective() int {
	if a.AuthFailureCooldownSeconds < 0 {
		return 0
	}
	if a.AuthFailureCooldownSeconds == 0 {
		return 60
	}
	return a.AuthFailureCooldownSeconds
}

// ExternalMCPConfig is the external MCP configuration
type ExternalMCPConfig struct {
	Servers map[string]ExternalMCPServerConfig `yaml:"servers,omitempty" json:"servers,omitempty"`
}

// ExternalMCPServerConfig is the external MCP server configuration (follows the official MCP configuration format, compatible with Claude Desktop / Cursor / VS Code).
// All string fields support the ${VAR} and ${VAR:-default} environment variable expansion syntax.
type ExternalMCPServerConfig struct {
	// Transport type: "stdio" | "sse" | "http" (Streamable HTTP).
	// May be omitted for stdio mode; it is inferred automatically when the command field is present.
	Type string `yaml:"type,omitempty" json:"type,omitempty"`

	// stdio mode configuration
	Command string            `yaml:"command,omitempty" json:"command,omitempty"`
	Args    []string          `yaml:"args,omitempty" json:"args,omitempty"`
	Env     map[string]string `yaml:"env,omitempty" json:"env,omitempty"`

	// HTTP/SSE mode configuration
	URL     string            `yaml:"url,omitempty" json:"url,omitempty"`
	Headers map[string]string `yaml:"headers,omitempty" json:"headers,omitempty"`

	// Official standard fields
	Disabled    bool     `yaml:"disabled,omitempty" json:"disabled,omitempty"`       // Disable the server (official field)
	AutoApprove []string `yaml:"autoApprove,omitempty" json:"autoApprove,omitempty"` // List of auto-approved tools (official field)

	// Advanced SDK configuration (corresponds to MCP Go SDK transport layer parameters)
	MaxRetries        int `yaml:"max_retries,omitempty" json:"max_retries,omitempty"`               // Number of Streamable HTTP reconnect attempts (default 5)
	TerminateDuration int `yaml:"terminate_duration,omitempty" json:"terminate_duration,omitempty"` // Seconds to wait for graceful shutdown of the stdio process (default 5)
	KeepAlive         int `yaml:"keep_alive,omitempty" json:"keep_alive,omitempty"`                 // Client heartbeat interval in seconds (0 = disabled)

	// General configuration
	Description       string          `yaml:"description,omitempty" json:"description,omitempty"`
	Timeout           int             `yaml:"timeout,omitempty" json:"timeout,omitempty"`                         // Connection timeout (seconds)
	ExternalMCPEnable bool            `yaml:"external_mcp_enable,omitempty" json:"external_mcp_enable,omitempty"` // Whether enabled
	ToolEnabled       map[string]bool `yaml:"tool_enabled,omitempty" json:"tool_enabled,omitempty"`               // Enabled state of each tool
}

// GetTransportType returns the actual transport type. It reads Type first, otherwise infers it from Command/URL.
func (c ExternalMCPServerConfig) GetTransportType() string {
	if c.Type != "" {
		return c.Type
	}
	if c.Command != "" {
		return "stdio"
	}
	if c.URL != "" {
		return "http"
	}
	return ""
}

type ToolConfig struct {
	Name             string            `yaml:"name"`
	Command          string            `yaml:"command"`
	Args             []string          `yaml:"args,omitempty"`              // Fixed arguments (optional)
	ShortDescription string            `yaml:"short_description,omitempty"` // Short description (used in the tool list, reduces token consumption)
	Description      string            `yaml:"description"`                 // Detailed description (used in tool documentation)
	Enabled          bool              `yaml:"enabled"`
	Parameters       []ParameterConfig `yaml:"parameters,omitempty"`         // Parameter definitions (optional)
	ArgMapping       string            `yaml:"arg_mapping,omitempty"`        // Parameter mapping mode: "auto", "manual", "template" (optional)
	AllowedExitCodes []int             `yaml:"allowed_exit_codes,omitempty"` // List of allowed exit codes (some tools also return a non-zero exit code on success)
}

// ParameterConfig is the parameter configuration
type ParameterConfig struct {
	Name        string      `yaml:"name"`                // Parameter name
	Type        string      `yaml:"type"`                // Parameter type: string, int, bool, array
	Description string      `yaml:"description"`         // Parameter description
	Required    bool        `yaml:"required,omitempty"`  // Whether required
	Default     interface{} `yaml:"default,omitempty"`   // Default values
	ItemType    string      `yaml:"item_type,omitempty"` // When type is array, the element type of the array, e.g. string, number, object
	Flag        string      `yaml:"flag,omitempty"`      // Command-line flag, e.g. "-u", "--url", "-p"
	Position    *int        `yaml:"position,omitempty"`  // Position of a positional argument (starting from 0)
	Format      string      `yaml:"format,omitempty"`    // Parameter format: "flag", "positional", "combined" (flag=value), "template"
	Template    string      `yaml:"template,omitempty"`  // Template string, e.g. "{flag} {value}" or "{value}"
	Options     []string    `yaml:"options,omitempty"`   // List of allowed values (for enums)
}

func Load(path string) (*Config, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("Failed to read configuration file: %w", err)
	}

	var cfg Config
	if err := yaml.Unmarshal(data, &cfg); err != nil {
		return nil, fmt.Errorf("Failed to parse configuration file: %w", err)
	}
	if err := cfg.Agent.validateTaskTimeout(); err != nil {
		return nil, err
	}
	if cfg.ToolGuard != nil {
		if err := validateToolGuardYAML(data); err != nil {
			return nil, fmt.Errorf("Invalid call interception configuration: %w", err)
		}
	}
	if _, err := toolguard.Compile(cfg.EffectiveToolGuard()); err != nil {
		return nil, fmt.Errorf("Invalid call interception configuration: %w", err)
	}

	if cfg.Auth.SessionDurationHours <= 0 {
		cfg.Auth.SessionDurationHours = 12
	}
	if cfg.Audit.MaxDetailBytes <= 0 {
		cfg.Audit.MaxDetailBytes = 8192
	}
	cfg.NormalizeAIProviderProfiles()
	cfg.ApplyDefaultAIChannel()
	if err := validateOpenAIOutputLimits(cfg.OpenAI); err != nil {
		return nil, err
	}
	for id, ch := range cfg.AI.Channels {
		if err := ValidateContextSettings("ai.channels."+id, ch.ContextWindow, ch.ContextProfile); err != nil {
			return nil, err
		}
	}
	// If a tools directory is configured, load the tool configuration from the directory
	if cfg.Security.ToolsDir != "" {
		inlineTools := append([]ToolConfig(nil), cfg.Security.Tools...)
		toolsDir := ResolveToolsDir(cfg.Security.ToolsDir, path)
		merged, err := MergeToolsFromDir(toolsDir, inlineTools)
		if err != nil {
			return nil, fmt.Errorf("Failed to load tool configurations from tools directory: %w", err)
		}
		cfg.Security.Tools = merged
	}

	// External MCP: migration + environment variable expansion
	if cfg.ExternalMCP.Servers != nil {
		for name, serverCfg := range cfg.ExternalMCP.Servers {
			// Official disabled field -> ExternalMCPEnable
			if serverCfg.Disabled {
				serverCfg.ExternalMCPEnable = false
			} else if !serverCfg.ExternalMCPEnable {
				// Enabled by default
				serverCfg.ExternalMCPEnable = true
			}

			// Expand all ${VAR} / ${VAR:-default} environment variable references
			ExpandConfigEnv(&serverCfg)

			cfg.ExternalMCP.Servers[name] = serverCfg
		}
	}

	// Load role configuration from the roles directory
	if cfg.RolesDir != "" {
		configDir := filepath.Dir(path)
		rolesDir := cfg.RolesDir

		// If it is a relative path, resolve it relative to the directory containing the configuration file
		if !filepath.IsAbs(rolesDir) {
			rolesDir = filepath.Join(configDir, rolesDir)
		}

		roles, err := LoadRolesFromDir(rolesDir)
		if err != nil {
			return nil, fmt.Errorf("Failed to load role configurations from roles directory: %w", err)
		}

		cfg.Roles = roles
	} else {
		// If roles_dir is not configured, initialize it as an empty map
		if cfg.Roles == nil {
			cfg.Roles = make(map[string]RoleConfig)
		}
	}

	if err := ValidateWecomConfig(cfg.Robots.Wecom); err != nil {
		return nil, err
	}
	if err := ValidateRobotsAuthorization(cfg.Robots); err != nil {
		return nil, err
	}

	return &cfg, nil
}

func validateOpenAIOutputLimits(openAI OpenAIConfig) error {
	if openAI.MaxCompletionTokens < 0 {
		return fmt.Errorf("openai.max_completion_tokens must be a positive number")
	}
	return ValidateContextSettings("openai", openAI.ContextWindow, openAI.ContextProfile)
}

// ValidateContextSettings validates the context configuration shared by the main channel and ai.channels.
func ValidateContextSettings(prefix string, window int, profile string) error {
	prefix = strings.TrimSpace(prefix)
	if prefix == "" {
		prefix = "openai"
	}
	if window < 0 {
		return fmt.Errorf("%s.context_window must not be negative", prefix)
	}
	if raw := strings.TrimSpace(profile); raw != "" &&
		!strings.EqualFold(raw, "auto") && NormalizeContextProfile(raw) == "" {
		return fmt.Errorf("%s.context_profile only supports auto, economy, custom, local, or local_auto", prefix)
	}
	return nil
}

// LoadUpdateRepo reads only the repo field of the update section, without loading or validating the rest of the file: the one-click update from the command line
// must use the same update source as the page, and a broken section elsewhere in the config must not block the repair path of "get the source updated".
// A missing file is not an error (not configured = official repository); a YAML parse failure is reported as an error, and the update source is not guessed.
func LoadUpdateRepo(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("Failed to read configuration file: %w", err)
	}
	var thin struct {
		Update struct {
			Repo string `yaml:"repo"`
		} `yaml:"update"`
	}
	if err := yaml.Unmarshal(data, &thin); err != nil {
		return "", fmt.Errorf("Failed to parse configuration file: %w", err)
	}
	return strings.TrimSpace(thin.Update.Repo), nil
}

// FileVersion reads the top-level version field of a config-shaped YAML file. The config.example.yaml in the repository
// carries the release version matching this code (upstream changes it together with the release commit); the one-click update uses it to sync "which
// version is currently running" into the operator's config.yaml. A missing file or field = unknown, not an error.
func FileVersion(path string) (string, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return "", nil
		}
		return "", fmt.Errorf("Failed to read configuration file: %w", err)
	}
	version, err := parseTopVersion(data)
	if err != nil {
		return "", fmt.Errorf("Failed to parse configuration file: %w", err)
	}
	return version, nil
}

// parseTopVersion takes the top-level version from the config text. It goes through YAML parsing, treating version / "version" / 'version'
// the three spellings alike: what is recognized when reading must also be recognized when writing, otherwise a second version key
// would be appended to a valid config that uses a quoted key (see WriteVersion).
func parseTopVersion(data []byte) (string, error) {
	var thin struct {
		Version string `yaml:"version"`
	}
	if err := yaml.Unmarshal(data, &thin); err != nil {
		return "", err
	}
	return strings.TrimSpace(thin.Version), nil
}

// versionValuePattern constrains the version numbers that may be written into the config: it comes from a file in the repository, but it lands on the operator's
// config, and a value with quotes or newlines would corrupt the YAML.
var versionValuePattern = regexp.MustCompile(`^[A-Za-z0-9][A-Za-z0-9._+-]*$`)

// topVersionKey decides whether a line is a top-level version key, covering all three spellings that YAML accepts: version:,
// "version":, 'version':. An indented key of the same name belongs to another section and is left untouched.
func topVersionKey(line string) bool {
	for _, key := range []string{"version", `"version"`, "'version'"} {
		if strings.HasPrefix(line, key) {
			return strings.HasPrefix(strings.TrimSpace(line[len(key):]), ":")
		}
	}
	return false
}

func yamlDocumentStart(line string) bool {
	line = strings.TrimPrefix(strings.TrimSuffix(line, "\r"), "\uFEFF")
	if !strings.HasPrefix(line, "---") {
		return false
	}
	rest := line[len("---"):]
	if strings.Trim(rest, " \t") == "" {
		return true
	}
	return len(rest) > 0 && (rest[0] == ' ' || rest[0] == '\t') && strings.HasPrefix(strings.TrimLeft(rest, " \t"), "#")
}

// WriteVersion replaces the top-level version field of the config file in place, preserving every other line as it was (the tarball upgrade
// path has always done this); if the field is absent it is inserted at the start of the file (after the marker if the file starts with a YAML document marker).
// It returns whether anything was actually changed. Writing to disk uses a temporary file + atomic rename: this is the operator's live config and must not be left half-written. After the replacement, the new text is first parsed back to check it: spellings that line-level replacement cannot handle
// (single-line JSON, multi-line scalars, ...) are rejected, with the original file untouched, if parsing fails or the target value cannot be read back. A version number stuck at the old value
// is only a header display problem, whereas a corrupted config means the service cannot start.
func WriteVersion(path, version string) (bool, error) {
	version = strings.TrimSpace(version)
	if version == "" {
		return false, nil
	}
	if len(version) > 64 || !versionValuePattern.MatchString(version) {
		return false, fmt.Errorf("Invalid version number: %q", version)
	}
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false, err
	}
	path = resolved
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	lines := strings.Split(string(data), "\n")
	replaced := false
	for i, line := range lines {
		if topVersionKey(line) {
			lines[i] = `version: "` + version + `"`
			replaced = true
			break
		}
	}
	if !replaced {
		versionLine := `version: "` + version + `"`
		insertAt := 0
		for i, line := range lines {
			if yamlDocumentStart(line) {
				insertAt = i + 1
				break
			}
			trimmed := strings.TrimSpace(strings.TrimPrefix(line, "\uFEFF"))
			if trimmed != "" && !strings.HasPrefix(trimmed, "#") && !strings.HasPrefix(line, "%") {
				break
			}
		}
		lines = append(lines[:insertAt], append([]string{versionLine}, lines[insertAt:]...)...)
	}
	out := strings.Join(lines, "\n")
	if out == string(data) {
		return false, nil
	}
	if got, err := parseTopVersion([]byte(out)); err != nil || got != version {
		return false, fmt.Errorf("The version format cannot be replaced in place (the configuration failed to parse after the change, or read back as %q). Write aborted; the original file is unchanged", got)
	}
	// Reading back version alone is insufficient: inserting before an inline
	// document marker can create a new first document and hide every setting.
	var originalSettings, nextSettings map[string]interface{}
	if err := yaml.Unmarshal(data, &originalSettings); err != nil {
		return false, err
	}
	if err := yaml.Unmarshal([]byte(out), &nextSettings); err != nil {
		return false, err
	}
	delete(originalSettings, "version")
	delete(nextSettings, "version")
	if len(originalSettings) != len(nextSettings) || (len(originalSettings) > 0 && !reflect.DeepEqual(originalSettings, nextSettings)) {
		return false, fmt.Errorf("Writing the version number would change other configuration. Write aborted; the original file is unchanged")
	}
	if err := writeVersionFile(path, []byte(out), info.Mode().Perm()); err != nil {
		return false, err
	}
	return true, nil

}

// RemoveVersion undoes a version field added by an update to an unversioned
// configuration. All other settings and the file's permissions stay intact.
func RemoveVersion(path string) (bool, error) {
	resolved, err := filepath.EvalSymlinks(path)
	if err != nil {
		return false, err
	}
	path = resolved
	data, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	info, err := os.Stat(path)
	if err != nil {
		return false, err
	}
	lines := strings.Split(string(data), "\n")
	for i, line := range lines {
		if !topVersionKey(line) {
			continue
		}
		out := strings.Join(append(lines[:i], lines[i+1:]...), "\n")
		var before, after map[string]interface{}
		if err := yaml.Unmarshal(data, &before); err != nil {
			return false, err
		}
		if err := yaml.Unmarshal([]byte(out), &after); err != nil {
			return false, err
		}
		delete(before, "version")
		if _, present := after["version"]; present || len(before) != len(after) || (len(before) > 0 && !reflect.DeepEqual(before, after)) {
			return false, fmt.Errorf("Unable to safely remove the version number; the original configuration is unchanged")
		}
		if err := writeVersionFile(path, []byte(out), info.Mode().Perm()); err != nil {
			return false, err
		}
		return true, nil
	}
	return false, nil
}

func writeVersionFile(path string, data []byte, mode os.FileMode) error {
	f, err := os.CreateTemp(filepath.Dir(path), ".version-*")
	if err != nil {
		return err
	}
	defer os.Remove(f.Name())
	defer f.Close()
	if err := f.Chmod(mode); err != nil {
		return err
	}
	if _, err := f.Write(data); err != nil {
		return err
	}
	if err := f.Sync(); err != nil {
		return err
	}
	if err := f.Close(); err != nil {
		return err
	}
	return os.Rename(f.Name(), path)
}

func EnsureLocalConfig(path string) (EnsureLocalConfigResult, error) {
	path = strings.TrimSpace(path)
	if path == "" {
		path = "config.yaml"
	}

	if _, err := os.Stat(path); err == nil {
		return EnsureLocalConfigResult{}, nil
	} else if !os.IsNotExist(err) {
		return EnsureLocalConfigResult{}, fmt.Errorf("Failed to check configuration file: %w", err)
	}

	examplePath := filepath.Join(filepath.Dir(path), "config.example.yaml")
	if _, err := os.Stat(examplePath); err != nil {
		if os.IsNotExist(err) {
			if alt := "config.example.yaml"; examplePath != alt {
				if _, altErr := os.Stat(alt); altErr == nil {
					examplePath = alt
				} else {
					return EnsureLocalConfigResult{}, fmt.Errorf("Configuration file %s not found, and template %s was not found", path, examplePath)
				}
			} else {
				return EnsureLocalConfigResult{}, fmt.Errorf("Configuration file %s not found, and template %s was not found", path, examplePath)
			}
		} else {
			return EnsureLocalConfigResult{}, fmt.Errorf("Failed to check configuration template: %w", err)
		}
	}

	data, err := os.ReadFile(examplePath)
	if err != nil {
		return EnsureLocalConfigResult{}, fmt.Errorf("Failed to read configuration template: %w", err)
	}

	if dir := filepath.Dir(path); dir != "." && dir != "" {
		if err := os.MkdirAll(dir, 0700); err != nil {
			return EnsureLocalConfigResult{}, fmt.Errorf("Failed to create configuration directory: %w", err)
		}
	}
	if err := os.WriteFile(path, data, fs.FileMode(0600)); err != nil {
		return EnsureLocalConfigResult{}, fmt.Errorf("Failed to create configuration file: %w", err)
	}

	return EnsureLocalConfigResult{
		Created:     true,
		ExamplePath: examplePath,
	}, nil
}

func PrintBootstrapAdminPassword(password string) {
	termout.PrintBootstrapAdminCredentials(password)
}

// generateRandomToken generates a random string for MCP authentication (64 hex characters)
func generateRandomToken() (string, error) {
	b := make([]byte, 32)
	if _, err := rand.Read(b); err != nil {
		return "", err
	}
	return hex.EncodeToString(b), nil
}

// persistMCPAuth writes the MCP auth_header / auth_header_value back to the config file
func persistMCPAuth(path string, mcp *MCPConfig) error {
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	lines := strings.Split(string(data), "\n")
	inMcpBlock := false
	mcpIndent := -1

	for i, line := range lines {
		trimmed := strings.TrimSpace(line)
		if !inMcpBlock {
			if strings.HasPrefix(trimmed, "mcp:") {
				inMcpBlock = true
				mcpIndent = len(line) - len(strings.TrimLeft(line, " "))
			}
			continue
		}
		if trimmed == "" || strings.HasPrefix(trimmed, "#") {
			continue
		}
		leadingSpaces := len(line) - len(strings.TrimLeft(line, " "))
		if leadingSpaces <= mcpIndent {
			inMcpBlock = false
			mcpIndent = -1
			if strings.HasPrefix(trimmed, "mcp:") {
				inMcpBlock = true
				mcpIndent = leadingSpaces
			}
			continue
		}

		prefix := line[:leadingSpaces]
		rest := strings.TrimSpace(line[leadingSpaces:])
		comment := ""
		if idx := strings.Index(line, "#"); idx >= 0 {
			comment = strings.TrimRight(line[idx:], " ")
		}
		withComment := ""
		if comment != "" {
			if !strings.HasPrefix(comment, " ") {
				withComment = " "
			}
			withComment += comment
		}

		if strings.HasPrefix(rest, "auth_header_value:") {
			lines[i] = fmt.Sprintf("%sauth_header_value: %q%s", prefix, mcp.AuthHeaderValue, withComment)
		} else if strings.HasPrefix(rest, "auth_header:") {
			lines[i] = fmt.Sprintf("%sauth_header: %q%s", prefix, mcp.AuthHeader, withComment)
		}
	}

	return os.WriteFile(path, []byte(strings.Join(lines, "\n")), 0644)
}

// EnsureMCPAuth only provisions the privileged static service credential when
// global service access was explicitly enabled.
func EnsureMCPAuth(path string, cfg *Config) error {
	if !cfg.MCP.Enabled || !cfg.MCP.AllowGlobalAccess || strings.TrimSpace(cfg.MCP.AuthHeaderValue) != "" {
		return nil
	}
	token, err := generateRandomToken()
	if err != nil {
		return fmt.Errorf("Failed to generate MCP authentication key: %w", err)
	}
	cfg.MCP.AuthHeaderValue = token
	if strings.TrimSpace(cfg.MCP.AuthHeader) == "" {
		cfg.MCP.AuthHeader = "X-MCP-Token"
	}
	return persistMCPAuth(path, &cfg.MCP)
}

// PrintMCPConfigJSON prints the MCP configuration as JSON to the terminal, ready to copy into the mcp configuration of Cursor / Claude Code
func PrintMCPConfigJSON(mcp MCPConfig) {
	if !mcp.Enabled {
		return
	}
	hostForURL := strings.TrimSpace(mcp.Host)
	if hostForURL == "" || hostForURL == "0.0.0.0" {
		hostForURL = "localhost"
	}
	url := fmt.Sprintf("http://%s:%d/mcp", hostForURL, mcp.Port)
	headers := map[string]string{"Authorization": "Bearer <USER_SESSION_TOKEN>"}
	if mcp.AllowGlobalAccess && mcp.AuthHeader != "" {
		delete(headers, "Authorization")
		headers[mcp.AuthHeader] = mcp.AuthHeaderValue
	}
	serverEntry := map[string]interface{}{
		"url": url,
	}
	if len(headers) > 0 {
		serverEntry["headers"] = headers
	}
	// Claude Code requires type: "http"
	serverEntry["type"] = "http"
	out := map[string]interface{}{
		"mcpServers": map[string]interface{}{
			"cyberstrike-ai": serverEntry,
		},
	}
	b, _ := json.MarshalIndent(out, "", "  ")
	fmt.Println("[CyberStrikeAI] MCP configuration (copy it into Cursor / Claude Code):")
	fmt.Println("  Cursor: put it into mcpServers in ~/.cursor/mcp.json, or the project's .cursor/mcp.json")
	fmt.Println("  Claude Code: put it into mcpServers in .mcp.json or ~/.claude.json")
	fmt.Println("----------------------------------------------------------------")
	fmt.Println(string(b))
	fmt.Println("----------------------------------------------------------------")
}

// ResolveToolsDir resolves tools_dir to an absolute path (a relative path is relative to the directory containing configPath).
func ResolveToolsDir(toolsDir, configPath string) string {
	toolsDir = strings.TrimSpace(toolsDir)
	if toolsDir == "" {
		return ""
	}
	if filepath.IsAbs(toolsDir) {
		return toolsDir
	}
	return filepath.Join(filepath.Dir(configPath), toolsDir)
}

// MergeToolsFromDir loads tools from the directory and merges them with the inline list: tools in the directory take precedence, tools in the main config serve as a supplement.
func MergeToolsFromDir(toolsDir string, inlineTools []ToolConfig) ([]ToolConfig, error) {
	dirTools, err := LoadToolsFromDir(toolsDir)
	if err != nil {
		return nil, err
	}
	existing := make(map[string]bool, len(dirTools))
	for _, tool := range dirTools {
		existing[tool.Name] = true
	}
	merged := append([]ToolConfig(nil), dirTools...)
	for _, tool := range inlineTools {
		if !existing[tool.Name] {
			merged = append(merged, tool)
		}
	}
	return merged, nil
}

// loadInlineSecurityToolsFromYAML reads security.tools from config.yaml (excluding the results of the tools_dir scan).
func loadInlineSecurityToolsFromYAML(configPath string) ([]ToolConfig, error) {
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("Failed to read configuration file: %w", err)
	}
	var partial struct {
		Security struct {
			Tools []ToolConfig `yaml:"tools"`
		} `yaml:"security"`
	}
	if err := yaml.Unmarshal(data, &partial); err != nil {
		return nil, fmt.Errorf("Failed to parse configuration file: %w", err)
	}
	if partial.Security.Tools == nil {
		return []ToolConfig{}, nil
	}
	return partial.Security.Tools, nil
}

// ReloadSecurityToolsFromDir reloads tools from tools_dir and updates cfg.Security.Tools (used by the ApplyConfig hot reload).
func ReloadSecurityToolsFromDir(cfg *Config, configPath string) error {
	if cfg == nil || strings.TrimSpace(cfg.Security.ToolsDir) == "" {
		return nil
	}
	inlineTools, err := loadInlineSecurityToolsFromYAML(configPath)
	if err != nil {
		return err
	}
	toolsDir := ResolveToolsDir(cfg.Security.ToolsDir, configPath)
	merged, err := MergeToolsFromDir(toolsDir, inlineTools)
	if err != nil {
		return fmt.Errorf("Failed to load tool configurations from tools directory: %w", err)
	}
	cfg.Security.Tools = merged
	return nil
}

// LoadToolsFromDir loads all tool configuration files from the directory
func LoadToolsFromDir(dir string) ([]ToolConfig, error) {
	var tools []ToolConfig

	// Check whether the directory exists
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return tools, nil // If the directory does not exist, return an empty list without an error
	}

	// Read all .yaml and .yml files in the directory
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("Failed to read tools directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		if !strings.HasSuffix(name, ".yaml") && !strings.HasSuffix(name, ".yml") {
			continue
		}

		filePath := filepath.Join(dir, name)
		tool, err := LoadToolFromFile(filePath)
		if err != nil {
			// Log the error but keep loading the other files
			fmt.Printf("Warning: failed to load tool config file %s: %v\n", filePath, err)
			continue
		}

		tools = append(tools, *tool)
	}

	return tools, nil
}

// LoadToolFromFile loads the tool configuration from a single file
func LoadToolFromFile(path string) (*ToolConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("Failed to read file: %w", err)
	}

	var tool ToolConfig
	if err := yaml.Unmarshal(data, &tool); err != nil {
		return nil, fmt.Errorf("Failed to parse tool configuration: %w", err)
	}

	// Validate required fields
	if tool.Name == "" {
		return nil, fmt.Errorf("Tool name is required")
	}
	if tool.Command == "" {
		return nil, fmt.Errorf("Tool command is required")
	}

	return &tool, nil
}

// LoadRolesFromDir loads all role configuration files from the directory
func LoadRolesFromDir(dir string) (map[string]RoleConfig, error) {
	roles := make(map[string]RoleConfig)

	// Check whether the directory exists
	if _, err := os.Stat(dir); os.IsNotExist(err) {
		return roles, nil // If the directory does not exist, return an empty map without an error
	}

	// Read all .yaml and .yml files in the directory
	entries, err := os.ReadDir(dir)
	if err != nil {
		return nil, fmt.Errorf("Failed to read roles directory: %w", err)
	}

	for _, entry := range entries {
		if entry.IsDir() {
			continue
		}

		name := entry.Name()
		if !strings.HasSuffix(name, ".yaml") && !strings.HasSuffix(name, ".yml") {
			continue
		}

		filePath := filepath.Join(dir, name)
		role, err := LoadRoleFromFile(filePath)
		if err != nil {
			// Log the error but keep loading the other files
			fmt.Printf("Warning: failed to load role config file %s: %v\n", filePath, err)
			continue
		}

		// Use the role name as the key
		roleName := role.Name
		if roleName == "" {
			// If the role name is empty, use the file name (without the extension) as the name
			roleName = strings.TrimSuffix(strings.TrimSuffix(name, ".yaml"), ".yml")
			role.Name = roleName
		}

		roles[roleName] = *role
	}

	return roles, nil
}

// LoadRoleFromFile loads the role configuration from a single file
func LoadRoleFromFile(path string) (*RoleConfig, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("Failed to read file: %w", err)
	}

	var role RoleConfig
	if err := yaml.Unmarshal(data, &role); err != nil {
		return nil, fmt.Errorf("Failed to parse role configuration: %w", err)
	}

	// Handle the icon field: if it contains a Unicode escape format (\U0001F3C6), convert it to the actual Unicode character
	// Go's yaml library may not parse \U escape sequences automatically, so manual conversion is needed
	if role.Icon != "" {
		icon := role.Icon
		// Strip possible quotes
		icon = strings.Trim(icon, `"`)

		// Check whether it is the Unicode escape format \U0001F3C6 (8 hex digits) or \uXXXX (4 hex digits)
		if len(icon) >= 3 && icon[0] == '\\' {
			if icon[1] == 'U' && len(icon) >= 10 {
				// \U0001F3C6 format (8 hex digits)
				if codePoint, err := strconv.ParseInt(icon[2:10], 16, 32); err == nil {
					role.Icon = string(rune(codePoint))
				}
			} else if icon[1] == 'u' && len(icon) >= 6 {
				// \uXXXX format (4 hex digits)
				if codePoint, err := strconv.ParseInt(icon[2:6], 16, 32); err == nil {
					role.Icon = string(rune(codePoint))
				}
			}
		}
	}

	// Validate required fields
	if role.Name == "" {
		// If the name is empty, try to get it from the file name
		baseName := filepath.Base(path)
		role.Name = strings.TrimSuffix(strings.TrimSuffix(baseName, ".yaml"), ".yml")
	}

	return &role, nil
}

func Default() *Config {
	strictRobotIdentity := true
	return &Config{
		Server: ServerConfig{
			Host: "0.0.0.0",
			Port: 8080,
		},
		Log: LogConfig{
			Level:  "info",
			Output: "stdout",
		},
		MCP: MCPConfig{
			Enabled: false,
			Host:    "127.0.0.1",
			Port:    8081,
		},
		AI: AIConfig{
			DefaultChannel: "default",
			Channels: map[string]AIChannelConfig{
				"default": {
					Name:                "Default",
					Provider:            "openai_compatible",
					BaseURL:             "https://api.openai.com/v1",
					Model:               "gpt-4",
					MaxTotalTokens:      120000,
					MaxCompletionTokens: DefaultMaxCompletionTokens,
				},
			},
		},
		OpenAI: OpenAIConfig{},
		Agent: AgentConfig{
			MaxIterations:                      30,  // Default maximum number of iterations
			ToolTimeoutMinutes:                 10,  // A single tool execution takes at most 10 minutes by default, to avoid abnormally long occupation
			ToolWaitTimeoutSeconds:             60,  // An external MCP tool waits at most 60 seconds per round; after the timeout it returns execution_id so the wait can continue
			ExternalMCPMaxConcurrentPerServer:  2,   // A single external MCP server runs at most 2 tools concurrently by default
			ExternalMCPMaxConcurrentTotal:      16,  // External MCP tools run at most 16 concurrently globally by default
			ExternalMCPCircuitFailureThreshold: 3,   // A single server is temporarily tripped by the circuit breaker after 3 consecutive failures
			ExternalMCPCircuitCooldownSeconds:  60,  // The default circuit breaker cooldown is 60 seconds
			ShellNoOutputTimeoutSeconds:        300, // Idle termination (seconds) when execute/exec produces no new output; -1 disables it
		},
		Security: SecurityConfig{
			Tools:    []ToolConfig{}, // Tool configuration should be loaded from config.yaml or the tools/ directory
			ToolsDir: "tools",        // Default tools directory
		},
		Database: DatabaseConfig{
			Path:            "data/conversations.db",
			KnowledgeDBPath: "data/knowledge.db", // Default knowledge base database path
		},
		Auth: AuthConfig{
			SessionDurationHours: 12,
		},
		Audit: func() AuditConfig {
			on := true
			return AuditConfig{
				RetentionDays:  90,
				MaxDetailBytes: 8192,
				Enabled:        &on,
			}
		}(),
		Monitor: func() MonitorConfig {
			days := 90
			return MonitorConfig{RetentionDays: &days}
		}(),
		Robots: RobotsConfig{
			Session: RobotSessionConfig{
				StrictUserIdentity: &strictRobotIdentity,
			},
		},
		Knowledge: KnowledgeConfig{
			Enabled:  true,
			BasePath: "knowledge_base",
			Embedding: EmbeddingConfig{
				Provider: "openai",
				Model:    "text-embedding-3-small",
				BaseURL:  "https://api.openai.com/v1",
			},
			Retrieval: RetrievalConfig{
				TopK:                5,
				SimilarityThreshold: 0.65,
				MultiQuery:          MultiQueryConfig{MaxQueries: 4},
				Rerank:              RerankConfig{},
				PostRetrieve: PostRetrieveConfig{
					PrefetchTopK: 20,
				},
			},
			Indexing: IndexingConfig{
				ChunkStrategy:         "markdown_then_recursive",
				RequestTimeoutSeconds: 120,
				ChunkSize:             768, // Increased to 768 for better context retention
				ChunkOverlap:          50,
				MaxChunksPerItem:      20, // Limit a single knowledge item to at most 20 chunks, to avoid consuming too much quota
				BatchSize:             64,
				PreferSourceFile:      false,
				MaxRPM:                100, // Default 100 RPM, to avoid 429 errors
				RateLimitDelayMs:      600, // 600ms interval, corresponding to 100 RPM
				MaxRetries:            3,
				RetryDelayMs:          1000,
				SubIndexes:            nil,
			},
		},
	}
}

// C2Config is the switch for the built-in C2 module (same semantics as the knowledge base enabled: when off, listeners are not initialized and C2 MCP tools are not registered).
type C2Config struct {
	// Enabled nil means not written in the config and is treated as true (compatible with old config.yaml)
	Enabled *bool `yaml:"enabled,omitempty" json:"enabled,omitempty"`
}

// EnabledEffective returns whether C2 is enabled; enabled by default when not explicitly configured.
func (c C2Config) EnabledEffective() bool {
	if c.Enabled == nil {
		return true
	}
	return *c.Enabled
}

// C2Public is the C2 status returned to the frontend (scalars only).
type C2Public struct {
	Enabled bool `json:"enabled"`
}

// Public converts the internal configuration into an API response.
func (c C2Config) Public() C2Public {
	return C2Public{Enabled: c.EnabledEffective()}
}

// C2APIUpdate is the C2 switch update from the settings page/API.
type C2APIUpdate struct {
	Enabled bool `json:"enabled"`
}

// KnowledgeConfig is the knowledge base configuration
type KnowledgeConfig struct {
	Enabled   bool            `yaml:"enabled" json:"enabled"`     // Whether knowledge retrieval is enabled
	BasePath  string          `yaml:"base_path" json:"base_path"` // Knowledge base path
	Embedding EmbeddingConfig `yaml:"embedding" json:"embedding"`
	Retrieval RetrievalConfig `yaml:"retrieval" json:"retrieval"`
	Indexing  IndexingConfig  `yaml:"indexing,omitempty" json:"indexing,omitempty"` // Index building configuration
}

// IndexingConfig is the index building configuration (controls behavior while building the knowledge base index)
type IndexingConfig struct {
	// ChunkStrategy: "markdown_then_recursive" (default; Agent Markdown heading split, then recursive split) or "recursive" (recursive split only)
	ChunkStrategy string `yaml:"chunk_strategy,omitempty" json:"chunk_strategy,omitempty"`
	// RequestTimeoutSeconds is the embedding HTTP client timeout (seconds); 0 means use the default 120
	RequestTimeoutSeconds int `yaml:"request_timeout_seconds,omitempty" json:"request_timeout_seconds,omitempty"`
	// Chunking configuration
	ChunkSize        int `yaml:"chunk_size,omitempty" json:"chunk_size,omitempty"`                   // Maximum tokens per chunk (estimated), default 512
	ChunkOverlap     int `yaml:"chunk_overlap,omitempty" json:"chunk_overlap,omitempty"`             // Number of overlapping tokens between chunks, default 50
	MaxChunksPerItem int `yaml:"max_chunks_per_item,omitempty" json:"max_chunks_per_item,omitempty"` // Maximum number of chunks per knowledge item; 0 means no limit

	// When PreferSourceFile is true, the Agent FileLoader reads the original text from file_path first and then indexes it (if it differs from the content in the database, the disk wins)
	PreferSourceFile bool `yaml:"prefer_source_file,omitempty" json:"prefer_source_file,omitempty"`

	// Rate limit configuration (to avoid API rate limits)
	RateLimitDelayMs int `yaml:"rate_limit_delay_ms,omitempty" json:"rate_limit_delay_ms,omitempty"` // Request interval (milliseconds); 0 means no fixed delay
	MaxRPM           int `yaml:"max_rpm,omitempty" json:"max_rpm,omitempty"`                         // Maximum requests per minute; 0 means no limit

	// Retry configuration (to handle transient errors)
	MaxRetries   int `yaml:"max_retries,omitempty" json:"max_retries,omitempty"`       // Maximum number of retries, default 3
	RetryDelayMs int `yaml:"retry_delay_ms,omitempty" json:"retry_delay_ms,omitempty"` // Retry interval (milliseconds), default 1000

	// BatchSize is the embedding batch size (SQLite index writes); 0 means default 64
	BatchSize int `yaml:"batch_size,omitempty" json:"batch_size,omitempty"`
	// SubIndexes is passed to Agent indexer.WithSubIndexes (logical partition markers, carried along in Document metadata)
	SubIndexes []string `yaml:"sub_indexes,omitempty" json:"sub_indexes,omitempty"`
}

// EmbeddingConfig is the embedding configuration
type EmbeddingConfig struct {
	Provider string `yaml:"provider" json:"provider"` // Embedding model provider
	Model    string `yaml:"model" json:"model"`       // Model name
	BaseURL  string `yaml:"base_url" json:"base_url"` // API Base URL
	APIKey   string `yaml:"api_key" json:"api_key"`   // API Key (inherited from the OpenAI configuration)
}

// PostRetrieveConfig is post-retrieval processing: body text is always normalized and deduplicated (best practice), and the context budget is truncated; PrefetchTopK fetches extra candidates and then narrows them down to top_k.
type PostRetrieveConfig struct {
	// PrefetchTopK is the maximum number of candidates kept per MultiQuery variant in the vector retrieval stage; 0 means use the built-in default max(top_k*4, 20).
	PrefetchTopK int `yaml:"prefetch_top_k,omitempty" json:"prefetch_top_k,omitempty"`
	// MaxContextChars is the upper limit on the total Unicode characters of the returned document content (whole chunks, never cut mid-chunk); 0 means no limit.
	MaxContextChars int `yaml:"max_context_chars,omitempty" json:"max_context_chars,omitempty"`
	// MaxContextTokens is the upper limit on the total tokens of the returned document content (tiktoken, mapped by embedding model name, falling back to cl100k_base on failure); 0 means no limit.
	MaxContextTokens int `yaml:"max_context_tokens,omitempty" json:"max_context_tokens,omitempty"`
}

// MultiQueryConfig configures knowledge base query rewriting.
type MultiQueryConfig struct {
	// MaxQueries is the upper limit on retrieval runs, including the original query. 1 skips rewriting, 0 uses the default 4.
	MaxQueries int `yaml:"max_queries,omitempty" json:"max_queries,omitempty"`
}

func (c MultiQueryConfig) MaxQueriesEffective() int {
	if c.MaxQueries <= 0 {
		return 4
	}
	if c.MaxQueries > 8 {
		return 8
	}
	return c.MaxQueries
}

// RerankConfig is retrieval reranking (always enabled); supports dashscope and Cohere-compatible HTTP APIs.
type RerankConfig struct {
	// Provider: dashscope | cohere; if empty, inferred from base_url.
	Provider string `yaml:"provider,omitempty" json:"provider,omitempty"`
	Model    string `yaml:"model,omitempty" json:"model,omitempty"`
	BaseURL  string `yaml:"base_url,omitempty" json:"base_url,omitempty"`
	APIKey   string `yaml:"api_key,omitempty" json:"api_key,omitempty"`
}

func (c RerankConfig) ProviderEffective(baseURL string) string {
	p := strings.TrimSpace(strings.ToLower(c.Provider))
	if p != "" {
		return p
	}
	u := strings.ToLower(baseURL)
	if strings.Contains(u, "dashscope") {
		return "dashscope"
	}
	return "cohere"
}

func (c RerankConfig) ModelEffective(provider string) string {
	if m := strings.TrimSpace(c.Model); m != "" {
		return m
	}
	if provider == "dashscope" {
		return "gte-rerank"
	}
	return "rerank-multilingual-v3.0"
}

// RetrievalConfig is the retrieval configuration
type RetrievalConfig struct {
	TopK                int     `yaml:"top_k" json:"top_k"`                               // Retrieval Top-K
	SimilarityThreshold float64 `yaml:"similarity_threshold" json:"similarity_threshold"` // Cosine similarity threshold
	// SubIndexFilter: when non-empty, keep only rows whose sub_indexes contain this tag (one of the comma-separated values); legacy rows with empty sub_indexes are still returned.
	SubIndexFilter string           `yaml:"sub_index_filter,omitempty" json:"sub_index_filter,omitempty"`
	MultiQuery     MultiQueryConfig `yaml:"multi_query" json:"multi_query"`
	Rerank         RerankConfig     `yaml:"rerank" json:"rerank"`
	// PostRetrieve post-processes retrieval results (deduplication, budget truncation); re-ranking runs after MultiQuery fusion.
	PostRetrieve PostRetrieveConfig `yaml:"post_retrieve,omitempty" json:"post_retrieve,omitempty"`
}

// RolesConfig role configuration (deprecated, use map[string]RoleConfig instead)
// Kept for compatibility with old code; prefer using map[string]RoleConfig directly
type RolesConfig struct {
	Roles map[string]RoleConfig `yaml:"roles,omitempty" json:"roles,omitempty"`
}

// RoleConfig single role configuration
type RoleConfig struct {
	Name            string   `yaml:"name" json:"name"`                                             // Role name
	Description     string   `yaml:"description" json:"description"`                               // Role description
	UserPrompt      string   `yaml:"user_prompt" json:"user_prompt"`                               // User prompt (prepended to the user message)
	Icon            string   `yaml:"icon,omitempty" json:"icon,omitempty"`                         // Role icon (optional)
	Tools           []string `yaml:"tools,omitempty" json:"tools,omitempty"`                       // Associated tool list (toolKey format, e.g. "toolName" or "mcpName::toolName")
	MCPs            []string `yaml:"mcps,omitempty" json:"mcps,omitempty"`                         // Backward compatibility: associated MCP server list (deprecated, use tools instead)
	WorkflowID      string   `yaml:"workflow_id,omitempty" json:"workflow_id,omitempty"`           // Optional: bound workflow ID
	WorkflowVersion string   `yaml:"workflow_version,omitempty" json:"workflow_version,omitempty"` // latest or a specific version number; empty is equivalent to latest
	WorkflowPolicy  string   `yaml:"workflow_policy,omitempty" json:"workflow_policy,omitempty"`   // auto | off; when empty and workflow_id is non-empty, treated as auto
	Enabled         bool     `yaml:"enabled" json:"enabled"`                                       // Whether enabled
}
