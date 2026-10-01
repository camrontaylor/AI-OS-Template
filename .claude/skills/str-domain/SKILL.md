---
name: str-domain
description: >
  Brainstorm project names and investigate domain availability, registrar and aftermarket prices, trademark screening, and social handles. Use for "find a domain", "name my project", "check domain availability", or "domain hunt". Works backwards from availability and budget. Produces a verified shortlist and uncertainty log; it does not purchase, backorder, or negotiate automatically.
---

# Domain Research

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A domain shortlist with timestamped availability, prices, screening evidence, and uncertainty.
Save deliverables to `projects/str-domain/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## str-domain` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/str-domain/` | Relevant files if present | User-owned settings |
| `brand_context/positioning.md` | summary | Brand and audience context |
| `brand_context/icp.md` | summary | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `str-decide` | Optional | Choose between surviving names | Present comparative tradeoffs |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-domain/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Set budget and generate candidates

Capture business meaning, target audience, naming constraints, preferred TLDs, and registration plus renewal budget. Generate memorable branded combinations before researching attractive but unavailable names. Read the candidate heuristics in the method reference.
Read [the detailed method](references/methodology.md#step-2--seed-words-for-branded-combos) for this step’s mechanics and output shape.

## Step 3: Check registration status with evidence

Use available registrar read-only CLI/API, authoritative whois, or RDAP. Classify AVAILABLE, TAKEN, or UNKNOWN; classify reserved/blocked as unavailable. Rate limits, timeouts, 403s, and unsupported-TLD 404s are UNKNOWN. Cross-check apparent availability through a registrar.
Read [the detailed method](references/methodology.md#step-4--cross-check-with-whois) for this step’s mechanics and output shape.

## Step 4: Compare real costs and aftermarket options

Separate first-year, renewal, premium registration, and aftermarket asking prices with currency and timestamp. Optional Domainr/Namecheap keys are not assumed. For taken candidates, inspect public liveness and registration expiry where accessible, and provide marketplace click-through links. Expiry does not guarantee a drop.
Read [the detailed method](references/methodology.md#step-7--aftermarket-sweep-for-taken-candidates) for this step’s mechanics and output shape.

## Step 5: Screen surviving names and recommend

For top 3–5 affordable names, research search collisions, relevant-country trademark databases, spoken spelling, and actual handle availability. A social HTTP status alone is insufficient. Label trademark work as preliminary screening. Present a ranked shortlist with evidence, unresolved checks, and optional draft offer text.
Read [the detailed method](references/methodology.md#step-10--now-do-the-name-research-not-before) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/str-domain/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## str-domain` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Never purchase a domain, place a backorder, or send an offer without explicit user instruction.
- Do not use marketplace access-control evasion as a fallback.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## str-domain` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing binary: resolve `scripts/setup.sh` inside this installed skill package and run it only for the required missing tools; inspect its result before proceeding.
- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
