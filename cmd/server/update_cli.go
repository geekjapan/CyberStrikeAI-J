package main

import (
	"context"
	"cyberstrike-ai/internal/config"
	"cyberstrike-ai/internal/update"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// The same one-click update the console page drives, for the two cases a page cannot
// serve: the process is not running at all, and somebody is ssh'd in with a keyboard.
// Keeping it in the binary rather than only in a shell script means one implementation of
// "fetch, fast-forward, rebuild, swap" instead of two that can disagree. The update
// source is read from the same config.yaml field the page saves to, so the keyboard and
// the button can never update from different repositories.
func updateCommandIfNeeded(configPath string, check, apply, rollback bool) (bool, int) {
	if !check && !apply && !rollback {
		return false, 0
	}
	root := filepath.Dir(configPath)
	repo, err := config.LoadUpdateRepo(configPath)
	if err != nil {
		fmt.Fprintf(os.Stderr, "Failed to read the update source: %v\n", err)
		return true, 1
	}
	opts := update.Options{Root: root, Repo: repo}
	ctx, cancel := context.WithTimeout(context.Background(), 45*time.Minute)
	defer cancel()

	source := strings.TrimSpace(repo)
	if source == "" {
		source = update.DefaultRepoURL + " (official repository default)"
	}
	fmt.Printf("Install directory: %s\n", root)
	fmt.Printf("Update source: %s\n", source)
	switch {
	case check:
		snap, err := update.Check(ctx, opts)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Failed to check for updates: %v\n", err)
			return true, 1
		}
		printSnapshot(snap)
		if !snap.Installed || snap.CheckError != "" {
			return true, 1
		}
		return true, 0
	case apply:
		res, err := update.Apply(ctx, opts, func(s update.Step) {
			fmt.Printf("[%s] %s\n", s.Phase, s.Message)
		})
		if res != nil {
			printResult(res)
		}
		if err != nil {
			fmt.Fprintf(os.Stderr, "Update did not complete: %v\n", err)
			return true, 1
		}
		fmt.Println("Source and binary are in place; the new code takes effect after the service restarts.")
		return true, 0
	case rollback:
		res, err := update.Rollback(ctx, opts)
		if err != nil {
			fmt.Fprintf(os.Stderr, "Rollback did not complete: %v\n", err)
			return true, 1
		}
		printResult(res)
		return true, 0
	}
	return true, 0
}

func printSnapshot(s *update.Snapshot) {
	if !s.Installed {
		fmt.Printf("This directory is not a git work tree (%s); cannot update automatically\n", s.Root)
		return
	}
	target := s.TargetBranch
	if target == "" {
		target = "?"
	}
	fmt.Printf("Local branch %s / commit %s (%s), update source default branch %s\n", s.Branch, s.Commit, s.Subject, target)
	if s.CheckError != "" {
		fmt.Printf("Check failed: %s\n", s.CheckError)
		return
	}
	fmt.Printf("Update source latest %s (%s), %d commits behind, local is %d commits ahead\n", s.RemoteCommit, s.RemoteSubject, s.Behind, s.Ahead)
	for _, c := range s.Incoming {
		fmt.Printf("  ○ %s %s\n", c.Commit, c.Subject)
	}
	if s.Behind > len(s.Incoming) {
		fmt.Printf("  ... (%d in total, showing %d)\n", s.Behind, len(s.Incoming))
	}
	if len(s.BlockingChanges) > 0 {
		fmt.Printf("%d local source files were modified; the update will refuse to run:\n", len(s.BlockingChanges))
		for _, c := range s.BlockingChanges {
			fmt.Printf("  ! %s (%s)\n", c.Path, c.Status)
		}
	}
	if !s.CanBuild {
		fmt.Println("No Go toolchain on this machine: the update only moves source and will not recompile")
	}
	if s.BuildPending {
		fmt.Println("The previous update left an unfinished build (source in place, binary still old): install the toolchain and rerun the update to finish it")
	}
	if s.HasRollback {
		fmt.Printf("Can roll back to %s\n", s.RollbackTo)
	}
}

func printResult(r *update.Result) {
	moved := r.Commits > 0 || r.ToCommit != r.FromCommit
	if !moved && !r.BinaryBuilt {
		fmt.Println("Already up to date, nothing changed")
		return
	}
	if moved {
		fmt.Printf("%s → %s (%d commits, %d files touched, took %s)\n", r.FromCommit, r.ToCommit, r.Commits, r.FilesTouched, r.Duration)
	} else {
		// commits == 0 but a binary was built: a retry that finished a build the previous
		// attempt could not. Saying "Already up to date, no changes" here would bury the one thing
		// that did happen.
		fmt.Printf("Source is already up to date (%s); this run added the binary\n", r.ToCommit)
	}
	if len(r.KeptContent) > 0 {
		fmt.Printf("Kept %d local content files (roles/skills/tools etc., not overwritten by upstream):\n", len(r.KeptContent))
		for _, p := range r.KeptContent {
			fmt.Printf("  = %s\n", p)
		}
	}
	if r.BinaryBuilt {
		fmt.Printf("Binary replaced: %s (old version kept at %s for rollback)\n", r.BinaryPath, r.PrevBinary)
	}
}
