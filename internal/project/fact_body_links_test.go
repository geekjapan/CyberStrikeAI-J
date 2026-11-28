package project

import (
	"path/filepath"
	"reflect"
	"strings"
	"testing"

	"cyberstrike-ai/internal/database"

	"go.uber.org/zap"
)

func TestParseLinksFromBodyDependsOn(t *testing.T) {
	t.Parallel()
	// Chinese stays: body headings stored by earlier versions are Chinese.
	body := "## 关联\n- 依赖事实: target/api\n- 相关 fact_key: auth/session"
	want := []database.ProjectFactEdgeFromInput{
		{From: "target/api", Type: "depends_on"},
		{From: "auth/session", Type: "supports"},
	}
	if links := ParseLinksFromBody(body); !reflect.DeepEqual(links, want) {
		t.Fatalf("links = %+v, want %+v", links, want)
	}
}

func TestSyncBodyLinksSection(t *testing.T) {
	t.Parallel()
	// Chinese stays: body headings stored by earlier versions are Chinese.
	body := "## 结论\nx\n\n## 关联\n- 依赖事实: old/key"
	edges := []*database.ProjectFactEdge{{EdgeType: "discovered_on", SourceFactKey: "target/a"}}
	out := SyncBodyLinksSection(body, edges)
	if !strings.Contains(out, "discovered_on: target/a") {
		t.Fatalf("missing synced edge: %q", out)
	}
}

func TestFactGraphIntegration(t *testing.T) {
	dir := t.TempDir()
	dbPath := filepath.Join(dir, "test.db")
	db, err := database.NewDB(dbPath, zap.NewNop())
	if err != nil {
		t.Fatal(err)
	}
	defer db.Close()

	p, err := db.CreateProject(&database.Project{Name: "g"})
	if err != nil {
		t.Fatal(err)
	}
	for _, spec := range []struct{ key, cat, summary string }{
		{"target/root", "target", "root"},
		{"finding/x", "finding", "finding x"},
	} {
		_, err := db.UpsertProjectFact(&database.ProjectFact{
			ProjectID: p.ID, FactKey: spec.key, Category: spec.cat, Summary: spec.summary, Confidence: "confirmed",
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if err := db.ReplaceIncomingProjectFactEdges(p.ID, "finding/x", []database.ProjectFactEdgeFromInput{
		{From: "target/root", Type: "discovered_on"},
	}); err != nil {
		t.Fatal(err)
	}
	graph, err := BuildProjectFactGraph(db, p.ID, "path", true)
	if err != nil {
		t.Fatal(err)
	}
	if len(graph.Nodes) < 2 || len(graph.Edges) < 1 {
		t.Fatalf("expected graph nodes/edges, got %d/%d", len(graph.Nodes), len(graph.Edges))
	}
}

func TestParseLinksFromBodyDependsOnEnglish(t *testing.T) {
	t.Parallel()
	body := "## Links\n- Depends on fact: target/api\n- related fact_key: auth/session"
	want := []database.ProjectFactEdgeFromInput{
		{From: "target/api", Type: "depends_on"},
		{From: "auth/session", Type: "supports"},
	}
	if links := ParseLinksFromBody(body); !reflect.DeepEqual(links, want) {
		t.Fatalf("links = %+v, want %+v", links, want)
	}
}

func TestParseLinksFromBodyAutoSyncedBlock(t *testing.T) {
	t.Parallel()
	want := []database.ProjectFactEdgeFromInput{
		{From: "target/a", Type: "discovered_on"},
		{From: "target/b", Type: "depends_on"},
	}
	cases := []struct{ name, body string }{
		{"english header", "## Links\n- Structured relation edges (auto-synced):\n  - discovered_on: target/a\n  - depends_on: target/b\n"},
		// Chinese stays: section and block headers stored by earlier versions are Chinese.
		{"legacy header", "## 关联\n- 结构化关系边（自动同步）：\n  - discovered_on: target/a\n  - depends_on: target/b\n"},
		// Chinese stays: a block header stored by earlier versions under the English section heading.
		{"legacy header under english section", "## Links\n- 结构化关系边（自动同步）：\n  - discovered_on: target/a\n  - depends_on: target/b\n"},
	}
	for _, c := range cases {
		if links := ParseLinksFromBody(c.body); !reflect.DeepEqual(links, want) {
			t.Errorf("%s: links = %+v, want %+v", c.name, links, want)
		}
	}
	// Without a block header the typed lines are plain text, not edges.
	if links := ParseLinksFromBody("## Links\n  - discovered_on: target/a\n"); links != nil {
		t.Errorf("lines outside a sync block parsed as links: %+v", links)
	}
}

func TestSyncBodyLinksSectionReplacesExistingBlock(t *testing.T) {
	t.Parallel()
	edges := []*database.ProjectFactEdge{{EdgeType: "discovered_on", SourceFactKey: "target/new"}}
	const wantBlock = "- Structured relation edges (auto-synced):\n  - discovered_on: target/new"
	cases := []struct{ name, body, want string }{
		{
			"english block",
			"## Conclusion\nx\n\n## Links\n- Structured relation edges (auto-synced):\n  - discovered_on: old/key\n### Notes\nkeep me\n",
			"## Conclusion\nx\n\n## Links\n" + wantBlock + "\n### Notes\nkeep me",
		},
		{
			// Chinese stays: section and block headers stored by earlier versions are Chinese.
			"legacy block",
			"## 结论\nx\n\n## 关联\n- 结构化关系边（自动同步）：\n  - discovered_on: old/key\n### Notes\nkeep me\n",
			"## 结论\nx\n\n## 关联\n" + wantBlock + "\n### Notes\nkeep me",
		},
	}
	for _, c := range cases {
		out := SyncBodyLinksSection(c.body, edges)
		if out != c.want {
			t.Errorf("%s: got %q, want %q", c.name, out, c.want)
		}
		if n := strings.Count(out, "auto-synced"); n != 1 {
			t.Errorf("%s: %d sync blocks after sync, want 1: %q", c.name, n, out)
		}
		// Syncing again changes nothing.
		if again := SyncBodyLinksSection(out, edges); again != out {
			t.Errorf("%s: second sync changed the body: %q", c.name, again)
		}
	}
}

func TestSyncBodyLinksSectionAppendsLinksSection(t *testing.T) {
	t.Parallel()
	edges := []*database.ProjectFactEdge{{EdgeType: "discovered_on", SourceFactKey: "target/new"}}
	got := SyncBodyLinksSection("## Conclusion\nx", edges)
	want := "## Conclusion\nx\n\n## Links\n- Structured relation edges (auto-synced):\n  - discovered_on: target/new"
	if got != want {
		t.Fatalf("got %q, want %q", got, want)
	}
}
