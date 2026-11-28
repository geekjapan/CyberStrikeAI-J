package authctx

import (
	"strings"
	"testing"
)

// Exhaust the stated finite domain against the copied production implementation.
func TestBoundedPrincipalProtection(t *testing.T) {
	keys := []string{"chat:read", "project:write", "unrelated"}
	scopes := []string{"", " \t", "assigned", "all", " assigned "}
	cases := 0
	for _, fallback := range []string{"", "assigned", " all "} {
		for grants := 0; grants < 27; grants++ {
			for scopeState := 0; scopeState < 216; scopeState++ {
				permissions := map[string]bool{}
				permissionScopes := map[string]string{}
				wantGrant := [3]bool{}
				wantScope := [3]string{}
				g, s := grants, scopeState
				for i, key := range keys {
					grantState, localState := g%3, s%6
					g, s = g/3, s/6
					if grantState != 0 {
						permissions[key] = grantState == 2
					}
					if localState != 0 {
						permissionScopes[key] = scopes[localState-1]
					}
					wantGrant[i] = grantState == 2
					wantScope[i] = strings.TrimSpace(fallback)
					if wantGrant[i] && strings.TrimSpace(permissionScopes[key]) != "" {
						wantScope[i] = strings.TrimSpace(permissionScopes[key])
					}
				}
				p := NewPrincipalWithScopes("user", "name", fallback, permissions, permissionScopes)
				check := func(phase string) {
					for i, key := range keys {
						for _, query := range []string{key, " \t" + key + "\n"} {
							if got := p.HasPermission(query); got != wantGrant[i] {
								t.Fatalf("GRANT_SNAPSHOT phase=%s fallback=%q grants=%d scopes=%d query=%q got=%v want=%v", phase, fallback, grants, scopeState, query, got, wantGrant[i])
							}
							if got := p.ScopeFor(query); got != wantScope[i] {
								t.Fatalf("SCOPE_SNAPSHOT_PRECEDENCE phase=%s fallback=%q grants=%d scopes=%d query=%q got=%q want=%q", phase, fallback, grants, scopeState, query, got, wantScope[i])
							}
						}
					}
				}
				check("constructed")
				for i, key := range keys {
					permissions[key] = !wantGrant[i]
					permissionScopes[key] = "changed-after-construction"
				}
				check("input-maps-mutated")
				cases++
			}
		}
	}
	p := NewPrincipalWithScopes("user", "name", "all", nil, nil)
	if p.HasPermission("chat:read") || p.ScopeFor("chat:read") != "all" {
		t.Fatal("NIL_MAPS: nil inputs must grant nothing and preserve legacy fallback")
	}
	t.Logf("exhausted %d map states; 24 permission/scope calls per state across both phases; nil maps checked", cases)
}
