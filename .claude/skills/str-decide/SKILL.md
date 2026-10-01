---
name: str-decide
description: >
  Make and record a decision using the 37signals question bank plus opportunity cost. Use for "help me decide", "go/no-go", "deciding between", or a consequential choice. Selects 6–8 relevant questions, captures first instinct, and records rationale and a revisit date. Business viability scoring belongs in str-business-brainstorm; execution belongs in the appropriate operations skill.
---

# Decide

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A decision record with answers, rationale, expected outcome, and revisit date.
Save deliverables to `projects/str-decide/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## str-decide` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/str-decide/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-deep-research` | Optional | Resolve information that could change the call | Record the unknown and wait criteria |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-decide/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Frame the choice

Record options, stakes, reversibility, deadline, and context. Identify the decision owner. Ask only for facts missing from conversation and workspace context.
Read [the detailed method](references/methodology.md#step-1--capture-the-decision) for this step’s mechanics and output shape.

## Step 3: Choose the questions

Read references/questions.md. Start with Q1 necessity, Q2 owner, Q8 reversibility, Q9 instinct, and Q3 future perspective. Add questions appropriate to money, customers, time pressure, recurring choices, people, or irreversible consequences. Cap the total around eight.
Read [the detailed method](references/methodology.md#step-2--triage-the-question-set) for this step’s mechanics and output shape.

## Step 4: Capture answers and first instinct

Ask Q9 before analytical questions. Keep the user’s actual words, then walk through the other questions individually or in a compact group. Separate facts, preferences, and predictions.
Read [the detailed method](references/methodology.md#step-3--walk-through) for this step’s mechanics and output shape.

## Step 5: Make the call and revisit plan

Choose decide now, decide smaller, wait for named evidence, no decision needed, or refer to the proper owner. Explain any departure from first instinct. Set a revisit date and observable success conditions; record the date without creating an unsolicited automation.
Read [the detailed method](references/methodology.md#step-4--reach-a-call) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/str-decide/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## str-decide` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Preserve legitimate 37signals methodology attribution.
- Do not convert a recommendation into a financial transaction or outward commitment.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## str-decide` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
