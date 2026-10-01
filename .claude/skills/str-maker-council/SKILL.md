---
name: str-maker-council
description: >
  Apply contrasting published founder and operator frameworks to a company-building decision. Use for "maker council", "board of advisors", "what would Bezos do", "hire or bootstrap", or "get several founder perspectives". Selects a simulated bench with a dissenter, maps disagreements, and synthesizes a recommendation. Label simulations clearly; marketing campaign questions belong in str-marketing-council.
---

# Maker Council

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A clearly labeled simulated council session with disagreement map and chair’s recommendation.
Save deliverables to `projects/str-maker-council/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## str-maker-council` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/str-maker-council/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| `brand_context/icp.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-deep-research` | Optional | Verify published positions | Use sourced dossier material and flag uncertainty |
| `str-decide` | Optional | Formalize the resulting choice | Record the recommended options |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-maker-council/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Frame the council session

Read existing business context, then capture question, stakes, stage, constraints, and requested mode. Quick take uses one member, ordinary council uses 3–5, and a full council is reserved for justified high stakes.
Read [the detailed method](references/methodology.md#before-starting) for this step’s mechanics and output shape.

## Step 3: Seat relevant contrasting lenses

Read only chosen references/advisors/*.md. Honor requested members and include a documented dissenter. Custom public advisors require sourced positions; private advisors require user-supplied views and live in scoped config, not the shipped files.
Read [the detailed method](references/methodology.md#seating-the-council) for this step’s mechanics and output shape.

## Step 4: Ground and deliver each take

Apply each seated member’s signature questions to this case. Verify time-sensitive claims with current primary material when tools are available. Label the result as a simulation; paraphrase frameworks and quote only verifiable words. A member’s actual opinion about this business is unknown.
Read [the detailed method](references/methodology.md#session-protocol) for this step’s mechanics and output shape.

## Step 5: Map disagreement and synthesize

Identify 2–4 substantive conflicts, the underlying tradeoff, and evidence that would settle each. Recommend a path fitted to the user, a warning tripwire, and concrete next steps. Hand formal choice to str-decide and execution to the appropriate skill.
Read [the detailed method](references/methodology.md#grounding-rules-non-negotiable) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/str-maker-council/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## str-maker-council` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Never invent quotations, endorsements, or personal opinions about the user’s business.
- A famous name is not evidence; apply the documented framework rather than mimic a persona.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## str-maker-council` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
