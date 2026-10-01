---
name: fin-company-cfo
description: >
  Analyze company cash, reconciled monthly financials, runway, and forecasts. Use for "monthly cash report", "CFO snapshot", "cash pulse", "runway forecast", or "cash projection". Modes are monthly, weekly, scenario, and pickup. Uses user exports or actual read-only connected sources and discloses assumptions; personal household modeling belongs in fin-personal-cfo. Produces analysis, never transactions or accounting filings.
---

# Company CFO Analysis

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A reconciled financial snapshot, assumption ledger, scenario projector, and resume checkpoint.
Save deliverables to `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## fin-company-cfo` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/fin-company-cfo/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-decide` | Optional | Structure leadership decisions | Present scenario options |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/fin-company-cfo/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Load company inputs and resume state

Read scoped company config, prior report, projector, and relevant local context. Use references/company-config-template.md. Choose monthly, weekly cash pulse, scenario, or pickup, and establish currency, account scope, cutoff date, and data coverage.
Read [the detailed method](references/methodology.md#step-0--load-company-config--prior-run) for this step’s mechanics and output shape.

## Step 3: Pull and reconcile read-only data

Import bank, processor, payroll, and expense exports or explicitly connected read-only sources. Follow references/categorization.md; deduplicate, account for transfers, settlements and fee timing, and check payroll versus income statements. Record missing files and reconciliation differences before projecting.
Read [the detailed method](references/methodology.md#phase-2--categorize-and-reconcile) for this step’s mechanics and output shape.

## Step 4: Compute cash with complete history

Read references/eom-cash-methodology.md. Balance at cutoff is opening baseline plus posted transactions through cutoff. Reconcile complete-history sums to observed current account balances, including any pre-history opening balance. Never use raw partial transaction sums as cash.
Read [the detailed method](references/methodology.md#phase-3--compute-eom-cash-the-transaction-sum-method) for this step’s mechanics and output shape.

## Step 5: Project scenarios and report decisions

Read references/scenario-projector.md and traps.md. Update assumptions for cash, burn, receivables, payroll, churn, and revenue; show base/upside/downside and sensitivity. Write a snapshot following report-template.md with cash, runway, changes, anomalies, options, and source/cutoff notes. Weekly is a thin pulse; pickup resumes the checkpoint rather than recomputing blindly.
Read [the detailed method](references/methodology.md#phase-5--write-the-snapshot-report) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/fin-company-cfo/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## fin-company-cfo` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- No transfers, payments, trades, loan applications, or accounting submissions.
- Protect raw financial files and secrets from version control and external publication.
- Missing historical coverage requires a disclosed baseline or an incomplete-data result.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## fin-company-cfo` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
