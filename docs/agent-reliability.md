# Reliable work

These rules extend the existing startup, memory and skill flows. `AGENTS.md` owns
the defaults. This guide explains their use and the local maintenance commands.

## Recover the right task

Keep a compact task record in the existing daily session or linked project brief:
the original goal, accepted constraints, decisions, attempts and observed results,
source and output paths, the next action, and what would prove completion.

Save a material decision before an action that depends on it. After verification,
save the result or next unfinished action and read the changed entry back. Skip
unchanged state and trivial answers. Store evidence and decisions, not private
reasoning. A proposal stays a proposal until the decision owner accepts it.

After a restart, context reset or handoff, find the matching record and recheck
live state before repeating a write. The newest log may belong to another task.
Past permission does not authorize unrelated or destructive work.

## Check claims and results

Use memory to find sources. Verify current claims from live state, primary files
or official docs. Mark an unverified claim as unknown. When a claim mixes verified
behavior with a future plan, state which part is known and which part is proposed.

For an external action, identify the exact account, repository, branch, inbox or
other target. Keep the returned artifact ID or URL. Read the actual changed state
before claiming the action finished. A local draft or successful command alone
does not prove a live send, merge, deployment or account change.

After an uncertain write, check the target before retrying. A timeout may happen
after a service applied the change. If retry safety is unknown, finish independent
work and report the smallest missing check.

Before delivery, check every agreed requirement against its source or result. For
judgment work, use a different check: grounded source review, or a fresh reviewer
given the goal, artifact and verified facts. Correct clear errors and surface only
the direction calls the user needs to own.

## Learn from confirmed corrections

In Solo mode, record a confirmed mistake under `### Corrections` in the active
scope's existing daily session. Use one bullet per lesson:

```markdown
### Corrections
- [mkt-copywriting] Keep the offer agreed in the project brief.
- [general] Read the live result before reporting a send as complete.
```

Use an installed skill name or `general`. Keep opinions, new data and ordinary
plan changes under Decisions instead. Exclude secrets and private reasoning.

From the root or the active client folder:

```bash
python3 /path/to/AI-OS/scripts/workspace-maintenance.py corrections --date 2026-10-01
python3 /path/to/AI-OS/scripts/workspace-maintenance.py corrections --date 2026-10-01 --check
```

Replace the example path and date. Without `--date`, the command uses this
computer's local date. Promotion appends to the same scope's `context/learnings.md`
and leaves the source log intact. Duplicate lessons are skipped, including across
dates. Invalid entries stop the whole promotion before a write. `--check` reports
recorded lessons still missing from learnings; it cannot find unrecorded mistakes.

The optional `daily-correction-distill` job starts paused. Enable it only after
reviewing its schedule and scope. Manual promotion works without a scheduler or
another model call. To undo a promotion, remove its new learnings bullet; the
source remains available for review.

## Read a client through its current-state brief

In a Solo client session, refresh the generated brief before gathering context:

```bash
python3 /path/to/AI-OS/scripts/workspace-maintenance.py brief
```

The command uses the current root or client scope. `--scope` can point to that
workspace explicitly. It writes `context/current-state.md` from working memory,
the last three daily logs, and local context/project links. The brief is an index
and recent summary. Read linked source files when older decisions or details
matter; the brief is not proof or a complete history. It reads no sibling client.
Delete the generated file to undo it, then regenerate it when needed.
The tool refreshes only files with its generated marker. It preserves an existing
unmarked `current-state.md`; keep that file as a source or move it aside yourself
before asking for a generated brief.

## Check the setup

```bash
python3 /path/to/AI-OS/scripts/workspace-maintenance.py health
```

This command changes no files. It checks tool availability, the working-memory
budget, settings and memory JSON, skill discovery links, configured backup remotes,
active job definitions and today's recorded correction gaps. Each warning names
its next check. Optional backup setup is a warning, not a required install step.

It does not test live backup privacy/freshness, search quality or scheduler
execution. Use the existing memory, GitHub and cron status tools for those checks.
It reads no `.env` values and prints no stored credentials or remote URLs.

## Keep Team access authoritative

All three maintenance commands are Solo-only. They stop before reading local
context when Team mode, a context overlay, a saved Team login, or unreadable login
state is detected. An expired login still owns that boundary. Use the connected
runtime's authorized snapshot and storage for Team checkpoints and lessons.
If no such write is available, state the persistence gap and continue only work
allowed by the Team conversation-only rules. Never substitute local files.

## Make code changes small and checkable

Trace the affected flow and callers before editing. Reuse existing helpers,
standard library features and installed dependencies. Fix a shared cause once.
Change only what the task requires and preserve the surrounding style.

Define a runnable check for the actual result. Nontrivial logic needs a small
behavior test at its public interface. A trivial one-line change needs only the
appropriate check. Run it before saying the code works. Broaden tests when changed
behavior or a failure warrants it; avoid tests that merely restate the code.
