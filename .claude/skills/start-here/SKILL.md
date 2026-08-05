---
name: start-here
description: "Run AI-OS first-run onboarding as a complete Q/A setup flow. Use when someone has just installed or copied AI-OS, opens a fresh root or client workspace, asks to set up AI-OS, gather context, build brand context, choose skills, understand the system, or invokes a start-here/onboarding entry point. This is the AI-OS source of truth for onboarding; tool-specific entry points must delegate here."
---

# Start Here

## Outcome

Walk the user through AI-OS setup by Q/A, one answer at a time, until the workspace has enough context to be useful. Build or confirm brand context, user context, skill selection, operating context, safety boundaries, and a first useful task.

This skill is the AI-OS source of truth for onboarding. Any tool-specific entry point should delegate here instead of carrying its own copy of the workflow.

## Context Needs

| File | Load level | Why |
|---|---|---|
| `README.md` | summary | Explain what the user has installed without a feature dump |
| `AGENTS.md` | targeted | Preserve the AI-OS runtime contract, skill home, memory, approval, and external-action rules |
| `brand_context/` | file list, then relevant files | Detect existing setup and avoid overwriting real brand context |
| `context/USER.md` | full if present | Preserve existing user profile and fill gaps |
| `context/memory/` | file list | Detect first-run versus returning workspace |
| `.claude/skills/_catalog/catalog.json` | full | Build the dynamic optional-skill checklist |
| `.claude/skills/_catalog/installed.json` | full if present | Detect whether skill selection is complete |
| `.env.example` and `.env` | key names only | Mention optional integrations without reading or exposing secret values |
| Foundation skills | full before writing files | `mkt-brand-voice`, `mkt-positioning`, and `mkt-icp` own the brand-file methodology |

If a `SKILL.local.md` exists beside any loaded skill, read it too and let local rules override the base skill.

## Rules

- Ask one question at a time. Wait for the answer before asking the next.
- Skip questions the user already answered. Briefly state what you inferred so they can correct it.
- Do not ask more than four core business or taste questions before moving into source collection and durable setup files.
- Keep optional setup optional. Backups, keys, cron, team setup, and dashboard tours help, but brand context plus a first real task is the day-one win.
- Never rebuild existing `brand_context/` without explicit user approval.
- Never silently produce generic output when core context is missing. Name the missing piece and ask the next smallest question.
- Use live repo state. Scan files and scripts before explaining what exists.
- Ask explicit approval before creating a repo, changing Git remotes, pushing, publishing, sending, deploying, or writing to external services.

## Step 0: Start the session record

Create today's memory file per the active AI-OS instructions:

- If `context/memory/{YYYY-MM-DD}.md` does not exist, create it with a `## Session - {HH:MM}` header.
- If it exists, append a new `## Session - {HH:MM}` block.
- Add `### Goal` once the user states what they are setting up or trying to do.

If session-memory hooks already created the block, use the existing block rather than creating a duplicate.

## Step 1: Backup check

Run this for root workspaces and client workspaces before collecting private brand or business data.

1. Check `.env` for `IS_TEMPLATE_MAINTAINER=true`. If present, skip this step because the template maintainer owns the upstream repo.
2. Run `git remote -v`.
3. If `origin` is missing, points at `camrontaylor/AI-OS-Template`, or otherwise looks like a public template remote, the user has not configured their own private backup.
4. If `origin` points at the user's own repo, skip silently.

If backup is not configured, say:

> Before we add brand, client, or project context, quick safety check: this workspace still looks connected to the public template instead of your own private backup repo. Your data lives locally right now.

Then guide based on tools available:

- If `gh` is installed and authenticated, offer to create a private repo and wire remotes with `gh repo create my-ai-os --private --source=. --remote=origin`.
- If `gh` is unavailable, give the manual path: `git remote rename origin upstream && git remote add origin <their-private-repo-url> && git push -u origin main`.

Ask for explicit approval before creating a repo, changing Git remotes, or pushing. If they do not approve, continue onboarding and record the backup as deferred.

## Step 2: Detect the setup mode

Scan:

- `brand_context/`, ignoring `README.md` and `_templates/`
- `context/USER.md`
- `.claude/skills/_catalog/catalog.json`
- `.claude/skills/_catalog/installed.json` if it exists
- current path, to detect whether the user is inside `clients/{client}/`

Classify:

- **Fresh root workspace:** no real brand files at root.
- **Fresh client workspace:** current path is inside `clients/{client}/` and that client has no real brand files.
- **Already set up:** real brand files exist.
- **Selection incomplete:** `installed.json` is missing, has `selection_pending: true`, or has no clear completed selection state.

If already set up and selection is complete, respond:

> You're already set up. Just tell me what you're working on.

Then stop. If the user explicitly asked to rerun onboarding, continue and ask before overwriting existing brand context.

If selection is incomplete, complete skill selection before finishing, even if brand context already exists.

## Step 3: Give the short orientation

For a root workspace, read `README.md` and explain in four to six conversational sentences:

- AI-OS is a local agent workspace that learns the user's brand, preferences, and working context.
- First run builds the foundation files so later skills do not produce generic output.
- Skills are local AI-OS capabilities under `.claude/skills/`; that folder is the canonical skill home for every compatible runtime.
- Feedback and session logs make future work sharper.

For a client workspace, read the client `AGENTS.md` if present and explain:

- this folder is for that client or brand,
- root AI-OS holds shared methodology and scripts,
- this client folder gets separate brand context, memory, projects, and cron jobs,
- setup here should describe the client, not the operator's own business.

End with the first question. Do not list skills yet.

## Step 4: Brand foundation Q/A

Ask these one at a time. Wait after each. Skip any already answered.

### Q1: Business and offer

Root:

> What does your business do, and what do you sell or want AI-OS to help you produce? Give me the plain-English version.

Client:

> What does this client do, and what do they sell or need us to help produce? Give me the plain-English version.

Capture: business summary, offer, business model, product or service category, and obvious work types.

### Q2: Audience and pain

> Who is the ideal customer, and what problem are they usually trying to solve when they come to you?

Capture: ICP, buyer role, pain, urgency, alternatives, and buying trigger.

### Q3: Difference and proof

> What makes this different from the alternatives, and what proof or examples should I know about?

Capture: positioning, differentiation, credibility, proof points, case studies, constraints, claims that need evidence.

### Q4: Voice and taste

> How should this come across? Pick a couple of words, describe the vibe, or name people and brands it should sound like or avoid.

If useful, offer examples: direct, warm, authoritative, playful, provocative, empathetic, premium, technical, plain-spoken.

Then ask:

> If we are starting from zero on voice, do you want the deeper voice interview, or should I keep this first pass quick?

Capture a `deep_voice_flow` flag: `yes`, `no`, or `unset`.

## Step 5: Links, assets, and source material

Ask:

> Got a website, LinkedIn, YouTube, docs, sales pages, or example writing I should learn from? Business and personal links are both useful if they shape the voice.

If they provide links:

- Separate business links, personal links, social handles, and source docs.
- Save them in `brand_context/assets.md`.
- Try the built-in web fetch path first.
- If built-in fetch fails and `FIRECRAWL_API_KEY` exists in `.env`, use Firecrawl for scraping and brand asset extraction.
- If Firecrawl is missing, say it is optional and continue with what is available.
- Extract five to ten representative sentences when possible and note why they are useful.

If they have no links, create `brand_context/assets.md` with empty sections so it is ready for later.

If they mention files, ask for the exact file paths or attachments and scan only the files they provide.

## Step 6: Optional environment scan

Compare `.env.example` to `.env`. Read key names only; do not print or store secret values.

Mention missing optional keys once, only if they unlock relevant capabilities based on the user's answers. Use this shape:

> A few optional integrations are available later:
> - `FIRECRAWL_API_KEY`: stronger web scraping and brand asset detection.
> - `<KEY>`: `<what it unlocks>`.
>
> None of these are required for setup.

Do not turn this into a long key inventory.

## Step 7: Build the durable foundation

Use the user's answers plus any extracted source material to create or update:

- `brand_context/voice-profile.md`
- `brand_context/samples.md`
- `brand_context/positioning.md`
- `brand_context/icp.md`
- `brand_context/assets.md`
- `context/USER.md`
- `context/learnings.md`

Before writing the brand files, read these skills and their local overrides if present:

- `.claude/skills/mkt-brand-voice/SKILL.md`
- `.claude/skills/mkt-positioning/SKILL.md`
- `.claude/skills/mkt-icp/SKILL.md`

Brand voice routing:

- If source copy or a successfully scraped URL exists, use extract or scrape mode.
- If no source copy exists and `deep_voice_flow = yes`, use the deeper playbook referenced by `mkt-brand-voice`.
- If no source copy exists and `deep_voice_flow = no`, use the quick build questions referenced by `mkt-brand-voice`.
- If `deep_voice_flow = unset`, recommend the deeper playbook only if voice quality is central to the user's work. Otherwise choose quick build and note it can be deepened later.

For `context/USER.md`, capture:

- user's name if known,
- role,
- business or client context,
- communication preferences,
- recurring work types,
- constraints and taste signals,
- whether this is root or client setup.

For `context/learnings.md`, create sections for active skill folder names if missing. Keep lessons empty unless real feedback has been learned.

## Step 8: Show proof of setup

Show actual excerpts, not only filenames:

```text
Here's what I built:

Voice: <two-sentence excerpt from voice-profile.md>
Positioning: <one-line positioning statement>
ICP: <one practical pain or buying trigger>

Saved in brand_context/ and context/USER.md.
```

Then continue directly to skill selection. Do not wait between showing results and presenting skill selection.

## Step 9: Skill selection

Read `.claude/skills/_catalog/catalog.json`. Read `.claude/skills/_catalog/installed.json` if it exists; if it is missing, treat selection as pending and continue.

Explain skills through the user's business context, then present the optional skills as a numbered checklist grouped by category. Use the live catalog. Do not hardcode the example list.

Use this shape:

```text
Now let's pick which optional skills to keep. Everything is pre-selected. Tell me what to remove, or say "keep all."

Content and copy
1. <skill-name>: <why this matters for their business>

Research and strategy
2. <skill-name>: <why this matters for their business>

Utility
3. <skill-name>: <why this matters for their business>
```

Wait for the user's response.

If they say keep all, run:

```bash
python3 scripts/select-skills.py --remove none
```

If they remove numbered items, map numbers to skill folder names and run:

```bash
python3 scripts/select-skills.py --remove "skill-a,skill-b"
```

After the script completes, read `.claude/skills/_catalog/selection-result.json` and acknowledge briefly:

> All set. `<N>` skills are ready to go.

Do not continue until selection has run.

## Step 10: Operating context Q/A

After brand context and skill selection, gather the rest of the setup context. Ask one at a time and skip known answers.

### Q5: Role and working style

> How do you usually work: solo founder, agency, freelancer, operator, marketer, developer, or something else?

Capture role, collaboration style, and how much autonomy they want from AI-OS.

### Q6: Common work

> What are the recurring jobs you want AI-OS to help with first? Examples: content, research, client delivery, sales, operations, coding, reporting, or automation.

Capture recurring outputs, cadence, and preferred save locations if obvious.

### Q7: Clients or multiple brands

Ask only if not already clear:

> Will this workspace mostly serve one brand, or do you need separate client or brand workspaces?

If multiple clients or brands are involved, explain:

> You can say "add a client" any time. Each client gets separate brand context, memory, projects, and cron jobs while sharing the root skills and scripts.

Point to `docs/multi-client-guide.md`.

### Q8: Tools and connectors

> What tools matter most to your work right now? For example: GitHub, Google Drive, Gmail, Notion, Slack, Figma, Stripe, analytics, ad platforms, or a website CMS.

Capture likely connector needs. Do not try to connect everything during first run unless the user asks.

### Q9: Privacy, approvals, and boundaries

> Anything I should be careful with: private client data, legal or health claims, regulated industries, approval rules, or things I should never send or publish without asking?

Capture durable boundaries in `context/USER.md` or the client context file. Do not store secrets.

### Q10: First success

> What would make this first setup feel useful today? I recommend one small real task after this, so we prove the loop end to end.

Use the answer to choose the first recommendation.

## Step 11: How AI-OS works

Give a short primer in natural language:

- **Single task:** the user asks for one output and AI-OS does it.
- **Planned project:** AI-OS scopes linked deliverables into a brief.
- **GSD project:** complex phased work with structured planning and execution.
- **Sessions:** when the user says "done for today" or similar, session notes save to `context/memory/YYYY-MM-DD.md`.
- **Memory:** durable facts go to `context/USER.md`, `context/MEMORY.md`, `context/learnings.md`, and brand files.
- **Reusable skills:** AI-OS skills live under `.claude/skills/`; this onboarding workflow lives at `.claude/skills/start-here/`.

Mention docs only as pointers:

- `docs/projects-guide.md`
- `docs/cheat-sheet.md`
- `docs/how-it-works.md`

## Step 12: Optional operations tour

Offer, do not force:

> Want a quick tour of the operational side: dashboard, connectors, backups, cron, team setup, and health checks? Or skip it for now?

If they want it, cover:

1. Command Centre dashboard: `bash scripts/centre.sh`, guide `docs/command-centre-guide.md`.
2. Connectors and API keys: `.env.example` and `docs/connectors.md`.
3. Nightly memory jobs: `claude setup-token`, then `bash scripts/enable-cron.sh <token>`, guide `docs/turn-on-nightly-jobs.md`.
4. Client workspaces: `bash scripts/add-client.sh "Client Name"`, guide `docs/multi-client-guide.md`.
5. Team access: guide `docs/team-sharing.md`.
6. Health check: "run a systems check" or `bash .claude/skills/meta-systems-check/scripts/check.sh`.

## Step 13: Recommend the first real task

End with one recommendation tied to their context:

> Given you're `<situation>`, I recommend we start with `<task>` because `<reason>`.

Do not present a menu. If they gave a first-success answer, use it. If they did not, choose a small task that creates a useful output and exercises the new context.

## Anti-patterns

- Asking all onboarding questions at once.
- Asking more than four core business or taste questions before moving into source collection and durable setup files.
- Rebuilding existing brand context without permission.
- Listing every possible feature, connector, or doc on day one.
- Treating optional API keys or cron as setup blockers.
- Showing a generic skill menu instead of framing the dynamic skill list around the user's business.
- Ending onboarding without skill selection when selection is pending.
- Ending onboarding without one clear first-task recommendation.
