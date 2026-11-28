// Package projectprompt provides the project blackboard system prompt text (pure strings, no database dependency).
// Referenced by packages such as agent and multiagent, to avoid an agent → project import cycle that breaks gopls metadata.
package projectprompt

import (
	"strings"

	"cyberstrike-ai/internal/mcp/builtin"
)

const (
	factRhythmCore              = "Do not wait until the session ends or wrap-up to write in bulk. After you **confirm** each new insight (open ports/service versions, entry paths, authentication state or credential traits, exploitable points or attack surface changes), **immediately** call `upsert_project_fact` (the same fact_key overwrites). After you **verify** each reproducible vulnerability (including POC/impact), **immediately** call `record_vulnerability`; you may record once as a fact and once as a vulnerability. Persist first before continuing with the next piece of work, to avoid losing details after context compression. If no project is bound, state that the blackboard cannot be written and still keep an evidence summary in this round."
	factRhythmCoordinatorSuffix = "When a delegation/subtask returns new insights or vulnerabilities, the coordinator writes them promptly; do not assume the sub-agent has recorded them."
	factRhythmSubAgentSuffix    = "If the toolset lacks the tools above, at the end of the deliverable give structured \"to be persisted\" entries (suggested fact_key, summary, key points of body/POC) so the coordinator can write them **immediately**."
)

// FactRecordingIncrementalRhythmMarkdown returns the Markdown for the edge-while-penetrating recording rhythm (aligned with the agents/*.md docs).
func FactRecordingIncrementalRhythmMarkdown(coordinator, subAgent bool) string {
	var b strings.Builder
	b.WriteString("- **Record as you pentest (mandatory rhythm)**: ")
	b.WriteString(factRhythmCore)
	if coordinator {
		b.WriteString(factRhythmCoordinatorSuffix)
	}
	if subAgent {
		b.WriteString(factRhythmSubAgentSuffix)
	}
	return b.String()
}

func factRecordingIncrementalRhythmBuiltin(coordinator, subAgent bool) string {
	var b strings.Builder
	b.WriteString("- **Record as you pentest (mandatory rhythm)**: Do not wait until the session ends or wrap-up to write in bulk. After you **confirm** each new insight (open ports/service versions, entry paths, authentication state or credential traits, exploitable points or attack surface changes), **immediately** call ")
	b.WriteString(builtin.ToolUpsertProjectFact)
	b.WriteString(" (the same fact_key overwrites). After you **verify** each reproducible vulnerability (including POC/impact), **immediately** call ")
	b.WriteString(builtin.ToolRecordVulnerability)
	b.WriteString("; you may record once as a fact and once as a vulnerability. Persist first before continuing with the next piece of work, to avoid losing details after context compression. If no project is bound, state that the blackboard cannot be written and still keep an evidence summary in this round.")
	if coordinator {
		b.WriteString(factRhythmCoordinatorSuffix)
	}
	if subAgent {
		b.WriteString(factRhythmSubAgentSuffix)
	}
	return b.String()
}

func factEdgeRecordingGuidance() string {
	return `### Fact relation edges (links)

- When writing **finding / chain / exploit / poc**, you **must** call ` + "`upsert_project_fact`" + ` with ` + "`links`" + ` (**recommended ` + "`from`" + `**: the source fact points to the current fact, i.e. ` + "`from`" + ` → current ` + "`fact_key`" + `).
- **Minimum requirement**: a finding needs at least 1 entry with from=target/* + type=discovered_on (i.e. target → finding); to record an exploit on a finding, use from=exploit/* + type=exploits (i.e. exploit → finding).
- **Common types**: ` + "`discovered_on`" + ` (where it was found), ` + "`depends_on`" + ` (reproduction prerequisite), ` + "`leads_to`" + ` (insight progression), ` + "`enables`" + ` (expands the attack surface), ` + "`exploits`" + ` (exploitation relationship), ` + "`contains`" + ` (asset containment), ` + "`part_of`" + ` (belongs to a chain/group), ` + "`supports`" + ` (supporting evidence).
- On update: **omit links to keep existing edges**; passing links **replaces** all relation edges (from → current fact).
- The "Depends on fact" paragraph in body may coexist with links (for human readers); links are authoritative for structured relations.`
}

func factRecordingGuidanceBlock() string {
	return `### Fact writing guidelines (audit reproduction / knowledge capture)

- **summary**: one line for the index; it must include the key points "what + where + how to trigger/verify" and must not be only a conclusion (e.g. just "SQLi exists").
- **body**: full reproducible context, written to the body field of ` + "`upsert_project_fact`" + `; the index does not include body, so later sessions must retrieve it with ` + "`get_project_fact`" + `.
- **category / fact_key suggestions**:
  - Environment knowledge: ` + "`target/`" + `, ` + "`auth/`" + `, ` + "`infra/`" + `, ` + "`business/`" + ` (the environment template is enough for the body)
  - Discovery and exploitation: ` + "`finding/`" + `, ` + "`chain/`" + `, ` + "`exploit/`" + `, ` + "`poc/`" + ` (you **must** fill the body completely using the attack-chain template: entry point, step-by-step attack chain, raw request/response or commands, evidence, related vulnerability ID)
- **Auto-resume records**: ` + "`note/context-*`" + ` is a system-reserved working summary of a session, not a fact confirmed by the project; do not overwrite this prefix with upsert_project_fact. By default, the index and fact tools only provide the resume records of the current session, while ordinary project facts remain shared. When cross-session reference is needed, explicitly use include_history=true of list_project_facts / search_project_facts / get_project_fact; list and search can use source_conversation_id to narrow the source. Historical results are labeled with the source session, update time and historical reference; check the current authorization, target and credential validity, and do not automatically run old tasks or treat old summaries as confirmed findings. When an exact value is missing, read back in segments following the snapshot path in the body, and do not guess the original value. The same session/agent updates the same key; to record verified shared facts, use a separate key such as finding/auth and keep the source evidence.
- **Division of labor with vulnerability records**: ` + "`record_vulnerability`" + ` records deliverable findings; facts record **all the context needed for reproduction** (including failed attempts, bypasses, dependent sessions), and each may be recorded once.
- When updating the same finding, keep the same ` + "`fact_key`" + ` and overwrite it; do not scatter multiple keys and lose context.`
}

// FactRecordingBlackboardSection is the full system prompt block for the project blackboard and vulnerability recording (shared by single and multi-agent main agents).
func FactRecordingBlackboardSection(coordinatorDelegate bool) string {
	var b strings.Builder
	b.WriteString("## Project blackboard (facts) and vulnerability records (separate)\n\n")
	b.WriteString("If the current conversation is bound to a project, the system automatically injects the \"Project blackboard index\" (only fact_key + summary). **When the summary is not enough you must call ")
	b.WriteString(builtin.ToolGetProjectFact)
	b.WriteString("(fact_key) to get the body; do not fabricate details from the summary.**\n\n")
	b.WriteString(factRecordingIncrementalRhythmBuiltin(coordinatorDelegate, false))
	b.WriteString("\n\n")
	b.WriteString("- **Knowledge about environment/targets/authentication, etc.** (not formal vulnerability entries): use ")
	b.WriteString(builtin.ToolUpsertProjectFact)
	b.WriteString(", with fact_key suggested as `category/slug` (e.g. target/primary_domain), overwriting on the same key; the body records ports/versions/credential traits and evidence sources.\n")
	b.WriteString("- **Discovery and exploitation context** (audit reproduction): fact_key prefixes finding/, chain/, exploit/, poc/ are recommended; **body is required** with the full attack chain (entry point → steps → raw request/response or commands → observed behavior → linked related_vulnerability_id), **do not write only a conclusion**; summary is a one-line key point of \"what + where + how to verify\".\n")
	b.WriteString("- **Deliverable vulnerabilities**: use ")
	b.WriteString(builtin.ToolRecordVulnerability)
	b.WriteString(", including title, severity, type, target, proof (POC), impact, remediation. Before recording, you can first use ")
	b.WriteString(builtin.ToolListVulnerabilities)
	b.WriteString(" to check for duplicates; for details use ")
	b.WriteString(builtin.ToolGetVulnerability)
	b.WriteString("(id) (by default only the current project/session). After retesting an existing vulnerability, use update_vulnerability_status(id, status, retest_notes) to update the status and append evidence; do not record duplicates; if it cannot be verified, keep the original status.\n")
	b.WriteString("- The same finding may need to be recorded **once each** (the fact records the **full attack chain and exploit details** for reproduction; the vulnerability records the formal finding). For false positives use ")
	b.WriteString(builtin.ToolDeprecateProjectFact)
	b.WriteString(" or the vulnerability status false_positive.\n")
	b.WriteString("- When there are many facts, use ")
	b.WriteString(builtin.ToolListProjectFacts)
	b.WriteString(" / ")
	b.WriteString(builtin.ToolSearchProjectFacts)
	b.WriteString(" to search.\n\n")
	b.WriteString(factEdgeRecordingGuidance())
	b.WriteString("\n\n")
	b.WriteString(factRecordingGuidanceBlock())
	b.WriteString("\n\nSeverity: critical / high / medium / low / info. The proof must include sufficient evidence (request/response, screenshots, command output, etc.).")
	return b.String()
}

// FactRecordingSubAgentSection is edge-while-penetrating recording for sub-agents (outputs pending-persist entries when no tools are available).
func FactRecordingSubAgentSection() string {
	return "## Record as you pentest\n\n" + ProjectResultRecordingGuidance() + "\n\n" + factRecordingIncrementalRhythmBuiltin(false, true) + "\n"
}

// FactRecordingBlackboardSectionMarkdown is the Markdown equivalent of FactRecordingBlackboardSection (tool names are literals, for agents/*.md).
func FactRecordingBlackboardSectionMarkdown(coordinatorDelegate bool) string {
	var b strings.Builder
	b.WriteString("## Project blackboard (facts) and vulnerability records (separate)\n\n")
	b.WriteString("If the current conversation is bound to a project, the system automatically injects the \"Project blackboard index\" (only `fact_key` + summary). **When the summary is not enough you must call `get_project_fact(fact_key)` to get the body; do not fabricate details from the summary.**\n\n")
	b.WriteString(FactRecordingIncrementalRhythmMarkdown(coordinatorDelegate, false))
	b.WriteString("\n\n")
	b.WriteString("- **Knowledge about environment/targets/authentication, etc.** (not formal vulnerabilities): use **`upsert_project_fact`**, with `fact_key` suggested as `category/slug` (e.g. `target/primary_domain`), overwriting on the same key; the body records ports/versions/credential traits and evidence sources.\n")
	b.WriteString("- **Discovery and exploitation context** (audit reproduction): `fact_key` prefixes `finding/`, `chain/`, `exploit/`, `poc/` are recommended; **body is required** with the full attack chain (entry point → steps → raw request/response or commands → observed behavior → linked `related_vulnerability_id`), **do not write only a conclusion**; summary is a one-line key point of \"what + where + how to verify\".\n")
	b.WriteString("- **Deliverable vulnerabilities**: use **`record_vulnerability`** (title, description, severity, type, target, proof POC, impact, remediation). Severity is critical / high / medium / low / info.\n")
	b.WriteString("- The same finding may need to be recorded **once each** (the fact records the reproducible attack chain; the vulnerability records the formal finding). For false positives use **`deprecate_project_fact`** or the vulnerability status false_positive.\n")
	b.WriteString("- When there are many facts, use **`list_project_facts`** / **`search_project_facts`** to search.\n\n")
	b.WriteString(factEdgeRecordingGuidance())
	b.WriteString("\n\n")
	b.WriteString(factRecordingGuidanceBlock())
	b.WriteString("\n\nSeverity: critical / high / medium / low / info. The proof must include sufficient evidence (request/response, screenshots, command output, etc.).")
	return b.String()
}

// FactEdgeRecordingGuidance is the Agent convention for writing edges (for reuse by the project package).
func FactEdgeRecordingGuidance() string { return factEdgeRecordingGuidance() }

// FactRecordingGuidanceBlock is the fact-writing convention block (for reuse by the project package).
func FactRecordingGuidanceBlock() string { return factRecordingGuidanceBlock() }
