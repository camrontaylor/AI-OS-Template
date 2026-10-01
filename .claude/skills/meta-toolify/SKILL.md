---
name: meta-toolify
description: >
  Integrate one external API, SDK, connector, or MCP into AI-OS or an explicitly selected project. Use for "wire up this API", "connect this service", "add an MCP", or "set up this integration". Detects the real stack, fetches official docs, configures secrets safely, builds scoped client/webhook code, registers services, and verifies a read-only smoke test. Skill creation belongs in meta-skillify; schedules in ops-loopify.
---

# Toolify Integration

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

Integration code/configuration, service registration, reusable recipe, and a dated verification report.
Save deliverables to `projects/meta-toolify/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## meta-toolify` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/meta-toolify/` | Relevant files if present | User-owned settings |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `tool-watch-video` | Optional | Extract an integration walkthrough | Read official docs and supplied notes |
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/meta-toolify/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Specify one integration

Determine exact service, workspace/client or application path, stack, auth, SDK, environments, required scopes, webhook needs, rate limits, and success signal. Infer facts from existing code, not the source author’s Next.js/Rails defaults. Present a concrete configuration before consequential account changes.

## Step 3: Read current official documentation

Use actual available documentation/search tools. Pin supported SDK versions and distinguish APIs from MCP tools. Check a real recipe file before reading it; if none exists, derive the integration from official docs and store the reusable recipe in scoped config.

## Step 4: Scaffold scoped plumbing

Build client singleton, typed wrappers, optional signed webhook handler, and non-destructive example usage. Preserve existing app conventions and MCP entries. Register actual external services in root AGENTS.md, .env.example and README.md when root-scoped; document client-only services inside that client. Never install upstream skill marketplaces.

## Step 5: Verify auth and operational handoff

Use official auth headers, refresh handling, webhook verification, expirations, retry/rate-limit policy, and server-only secrets. Keep placeholders in tracked examples and real values in the existing secret environment. Run an authorized read-only smoke test or report its unmet prerequisite. Return files, variable names, versions, test results, and remaining dashboard steps.

## Step 6: Save and verify output

Create `projects/meta-toolify/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## meta-toolify` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Never print credentials, put secrets into command arguments, or expose server keys in client bundles.
- Merge MCP/service configuration without overwriting existing entries.
- Do not assume a tool can be called because its name appears in a reference.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## meta-toolify` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
