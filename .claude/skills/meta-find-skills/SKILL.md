---
name: meta-find-skills
description: "Choose the smallest useful set of installed AI-OS skills for a task. Use for find a skill, what skill handles this, can AI-OS do this, or a multifaceted task with uncertain routing. Scans the shared inventory and only the active client's skills, respects hidden skills, and names real capability gaps. Does not build skills, install tools or change accounts."
---

# Find Skills

Choose one to three non-overlapping skills that cover the requested outcome.
Complete the original task after routing; a list of skills alone only finishes a
request whose outcome was the list itself.

## Context Needs

| Source | Load | Purpose |
|---|---|---|
| Root `.claude/skills/*/SKILL.md` | All frontmatter; full selected skills | Canonical shared inventory |
| Active client `.claude/skills/*/SKILL.md` | Frontmatter; full selected skills | Client-only methods and same-name overrides |
| Active client's `.claude/settings.local.json` | `skillOverrides` only | Exclude skills marked `off` in Solo mode |
| Selected `SKILL.local.md` | Full, root and active client when present | Preserve user-owned changes |
| Active `context/learnings.md` | `## meta-find-skills` | Prior routing lessons, Solo only |
| `_catalog/catalog.json` | Targeted after installed coverage | Optional methods that can be restored |

Resolve root and active scope through `docs/agent-startup.md`. In Team mode, read
only shared methodology and the authorized injected inventory and preferences.
Never read local client settings, context or another user's files in Team mode.
If the snapshot lacks a scoped inventory, report that limit rather than inferring
client access from a path. Respect the existing conversation-only boundary.

## 1. Identify the needs

Name the outcome and the capabilities it needs. Separate needs that change the
correctness or usefulness of the result from optional extras. For multi-part work,
map its phases before choosing a skill. Do not collect skills for minor needs the
agent can already handle.

## 2. Read the complete installed inventory

Read the frontmatter of every direct child `SKILL.md` in the shared source,
excluding underscore-prefixed support folders. Include only the active client's
authorized local skills. Deduplicate inherited links by resolved path. A client's
same-name skill takes precedence; an `off` override excludes that skill.

Use `.claude/skills/` as authority. `.agents/skills/` is its discovery adapter;
catalogs and the current tool's picker may be stale. Use the public method's
triggers, exclusions, Context Needs and available fallback to judge fit.

Do not route this task back to `meta-find-skills` itself. A runtime-only plugin
may supplement a method, but label it runtime-only and do not promise portability.

## 3. Commit to the smallest route

Use one skill for a focused task. Choose two or three only when each covers a
different material need. Prefer one exact-fit method over overlapping specialists.
Order them by dependency, such as research, decision, then production.

Read each selected `SKILL.md`, its applicable local overrides, Context Needs and
matching learnings before execution. Retain the original objective and accepted
constraints when switching methods. Tool references describe a capability; map
them to the current agent's available tools and documented fallback.

## 4. Handle a real gap

Check the optional catalog only after installed coverage. Restore a named optional
skill through `scripts/add-skill.sh` when the user has asked for its installation;
listing it does not mean it is installed.

If this install has a `skills-library/INDEX.md`, read only relevant parked entries.
Parked sources are candidates for review, not live methods. If neither the catalog
nor a local library covers the need, name the gap and proceed with available tools
when useful. Offer to find or build a method only when it would improve the job.

External discovery is for a material uncovered need or an explicit request. Use
current official source repositories and documentation, check scope and license,
and keep any downloaded candidate under a task folder in the install's ignored
`.tmp/` directory. Report it as task-scoped. It becomes a shared skill only through
the registration process in `docs/building-skills.md` and the user's decision.
Never install skills globally or replace local overrides.

Do not require usage-ranking scripts, a library, a connector or a paid service
that this template does not ship. Their absence is not a broken routing system.

## Output

For a skill-finding request, give one chosen route with each skill's job and any
material gap. For an execution request, name the selected method briefly and do
the work. Keep rejected candidates out of the reply unless the choice turns on
their tradeoff. Ask only when a missing fact changes the route.

## Verification

- An installed match is chosen without an external search or installation.
- A multi-part request gets at most three distinct methods covering its needs.
- A hidden or unauthorized client skill is excluded; sibling context is unread.
- An optional or parked candidate is labelled accurately and stays uninstalled.
- A missing optional service uses the documented fallback or a stated limit.
- Selected methods are read fully, and the original requested outcome is checked.
