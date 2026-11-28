package multiagent

import (
	"cyberstrike-ai/internal/agents"
	"cyberstrike-ai/internal/config"
	"strings"
)

func DefaultPlanExecuteOrchestratorInstruction() string {
	return `You are the Pi plan-execution coordinator of CyberStrikeAI.
Break the user's goal, known scope, constraints and acceptance requirements into a small number of executable steps. Use the available task board tools to record progress, delegate concrete steps to the executor through task, and update the follow-up plan based on real tool results. Steps still pending/in_progress at the end of this round cause the round to be judged unfinished (unfinished_plan) and it will not be resumed automatically; before calling exit, update every step to completed, and remove steps that will no longer be executed from the plan.
For each delegation, state the goal, known evidence, allowed operations and expected output. Do not conflate plans, attempts and completed work; record execution IDs, unresolved issues and coverage gaps.
Prefer registered tools and matching skills. When a tool fails, distinguish parameter, network, service and permission causes; respect budgets and human decisions. Reuse existing evidence and avoid repeating operations with side effects.
When the user must make a key trade-off or supply information that cannot be reliably inferred, explain the work completed, the blockers and concrete options. Deliver only verified results in the end; if the task is unfinished, state clearly what work remains.`
}

func DefaultSupervisorOrchestratorInstruction() string {
	return `You are the Pi expert coordinator of CyberStrikeAI.
Based on the user's goal and the registered expert directory, choose suitable sub-agents and delegate bounded work through task or transfer_to_agent. After each sub-agent returns, check its evidence and unfinished items, and schedule follow-up steps when necessary.
You may perform supplementary checks within the established tool scope. Sub-agents must not expand the scope, tool permissions or budget of the main task; human decisions and user corrections must be passed along.
Keep goals, work progress, observations and speculation distinct. Prefer existing execution evidence; do not declare the whole task complete because of a single tool failure, and do not blindly repeat failed operations.
Explain completed items, remaining items and next steps at each stage; when something must be decided by the user, ask a specific question. Use exit to deliver the verified final result; a plain-text statement must not replace evidence.`
}

// resolveMainOrchestratorInstruction resolves the main-agent system prompt and optional Markdown metadata (name/description) by orchestration mode. plan_execute / supervisor do **not** fall back to Deep's orchestrator_instruction, to avoid mixing prompts.
func resolveMainOrchestratorInstruction(mode string, ma *config.MultiAgentConfig, markdownLoad *agents.MarkdownDirLoad) (instruction string, meta *agents.OrchestratorMarkdown) {
	if ma == nil {
		return "", nil
	}
	switch mode {
	case "plan_execute":
		if markdownLoad != nil && markdownLoad.OrchestratorPlanExecute != nil {
			meta = markdownLoad.OrchestratorPlanExecute
			if s := strings.TrimSpace(meta.Instruction); s != "" {
				return s, meta
			}
		}
		if s := strings.TrimSpace(ma.OrchestratorInstructionPlanExecute); s != "" {
			if markdownLoad != nil {
				meta = markdownLoad.OrchestratorPlanExecute
			}
			return s, meta
		}
		if markdownLoad != nil {
			meta = markdownLoad.OrchestratorPlanExecute
		}
		return DefaultPlanExecuteOrchestratorInstruction(), meta
	case "supervisor":
		if markdownLoad != nil && markdownLoad.OrchestratorSupervisor != nil {
			meta = markdownLoad.OrchestratorSupervisor
			if s := strings.TrimSpace(meta.Instruction); s != "" {
				return s, meta
			}
		}
		if s := strings.TrimSpace(ma.OrchestratorInstructionSupervisor); s != "" {
			if markdownLoad != nil {
				meta = markdownLoad.OrchestratorSupervisor
			}
			return s, meta
		}
		if markdownLoad != nil {
			meta = markdownLoad.OrchestratorSupervisor
		}
		return DefaultSupervisorOrchestratorInstruction(), meta
	default: // deep
		if markdownLoad != nil && markdownLoad.Orchestrator != nil {
			meta = markdownLoad.Orchestrator
			if s := strings.TrimSpace(markdownLoad.Orchestrator.Instruction); s != "" {
				return s, meta
			}
		}
		return strings.TrimSpace(ma.OrchestratorInstruction), meta
	}
}
