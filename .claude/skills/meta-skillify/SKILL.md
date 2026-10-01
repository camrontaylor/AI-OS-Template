---
name: meta-skillify
description: >
  Create, adapt, or update a capability using AI-OS’s own skill-building workflow. Use for "turn this into a skill", "skill from this chat/video", "adapt this skill", or "propagate this learning". Routes source material, classifies keep/adapt/add, checks licenses, and coordinates native structure, scoped context, registration, and tests. meta-skill-creator supplies the canonical authoring workflow; this is its source-routing companion.
---

# Skillify

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

Native skill drafts or authorized updates, adaptation classification, validation report, and registration changes.
Save deliverables to `projects/meta-skillify/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## meta-skillify` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/meta-skillify/` | Relevant files if present | User-owned settings |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `meta-skill-creator` | Required | Canonical AI-OS skill creation and validation | Stop and report the missing native authoring skill |
| `tool-watch-video` | Optional | Extract process recording | Use supplied transcript/notes |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/meta-skillify/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Detect mode and source

Create from chat, supplied notes, process video, or scratch; adapt from an external/local skill; update an existing skill from concrete feedback. Ask only when source or target is ambiguous. Read docs/building-skills.md, meta-skill-creator and its local override before writing.

## Step 3: Extract and classify methodology

Read the whole relevant workflow/resources. Keep sound mechanics, adapt names/paths/tools/context, and add AI-OS context/dependencies/outputs. Identify trigger overlaps and installed upstream/downstream skills. For video, use tool-watch-video visual mode when actual screen details matter.

## Step 4: Check licenses and choose scope

For external adaptations inspect source license and retain mandatory notices in a dedicated legal notice location. A rebrand does not remove legal duties. Use root .claude/skills for shared capabilities or clients/{slug}/.claude/skills for a client-only skill; do not shadow an existing root name. Keep unrelated repositories out of scope.

## Step 5: Author, register, and validate natively

Follow meta-skill-creator and docs/building-skills.md: category-name folder/frontmatter, canonical sections, under-200-line entrypoint, focused resources, dependencies/fallbacks, learnings, humanizer when relevant, and dated project output. Root skills update registry, context matrix, learnings and README; client skills remain client-local. Validate paths, schema, resource links, and appropriate scenarios. Do not automatically commit, push, publish, or install marketplaces.

## Step 6: Propagate corrections deliberately

Use references/update-change-types.md and update-propagation.md to find affected skills by keywords and semantic relevance. Distinguish direct and adjacent matches; preserve exceptions. User corrections go immediately into SKILL.local.md and skill learnings; cross-cutting principles go under General. Base-definition changes follow the authorized authoring task. Record change impact and version reasoning.

## Step 7: Save and verify output

Create `projects/meta-skillify/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 8: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## meta-skillify` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Native AI-OS instructions control format and scope; never depend on absent upstream plugins.
- User feedback updates SKILL.local.md; do not rewrite shipped base definitions during ordinary skill execution.
- Do not replace root agent instructions or the established memory system.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## meta-skillify` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
