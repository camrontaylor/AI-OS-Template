## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/mkt-jab-hook/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /mkt-jab-hook — Jab-jab-jab-right-hook for a personal portfolio

Gary Vaynerchuk's framework applied to your configured portfolio: keep the feed mostly *jabs* (value — BIP + educational) so the *hooks* (promo) earn attention when they land. Drafts to your personal Typefully workspace.

**One-time setup**: see `properties.md` and `typefully-config.md` to configure your real portfolio + workspace. Personal config lives in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/`.

<a id="mental-model"></a>
## Mental model

- **N rotation slots** (configured in `context/config/mkt-jab-hook/properties.yaml`): one per property you want to promote on rotation
- **~2 promo posts/week** → each property cycles every ~3 weeks at equal weight
- **Non-promo days**: 50/50 build-in-public vs educational
- **Target weekly rhythm**: ~2 promo + ~2–3 BIP + ~2–3 educational
- **Platforms**: X + LinkedIn via your personal Typefully workspace

<a id="step-1--pick-the-mode"></a>
## Step 1 — Pick the mode

Detect from the trigger:

| User says | Mode |
|---|---|
| "plan my socials," "next week's posts" | **plan** |
| "what should I post," "next promo," "pick next" | **pick-next** |
| "audit my socials," "what's overdue," "what haven't I posted about" | **audit** |
| "draft a promo for X," "BIP post about Y," "educational about Z" | **draft** |

If ambiguous, confirm.

<a id="step-2--load-context"></a>
## Step 2 — Load context

1. Read `properties.md` — the 6 rotation slots and angle ideas
2. Read `voice.md` — the user's voice rules per platform
3. Read `content-types.md` — templates for promo / BIP / educational
4. Pull recent posts from your personal Typefully workspace:
   - First run: call `mcp__typefully__typefully_list_social_sets` and ask which social set is your personal (X + LinkedIn). Save the ID to `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/typefully.yaml` for future runs (schema in `typefully-config.example.yaml` — never save it inside the skill folder; upgrades wipe it).
   - Call `mcp__typefully__typefully_list_drafts` filtered to the last 30 days
   - Classify each as promo / BIP / educational by content
5. Compute **days since last promo** for each of the 6 slots

<a id="step-3--mode-logic"></a>
## Step 3 — Mode logic

<a id="plan-7-day-plan"></a>
### plan (7-day plan)
- Slot the 1–2 most overdue properties as **promo** posts
- Fill remaining 5 days with **alternating** BIP and educational (50/50)
- Output as a table: `Day | Type | Property/Topic | Hook | Draft summary`
- Don't stack two promo on consecutive days
- After the user approves the plan, offer to draft each one in sequence

<a id="pick-next"></a>
### pick-next
- Identify the most overdue property
- If most overdue < 14 days, suggest a BIP or educational instead (whichever is less recent)
- Draft 1 post; ask before syndicating

<a id="audit"></a>
### audit
- Report: days since last promo per property, ordered by most overdue
- Flag any property >21 days as overdue
- Suggest the next 1–2 moves

<a id="draft"></a>
### draft
- Skip rotation logic — draft the requested post
- Use the right content-type template

<a id="step-4--draft"></a>
## Step 4 — Draft

Follow `voice.md` and `content-types.md`. Default: **single post**, one per platform (X version + LinkedIn version). Thread only if the second post earns its place.

**Link placement (load-bearing)**: never put a URL in the body. Default is no link at all — let curiosity drive the click. When a link is needed, draft it as a **first comment** for LinkedIn (Typefully supports auto-comment) or a **reply** for X. The body always stands alone.

<a id="optional-inspiration-scan"></a>
### Optional: inspiration scan

For `promo` and `educational` posts, optionally scan inspiration accounts (`inspiration.md`) before drafting:

1. Pick 1–2 accounts whose audience overlaps with the property
2. Pull recent posts (agent-browser if it works on LinkedIn; otherwise ask the user to paste examples or fall back to their X/newsletter)
3. Extract structural patterns: hook openers, post length, line-break rhythm, CTA styles
4. Apply ONE pattern to the user's voice — never mimic phrasing
5. Log new patterns in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/patterns.local.md` (create if missing) so they accumulate — `patterns.md` documents the starter patterns and stays read-only

Skip inspiration scan when the user says "just draft it" or when iterating on an existing post.

<a id="step-5--syndicate-to-typefully"></a>
## Step 5 — Syndicate to Typefully

Ask: *"Push to Typefully now? (X + LinkedIn, your personal workspace)"*

If yes:
1. Read social set ID from `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/typefully.yaml` (setup notes in `typefully-config.md`)
2. Call `mcp__typefully__typefully_create_draft` once for X, once for LinkedIn (or once with both platforms if the social set spans both)
3. If the draft has a first-comment link, configure Typefully to add it automatically (LinkedIn auto-comment / X reply). If the MCP doesn't support auto-comment for one of the platforms, surface the comment text so the user can paste it after publishing.
4. Default to **draft** state (not scheduled) — the user reviews in Typefully UI before sending
5. Return the Typefully draft URLs

<a id="composes-with"></a>
## Composes with

- `tool-paste` — clean output for pasting into Typefully / LinkedIn / X manually if the MCP path doesn't fit
- `tool-social-fetch` — pull inspiration-account posts for structural analysis (replaces inline agent-browser)
- `str-deep-research` — when a promo needs a stat or citation the draft doesn't have yet
- `mkt-social` — generic social frameworks, useful when teaching strategy vs shipping your own posts
- `mkt-copywriting` — for hook / headline ideation when stuck

<a id="notes-on-quality"></a>
## Notes on quality

- **1 promo per week per property is the floor, not the ceiling.** Rotation compounds when it's predictable — 4 properties × 1 promo/week = 4 promo weeks/month. Educational + BIP + community fill the rest.
- **Never mimic phrasing from inspiration accounts.** Extract *structure* (hook opener type, line-break rhythm, CTA style) and apply to your own voice. Voice is the moat; copying phrasing destroys it.
- **Links belong in first comments, not the body** for LinkedIn + X. Documented in `context/knowledge/personal/notes/feedback_social_link_placement.md`. Body posts with inline URLs get algorithm-suppressed on both platforms.
- **Draft state, not scheduled state.** Every Typefully push defaults to draft — human review in the Typefully UI before publish is non-negotiable. Automated scheduling of unreviewed drafts has repeatedly produced posts the user regrets.
- **Reader-perspective framing.** *"You'll know X"* not *"we'll teach you X."* *"What you're guaranteed"* not *"what we'd guarantee."*
- **Voice.local.md overrides the shipped voice.md.** Personal voice rules never live in the public repo — always in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/mkt-jab-hook/voice.local.md`.
- **Cadence cap: 2 posts/day per platform, per account.** More than that degrades reach + reads as spam.

<a id="memory-references"></a>
## Memory references

- `context/knowledge/personal/notes/feedback_promo_voice.md` (if present) — conviction-coded CTAs + reader-perspective framing
- `context/knowledge/personal/notes/feedback_social_cadence.md` (if present) — cadence cap (e.g., 2 posts/day per platform)
