---
name: meta-worktree
description: 'Audit the AI-OS folder and worktrees in plain English, then offer to tidy up: branches, dirty work, stashes, recovery branches, local-vs-GitHub state, and work another session left behind. Asks first on anything risky. Not for "go back to yesterday" (ops-versioning) or non-git tasks.'
when_to_use: 'Invoke when the request sounds like: "check worktrees", "check the folder", "what happened while I was away", "where is my work", "is everything saved", "tidy up the folder"'
metadata:
  type: meta
---

# meta-worktree

The plain-English status report for the AI-OS folder. Non-developers should
never need to read `git status`. This skill does the looking for them.

## When to use

The skill auto-triggers on the phrases above. Use it whenever the user:
- asks what is going on with their folder or worktrees,
- wonders where a piece of work is or whether it was saved,
- has not opened AI-OS for a while and wants a fresh status,
- wants to tidy up worktrees, branches, or recovery snapshots,
- suspects two sessions overwrote each other.

Do NOT use this skill for "go back to yesterday's draft" — that is
`ops-versioning` (document snapshots), not git history.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `context/learnings.md` | `## meta-worktree` | Known workspace and recovery edge cases |
| `.command-centre/branch-state.log` | recent entries, when present | Human-facing branch warnings |
| `.command-centre/autosave-pending.log` | recent entries, when present | Deferred autosave evidence |

All other state comes from the read-only audit script, not from memory.

## How it works

1. Run `bash $CLAUDE_PROJECT_DIR/.claude/skills/meta-worktree/scripts/audit.sh`.
   It emits one JSON document on stdout: every observation, severity, and the
   exact action commands that would resolve it.
2. Read the JSON. **Translate every finding into plain English** using the
   translations table below — never paste raw git output at the user.
3. Present findings in this order:
   - `## What's happening right now` — the calm, factual snapshot (1–4 lines).
   - `## What needs your attention` — only the items that have an action,
     ranked highest impact first, numbered, each with a one-line plain
     description AND a one-line "I can…" action.
   - `## Want me to do these?` — close with one short approval line.
4. On approval (any of "yes", "go ahead", "do them", "all of them", or specific
   numbers like "1 and 3"), run
   `bash $CLAUDE_PROJECT_DIR/.claude/skills/meta-worktree/scripts/act.sh ID1 ID2 …`
   with the chosen action IDs from the JSON.
5. After acting, run the audit again and confirm what changed. Mention what was
   done in one short paragraph; do not re-list everything.

## What it audits

- Current branch of the primary folder (should normally be `main`).
- Uncommitted work in the primary.
- All worktrees: their folder, branch, age, dirty/clean state.
- Branches that have un-merged commits (`feature/*`, `work/*`).
- Recovery snapshot branches (`autosave-recovery/*`) — pruning candidates.
- Stashes, especially auto-shelved `epitaxy:` stashes from other sessions.
- Local vs `origin/main`: ahead, behind, diverged.
- Recent entries in `.command-centre/branch-state.log` and `autosave-pending.log`.
- `.recovered` files left by the coexistence safety net.
- Any worktree folder on disk that git no longer tracks.

## Plain-English translations (use these — never raw jargon)

| git says | say |
|---|---|
| "ahead N" | "N saved things that aren't backed up to GitHub yet" |
| "behind N" | "N updates from GitHub you haven't pulled in" |
| "diverged" | "your folder and GitHub disagree on some things — needs reconciling" |
| "feature/x with N commits ahead of main" | "a side branch named 'x' with N saved things not yet in main" |
| "work/x worktree" | "an isolated session folder called 'x'" |
| "uncommitted changes" / "dirty tree" | "unsaved edits" |
| "epitaxy stash" / "auto-stash" | "shelved work set aside by another session" |
| "autosave-recovery/YYYYMMDD-HHMMSS" | "a safety snapshot from <human date>" |
| "HEAD detached" | "the folder is in a special view-only state, not on any branch" |
| "merge conflict" | "two changes touched the same line and need a choice" |
| "untracked .recovered file" | "a backup copy a safety net put back beside your file" |

## Asking before destructive or ambiguous action

The skill NEVER executes these without explicit per-item approval:
- Removing a feature branch that still has commits not in main.
- Deleting a recovery snapshot from less than 7 days ago.
- Resolving a `.recovered` file by overwriting either side.
- Removing a worktree whose folder still has unsaved edits (the action
  preserves them via the worktree autosave path, but the user should know).
- Anything that would push to `origin/main` directly (always go via PR per
  the Branching Policy in AGENTS.md).

For these the response lists them under a separate **`## Needs your call`**
block, each with a plain question the user can answer.

## Eval

Run this eval before changing workspace audit or action behavior:

```bash
bash scripts/test-base-return-to-main.sh
bash .claude/skills/meta-worktree/scripts/audit.sh
bash scripts/workspace-health-report.sh
bash scripts/branch-triage-report.sh
```

The eval passes when the audit is read-only, translates git state into plain
language, surfaces dirty work, ahead/behind state, worktrees, stashes, and side
branches, returns clean autosave recovery branches to `main` without deleting
the saved branch, and keeps push, pull, merge, archive, delete, and ambiguous
overwrite actions behind explicit approval. It fails if it mutates git state
during audit or hides normal side branches with unique commits.

## Rules

- Plain fifth-grade English; never use em or en dashes.
- Decide and recommend; do not present a neutral menu of equivalents.
- Surface only real items — never invent findings to look thorough.
- One concrete action per item, ranked. Cap the visible list at five even on a
  big audit; bundle the rest as "and N smaller items I can sweep up too".
- If the audit reports no issues, say "Everything looks clean" in one line and
  do not pad with reassurances.
