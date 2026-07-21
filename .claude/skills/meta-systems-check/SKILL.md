---
name: meta-systems-check
description: "Full health check of the AI-OS install, reported as a plain-English scorecard of what works, what is missing, and what is broken. Not for cron status alone (ops-cron) or worktree audits (meta-worktree)."
when_to_use: 'Invoke when the request sounds like: "systems check", "health check", "is everything working", "what is broken", "diagnose AI-OS", "check my setup"'
---

# meta-systems-check

Checks whether the AI-OS install is healthy and tells the user, in plain words, what works, what is missing, and what is broken.

## When to use

The user asks whether the system is healthy, working, set up correctly, connected, or whether anything is broken. Examples: "is everything working", "run a systems check", "what's broken", "is my AI-OS set up right", "did the install work".

## When NOT to use

- Just the cron schedule or job status, use `ops-cron`.
- Recalling a past fact or memory, use `memory-recall`.
- Git branches, worktrees, dirty work, or "where is my work", use `meta-worktree`.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `context/learnings.md` | `## meta-systems-check` | Known health-check false positives and fixes |
| `docs/connectors.md` | targeted | Connector inventory authority |

The check scripts inspect runtime state directly. Do not preload broad memory or
brand context for a normal health check.

## How to run

Run the read-only check script from the repo root:

    bash .claude/skills/meta-systems-check/scripts/check.sh

It changes nothing. It prints a scorecard grouped as CRITICAL, WARNINGS, INFO, and OK, each finding with a one-line fix, plus a summary line and an overall HEALTHY or NEEDS ATTENTION status.

For a slower check that also runs Command Centre cron/runtime tests and a build:

    bash .claude/skills/meta-systems-check/scripts/check.sh --deep

Use `--deep` only when the user asks for a deeper diagnostic, before a release,
or when Command Centre behavior is part of the question. Keep normal systems
checks lightweight.

Deep checks time out after 240 seconds per command by default. Override only for
debugging:

    AI_OS_DEEP_TIMEOUT_SECONDS=600 bash .claude/skills/meta-systems-check/scripts/check.sh --deep

## How to present the result

1. Lead with the overall status (HEALTHY or NEEDS ATTENTION) in one line.
2. List the CRITICAL items first, each with its exact fix command. These block the system.
3. Then the WARNINGS, then anything from INFO worth flagging.
4. Skip or compress the OK list unless the user wants the full picture.
5. End with one recommendation: the single highest-leverage fix to run next.

Keep it plain. Translate any jargon. Never print secret values; the script reports key names and counts only, never the keys themselves.

## What it checks

- Node runtime, and the Command Centre dependencies (better-sqlite3).
- The onboarding command is present.
- The nightly cron daemon (macOS launchd): loaded, off, or stalled.
- Semantic memory (memsearch) installed.
- API keys: how many documented keys are exported in the current process. It does not read `.env`.
- Connector readiness: connector map, AgentMail files, Notion sync files, Notion resource-health status, Notion blocker notes, and client-dashboard shared profile.
- Brand context: whether onboarding has been run.
- Client folders: each has its AGENTS.md, CLAUDE.md, and .claude/commands.
- Git backup remote: your own, the template's, or none.
- VERSION vs CHANGELOG.
- The MEMORY.md character budget.
- Claude settings.json is valid JSON.
- In `--deep` mode only: `npm run test:cron` and `npm run build` in `command-centre/`, each with a timeout.

## Eval

Run this eval before changing system health checks or result presentation:

```bash
bash .claude/skills/meta-systems-check/scripts/check.sh
bash scripts/memory-system-audit.sh
```

The eval passes when the normal check stays read-only, reports critical,
warning, info, and OK groups, never prints secret values, reports failed Notion
resource health as needing attention, keeps Command Centre
build/test work behind `--deep`, and gives one clear next fix. It fails if the
skill mutates files, treats optional setup as critical, or claims semantic
memory is proven when only fallback recall was available.

## Rules

- Read-only. The skill never changes anything; it only reports. If the user wants a fix applied, do that as a separate, explicit step.
- After presenting, offer to apply the top one or two fixes, but do not auto-fix.
- The cron check is macOS-first; on other systems that one check is skipped, not failed.
- A failed `notion-resource-health` status is a warning and the overall status is `NEEDS ATTENTION`; the check must not say `HEALTHY` while Resource Sync is blocked.
- Keep deep Command Centre tests out of normal mode. They are explicit release/debug checks, not startup checks.
