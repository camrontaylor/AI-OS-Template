---
name: meta-systems-check
description: "Health AND refinement review of the AI-OS install, as a plain-English scorecard: what works, what is missing, what is broken, AND what is sub-optimal - how data/information is being accessed, what durable knowledge is being missed by recall, and what is not structured in the most optimal way. Not for cron status alone (ops-cron) or worktree audits (meta-worktree)."
when_to_use: 'Invoke when the request sounds like: "systems check", "health check", "is everything working", "what is broken", "diagnose AI-OS", "check my setup", "refine the system", "what could be better", "what am I missing", "is this structured optimally", "how is data being accessed", "review the memory/data layer"'
---

# meta-systems-check

Two jobs in one skill:

1. **Health** - is the AI-OS install working? What works, what is missing, what is broken. A hard pass/fail.
2. **Refinement** - beyond "not broken", is it *optimal*? How is data and information being accessed, what durable knowledge is being missed by recall, and what is not structured in the best way? These are opportunities, not failures.

Refinement findings never flip a healthy system to NEEDS ATTENTION; they surface on their own line so a green system still shows where it could be sharper.

## When to use

The user asks whether the system is healthy, working, set up correctly, connected, or broken - OR whether it is *optimal*: how data is accessed, what is being missed, what could be structured better, "refine the system", "what am I missing". Examples: "is everything working", "run a systems check", "what's broken", "is my AI-OS set up right", "what could be better", "is our knowledge actually reachable", "review the memory layer".

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
4. Then the REFINEMENTS (if any): "not broken, but could be better" - each with its one-line improvement. Say plainly these do not affect health status.
5. Skip or compress the OK list unless the user wants the full picture.
6. End with one recommendation: the single highest-leverage next step (a fix if anything is broken, otherwise the top refinement).

Keep it plain. Translate any jargon. Never print secret values; the script reports key names and counts only, never the keys themselves.

## What it checks

- Node runtime, and the Command Centre dependencies (better-sqlite3).
- The onboarding command is present.
- Scheduler authority: local macOS launchd, or an explicitly declared Hermes VPS migration with local launchd intentionally stopped.
- Semantic memory (memsearch) installed.
- API keys: how many documented keys are exported in the current process. It does not read `.env`.
- Connector readiness: connector map, AgentMail files, Notion sync files, Notion resource-health status, Notion blocker notes, and client-dashboard shared profile.
- Brand context: whether onboarding has been run.
- Client folders: each has its AGENTS.md, CLAUDE.md, and .claude/commands.
- Git backup remote: your own, the template's, or none.
- VERSION vs CHANGELOG.
- The MEMORY.md character budget.
- Claude settings.json is valid JSON.
- **Data access & memory structure (the REFINEMENT lens, always on, read-only):**
  - Whether the durable synthesis layer (top-level `context/*.md`: relationship history, ops synthesis, Decision Ledger, current-state, for root and every client) is actually in the semantic index source set, so recall can reach it.
  - Whether the index policy (`config/memory-index-policy.json`), the indexer (`scripts/memsearch-reindex.sh`), and the markdown fallback (`scripts/memory-search.py`) all agree on the routine source set - drift means the policy silently lies about what is searchable, or recall loses surfaces when Milvus is locked.
  - Whether any reranker authority weight points at a source that exists nowhere in the tree (dead config that skews recall tuning).
- In `--deep` mode only: `npm run test:cron` and `npm run build` in `command-centre/`, each with a timeout.

## Refinement review (beyond the script)

The script's REFINEMENTS bucket catches the *known, scriptable* structure problems. When the user asks to genuinely refine the system ("what am I missing", "is this structured optimally", "how is our data accessed", "make the memory/data layer better"), also do a short model-driven review that the script cannot fully automate. Ask these questions against the real files, then propose concrete, reversible improvements:

- **Access - how is each kind of data reached?** For every meaningful store (memory logs, learnings, decisions, client synthesis docs, meeting transcripts, brand context, Notion catalog, project deliverables), which retrieval tier serves it: in-context at startup, semantic index, markdown fallback, deep-search-only, or *nothing* (only reachable if you already know the path)? A store in the last bucket is effectively invisible to future sessions.
- **Missed - what durable knowledge has no access path?** New content types get added over time (a new synthesis doc, a new client folder shape, a new archive). Did its access path get wired in, or is it stranded? The trigger for this whole review was exactly this: rich client synthesis was on disk but unindexed.
- **Sub-optimal - what is structured badly?** Duplicated or near-duplicate sources competing in recall; one source monopolizing top results; deep-search material that should be summarized-and-promoted (or the reverse - noise that should be demoted); a policy/spec that has drifted from the code; dead references/weights; things sitting in the wrong tier.
- **Bounded - what should stay out?** Refinement is not "index everything". Verbatim transcripts, raw scraped pages, and large asset trees are deliberately deep-search-only (noise + speed). The right move is usually to index the *synthesis* of bulky material, not the bulk.

Turn each finding into a proposal with a named file, a one-line change, and how to reverse it. Recall-affecting changes MUST be verified: run `bash scripts/test-recall-golden.sh` before and after and confirm no regression (see the parity/coverage tests in the Eval). Never ship a recall change on intuition alone.

## Eval

Run this eval before changing system health checks or result presentation:

```bash
bash .claude/skills/meta-systems-check/scripts/check.sh
bash scripts/memory-system-audit.sh
bash scripts/test-memory-index-policy.sh
bash scripts/test-recall-golden.sh
```

The eval passes when the normal check stays read-only; reports CRITICAL,
WARNINGS, REFINEMENTS, INFO, and OK groups; never prints secret values; reports
failed Notion resource health as needing attention; keeps Command Centre
build/test work behind `--deep`; and gives one clear next step. The refinement
checks must be honest both ways: OK on a well-structured install, and they would
flag real drift (missing durable-synthesis indexing, policy/indexer/fallback
disagreement, or a dead reranker weight). REFINEMENTS must NOT flip HEALTHY to
NEEDS ATTENTION. It fails if the skill mutates files, treats optional setup as
critical, claims semantic memory is proven when only fallback recall was
available, or lets a refinement finding change the health verdict.

## Rules

- Read-only. The skill never changes anything; it only reports. If the user wants a fix applied, do that as a separate, explicit step.
- After presenting, offer to apply the top one or two fixes, but do not auto-fix.
- The cron check is macOS-first; on other systems that one check is skipped, not failed.
- A failed `notion-resource-health` status is a warning and the overall status is `NEEDS ATTENTION`; the check must not say `HEALTHY` while Resource Sync is blocked.
- Keep deep Command Centre tests out of normal mode. They are explicit release/debug checks, not startup checks.
- Refinement findings are opportunities, not failures: they get their own scorecard line and never change the HEALTHY vs NEEDS ATTENTION verdict.
- Any refinement the user asks you to apply that touches recall (indexing scope, fallback scope, reranker/fusion, source weights) must be verified with `bash scripts/test-recall-golden.sh` before and after - no recall change ships on intuition.
