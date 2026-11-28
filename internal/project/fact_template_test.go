package project

import (
	"strings"
	"testing"
)

func TestRequiresAttackChainBody(t *testing.T) {
	cases := []struct {
		cat, key string
		want     bool
	}{
		{"finding", "note/misc", true},
		{"note", "finding/sqli-login", true},
		{"target", "target/primary_domain", false},
		{"auth", "auth/admin_cookie", false},
		{"chain", "x", true},
		{"", "exploit/rce-upload", true},
	}
	for _, tc := range cases {
		if got := RequiresAttackChainBody(tc.cat, tc.key); got != tc.want {
			t.Errorf("RequiresAttackChainBody(%q,%q)=%v want %v", tc.cat, tc.key, got, tc.want)
		}
	}
}

func TestIsSparseFactBody(t *testing.T) {
	long := strings.Repeat("x", 150)
	if !IsSparseFactBody("finding", "finding/x", "") {
		t.Error("empty body should be sparse")
	}
	if !IsSparseFactBody("finding", "finding/x", long) {
		t.Error("body without repro clues should be sparse")
	}
	body := "## Attack chain\n1. step\n## Exploit\n```http\nGET / HTTP/1.1\n```\n"
	if IsSparseFactBody("finding", "finding/x", body) {
		t.Error("structured body should not be sparse")
	}
	if IsSparseFactBody("target", "target/x", "") {
		t.Error("env fact empty body is ok")
	}
}

// Each body below carries exactly one reproduction clue, so removing that
// clue's check from IsSparseFactBody makes the case report "sparse".
func TestIsSparseFactBodySingleClue(t *testing.T) {
	notSparse := []struct{ name, body string }{
		{"attack chain", "Attack chain: step one"},
		{"attack heading", "## Attack\nstep one"},
		{"exploit heading", "## Exploit\nstep one"},
		{"poc heading", "## POC\nstep one"},
		{"request", "Request: see log"},
		{"response", "Response: see log"},
		{"payload", "payload: see log"},
		// Chinese below stays: these headings are in fact bodies stored by earlier versions.
		{"legacy attack chain", "攻击链: 步骤一"},
		{"legacy attack heading", "## 攻击步骤\n步骤一"},
		{"legacy request", "请求: 见日志"},
		{"legacy response", "响应: 见日志"},
	}
	for _, c := range notSparse {
		if IsSparseFactBody("finding", "finding/x", c.body) {
			t.Errorf("%s: body with a reproduction clue reported as sparse: %q", c.name, c.body)
		}
	}
	// Chinese stays: a legacy conclusion-only body has no clue and must stay sparse.
	if !IsSparseFactBody("finding", "finding/x", "结论: 存在漏洞") {
		t.Error("conclusion-only legacy body should be sparse")
	}
}
