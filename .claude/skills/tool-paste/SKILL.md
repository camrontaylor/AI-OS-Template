---
name: tool-paste
description: >
  Clean terminal or copied content for Slack, Notion, X, LinkedIn, email, GitHub, Markdown, HTML, or plain text. Use for "paste-ready", "strip ANSI", "clean this for Slack", or "format this for email". Removes terminal artifacts, checks for secrets, preserves meaning and valid code, and saves a dated formatted file with preview. Clipboard access is optional; creating substantive new copy belongs in a writing skill.
---

# Paste Formatting

An AI-OS capability with scoped context, local configuration, and reviewable outputs.

## Outcome

A clean dated text, Markdown, or HTML file plus preview and optional safe clipboard copy.
Save deliverables to `projects/tool-paste/{YYYY-MM-DD}_{name}/` with dated filenames.
Knowledge skills also maintain their scoped raw/wiki corpus; integration and authoring skills may modify the explicitly selected project.

## Context Needs

| File | Load level | Purpose |
|---|---|---|
| `context/learnings.md` | `## tool-paste` only | Feedback for this skill |
| `context/learnings.md` | Relevant General entries | Cross-skill corrections |
| `context/config/tool-paste/` | Relevant files if present | User-owned settings |
| `brand_context/voice-profile.md` | tone only | Brand and audience context |
| Adjacent `SKILL.local.md` | Full if present | User overrides; take precedence |

## Dependencies

| Skill | Required? | What it provides | Without it |
|---|---|---|---|
| `tool-humanizer` | Optional for publishable prose | Editorial gate | Natural-language, voice, factual-claim checklist |

## Skill Relationships

Use the linked skills only if installed; check their SKILL.md and local overrides before invoking.
Consume related source artifacts without duplicating their workflow. Keep trigger boundaries stated in the description.
Keep durable source pointers with the dated project report. Use `meta-memory-write` only when the user asks to remember a concise working fact; full research and financial records stay in project files.

## Step 1: Load scope and corrections

Check the runtime before reading local context. With Team connected, the authoritative workspace snapshot supplies context and feedback; do not read or write local brand_context, context, or learnings. Use its configured output/feedback mechanisms and report a missing snapshot instead of a local fallback. In Solo mode, resolve the AI-OS root or explicitly active client and read only that scope’s listed brand files, this skill’s learnings, relevant General feedback, and local override.
In Solo mode, resolve user configuration as `${AI_OS_SKILL_CONFIG_DIR:-context/config}/tool-paste/` relative to that workspace; do not reuse another client’s settings.
Read relevant `assets/` examples if present; use the output template until an approved example exists.

## Step 2: Choose content and destination

Use supplied content first. Clipboard is a fallback only when available and relevant; check pbpaste/pbcopy rather than assuming macOS. Detect plain, Markdown, Slack, Notion, X, LinkedIn, email, GitHub, or HTML; default plain. Read references/destinations.md for the selected format.
Read [the detailed method](references/methodology.md#step-1--get-the-content) for this step’s mechanics and output shape.

## Step 3: Scan for secrets

Read references/secret-patterns.md and inspect likely tokens, environment values, passwords, and private URLs. Redact sensitive values in the saved/clipboard version and show a nonsecret explanation; do not expose them in previews or logs. Preserve legitimate hashes that are not secrets.
Read [the detailed method](references/methodology.md#step-3--scan-for-secrets) for this step’s mechanics and output shape.

## Step 4: Clean and format faithfully

Strip ANSI escape sequences, prompt artifacts, and unnecessary box drawing. Keep code exact, meaningful tables intact, and destination-valid headings, lists, fences, and links. For social output separate an optional link comment when the user’s local rules require it. Do not invent content to fill a length limit.
Read [the detailed method](references/methodology.md#step-4--universal-cleaning) for this step’s mechanics and output shape.

## Step 5: Verify destination fit

Check destination limits and offer trims rather than silently dropping meaning. For HTML save a rendered document, escape unsafe text, and provide an accessible preview path; do not copy raw HTML as if it were rich clipboard content. Copy safe plain/Markdown output only through an available clipboard tool.
Read [the detailed method](references/methodology.md#step-6--output) for this step’s mechanics and output shape.

## Step 6: Save and verify output

Create `projects/tool-paste/{YYYY-MM-DD}_{name}/` in the selected workspace.
Date-stamp generated filenames as `{YYYY-MM-DD}_{descriptive-name}.{ext}`. Keep an index of prior deliverables when revisits are useful.
Verify factual/source coverage, schema, calculations, destination fit, and links as appropriate. Store raw inputs only in the authorized local scope; do not mix client data.
For publishable prose only, run `tool-humanizer` if installed; otherwise edit for natural language, concrete claims, the user’s voice, and unsupported promises. Do not rewrite quotations, code, or structured data through this gate.
Show a concise preview, report the full absolute deliverable path, and distinguish completed work from unmet dependencies.

## Step 7: Capture feedback

Ask for feedback after major deliverables. In Solo mode append dated, contextual feedback under `## tool-paste` in the scoped `context/learnings.md`.
Save an approved good output as an asset only when the user authorizes it; keep private source data out of shared assets.

## Rules

- Team snapshot authority takes precedence over all local context/config/knowledge instructions in this entrypoint and its references.
- Read Rules and local overrides before every Solo run. User task authorization and AI-OS project rules govern actions.
- Check actual connector/CLI availability and authentication; use a documented local/manual fallback when absent.
- Never send, post, schedule publication, purchase, or push to a remote merely because a source example shows it.
- Keep base definitions immutable during ordinary use; store corrections in SKILL.local.md.
- Preserve code semantics and redact detected secrets.
- Never send or post the formatted text.

## Self-Update

With Team connected, use only the authoritative snapshot’s configured feedback/update mechanism; do not modify local context or skill rules. In Solo mode, when the user flags a wrong approach, format, assumption, or tone, immediately add the dated correction to `## Rules` in adjacent `SKILL.local.md`, then log it under `## tool-paste` in `context/learnings.md`.
Create the local override if absent. Preserve existing local entries and leave the shipped SKILL.md unchanged.

## Troubleshooting

- Missing configuration or source: ask for the necessary input, then continue independent local work.
- Missing optional tool: use the declared fallback and state the coverage limit.
- Missing required native skill: stop only the dependent step and report its exact name.
- Reference command differs from installed tooling: read current official docs; do not pretend the command succeeded.
