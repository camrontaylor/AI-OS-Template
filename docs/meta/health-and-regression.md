# Health And Regression

AI-OS should not depend on a person noticing the same breakage every week.
Recurring problems need health loops.

## Health Loop Shape

Every recurring failure mode should have:

1. A detector.
2. A plain-English report.
3. A recommended next action.
4. A safe automatic repair only when the action is local and low-risk.
5. An approval gate for destructive or external actions.

## Current Checks

| Check | Command | What It Proves |
|---|---|---|
| Systems check | `bash .claude/skills/meta-systems-check/scripts/check.sh` | Install dependencies, cron, connectors, memory budget signals, basic setup. |
| Memory audit | `bash scripts/memory-system-audit.sh` | Root/client memory boundaries, client sync, memory jobs, memsearch source contract. |
| Client sync audit | `bash scripts/client-sync-audit.sh --strict` | Root shared skills/scripts/hooks are in parity across clients. |
| Client memory evaluator | `bash scripts/client-memory-maintenance.sh --mode evaluate --all` | Client hot memory quality and organization. |
| Semantic memory health | `bash scripts/memsearch-health.sh` | Semantic recall works, or markdown fallback is the only proven layer. |
| Workspace health | `bash scripts/workspace-health-report.sh` | Unsaved edits, local-vs-GitHub drift, side branches, worktrees, stashes, safety snapshots. |
| Worktree audit | `bash .claude/skills/meta-worktree/scripts/audit.sh` | Machine-readable workspace findings and action IDs. |
| Meta doc drift | `bash scripts/meta-doc-drift-report.sh` | Meta docs, AGENTS.md, health jobs, and the self-sustaining plan still agree. |
| Skill eval coverage | `bash scripts/skill-eval-coverage-report.sh` | Live skills have explicit eval targets, or the missing coverage is reported. |
| Notion docs coverage | `bash scripts/notion-docs-coverage-report.sh` | Local docs, the Notion source map, sync packet, and draft bundle agree before any approved Notion write. |

## Report Locations

| Report | Path |
|---|---|
| System health plans and workspace reports | `projects/system-health/` |
| Root memory daily reports | `context/memory/` |
| Client memory health reports | `clients/{slug}/context/memory/` |
| Cron logs | `cron/logs/` |

## What Counts As A Regression

Treat these as regressions, not normal upkeep:

- a client `MEMORY.md` grows over budget without a health report,
- semantic memory is described as working when only markdown fallback was proven,
- raw MemSearch commands bypass AI-OS wrappers,
- root memory gets client-specific operational detail,
- client runtime or skill discovery links stop resolving to root,
- autosave creates commits but no workspace drift report exists,
- Notion resource sync fails because readiness was not checked first,
- a cron job writes logs but no durable report,
- a side branch sits with unclassified commits for days,
- a fix changes root shared methodology but clients are not synced,
- `AGENTS.md`, `docs/meta/`, recurring health jobs, or the self-sustaining plan
  describe different system contracts.
- a live skill is changed repeatedly without any explicit eval target or
  coverage report.
- Notion template docs are updated without a passing local coverage report.

## Approval Boundaries

These actions are never automatic:

- push,
- pull reconciliation,
- merge,
- branch archive/delete,
- worktree removal with unsaved work,
- Notion writes,
- sent email,
- deploy,
- release,
- external API writes.

The agent can prepare the action and show proof. The user approves the boundary
crossing.

## Scheduled Health Jobs

| Job | Purpose |
|---|---|
| `workspace-health-steward` | Writes a daily workspace drift report. |
| `client-memory-evaluator` | Writes client memory quality reports after distill and before curation. |
| `client-memory-curator` | Removes only clearly resolved client hot-memory lines. |
| `semantic-memory-health` | Retired time-based duplicate; kept as the manual health probe definition. |
| `meta-doc-drift` | Checks the meta docs against the runtime contract and health-loop inventory. |
| `skill-eval-coverage` | Reports live skills that still need explicit pass/fail eval coverage. |
| `notion-docs-coverage` | Checks local docs coverage before any approved Notion template docs sync. |
| `notion-resource-health` | Checks Notion Notes reachability before resource sync. |
| `nightly-memsearch-index` | Strictly refreshes the complete source set, records the generation, checks semantic health, then runs the stable top-three retrieval benchmark. |
| `nightly-memory-backup` | Creates append-only memory backups. |

## Done Means Proven

For maintenance work, do not call something done because the code changed.
Completion needs evidence:

- the relevant audit passes,
- the generated report exists,
- the scheduled job exists if recurrence matters,
- the client sync audit passes after shared changes,
- and any remaining warnings are named with a next action.

## Current Known Warnings

As of 2026-06-29:

- A client hot-memory file is back under budget and has a passing health report:
  `clients/{slug}/context/memory/2026-06-29_memory-health.md`.
- Notion Notes had read-only connector verification on 2026-06-29. Notion
  writes remain approval-gated.
- Workspace drift has a current report:
  `projects/system-health/2026-06-29_workspace-health.md`.
- Branch drift has a current triage plan:
  `projects/system-health/2026-06-29_branch-triage.md`.
