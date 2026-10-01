---
name: ops-project-management
description: >
  Manage a portfolio using five-column Kanban, Eisenhower triage, work-in-progress limits, and clear async updates. Use for "triage my backlog", "what should I work on next", "project status", "weekly pulse", or "what is blocked". Supports setup, triage, next, status, unblock, and weekly modes via actual available connectors or local/manual boards. It does not send status messages or delegate to people automatically.
---

# Project Management

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A dated board snapshot, triage or next-work plan, and explicit change ledger.
Save deliverables to `projects/ops-project-management/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## ops-project-management` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/ops-project-management/` | Relevant files if present | User-owned settings |
| `brand_context/voice-profile.md` | tone only | Brand and audience context |
| `brand_context/positioning.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-decide` | Optional | Resolve consequential project decisions | Capture the decision as an open item |
| `tool-humanizer` | Optional | Polish shareable status prose | Run the explicit editorial checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-project-management/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Select board and mode

Read scoped boards.md and optional team.local.md; use references/boards.md only as a template. Determine setup, triage, next, status, unblock, or weekly and target business. Cross-portfolio mode is explicit; never mix another client’s context accidentally.
Read [the detailed method](references/methodology.md#step-1--detect-mode-and-target) for this step’s mechanics and output shape.

## Step 3: Load a real adapter

Read references/adapters.md for the selected connected tool. Check actual authentication and commands before assuming Notion, GitHub Projects, Plane, or Linear is usable. Fall back to a local markdown Kanban or user-pasted state with an explicit freshness label.
Read [the detailed method](references/methodology.md#step-3--load-the-adapter) for this step’s mechanics and output shape.

## Step 4: Triage and limit work

Read references/kanban-methodology.md. Use Backlog → Ready → In Progress → Review/Blocked → Done/Archived. Classify urgent-important Q1, important-not-urgent Q2, urgent-not-important Q3, and neither Q4. Default In Progress WIP is three; finish existing work before pulling more. Recommend delegation without messaging anyone.
Read [the detailed method](references/methodology.md#step-4--run-the-mode) for this step’s mechanics and output shape.

## Step 5: Deliver the requested mode

Setup creates configured columns; triage recommends or applies authorized moves; next ranks 1–3 actionable items; unblock identifies named dependencies and safe first actions. Status and weekly report concrete shipped work, current work, named blockers, next priorities, and explicit open questions. Preserve card IDs and existing content.
Read [the detailed method](references/methodology.md#async-first-writing-rules) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/ops-project-management/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## ops-project-management` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Preserve user boards and do not delete or archive work solely from an inferred priority.
- No unsolicited messages, assignments to other people, or external status posting.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## ops-project-management` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
