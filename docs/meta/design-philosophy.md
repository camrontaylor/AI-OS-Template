# Design Philosophy

AI-OS is not a pile of prompts. It is an agent workspace that should get more
reliable as it is used.

## Core Idea

AI-OS turns different coding agents into the same business assistant by giving
them the same local brain, the same skills, and the same operating rules.

The important design choice is this: AI-OS is **agent-first**, not tool-first.
Claude Code is a first-class runtime, but it does not own the system. Codex,
Cursor, and other agents should reach the same behavior through adapters.

## Principles

### Local First

The durable source of truth lives in the repo:

- instructions in `AGENTS.md`,
- identity in `context/SOUL.md`,
- user preferences in `context/USER.md`,
- memory in `context/` and `clients/*/context/`,
- skills in `.claude/skills/`,
- reports in `projects/`.

External services can enrich the system, but they should not be the only place a
decision, memory, or deliverable exists.

### Markdown Is Authority

Markdown files are the canonical record. Search indexes, dashboards, Notion
views, and generated reports are derived surfaces. They can be rebuilt. If a
vector database disagrees with the markdown, markdown wins.

This follows the same shape as the MemSearch philosophy: use plain local files as
the memory substrate, then add semantic search as a retrieval layer.

### Small Hot Memory, Large Cold Memory

`MEMORY.md` is a hot scratchpad, not an archive. Its 2,500 character budget is a
design constraint that keeps startup fast and forces prioritization.

When hot memory overflows, do not blindly delete. Ask what the overflow reveals:

- stale work,
- unresolved decisions,
- duplicate facts,
- project details in the wrong place,
- missing reference files,
- or a weak access path.

The fix should improve the memory shape.

### Skills Are Curated Capabilities

A skill is not just a prompt. A live AI-OS skill should have:

- clear triggers,
- a known scope,
- local fallbacks where possible,
- learnings,
- and a registration path.

External skill packs land in `skills-library/` first. They do not flood the live
skill surface automatically.

### Self-Maintaining Beats Manually Clean

A one-time fix is incomplete when the failure mode is recurring.

Good AI-OS changes add a loop:

- detect,
- report,
- recommend,
- repair when safe,
- and preserve approval gates for risky actions.

Examples:

- client memory evaluator before curation,
- workspace health report before branch cleanup,
- semantic memory health before assuming recall works,
- Notion readiness before resource sync.

### Approval Gates Are Part Of The Design

AI-OS should automate observation and safe local maintenance. It should not
silently perform actions that cross boundaries:

- pushing,
- pulling,
- merging,
- deleting,
- archiving branches,
- sending messages,
- writing external systems,
- or changing live services.

Those actions need explicit approval and proof of target.

## Anti-Patterns

- Treating a warning as noise because the system still says `HEALTHY`.
- Letting cron jobs produce reports nobody can find.
- Solving a memory overage by deleting useful information instead of improving
  where it lives.
- Calling raw external tooling when AI-OS has a wrapper that preserves scope,
  fallbacks, and safety.
- Copying root methodology into clients instead of linking discovery surfaces to
  the canonical source.
- Treating autosave commits as the same thing as a backed-up, reviewed, or
  reconciled workspace.

## Design Test

Before adding or changing anything, ask:

> If this breaks again in two weeks, will AI-OS notice and explain the next step?

If the answer is no, the change is probably only a patch.
