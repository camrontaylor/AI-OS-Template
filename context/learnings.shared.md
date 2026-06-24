# Shared Learnings (sanitized, git-tracked)

> The general, non-identifying half of the learnings system. This file IS tracked in git,
> so vetted lessons compound across machines and can flow back to the template.
> Its private partner, `context/learnings.md`, is gitignored and holds the raw,
> per-machine, per-client lessons (which may name clients or people).
>
> Promotion rule: a lesson only moves here after every client name, person, exact path,
> token, and private detail is stripped. When in doubt, leave it in the private file.
> Same structure as `learnings.md`: skills read their own section; general insights go here.

# General

## What works well
- Work alongside AI-OS's own background agents (cron and the command centre can switch git
  branches under you) by using an isolated git worktree, and verify outputs hard (checksums,
  exact byte sizes, decoding from source rather than retyping) so nothing is silently corrupted.
- When a scheduled job "does not run", run it by hand and read its log before theorising. The
  real cause is usually mundane (an expired credential, a wrong path), not the first thing you
  suspect.
- Ground in the real files before asserting anything about how AI-OS works. Read the actual
  script, hook, skill, or job; do not answer from memory or a prior summary.
- Verify a produced artifact is complete by counting it against its source, not by trusting
  that the command "ran". A copy or sync step can exit cleanly while silently skipping files
  (for example a sync tool that does not recurse into listed directories), so expand directories
  to an explicit file list and check file-count parity before declaring success. Prove
  completeness; do not trust exit code 0.

## What does not work well
- Do not state a cause, a location, or who did something as fact before checking it with git,
  ps, or ls. Verify first, then assert.
- The MEMORY.md 2,500 character cap is a curation budget, not a stop-write wall. When a write
  would exceed it, consolidate first (drop resolved entries, merge similar ones, tighten verbose
  ones), then add. Nothing is lost: the full record lives in the daily logs and the search index.

# Individual Skills

(Promote per-skill lessons here only after they are stripped of any client or personal detail.)

## viz-ad-creative-codex

## viz-ad-creative-fal

## viz-ad-creative-figma
