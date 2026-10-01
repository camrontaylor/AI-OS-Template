# /start-here

The optional onboarding entry point for Codex and Claude Code. Codex users can
ask "Set up AI-OS"; Claude users can also run `/start-here`. If the user states
a task instead, begin that task and leave setup for later. Team sessions use
the authoritative snapshot and skip this local flow.

## Guard

Check whether `brand_context/` contains populated `.md` files.
- **Files exist** → respond "You're already set up. Just tell me what you're working on." and **stop**. Do not continue to any steps below.
- **No files** → continue to First-Run Mode below.

**Personal-hub root:** if this is the root (not inside `clients/`) and a `clients/*/brand_context/` is populated, or `context/.onboarding-skipped` exists, onboarding was already settled. Only continue if the user explicitly asked to set up the root's own brand.

**Skip path:** at any point in First-Run Mode, if the user wants to skip onboarding (for example they use this folder as a personal hub and keep their businesses in `clients/`), create an empty `context/.onboarding-skipped`, tell them each business gets its own onboarding with `bash scripts/add-client.sh "{name}"` then open `clients/{slug}` in Codex or run `codex` or `claude` there, and stop. Deleting the marker brings onboarding back.

**Skill selection check:** Read `.claude/skills/_catalog/installed.json`. If `selection_pending` is `true` (or the field is missing), the user hasn't chosen their skills yet. Run Step 9 (Skill Selection) before finishing.

## Always (both modes)

Use the session block already opened by `docs/agent-startup.md`; if absent, create today's memory file:
- Open a numbered `## Session N` block in `context/memory/{YYYY-MM-DD}.md` per `docs/daily-memory.md`, creating the file if it doesn't exist
- Fill in `### Goal` once the user states what they're working on

---

## First-Run Mode

### Step 0: Optional Backup

GitHub backup is optional and does not gate setup or skill use. Do not inspect
`.env` or create a remote repository as part of onboarding. If the user asks for
backup setup, follow the installer documentation and prepare the requested
private backup; remote creation or pushing follows the user's authorization.
Otherwise proceed directly to the intro and profile questions.

### Step 1: Project Scan + Intro

Check what exists:
- `brand_context/` files (which ones, which are missing)
- `context/USER.md` (populated or template?)
- `.claude/skills/` (which skills are installed)

**Detect if this is a client workspace:** Check if the current working directory is inside a `clients/` folder (path contains `/clients/`). If so, this is a client workspace — read the client `AGENTS.md` to get the client name from the `# Client: {name}` header.

**Client workspace intro (if inside clients/):**
Explain the multi-client setup and frame this as building brand context for this specific client:
- You're inside **{client name}**'s workspace — one of several client folders managed by the parent AI-OS
- The parent AI-OS at the root holds all the shared skills, methodology, and scripts — edits there benefit every client
- Each client folder (list any sibling folders under `clients/` if they exist) gets its own brand context, memory, and outputs — completely separate from each other
- Right now we're setting up **{client name}**'s brand foundation so everything produced here matches their voice, positioning, and audience
- We'll answer a few questions, then pick which skills to keep active for this client

**Standard intro (if NOT inside clients/):**
Read README.md and give the user a brief, genuine explanation of what they've set up:
- What AI-OS does (business OS that learns their brand, gets sharper each session)
- How it works in practice (answer a few questions → brand foundation → then you'll pick which skills to keep)
- The learnings loop (feedback improves future output)
- That skills can be built for any domain as needs grow

Keep it conversational and short, an orientation rather than a feature dump. Don't list installed skills here — that happens in Step 9 after brand context is built, so skills can be framed for their specific business. End with the first question.

### Step 2: Core Questions (ONE AT A TIME, SKIP IF ALREADY ANSWERED)

Ask up to four questions sequentially. Wait for each answer before asking the next.
Do NOT present all four at once.

**Before each question, check if the user already provided the answer in a previous response.** People often cover multiple topics in one answer (e.g., describing their business AND their ideal customer together). If you already have enough information for a question, skip it and move to the next one. Acknowledge what you picked up so the user knows you were listening.

**Question 1:**
- Client workspace: "What does **{client name}**'s business do? Give me the one-sentence version."
- Standard: "What does your business do? Give me the one-sentence version."
→ Wait for answer.

**Question 2:** "Who's your ideal customer — who do you help?"
→ Skip if Q1 answer already described the customer clearly enough to build an ICP.

**Question 3:** "What makes you different from the alternatives?"
→ Wait for answer.

**Question 4:** "How do you want to come across? Here are some common tones with examples:"

> **Direct** — gets to the point, no fluff. *"Here's what works. Do this, skip that."*
> **Warm** — friendly, approachable, like talking to someone who genuinely cares. *"I've been there — let me show you what helped me."*
> **Authoritative** — expert-led, confident, data-backed. *"The data is clear: businesses that automate X see 3x output."*
> **Playful** — casual, witty, doesn't take itself too seriously. *"Look, nobody wakes up excited about admin. That's the whole point."*
> **Provocative** — challenges assumptions, gets people to rethink. *"You don't have a hiring problem. You have an automation problem."*
> **Empathetic** — leads with understanding, validates the struggle. *"Scaling alone is exhausting. You shouldn't need a team of 10 to get there."*

"You can pick one, mix a couple, or describe it your own way."

Then add one follow-up line:
> "If you're starting from zero and want a more thorough voice extraction, I can run you through our AI-OS playbook in Step 5 (~10-15 min) — otherwise we'll keep it quick."

→ Wait for answer. Capture both the tone answer and a **deep_voice_flow** flag: `yes` if they opted in, `no` if they declined, `unset` if they didn't express a preference.

Capture all answers. You'll use them to build brand_context/.

### Step 3: Collect Brand Assets + URL Extraction

Ask: "Got a website, LinkedIn, YouTube, or any other links I should know about — both business and personal?"

If yes:
- Separate into business vs personal links and handles
- Save all to `brand_context/assets.md` under the correct sections
- Try WebFetch first to retrieve content from provided URLs for voice extraction
- If WebFetch fails (JS-heavy, bot-blocked), check credential availability without reading or printing secret values; honor the runtime permissions:
  - **Key present** → use Firecrawl scrape + branding extraction (auto-discover logo, colors, fonts)
  - **Key missing** → tell the user: "Your site needs a more powerful scraper to read properly. If you add a Firecrawl API key to your `.env` file, I can pull your brand assets (logo, colors, fonts) automatically. Firecrawl has a free tier at firecrawl.dev. For now, I'll work with what I can access."
- Extract 5-10 gold-standard sentences that represent their voice
- Note what makes each sentence representative
- If Firecrawl branding was used, report what was found vs what wasn't (see mkt-brand-voice Mode 4 for the format)

If no: skip URL extraction, but still create `brand_context/assets.md` with empty fields so it's ready for later.

### Step 3b: Environment Check

Scan `.env.example` for all documented API keys. Check availability only through permitted key-presence checks; never read or print secret values. Skip credential checks when the runtime denies access.

If any keys are missing, mention them once (not as a blocker):
> "A few optional integrations are available. You can add these to your `.env` file anytime:"
> - `FIRECRAWL_API_KEY` — powers advanced web scraping and auto-detects your brand assets (logo, colors, fonts). Free tier at firecrawl.dev.
>
> "None of these are required — everything works without them, they just unlock extra features."

If all keys are present, skip this step silently.

### Step 4: Local File Scan (Conditional)

If the user mentions they have existing copy, docs, or emails:
"Want to share any files? I can scan them for voice patterns."

If yes: read provided files, extract voice signals and strong sentences.

### Step 5: Build brand_context/

Run the foundation skill methodologies to create the brand files.
Use answers from Step 2 + extracted content from Steps 3-4.

Read each skill's SKILL.md for the full methodology:
- `.claude/skills/mkt-brand-voice/SKILL.md` → produces `voice-profile.md` + `samples.md`
- `.claude/skills/mkt-positioning/SKILL.md` → produces `positioning.md`
- `.claude/skills/mkt-icp/SKILL.md` → produces `icp.md`

**Brand voice routing (pass through the `deep_voice_flow` flag from Q4):**
- If the user provided a URL in Step 3 that scraped successfully, or pasted usable copy in Step 4 → route into **Auto-Scrape** / **Extract**. Do not mention Playbook.
- Otherwise route into **Build mode**. Inside Build:
  - `deep_voice_flow = yes` → go directly into the Playbook variant (`references/playbook-questions.md`). Don't re-ask the quick-vs-deep fork.
  - `deep_voice_flow = unset` → offer Playbook as the default: *"You're starting from zero on voice — want to run the AI-OS playbook (~10-15 min, deeper) or keep it to a quick 8-question setup?"* Route based on their answer.
  - `deep_voice_flow = no` → go directly into Quick Build (`references/build-questions.md`). Don't mention Playbook again.

Create `context/learnings.md` with sections matching installed skill folder names (e.g., `## mkt-brand-voice`).

### Step 6: Visual Identity

Now build the brand's **visual** foundation. `mkt-visual-identity` is a foundation skill (ships by default): it extracts design tokens — typography, colors, layout — and produces a `visual-identity.pdf` brand bible that every downstream visual skill (image generation, slides, diagrams) consumes.

Trigger the setup:
```
/mkt-visual-identity
```

Feed it the brand assets collected in Step 3 (logo, colors, fonts, website, screenshots) as reference material. If no visual references were provided, the skill works from sensible defaults and you can refine the identity later. This is deterministic — no API key required.

### Step 7: Update context/USER.md

Populate context/USER.md with what you've learned:
- Name and business from the conversation
- Communication style signals observed
- Role (founder / marketer / agency / student)

### Step 8: Show Results

Show actual excerpts — not just filenames.

Example format:
```
Here's what I built:

**Your voice:** [2-sentence excerpt from voice-profile.md]
**Your positioning:** [one-line statement from positioning.md]
**Your ICP:** [primary pain statement from icp.md]

Everything's saved in brand_context/. I'll use this in every skill going forward.
```

Run Step 9 in the same turn as Step 8, without pausing for input, because the skill checklist only makes sense once brand context is on screen. Show the results, then present the skill selection checklist below.

### Step 9: Skill Selection (mandatory)

Step 9 is mandatory on every first-run, even when skills are already installed, because the user still needs to choose what stays active for their business.

Now that brand context is built, briefly explain what each category does for this business, then present the checklist:

```
Now let's pick which skills to keep. Everything's pre-selected — just untick what you don't need.

Quick overview for [business]:
- **Content & Copy** — write landing pages, repurpose content, create video scripts in your voice
- **Research & Strategy** — find trending topics your audience cares about
- **Visual & Video** — generate images, diagrams, and AI avatar videos
- **Utility** — humanizer (de-AI your text), web scraping, YouTube transcripts
```

**Then present the optional skills as a numbered checklist** so the user can see what's available. Read `.claude/skills/_catalog/catalog.json` and list each optional skill with its number, name, and a one-line description framed for the user's business. Group by category. Illustrative format only; build the real list from catalog.json:

```
Everything's pre-selected. Tell me which to remove — or say "keep all" to move on.

**Content & Copy**
 1. mkt-copywriting — write landing pages and sales copy in your voice
 2. mkt-content-repurposing — turn one piece into posts across 8 platforms
 3. mkt-ugc-scripts — short-form video scripts for TikTok/Reels/Shorts

**Research & Strategy**
 4. str-trending-research — find what your audience is talking about right now

**Visual & Video**
 5. viz-excalidraw-diagram — architecture and workflow diagrams
 6. viz-image-gen — AI image generation (needs OPENAI_API_KEY or GEMINI_API_KEY)
 7. viz-ugc-heygen — AI avatar videos (needs HEYGEN_API_KEY)

**Utility**
 8. tool-humanizer — de-AI all written output
 9. tool-firecrawl-scraper — advanced web scraping (needs FIRECRAWL_API_KEY)
10. tool-youtube — YouTube transcripts (channel monitoring needs YOUTUBE_API_KEY)

**Operations**
11. ops-cron — schedule recurring tasks

Which would you like to remove? (e.g. "remove 5, 6, 7" or "keep all")
```

Wait for the user's response. Then run the script in CLI mode with their selections:
```bash
python3 scripts/select-skills.py --remove "viz-excalidraw-diagram,viz-image-gen,viz-ugc-heygen"
```

If the user says "keep all" or similar, run:
```bash
python3 scripts/select-skills.py --remove none
```

The script handles dependency resolution, folder removal, `installed.json` update, and prints a summary.

**Note:** If the user runs `python3 scripts/select-skills.py` directly in their own terminal (not through Claude), the script auto-detects the TTY and shows a full interactive checkbox UI with arrow keys + space to toggle.

**After the script completes**, read `.claude/skills/_catalog/selection-result.json` and acknowledge briefly: "All set — [N] skills ready to go."

Wait for the selection and the script result before Step 10, so the primer reflects the skills they actually kept.

### Step 10: How It Works Primer (mandatory)

Step 10 is mandatory on every first-run, because it is the user's only orientation to how the system works. Give the quick orientation after showing skills, before recommending a task.

Present this as a natural continuation, not a separate section. Three things to cover:

**1. How work is structured:**
> "Quick heads up on how we work together. There are three modes:
> - **Single task** — just ask me. Blog post, email, research — I get it done.
> - **Planned project** — for bigger work with multiple deliverables. I scope it first, write a brief, and we work from that across sessions.
> - **GSD project** — for complex builds with phases and milestones. Full structured planning and execution.
>
> You don't need to pick upfront — tell me what you're working on and I'll suggest the right level. Full details in [docs/projects-guide.md](docs/projects-guide.md)."

**2. Multi-client support: mention this when any of these signals are present:**
- User said "agency", "clients", "brands", "accounts", "freelance", "consulting"
- Business involves serving multiple companies or audiences
- User described work that implies client-based revenue (e.g., "we build automations for businesses")

If any signal is present:
> "Since you work with [clients/multiple brands], you can set up separate workspaces for each — just say 'add a client' and I'll create one. Each gets its own brand context, memory, and outputs while sharing the same skills and methodology. So you only build skills once and every client benefits.
>
> See [docs/multi-client-guide.md](docs/multi-client-guide.md) for the full setup."

Only skip this if the user is clearly a solo founder with a single product/brand and no mention of clients.

**3. Sessions and continuity:**
> "When you're done for the day, just say so — 'that's it', 'done for today', 'thanks' — and I'll automatically save everything: what we did, decisions made, open threads. Next time you come back, I pick up where we left off.
>
> For a quick reference of commands and paths, see [docs/cheat-sheet.md](docs/cheat-sheet.md)."

### Step 11: First Recommendation

End with ONE recommendation based on their business context:
"Given you're [situation], I'd start with [skill] — [reason]."

Do NOT present a menu and ask them to pick. Recommend.

---

## Anti-Patterns

1. Keep the core interview to the four questions in Step 2; later questions only gather assets.
2. Never present all questions at once — ask one, wait, then ask the next
3. End onboarding with one recommendation, not a menu of tasks (Step 11).
4. Never rebuild brand_context/ without explicitly asking first, because it can overwrite work the user already tuned
5. Never give generic recommendations — tie them to the specific business
6. Never silently produce generic output when context is missing — note the gap
7. Never use a hardcoded skill list — always scan `.claude/skills/` dynamically
8. Frame gaps as opportunities, not failures
