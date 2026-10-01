---
name: str-deep-research
description: >
  Produce a multi-pass, cited research brief with source dates, contradictions, confidence, gaps, and next steps. Use for "research this", "investigate", "due diligence", "validate this market", or a technical decision needing verification. Uses actual available search, browser, connectors, and local knowledge; single fact lookups and internal-only wiki questions do not need this workflow.
---

# Deep Research

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A cited research brief, source ledger, and research index.
Save deliverables to `projects/str-deep-research/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## str-deep-research` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/str-deep-research/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| `brand_context/icp.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `tool-social-fetch` | Optional | Normalize specific social sources | Use accessible original pages or pasted content |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-deep-research/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Frame the useful answer

State the research question and the decision it informs. Establish scope, recency, priority sources, and a stopping point. Search existing projects/str-deep-research and local knowledge before duplicating work.
Read [the detailed method](references/methodology.md#step-1--frame-the-question) for this step’s mechanics and output shape.

## Step 3: Plan independent discovery passes

Select official documents, independent reporting, practitioner evidence, and relevant local context. Check available search, browser, and connected workspace tools; do not assume an upstream plugin or account exists. Collect independent reads concurrently when supported.
Read [the detailed method](references/methodology.md#step-2--plan-the-sources) for this step’s mechanics and output shape.

## Step 4: Collect and verify evidence

For each source retain its URL or local path, publication date, claim, useful excerpt, and confidence. Follow citations to originals. Verify current prices, laws, product details, and high-stakes claims with primary sources; do not manufacture unavailable evidence.
Read [the detailed method](references/methodology.md#step-3--execute-discovery) for this step’s mechanics and output shape.

## Step 5: Synthesize contradictions and next steps

Group by sub-question. Distinguish corroborated fact, single-source claim, and inference. Surface opposing evidence and what would settle it. Write a brief proportional to the question with an answer, findings, contradictions, gaps, recommendations, and linked source list.
Read [the detailed method](references/methodology.md#step-4--synthesize) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/str-deep-research/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## str-deep-research` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Every material factual claim needs a supporting source pointer.
- Source repetition across syndicated sites is not independent corroboration.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## str-deep-research` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
