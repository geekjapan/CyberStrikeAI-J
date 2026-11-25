package workflow

import (
	"context"
	"strings"
	"testing"
)

// The expression comes from the generator, so a change there is tested here.
func TestHighRiskDraftExpression(t *testing.T) {
	result, err := GenerateDraftFromNaturalLanguage(context.Background(), DraftRequest{
		Prompt: "Scan the target assets for open ports, run a hardening script if a high-risk port is found, and finally output a report",
	})
	if err != nil {
		t.Fatal(err)
	}
	expr := ""
	for _, node := range result.Graph.Nodes {
		if node.Type == "condition" {
			expr = cfgString(node.Config, "expression")
		}
	}
	if !strings.Contains(expr, "{{previous.output}}") {
		t.Fatalf("no condition on the previous output: %q", expr)
	}
	if err := validateConditionExpression(expr); err != nil {
		t.Fatal(err)
	}
	for output, want := range map[string]bool{
		"Found 2 High severity ports":      true,
		"CRITICAL: RDP exposed":            true,
		"高リスクのポートを検出しました":                  true, // Japanese model output
		"发现高危端口":                           true, // Chinese stays: wording matched by earlier versions
		"all clear":                        false,
		"Highlights: nothing found":        false,
		"Port 443 has higher latency":      false,
		"Hypercritical review of the scan": false,
	} {
		if got := evalCondition(strings.ReplaceAll(expr, "{{previous.output}}", `"`+output+`"`), nil); got != want {
			t.Errorf("%q: got %v, want %v", output, got, want)
		}
	}
}
