package workflow

import "testing"

func TestHighRiskDraftExpression(t *testing.T) {
	expr := `"Found 2 High severity ports" matches "(?i)high|critical"`
	if err := validateConditionExpression(expr); err != nil {
		t.Fatal(err)
	}
	if !evalCondition(expr, nil) {
		t.Fatal("high severity output must match")
	}
	if evalCondition(`"all clear" matches "(?i)high|critical"`, nil) {
		t.Fatal("clean output must not match")
	}
}
