---
name: mkt-jab-hook
description: >
  Plan, choose, draft, or audit X and LinkedIn content using a value-first jab/jab/jab/hook rotation across the user’s configured properties. Use for "plan my socials", "next promo", "next jab", "audit my socials", or "what should I post". Reads AI-OS voice, portfolio, and real posting history and produces local drafts; connected Typefully draft export is optional. General social strategy belongs in mkt-social.
---

# Jab and Hook Content Rotation

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A rotation plan or coverage audit and dated platform draft files.
Save deliverables to `projects/mkt-jab-hook/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## mkt-jab-hook` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/mkt-jab-hook/` | Relevant files if present | User-owned settings |
| `brand_context/voice-profile.md` | full | Brand and audience context |
| `brand_context/positioning.md` | summary | Brand and audience context |
| `brand_context/icp.md` | full | Brand and audience context |
| `brand_context/samples.md` | full | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `tool-social-fetch` | Optional | Retrieve public inspiration | Use user-supplied examples |
| `tool-paste` | Optional | Destination formatting | Produce local platform drafts |
| `tool-humanizer` | Optional | Editorial gate | Run the explicit editorial checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Load real portfolio and history

Read properties.yaml, voice.local.md, inspiration.local.md, and optional Typefully configuration from scoped config. Use brand voice and references/voice.md, content-types.md, and properties.md. Connected posting history is optional; absent history is unknown, not zero. Do not assume six portfolio slots or a preselected account.
Read [the detailed method](references/methodology.md#step-2--load-context) for this step’s mechanics and output shape.

## Step 3: Choose mode and rotation

Plan, pick-next, audit, or draft. Start with a configurable rhythm around two promotions weekly and alternating educational/build-in-public value. Rank properties by time since last actual promotion; flag around 21 days overdue and avoid adjacent promotional days. Match actual portfolio size and user cadence.
Read [the detailed method](references/methodology.md#step-3--mode-logic) for this step’s mechanics and output shape.

## Step 4: Draft platform-specific value

Write one X draft and one LinkedIn draft unless the user asks otherwise. Use relevant template and one inspiration structure, never copied phrasing. Each body stands alone. Default links to a separate reply/comment when suitable; apply the user’s current local rule and avoid claiming an unverified ranking guarantee.
Read [the detailed method](references/methodology.md#step-4--draft) for this step’s mechanics and output shape.

## Step 5: Audit coverage and optional draft export

Return plan or overdue table and local drafts. If explicitly requested and a connected Typefully tool exists, verify target social set and export as unscheduled drafts. If unsupported, show manual copy text and any separate comment. Publishing and scheduling need explicit instruction.
Read [the detailed method](references/methodology.md#step-5--syndicate-to-typefully) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/mkt-jab-hook/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## mkt-jab-hook` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- User portfolio and brand voice override starter examples.
- Cadence is configurable; avoid more than two daily posts per account by default.
- Draft export is not authorization to publish or schedule.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## mkt-jab-hook` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
