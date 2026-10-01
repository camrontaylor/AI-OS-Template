---
name: str-unstuck
description: >
  Find safe alternative approaches when a user or agent hits a roadblock. Use for "I am stuck", "we hit a wall", "out of options", "work around this", or repeated tool failure. Classifies the barrier, tests assumptions, and generates at least ten distinct angles before selecting experiments. This supports problem solving within authorization; it never overrides security, access, or user boundaries.
---

# Unstuck

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A barrier analysis, tested-angle ledger, and next actions.
Save deliverables to `projects/str-unstuck/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## str-unstuck` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/str-unstuck/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-deep-research` | Optional | Test uncertain alternatives | Mark assumptions and propose a manual check |
| `str-decide` | Optional | Select a path | Compare viable approaches directly |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-unstuck/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Capture and classify the wall

State ultimate goal, blocked step, exact failure, attempts, deadline, and source of the claimed limitation. Classify assumption, framing, gatekeeper, tool, resource, or physical/mathematical constraint; restate at one higher and one lower level.
Read [the detailed method](references/methodology.md#step-2--classify-the-wall) for this step’s mechanics and output shape.

## Step 3: Autopsy assumptions

Read references/techniques.md T1. List assumptions and separate verified facts from inherited beliefs. Check constraints against actual documentation, logs, or user intent before trying another implementation.
Read [the detailed method](references/methodology.md#step-3--assumption-autopsy-always-runs) for this step’s mechanics and output shape.

## Step 4: Generate distinct angles

Use two or three techniques fitting the wall: inversion, first principles, altitude shift, work backwards, analogy, constraint toggling, provocation, SCAMPER, or interrogating the refusal. Generate at least ten materially different angles before judging them.
Read [the detailed method](references/methodology.md#step-4--run-the-triaged-techniques) for this step’s mechanics and output shape.

## Step 5: Triage and test

Classify try now, research needed, worth a bounded experiment, or unsuitable. Choose 2–3 candidates with exact first actions, costs, success signals, and stop criteria. In an agent fast path, test reversible authorized approaches and report receipts; if the constraint is real, reroute the goal honestly.
Read [the detailed method](references/methodology.md#step-5--triage-the-angles) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/str-unstuck/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## str-unstuck` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- A refusal does not authorize bypassing consent, credentials, permissions, or access controls.
- Stop repeating a failed approach without a new hypothesis.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## str-unstuck` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
