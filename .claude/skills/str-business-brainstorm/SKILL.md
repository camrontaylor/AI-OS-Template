---
name: str-business-brainstorm
description: >
  Pressure-test a new business, product, or side project on problem, audience, wedge, monetization, moat, portfolio fit, distribution, energy, and opportunity cost. Use for "should I build this", "validate this idea", or "new business idea". Produces a build, defer, or pass brief; marketing tactics for an existing product belong in str-marketing-ideas.
---

# Business Brainstorm

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A viability brief and searchable idea index.
Save deliverables to `projects/str-business-brainstorm/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## str-business-brainstorm` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/str-business-brainstorm/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| `brand_context/icp.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-deep-research` | Optional | Validate unknown market assumptions | Mark them unknown and define a validation test |
| `str-domain` | Optional | Check working names | Record naming as unresolved |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-business-brainstorm/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Capture the idea and portfolio fit

State the idea, why now, audience, and user constraints. Read configured portfolio.local.md and relevant local knowledge before asking for missing facts. Compare with existing initiatives; prefer an extension when it solves substantially the same job.
Read [the detailed method](references/methodology.md#step-1--capture-the-idea) for this step’s mechanics and output shape.

## Step 3: Score all nine dimensions

Read references/framework.md. Score problem, audience, wedge, monetization, moat, portfolio fit, distribution, energy fit, and opportunity cost as strong, adequate, weak, or unknown, with one evidence-backed explanation each. Do not turn missing data into a favorable score.
Read [the detailed method](references/methodology.md#step-3--score-each-dimension) for this step’s mechanics and output shape.

## Step 4: Validate the binding unknowns

Use str-deep-research or available web research on willingness to pay, alternatives, audience language, and pricing. If two or more dimensions remain unknown, identify a small validation experiment. Use str-domain for plausible working names without buying anything.
Read [the detailed method](references/methodology.md#step-4--trigger-research-where-needed-optional) for this step’s mechanics and output shape.

## Step 5: Reach a viability verdict

Write build, defer, pass, or adapt an angle for an existing initiative. Explain which dimension drives the verdict. Include first 100 customers, wedge offer, price range, MVP scope, reusable ideas, and open questions. A defer verdict includes a dated revisit and required evidence; scheduling requires a user request.
Read [the detailed method](references/methodology.md#step-6--output-the-brief) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/str-business-brainstorm/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## str-business-brainstorm` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- A domain price is a constraint, not proof of viability.
- Archive negative verdicts and preserve their rationale.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## str-business-brainstorm` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
