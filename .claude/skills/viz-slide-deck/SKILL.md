---
name: viz-slide-deck
description: >
  Create, update, convert, or export slide decks using a chosen narrative, density mode, and AI-OS brand context. Use for "make a deck", "speaker notes", "rewrite this slide", "convert PPTX", or "export slides". Supports speaker-led and reading-first output, three angles, overflow checks, and presentation validation. A configured React renderer is optional; local HTML/Markdown is the fallback. Deployment requires explicit instruction.
---

# Slide Deck

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

Dated narrative/outline, deck source, speaker notes, and requested verified exports.
Save deliverables to `projects/viz-slide-deck/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## viz-slide-deck` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/viz-slide-deck/` | Relevant files if present | User-owned settings |
| `brand_context/voice-profile.md` | full | Brand and audience context |
| `brand_context/positioning.md` | full | Brand and audience context |
| `brand_context/icp.md` | full | Brand and audience context |
| `brand_context/samples.md` | full | Brand and audience context |
| `brand_context/assets/` | full | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-deep-research` | Optional | Verify factual support | Flag missing evidence and use supplied facts |
| `tool-watch-video` | Optional | Extract recording source | Use supplied transcript/outline |
| `tool-humanizer` | Optional | Polish slide text and notes | Run the explicit editorial checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/viz-slide-deck/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Choose mode and constraints

Identify new, update, PPTX conversion, or export. Establish audience, objective, duration, speaker-led versus reading-first, visual identity, and requested format. Read references/narrative-and-voice.md. User identity comes from brand context or scoped identity.yaml; never fill another person’s footer.
Read `references/methodology.md` for the detailed mechanics relevant to this step.

## Step 3: Offer narrative angles and outline

Develop three genuinely different narrative approaches, explain tradeoffs, and use the user’s selected or already-authorized direction. Outline opening tension, evidence, examples, section beats, and final action. Stop at angles/outline if that is all requested.
Read `references/methodology.md` for the detailed mechanics relevant to this step.

## Step 4: Draft slides and notes

Speaker-led text stays concise, normally one idea and at most three bullets; notes carry the fuller spoken thought. Reading-first can use up to six bullets and explanatory prose. Give each slide a stable ID and update section ranges when inserting/removing. Use real brand assets with provenance.
Read `references/methodology.md` for the detailed mechanics relevant to this step.

## Step 5: Render, convert, and validate

If a configured React deck project contains the documented primitives, use references/system.md and template.md; otherwise create local HTML or Markdown without inventing imports. For PPTX use scripts/extract_pptx.py and references/ppt-conversion.md; pass input and dated output directory plus explicit local `--date`; preserve the original. For export use references/export.md and actual browser/renderer tooling. Preview at 1920×1080; check clipping, count, order, IDs, section ranges, text, and notes.
Read [the detailed method](references/methodology.md#mode-update) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/viz-slide-deck/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## viz-slide-deck` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Do not treat a Markdown recipe as an executable script.
- Publishing/deploying requires explicit instruction; local exports do not.
- Preserve original PPTX files and do not assume private upstream UI components exist.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## viz-slide-deck` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing binary: resolve `scripts/setup.sh` inside this installed skill package and run it only for the required missing tools; inspect its result before proceeding.
- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
