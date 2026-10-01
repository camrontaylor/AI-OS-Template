---
name: ops-loopify
description: >
  Design an idempotent recurring task or bounded in-session loop for AI-OS. Use for "run this daily", "schedule this", "keep checking until", "make this recurring", or "set up a loop". Adds checkpoints, failure handling, stop conditions, and a verification plan; recurring jobs use the existing ops-cron managed runtime. Skill authoring belongs in meta-skillify, and tool integration in meta-toolify.
---

# Loopify

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A dated loop specification, checkpoint schema, and an optional registered managed job.
Save deliverables to `projects/ops-loopify/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## ops-loopify` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/ops-loopify/` | Relevant files if present | User-owned settings |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `ops-cron` | Required for recurring jobs | AI-OS managed scheduling and runtime status | A bounded in-session loop or inactive job design only |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/ops-loopify/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Define task, scope, and stop condition

Capture work to repeat, workspace/client, intended outputs, timezone, cadence or completion signal, cost bounds, timeout, and notification intent. Use only user-requested recurring work. Read existing job definitions to avoid duplicate schedules.

## Step 3: Choose managed schedule or bounded loop

Use ops-cron for fixed recurring schedules supported by its current job-format reference. For until-condition tasks within a session, use a bounded iteration count and elapsed-time deadline. Dynamic backoff is part of the job body when supported; do not assume vendor wakeup tools or create OS cron.

## Step 4: Make the body idempotent

Define a stable run key, checkpoint, freshness check, and duplicate-output policy. Prefer append-only records or atomic replacement of the job’s own files. Checkpoint before external writes; retries must not resend or recreate work. Specify exponential backoff and a small retry cap.

## Step 5: Create and verify the job

For recurring work invoke ops-cron with its existing cron/jobs contract and current host requirements. Show the concrete prompt, schedule/timezone, outputs, timeout, and service dependencies. Activation follows the user’s authorization and ops-cron workflow. Test one safe run, inspect cron/status and logs, and report actual host state.

## Step 6: Save and verify output

Create `projects/ops-loopify/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## ops-loopify` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Never install global crontab, launchd, or Task Scheduler for AI-OS jobs.
- Stay quiet on unchanged/nonactionable state unless periodic updates were requested.
- Stop on completion, deadline, cost cap, repeated failure, or required user input.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## ops-loopify` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
