package builtin

// Built-in tool name constants
// Everywhere in the code that uses built-in tool names should use these constants, not hard-coded strings
const (
	// Vulnerability management tools
	ToolRecordVulnerability       = "record_vulnerability"
	ToolListVulnerabilities       = "list_vulnerabilities"
	ToolGetVulnerability          = "get_vulnerability"
	ToolUpdateVulnerabilityStatus = "update_vulnerability_status"

	// Asset management tools
	ToolCreateAsset       = "create_asset"
	ToolGetAsset          = "get_asset"
	ToolQueryAssets       = "query_assets"
	ToolUpdateAsset       = "update_asset"
	ToolDeleteAsset       = "delete_asset"
	ToolCompleteAssetScan = "complete_asset_scan"

	// Project blackboard (facts) tools
	ToolUpsertProjectFact    = "upsert_project_fact"
	ToolGetProjectFact       = "get_project_fact"
	ToolListProjectFacts     = "list_project_facts"
	ToolSearchProjectFacts   = "search_project_facts"
	ToolDeprecateProjectFact = "deprecate_project_fact"
	ToolRestoreProjectFact   = "restore_project_fact"

	// Knowledge base tools
	ToolListKnowledgeRiskTypes = "list_knowledge_risk_types"
	ToolSearchKnowledgeBase    = "search_knowledge_base"

	// Visual analysis (local image → VL model → text summary)
	ToolAnalyzeImage = "analyze_image"

	// Long-running tool execution control (query/wait/cancel background executions)
	ToolGetToolExecution    = "get_tool_execution"
	ToolWaitToolExecution   = "wait_tool_execution"
	ToolCancelToolExecution = "cancel_tool_execution"

	// WebShell assistant tools (used by the AI in WebShell management - AI assistant)
	ToolWebshellExec      = "webshell_exec"
	ToolWebshellFileList  = "webshell_file_list"
	ToolWebshellFileRead  = "webshell_file_read"
	ToolWebshellFileWrite = "webshell_file_write"

	// WebShell connection management tools (for managing webshell connections via MCP)
	ToolManageWebshellList   = "manage_webshell_list"
	ToolManageWebshellAdd    = "manage_webshell_add"
	ToolManageWebshellUpdate = "manage_webshell_update"
	ToolManageWebshellDelete = "manage_webshell_delete"
	ToolManageWebshellTest   = "manage_webshell_test"

	// Batch task queue (consistent with the Web batch tasks; lets the model create, start/stop and query queues)
	ToolBatchTaskList            = "batch_task_list"
	ToolBatchTaskGet             = "batch_task_get"
	ToolBatchTaskCreate          = "batch_task_create"
	ToolBatchTaskStart           = "batch_task_start"
	ToolBatchTaskRerun           = "batch_task_rerun"
	ToolBatchTaskPause           = "batch_task_pause"
	ToolBatchTaskDelete          = "batch_task_delete"
	ToolBatchTaskUpdateMetadata  = "batch_task_update_metadata"
	ToolBatchTaskUpdateSchedule  = "batch_task_update_schedule"
	ToolBatchTaskScheduleEnabled = "batch_task_schedule_enabled"
	ToolBatchTaskAdd             = "batch_task_add_task"
	ToolBatchTaskUpdate          = "batch_task_update_task"
	ToolBatchTaskRemove          = "batch_task_remove_task"

	// C2 toolset (similar items merged, 8 unified tools)
	ToolC2Listener   = "c2_listener"    // Listener management (create/start/stop/list/get/update/delete)
	ToolC2Session    = "c2_session"     // Session management (list/get/set_sleep/kill/delete)
	ToolC2Task       = "c2_task"        // Task dispatch (unified task_type parameter)
	ToolC2TaskManage = "c2_task_manage" // Task management (get_result/wait/list/cancel)
	ToolC2Payload    = "c2_payload"     // Payload generation (oneliner/build)
	ToolC2Event      = "c2_event"       // Event query
	ToolC2Profile    = "c2_profile"     // Malleable Profile management (list/get/create/update/delete)
	ToolC2File       = "c2_file"        // File management (list/get_result)
)

// IsBuiltinTool checks whether the tool name is a built-in tool
func IsBuiltinTool(toolName string) bool {
	switch toolName {
	case ToolRecordVulnerability,
		ToolListVulnerabilities,
		ToolGetVulnerability,
		ToolUpdateVulnerabilityStatus,
		ToolCreateAsset,
		ToolGetAsset,
		ToolQueryAssets,
		ToolUpdateAsset,
		ToolDeleteAsset,
		ToolCompleteAssetScan,
		ToolUpsertProjectFact,
		ToolGetProjectFact,
		ToolListProjectFacts,
		ToolSearchProjectFacts,
		ToolDeprecateProjectFact,
		ToolRestoreProjectFact,
		ToolListKnowledgeRiskTypes,
		ToolSearchKnowledgeBase,
		ToolAnalyzeImage,
		ToolGetToolExecution,
		ToolWaitToolExecution,
		ToolCancelToolExecution,
		ToolWebshellExec,
		ToolWebshellFileList,
		ToolWebshellFileRead,
		ToolWebshellFileWrite,
		ToolManageWebshellList,
		ToolManageWebshellAdd,
		ToolManageWebshellUpdate,
		ToolManageWebshellDelete,
		ToolManageWebshellTest,
		ToolBatchTaskList,
		ToolBatchTaskGet,
		ToolBatchTaskCreate,
		ToolBatchTaskStart,
		ToolBatchTaskRerun,
		ToolBatchTaskPause,
		ToolBatchTaskDelete,
		ToolBatchTaskUpdateMetadata,
		ToolBatchTaskUpdateSchedule,
		ToolBatchTaskScheduleEnabled,
		ToolBatchTaskAdd,
		ToolBatchTaskUpdate,
		ToolBatchTaskRemove,
		// C2 tools
		ToolC2Listener,
		ToolC2Session,
		ToolC2Task,
		ToolC2TaskManage,
		ToolC2Payload,
		ToolC2Event,
		ToolC2Profile,
		ToolC2File:
		return true
	default:
		return false
	}
}

// GetAllBuiltinTools returns the list of all built-in tool names
func GetAllBuiltinTools() []string {
	return []string{
		ToolRecordVulnerability,
		ToolListVulnerabilities,
		ToolGetVulnerability,
		ToolUpdateVulnerabilityStatus,
		ToolCreateAsset,
		ToolGetAsset,
		ToolQueryAssets,
		ToolUpdateAsset,
		ToolDeleteAsset,
		ToolCompleteAssetScan,
		ToolUpsertProjectFact,
		ToolGetProjectFact,
		ToolListProjectFacts,
		ToolSearchProjectFacts,
		ToolDeprecateProjectFact,
		ToolRestoreProjectFact,
		ToolListKnowledgeRiskTypes,
		ToolSearchKnowledgeBase,
		ToolAnalyzeImage,
		ToolGetToolExecution,
		ToolWaitToolExecution,
		ToolCancelToolExecution,
		ToolWebshellExec,
		ToolWebshellFileList,
		ToolWebshellFileRead,
		ToolWebshellFileWrite,
		ToolManageWebshellList,
		ToolManageWebshellAdd,
		ToolManageWebshellUpdate,
		ToolManageWebshellDelete,
		ToolManageWebshellTest,
		ToolBatchTaskList,
		ToolBatchTaskGet,
		ToolBatchTaskCreate,
		ToolBatchTaskStart,
		ToolBatchTaskRerun,
		ToolBatchTaskPause,
		ToolBatchTaskDelete,
		ToolBatchTaskUpdateMetadata,
		ToolBatchTaskUpdateSchedule,
		ToolBatchTaskScheduleEnabled,
		ToolBatchTaskAdd,
		ToolBatchTaskUpdate,
		ToolBatchTaskRemove,
		// C2 tools
		ToolC2Listener,
		ToolC2Session,
		ToolC2Task,
		ToolC2TaskManage,
		ToolC2Payload,
		ToolC2Event,
		ToolC2Profile,
		ToolC2File,
	}
}
