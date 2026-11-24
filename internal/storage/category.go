// Package storage is responsible for enumerating, evaluating, and cleaning up the disk garbage produced by the runtime space.
//
// Design constraints (the cost of wrongly deleting active task data is much higher than the disk space saved, so the following are all hard constraints):
//   - Each category enumerates deletion units only at a fixed level under a fixed root directory; no unbounded recursive deletion;
//   - A deletion unit must pass the confined check, to rule out path escape;
//   - Directory cleanup uses "atomic rename + RemoveAll": if the process crashes, only marked remnants are left behind, to be removed in the next round;
//   - For session-type units, the database is queried for the most recent activity time before deletion, and active sessions are always skipped; if the query fails, it is skipped conservatively (fail closed).
package storage

import (
	"os"
	"path/filepath"
	"strings"
	"time"

	"cyberstrike-ai/internal/config"
)

// deletionMarkerSuffix marks directories that have been determined for deletion and are being removed.
// Following the approach of Prometheus TSDB: the rename is atomic, so a crash never leaves a half-deleted directory under its original name.
const deletionMarkerSuffix = ".tmp-for-deletion"

// Scope describes the binding relationship between a deletion unit and a conversation or project.
type Scope int

const (
	// ScopeNone is unrelated to any conversation; it is judged only by the retention period (logs, checkpoints, C2 artifacts).
	ScopeNone Scope = iota
	// ScopeConversation: the directory name is the conversation ID, so it can be checked for whether the conversation still exists and for its most recent activity time.
	ScopeConversation
	// ScopeProject: the directory name is the project ID.
	ScopeProject
)

// Paths aggregates the root directories of each category.
// Injected by the app layer following the existing resolution rules (using the same values as database.SetAgentConversationDirs),
// to avoid this package deriving paths on its own, which could make the cleanup directories inconsistent with the directories actually written.
type Paths struct {
	Workspace            string
	Reduction            string
	ConversationArtifact string
	Plantask             string
	C2                   string
	ChatUploads          string
	WorkflowCheckpoints  string
	DiagnosticLogs       string
}

// Unit is a cleanup unit that can be deleted independently (a directory or a file).
type Unit struct {
	Path    string
	Session string // Scope: the corresponding ID when not ScopeNone, otherwise empty
	Scope   Scope
	IsDir   bool
	ModTime time.Time
	Size    int64
}

// Age returns how long a unit has been idle relative to now; a future timestamp (clock anomaly) is treated as 0.
func (u Unit) Age(now time.Time) time.Duration {
	if u.ModTime.IsZero() {
		return 0
	}
	if age := now.Sub(u.ModTime); age > 0 {
		return age
	}
	return 0
}

// scanner enumerates all deletion units under a given root directory.
type scanner func(root string) ([]Unit, error)

// category is a named cleanup task, corresponding to Gitea's [cron.*] subtask model.
type category struct {
	key        string
	label      string
	hint       string
	root       func(Paths) string
	scan       scanner
	pruneEmpty bool // After deleting units, reclaim the parent directories that became empty (the date layer of chat_uploads)
}

// CategoryInfo is the static metadata of a cleanup category, for display by the API and the frontend.
type CategoryInfo struct {
	Key   string `json:"key"`
	Label string `json:"label"`
	Hint  string `json:"hint"`
}

// DescribeCategories returns the metadata of all categories in registry order.
func DescribeCategories() []CategoryInfo {
	all := categories()
	out := make([]CategoryInfo, 0, len(all))
	for _, cat := range all {
		out = append(out, CategoryInfo{Key: cat.key, Label: cat.label, Hint: cat.hint})
	}
	return out
}

// categories returns all categories in a fixed order; categories whose root is empty are skipped by the caller.
func categories() []category {
	return []category{
		{
			key:   config.StorageCategoryWorkspace,
			label: "Agent workspace",
			hint:  "Working directory for files the agent downloads and scan output (tmp/workspace), split by project/session.",
			root:  func(p Paths) string { return p.Workspace },
			scan:  scanScopedDirs,
		},
		{
			key:   config.StorageCategoryReduction,
			label: "Tool output cache",
			hint:  "Truncated files for oversized tool output written to disk (tmp/reduction), one file per execution; purely derived data.",
			root:  func(p Paths) string { return p.Reduction },
			scan:  scanScopedDirs,
		},
		{
			key:   config.StorageCategoryConversationArtifact,
			label: "Session artifacts",
			hint:  "Summary records and the ledger of oversized user input (data/conversation_artifacts).",
			root:  func(p Paths) string { return p.ConversationArtifact },
			scan:  func(root string) ([]Unit, error) { return scanSessionDirs(root, ScopeConversation) },
		},
		{
			key:   config.StorageCategoryPlantask,
			label: "Planned task board",
			hint:  "Agent multi-agent plan board JSON (skills/.pi/plantask); purely derived data.",
			root:  func(p Paths) string { return p.Plantask },
			scan:  func(root string) ([]Unit, error) { return scanSessionDirs(root, ScopeConversation) },
		},
		{
			key:   config.StorageCategoryC2Artifacts,
			label: "C2 artifacts",
			hint:  "C2 returned screenshots, uploads, delivered files and generated payload binaries (tmp/c2). After cleanup, the matching payload download links stop working.",
			root:  func(p Paths) string { return p.C2 },
			scan: func(root string) ([]Unit, error) {
				return scanSubdirFiles(root, "results", "uploads", "downstream", "payloads")
			},
		},
		{
			key:        config.StorageCategoryChatUploads,
			label:      "Conversation uploads",
			hint:       "Attachments users upload in conversations (chat_uploads/date/session).",
			root:       func(p Paths) string { return p.ChatUploads },
			scan:       scanDatedSessionDirs,
			pruneEmpty: true,
		},
		{
			key:   config.StorageCategoryWorkflowCheckpoints,
			label: "Workflow checkpoints",
			hint:  "Workflow run checkpoint files (data/workflow-checkpoints), used only to resume interrupted runs.",
			root:  func(p Paths) string { return p.WorkflowCheckpoints },
			scan: func(root string) ([]Unit, error) {
				return scanPatternFiles(root, "*.ckpt", "*.ckpt.tmp")
			},
		},
		{
			key:   config.StorageCategoryDiagnosticLogs,
			label: "Diagnostic logs",
			hint:  "Diagnostic logs rotated daily (log/diagnostic-*.log).",
			root:  func(p Paths) string { return p.DiagnosticLogs },
			scan: func(root string) ([]Unit, error) {
				return scanPatternFiles(root, "diagnostic-*.log")
			},
		},
	}
}

// chatUploadsPlaceholderConvs is the placeholder directory name used for uploads that do not yet have a conversation ID,
// It must not be looked up in the database as a conversation ID; it is treated as non-session (judged only by the retention period).
var chatUploadsPlaceholderConvs = map[string]bool{"_new": true, "_manual": true}

// scanScopedDirs enumerates root/projects/<id> and root/conversations/<id>.
func scanScopedDirs(root string) ([]Unit, error) {
	scopes := []struct {
		dir   string
		scope Scope
	}{{"projects", ScopeProject}, {"conversations", ScopeConversation}}

	var units []Unit
	for _, s := range scopes {
		base := filepath.Join(root, s.dir)
		entries, err := os.ReadDir(base)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if !e.IsDir() {
				continue
			}
			u, err := statUnit(filepath.Join(base, e.Name()), e.Name(), s.scope)
			if err != nil {
				continue
			}
			units = append(units, u)
		}
	}
	return units, nil
}

// scanSessionDirs enumerates root/<id>; the directory name is the conversation ID.
func scanSessionDirs(root string, scope Scope) ([]Unit, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var units []Unit
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		u, err := statUnit(filepath.Join(root, e.Name()), e.Name(), scope)
		if err != nil {
			continue
		}
		units = append(units, u)
	}
	return units, nil
}

// scanDatedSessionDirs enumerates root/<YYYY-MM-DD>/<conversation ID or placeholder name>.
func scanDatedSessionDirs(root string) ([]Unit, error) {
	dates, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var units []Unit
	for _, d := range dates {
		if !d.IsDir() {
			continue
		}
		dateDir := filepath.Join(root, d.Name())
		convs, err := os.ReadDir(dateDir)
		if err != nil {
			continue
		}
		for _, cd := range convs {
			if !cd.IsDir() {
				// Loose files placed directly under a date directory: cleaned up as non-session files.
				if u, err := statUnit(filepath.Join(dateDir, cd.Name()), "", ScopeNone); err == nil {
					units = append(units, u)
				}
				continue
			}
			session, scope := cd.Name(), ScopeConversation
			if chatUploadsPlaceholderConvs[session] {
				session, scope = "", ScopeNone
			}
			if u, err := statUnit(filepath.Join(dateDir, cd.Name()), session, scope); err == nil {
				units = append(units, u)
			}
		}
	}
	return units, nil
}

// scanSubdirFiles enumerates the files under root/<subdir>/ (not recursive), used for C2 artifacts.
func scanSubdirFiles(root string, subdirs ...string) ([]Unit, error) {
	var units []Unit
	for _, sub := range subdirs {
		base := filepath.Join(root, sub)
		entries, err := os.ReadDir(base)
		if err != nil {
			if os.IsNotExist(err) {
				continue
			}
			return nil, err
		}
		for _, e := range entries {
			if e.IsDir() {
				continue
			}
			if u, err := statUnit(filepath.Join(base, e.Name()), "", ScopeNone); err == nil {
				units = append(units, u)
			}
		}
	}
	return units, nil
}

// scanPatternFiles enumerates the files under root that match any of the glob patterns.
func scanPatternFiles(root string, patterns ...string) ([]Unit, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	var units []Unit
	for _, e := range entries {
		if e.IsDir() {
			continue
		}
		matched := false
		for _, p := range patterns {
			if ok, _ := filepath.Match(p, e.Name()); ok {
				matched = true
				break
			}
		}
		if !matched {
			continue
		}
		if u, err := statUnit(filepath.Join(root, e.Name()), "", ScopeNone); err == nil {
			units = append(units, u)
		}
	}
	return units, nil
}

// statUnit collects the size and most recent modification time of a unit.
// Use Lstat: a symbolic link is measured as the link itself and is never followed to its target (otherwise data outside the working directory would be counted, or even deleted).
func statUnit(path, session string, scope Scope) (Unit, error) {
	info, err := os.Lstat(path)
	if err != nil {
		return Unit{}, err
	}
	u := Unit{
		Path:    path,
		Session: session,
		Scope:   scope,
		IsDir:   info.IsDir(),
		ModTime: info.ModTime(),
		Size:    info.Size(),
	}
	if u.IsDir {
		size, newest := dirStats(path)
		u.Size = size
		if newest.After(u.ModTime) {
			u.ModTime = newest
		}
	}
	if scope == ScopeNone {
		u.Session = ""
	}
	return u, nil
}

// dirStats aggregates the bytes used by a directory and the most recent modification time within it.
// filepath.WalkDir does not follow symbolic links, and a subtree that cannot be read is skipped on a best-effort basis without aborting the whole statistics run.
func dirStats(root string) (int64, time.Time) {
	var size int64
	var newest time.Time
	_ = filepath.WalkDir(root, func(path string, d os.DirEntry, err error) error {
		if err != nil || d == nil {
			return nil
		}
		info, infoErr := d.Info()
		if infoErr != nil {
			return nil
		}
		if !d.IsDir() {
			size += info.Size()
		}
		if mt := info.ModTime(); mt.After(newest) {
			newest = mt
		}
		return nil
	})
	return size, newest
}

// confined checks that candidate is actually inside root, to prevent any form of path escape.
func confined(root, candidate string) bool {
	if root == "" || candidate == "" {
		return false
	}
	rel, err := filepath.Rel(root, candidate)
	if err != nil {
		return false
	}
	if rel == "." || rel == ".." || filepath.IsAbs(rel) {
		return false
	}
	return !strings.HasPrefix(rel, ".."+string(filepath.Separator))
}

// pruneEmptyDirs reclaims empty directories bottom-up, descending at most depth levels.
// After a conversation directory is deleted from chat_uploads, an empty date directory is left behind, which also needs to be reclaimed.
// Only descendant directories that are truly empty are deleted; root itself is never deleted.
func pruneEmptyDirs(root string, depth int) int {
	if depth <= 0 {
		return 0
	}
	entries, err := os.ReadDir(root)
	if err != nil {
		return 0
	}
	removed := 0
	for _, e := range entries {
		if !e.IsDir() {
			continue
		}
		sub := filepath.Join(root, e.Name())
		removed += pruneEmptyDirs(sub, depth-1)
		if isEmptyDir(sub) && os.Remove(sub) == nil {
			removed++
		}
	}
	return removed
}

func isEmptyDir(path string) bool {
	entries, err := os.ReadDir(path)
	if err != nil {
		return false
	}
	return len(entries) == 0
}
