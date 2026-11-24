package project

import (
	"fmt"
	"strings"

	"cyberstrike-ai/internal/projectprompt"
)

// Fact category constants (the category field written by upsert_project_fact).
const (
	FactCategoryTarget   = "target"
	FactCategoryAuth     = "auth"
	FactCategoryInfra    = "infra"
	FactCategoryBusiness = "business"
	FactCategoryFinding  = "finding"
	FactCategoryChain    = "chain"
	FactCategoryExploit  = "exploit"
	FactCategoryPOC      = "poc"
	FactCategoryNote     = "note"
)

// RequiresAttackChainBody reports whether this fact should carry a reproducible attack chain or exploit detail (in the body, not just the summary).
func RequiresAttackChainBody(category, factKey string) bool {
	c := strings.ToLower(strings.TrimSpace(category))
	switch c {
	case FactCategoryFinding, FactCategoryChain, FactCategoryExploit, FactCategoryPOC, "vuln":
		return true
	}
	key := strings.ToLower(strings.TrimSpace(factKey))
	for _, prefix := range []string{"finding/", "chain/", "exploit/", "poc/"} {
		if strings.HasPrefix(key, prefix) {
			return true
		}
	}
	return false
}

// IsSparseFactBody returns true when the body of an attack-chain fact is too short or lacks key sections (soft validation, does not block the write).
func IsSparseFactBody(category, factKey, body string) bool {
	if !RequiresAttackChainBody(category, factKey) {
		return false
	}
	body = strings.TrimSpace(body)
	if body == "" {
		return true
	}
	lower := strings.ToLower(body)
	// Should contain at least one reproduction clue: steps, request, command, or code block
	hasSteps := strings.Contains(lower, "attack chain") || strings.Contains(lower, "## attack") ||
		strings.Contains(lower, "攻击链") || strings.Contains(lower, "## 攻击") || // Chinese matches bodies stored by earlier versions
		strings.Contains(lower, "## exploit") || strings.Contains(lower, "## poc")
	hasHTTP := strings.Contains(lower, "```http") || strings.Contains(lower, "```bash") ||
		strings.Contains(lower, "curl ") || strings.Contains(lower, "get ") || strings.Contains(lower, "post ")
	hasReq := strings.Contains(lower, "request") || strings.Contains(lower, "response") ||
		strings.Contains(lower, "请求") || strings.Contains(lower, "响应") || // legacy: bodies stored by earlier versions
		strings.Contains(lower, "payload")
	// With no attack chain, POC, request, or similar structural clues, treat it as a conclusion-only description (regardless of length)
	return !(hasSteps || hasHTTP || hasReq)
}

// FactBodyTemplate returns the suggested body Markdown skeleton for each category (for the Agent to fill with real content).
func FactBodyTemplate(category, factKey string) string {
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(factKey)), "artifact/") {
		return artifactFactBodyTemplate
	}
	if strings.HasPrefix(strings.ToLower(strings.TrimSpace(factKey)), "test/") || strings.HasPrefix(strings.ToLower(strings.TrimSpace(factKey)), "negative/") {
		return testResultFactBodyTemplate
	}
	if RequiresAttackChainBody(category, factKey) {
		return attackChainFactBodyTemplate
	}
	return envFactBodyTemplate
}

const attackChainFactBodyTemplate = `## Conclusion (verifiable, one sentence)
<Do not just write "a vulnerability exists"; state type + location + trigger condition>

## Target and entry point
- Target: <URL / IP:Port / hostname>
- Entry: <path / endpoint / parameter>
- Preconditions: <anonymous / role / cookie / other dependencies>

## Attack chain (reproducible step by step)
1. <Recon/discovery>
2. <Exploitation/trigger>
3. <Impact proof (file read, RCE echo, privilege-escalation data, etc.)>

## Exploit / POC
### Request
` + "```http\n<METHOD> <path> HTTP/1.1\nHost: ...\n...\n\n<body>\n```" + `

### Response / observed behavior
<Key response snippet, status code, differences>

### Command / script (if any)
` + "```bash\n<command>\n```" + `

## Key evidence
- <Tool output summary / screenshot path / session or message ID>

## Links
- related_vulnerability_id: <optional, the id from record_vulnerability>
- links (upsert parameter): [{ "from": "<fact_key>", "type": "discovered_on|..." }] (from → current fact)
- Depends on fact (readable body mirror): <fact_key, e.g. auth/session_cookie>

## Notes and uncertainty
<Hypotheses to verify, environment differences, bypass attempt records>`

const envFactBodyTemplate = `## Summary
<Core insight of this fact>

## Details
<Port/version/path/credential traits/business rules, etc.>

## Source and evidence
<Command output, response snippet, discovery time>

## Links
- Related fact_key: <optional>`

// FactRecordingGuidanceBlock is written to the system prompt: it requires facts to record attack chain context, not just conclusions.
func FactRecordingGuidanceBlock() string {
	return projectprompt.FactRecordingGuidanceBlock()
}

// SparseBodyWarning is the tool-return hint when the body of an attack-chain fact is insufficient (does not block saving).
func SparseBodyWarning(category, factKey string) string {
	if !IsSparseFactBody(category, factKey, "") {
		return ""
	}
	return fmt.Sprintf(
		"\n\n⚠ Note: category=%q / fact_key=%q is an attack-chain fact, but the body is empty or too thin. Please add the full attack chain and POC (see the template) so it can be audited and reproduced later.\nSuggested body skeleton:\n%s",
		category, factKey, FactBodyTemplate(category, factKey),
	)
}

// SparseBodyWarningIfNeeded decides from the actual body whether to append the warning.
func SparseBodyWarningIfNeeded(category, factKey, body string) string {
	if !IsSparseFactBody(category, factKey, body) {
		return ""
	}
	return SparseBodyWarning(category, factKey)
}

const artifactFactBodyTemplate = `## Outcome and verification status
<Purpose, applicable target/entry point; verified success / failed / unverified>

## Files and invocation
- Path relative to the project working directory: artifacts/<file name>
- Dependencies and versions: <dependency files, install/runtime environment>
- Invocation and variable parameters: <command, input/output; auth references auth/*>

## Verification evidence
<Verification time, raw command/output, applicable conditions; do not infer success from a file's existence>

## Links
<Source session, dependency fact_key, related_vulnerability_id>`

const testResultFactBodyTemplate = `## Tested conditions
<Target, entry point, parameters, identity/authentication, version, test time>

## Method and evidence
<Request/command, response differences, tool output; errors/timeouts must be marked separately>

## Conclusion and limits
<Succeeded / not found under the tested conditions / blocked / to be verified; do not extend to untested entry points>

## Retest triggers
<Change of target/entry point/identity/version, insufficient original evidence, or user requests a retest>

## Links
<Source session, script artifact/*, related fact/vulnerability IDs>`
