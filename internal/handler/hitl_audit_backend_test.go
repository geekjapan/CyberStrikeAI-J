package handler

import (
	"testing"

	"cyberstrike-ai/internal/config"
)

func TestHitlAuditEngineInfoTypeSafe(t *testing.T) {
	h := &AgentHandler{config: &config.Config{
		OpenAI: config.OpenAIConfig{Model: "gpt-4o"},
		Hitl:   config.HitlConfig{AuditBackend: "typesafe"},
	}}
	backend, model := h.hitlAuditEngineInfo()
	if backend != config.HitlAuditBackendTypeSafe {
		t.Fatalf("backend=%q", backend)
	}
	if model != config.TypeSafeDefaultModel {
		t.Fatalf("model=%q, want %s", model, config.TypeSafeDefaultModel)
	}
}

func TestHitlAuditEngineInfoOpenAIInheritsMainModel(t *testing.T) {
	h := &AgentHandler{config: &config.Config{
		OpenAI: config.OpenAIConfig{Model: "gpt-4o-mini"},
		Hitl:   config.HitlConfig{AuditBackend: "openai"},
	}}
	backend, model := h.hitlAuditEngineInfo()
	if backend != config.HitlAuditBackendOpenAI {
		t.Fatalf("backend=%q", backend)
	}
	if model != "gpt-4o-mini" {
		t.Fatalf("model=%q", model)
	}
}

func TestHitlAuditBackendFromRecordPrefersPayload(t *testing.T) {
	backend, model := hitlAuditBackendFromRecord("audit_agent", "audit agent: actual operation: probe", `{
		"hitlApproval": {"auditBackend": "typesafe", "auditModel": "jev-latest"}
	}`)
	if backend != config.HitlAuditBackendTypeSafe || model != "jev-latest" {
		t.Fatalf("backend=%q model=%q", backend, model)
	}
}

func TestHitlAuditBackendFromRecordInfersJevComment(t *testing.T) {
	// Each comment is recognized by exactly one marker (no "choice=", "TypeSafe" or "Jev"),
	// so deleting that marker's branch makes the case fall back to openai.
	cases := []struct{ name, comment string }{
		{"english destructive score", "audit agent: no destructive rule matched, allowed by default; highest destructive score=business availability 0.12"},
		// Chinese stays: comments stored by earlier versions were Chinese and must still be recognized.
		{"legacy chinese destructive score", "audit agent: 未命中破坏性规则，默认放行；最高破坏分=破坏业务可用性 0.12"},
		{"choice marker", "audit agent: choice=approve(0.90)"},
	}
	for _, c := range cases {
		backend, _ := hitlAuditBackendFromRecord("audit_agent", c.comment, `{}`)
		if backend != config.HitlAuditBackendTypeSafe {
			t.Errorf("%s: backend=%q, want %q", c.name, backend, config.HitlAuditBackendTypeSafe)
		}
	}
}

func TestHitlAuditBackendFromRecordInfersOpenAIComment(t *testing.T) {
	backend, _ := hitlAuditBackendFromRecord("audit_agent",
		"audit agent: actual operation: read /etc/passwd; matched rule: A3",
		`{}`)
	if backend != config.HitlAuditBackendOpenAI {
		t.Fatalf("backend=%q", backend)
	}
}

func TestHitlAuditBackendFromRecordIgnoresHuman(t *testing.T) {
	backend, model := hitlAuditBackendFromRecord("human", "approved by a human", `{"hitlApproval":{"auditBackend":"typesafe"}}`)
	if backend != "" || model != "" {
		t.Fatalf("backend=%q model=%q", backend, model)
	}
}
