# /onboarding

The onboarding entry point for first-time users.

## Guard

Check whether `brand_context/` contains populated `.md` files, ignoring `README.md` and the `_templates/` folder - those ship with a fresh install and do NOT count as real brand context.
- **Real brand files exist** → respond "You're already set up. Just tell me what you're working on." and **stop**. Do not continue to any steps below.
- **No real brand files** → continue to First-Run Mode below.

**Skill selection check:** Read `.claude/skills/_catalog/installed.json`. If `selection_pending` is `true` (or the field is missing), the user hasn't chosen their skills yet. Run Step 8 (Skill Selection) before finishing.

## Always (both modes)

Create today's memory file per CLAUDE.md's **Daily Memory** section:
- If `context/memory/{YYYY-MM-DD}.md` doesn't exist → create it with a `## Session - {HH:MM}` header
- If it already exists → append a new `## Session - {HH:MM}` block
- Fill in `### Goal` once the user states what they're working on

---

## First-Run Mode

### Step 0: GitHub Backup Check

**Run this every session (first-run AND returning), before anything else.**

Check whether the user's data is backed up to their own GitHub repo:
1. First, check `.env` for `IS_TEMPLATE_MAINTAINER=true`. If set, **skip this entire step** - the user owns the template repo and `origin` is already correct.
2. Run `git remote -v` and inspect the `origin` URL.
3. If `origin` contains `camrontaylor/ai-os-template` or another upstream template URL, the user has not set up their own private repo yet.
4. If there is no `origin` at all, same situation.

**If not configured:**
> "Before we get started - your brand data, client files, and project outputs all live locally right now. If anything happens to this machine, they're gone. Let's back them up to a private GitHub repo that only you can access."

Then guide them:
- If `gh` CLI is available and authenticated: offer to create a private repo automatically (`gh repo create my-ai-os --private --source=. --remote=origin`), rename the template remote to `upstream`, and push.
- If `gh` is not available: give manual steps - create a private repo on GitHub, then run `git remote rename origin upstream && git remote add origin <their-url> && git push -u origin main`.
- Reassure: "This is a **private** repo - only you can see it. Your brand voice, client data, and business content stay completely private."
- After setup: "You're backed up. I'll remind you to push at the end of each session."

**If already configured (origin is NOT the upstream):** skip silently.

### Step 1: Project Scan + Intro

Check what exists:
- `brand_context/` files (which ones, which are missing)
- `context/USER.md` (populated or template?)
- `.claude/skills/` (which skills are installed)

**Detect if this is a client workspace:** Check if the current working directory is inside a `clients/` folder (path contains `/clients/`). If so, this is a client workspace - read the client `AGENTS.md` to get the client name from the `# Client: {name}` header.

**Client workspace intro (if inside clients/):**
Explain the multi-client setup and frame this as building brand context for this specific client:
- You're inside **{client name}**'s workspace - one of several client folders managed by the parent AI-OS
- The parent AI-OS at the root holds all the shared skills, methodology, and scripts - edits there benefit every client
- Each client folder (list any sibling folders under `clients/` if they exist) gets its own brand context, memory, and outputs - completely separate from each other
- Right now we're setting up **{client name}**'s brand foundation so everything produced here matches their voice, positioning, and audience
- We'll answer a few questions, then pick which skills to keep active for this client

**Standard intro (if NOT inside clients/):**
Read README.md and give the user a brief, genuine explanation of what they've set up:
- What AI-OS does (business OS that learns their brand, gets sharper each session)
- How it works in practice (answer a few questions → brand foundation → then you'll pick which skills to keep)
- The learnings loop (feedback improves future output)
- That skills can be built for any domain as needs grow

Keep it conversational - 4-6 sentences max, not a feature dump. Don't list installed skills here - that happens in Step 8 after brand context is built, so skills can be framed for their specific business. End with the first question.

### Step 2: Core Questions (ONE AT A TIME, SKIP IF ALREADY ANSWERED)

Ask up to four questions sequentially. Wait for each answer before asking the next.
Do NOT present all four at once.

**Before each question, check if the user already provided the answer in a previous response.** People often cover multiple topics in one answer (e.g., describing their business AND their ideal customer together). If you already have enough information for a question, skip it and move to the next one. Acknowledge what you picked up so the user knows you were listening.

**Question 1:**
- Client workspace: "What does **{client name}**'s business do? Give me the one-sentence version."
- Standard: "What does your business do? Give me the one-sentence version."
→ Wait for answer.

**Question 2:** "Who's your ideal customer - who do you help?"
→ Skip if Q1 answer already described the customer clearly enough to build an ICP.

**Question 3:** "What makes you different from the alternatives?"
→ Wait for answer.

**Question 4:** "How do you want to come across? Here are some common tones with examples:"

> **Direct** - gets to the point, no fluff. *"Here's what works. Do this, skip that."*
> **Warm** - friendly, approachable, like talking to someone who genuinely cares. *"I've been there - let me show you what helped me."*
> **Authoritative** - expert-led, confident, data-backed. *"The data is clear: businesses that automate X see 3x output."*
> **Playful** - casual, witty, doesn't take itself too seriously. *"Look, nobody wakes up excited about admin. That's the whole point."*
> **Provocative** - challenges assumptions, gets people to rethink. *"You don't have a hiring problem. You have an automation problem."*
> **Empathetic** - leads with understanding, validates the struggle. *"Scaling alone is exhausting. You shouldn't need a team of 10 to get there."*

"You can pick one, mix a couple, or describe it your own way."

Then add one follow-up line:
> "If you're starting from zero and want a more thorough voice extraction, I can run you through our Agentic Academy playbook in Step 5 (~10-15 min) - otherwise we'll keep it quick."

→ Wait for answer. Capture both the tone answer and a **deep_voice_flow** flag: `yes` if they opted in, `no` if they declined, `unset` if they didn't express a preference.

Capture all answers. You'll use them to build brand_context/.

### Step 3: Collect Brand Assets + URL Extraction

Ask: "Got a website, LinkedIn, YouTube, or any other links I should know about - both business and personal?"

If yes:
- Separate into business vs personal links and handles
- Save all to `brand_context/assets.md` under the correct sections
- Try WebFetch first to retrieve content from provided URLs for voice extraction
- If WebFetch fails (JS-heavy, bot-blocked), check `.env` for `FIRECRAWL_API_KEY`:
  - **Key present** → use Firecrawl scrape + branding extraction (auto-discover logo, colors, fonts)
  - **Key missing** → tell the user: "Your site needs a more powerful scraper to read properly. If you add a Firecrawl API key to your `.env` file, I can pull your brand assets (logo, colors, fonts) automatically. Free tier at firecrawl.dev - 500 credits/month. For now, I'll work with what I can access."
- Extract 5-10 gold-standard sentences that represent their voice
- Note what makes each sentence representative
- If Firecrawl branding was used, report what was found vs what wasn't (see mkt-brand-voice Mode 4 for the format)

If no: skip URL extraction, but still create `brand_context/assets.md` with empty fields so it's ready for later.

### Step 3b: Environment Check

Scan `.env.example` for all documented API keys. Check which are configured in `.env`.

If any keys are missing, mention them once (not as a blocker):
> "A few optional integrations are available. You can add these to your `.env` file anytime:"
> - `FIRECRAWL_API_KEY` - powers advanced web scraping and auto-detects your brand assets (logo, colors, fonts). Free tier at firecrawl.dev.
>
> "None of these are required - everything works without them, they just unlock extra features."

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
  - `deep_voice_flow = unset` → offer Playbook as the default: *"You're starting from zero on voice - want to run the Agentic Academy playbook (~20-25 min, deeper) or keep it to a quick 8-question setup?"* Route based on their answer.
  - `deep_voice_flow = no` → go directly into Quick Build (`references/build-questions.md`). Don't mention Playbook again.

Create `context/learnings.md` with sections matching installed skill folder names (e.g., `## mkt-brand-voice`).

### Step 6: Update context/USER.md

Populate context/USER.md with what you've learned:
- Name and business from the conversation
- Communication style signals observed
- Role (founder / marketer / agency / student)

### Step 7: Show Results

Show actual excerpts - not just filenames.

Example format:
```
Here's what I built:

**Your voice:** [2-sentence excerpt from voice-profile.md]
**Your positioning:** [one-line statement from positioning.md]
**Your ICP:** [primary pain statement from icp.md]

Everything's saved in brand_context/. I'll use this in every skill going forward.
```

**IMPORTANT: After showing results, you MUST proceed to Step 8 (Skill Selection) in the SAME response. Do NOT wait for user input between Step 7 and Step 8. Show the results, then immediately present the skill selection checklist below.**

### Step 8: Skill Selection (MANDATORY - do NOT skip)

**This step is required during first-run mode.** Always run it after showing brand context results, even if skills are already installed. The user needs to choose which optional skills to keep for their business.

Now that brand context is built, briefly explain what each category does for THIS business, then present the checklist. Keep the intro to 3-4 lines max:

```
Now let's pick which skills to keep. Everything's pre-selected - just untick what you don't need.

Quick overview for [business]:
- **Content & Copy** - write landing pages, repurpose content, create video scripts in your voice
- **Research & Strategy** - find trending topics your audience cares about
- **Visual** - generate images and diagrams
- **Utility** - humanizer (de-AI your text) and YouTube transcripts
```

**Then present the optional skills as a numbered checklist** so the user can see what's available. Read `.claude/skills/_catalog/catalog.json` and list each optional skill with its number, name, and a one-line description framed for the user's business. Group by category. Example:

```
Everything's pre-selected. Tell me which to remove - or say "keep all" to move on.

**Content & Copy**
 1. mkt-copywriting - write landing pages and sales copy in your voice
 2. mkt-content-repurposing - turn one piece into posts across 8 platforms
 3. mkt-ugc-scripts - short-form video scripts for TikTok/Reels/Shorts

**Research & Strategy**
 4. str-trending-research - find what your audience is talking about right now

**Visual & Video**
 5. viz-excalidraw-diagram - architecture and workflow diagrams
 6. viz-ad-creative-codex - no-key ad creative batches in Codex
 7. viz-ad-creative-fal - fal-powered ad creative and short video (needs FAL_KEY)
 8. viz-ad-creative-figma - Figma/template ad creative (FIGMA_TOKEN optional)

**Utility**
 9. tool-humanizer - de-AI all written output
10. tool-youtube - YouTube transcript extraction (needs YOUTUBE_API_KEY)

**Operations**
11. ops-cron - schedule recurring tasks

Which would you like to remove? (e.g. "remove 5, 6, 7" or "keep all")
```

Wait for the user's response. Then run the script in CLI mode with their selections:
```bash
python3 scripts/select-skills.py --remove "viz-excalidraw-diagram,viz-ad-creative-fal"
```

If the user says "keep all" or similar, run:
```bash
python3 scripts/select-skills.py --remove none
```

The script handles dependency resolution, folder removal, `installed.json` update, and prints a summary.

**Note:** If the user runs `python3 scripts/select-skills.py` directly in their own terminal (not through Claude), the script auto-detects the TTY and shows a full interactive checkbox UI with arrow keys + space to toggle.

**After the script completes**, read `.claude/skills/_catalog/selection-result.json` and acknowledge briefly: "All set - [N] skills ready to go."

**Do NOT proceed to Step 9 until the user has made their skill selection and the script has run.**

### Step 9: How It Works Primer (MANDATORY - do NOT skip)

**This step is required.** After showing skills, ALWAYS give the user a quick orientation before recommending a task. This is their only onboarding - they won't read docs unless you tell them what exists.

Present this as a natural continuation, not a separate section. Three things to cover:

**1. How work is structured:**
> "Quick heads up on how we work together. There are three modes:
> - **Single task** - just ask me. Blog post, email, research - I get it done.
> - **Planned project** - for bigger work with multiple deliverables. I scope it first, write a brief, and we work from that across sessions.
> - **GSD project** - for complex builds with phases and milestones. Full structured planning and execution.
>
> You don't need to pick upfront - tell me what you're working on and I'll suggest the right level. Full details in [docs/projects-guide.md](docs/projects-guide.md)."

**2. Multi-client support - ALWAYS mention if ANY of these signals are present:**
- User said "agency", "clients", "brands", "accounts", "freelance", "consulting"
- Business involves serving multiple companies or audiences
- User described work that implies client-based revenue (e.g., "we build automations for businesses")

If any signal is present:
> "Since you work with [clients/multiple brands], you can set up separate workspaces for each - just say 'add a client' and I'll create one. Each gets its own brand context, memory, and outputs while sharing the same skills and methodology. So you only build skills once and every client benefits.
>
> See [docs/multi-client-guide.md](docs/multi-client-guide.md) for the full setup."

Only skip this if the user is clearly a solo founder with a single product/brand and no mention of clients.

**3. Sessions and continuity:**
> "When you're done for the day, just say so - 'that's it', 'done for today', 'thanks' - and I'll automatically save everything: what we did, decisions made, open threads. Next time you come back, I pick up where we left off.
>
> For a quick reference of commands and paths, see [docs/cheat-sheet.md](docs/cheat-sheet.md)."

**4. The nightly memory loop (one-time setup):**
> "AI-OS has six scheduled jobs that maintain your memory and search index every night. They are off by default until you do two short steps:
>
> 1. Run `claude setup-token` once (needs your Claude subscription). It prints a long-lived (about 1 year) token.
> 2. Run `bash scripts/enable-cron.sh <token>`. That stores the token (chmod 600), loads the durable launchd daemon, and runs a test job so you watch it succeed.
>
> Why setup-token and not `/login`: setup-token is built for headless use and lasts a year, so the nightly jobs keep working unattended. The wrapper `scripts/claude-cron-wrapper.sh` reads the token; the cron runtime uses it via `AGENTIC_OS_CLAUDE_BIN`. Without a credential, every job fails with a 401.
>
> The full plain-language explainer of memory, Milvus, and the jobs is in [docs/memory-and-cron.md](docs/memory-and-cron.md). The diagnosis writeup is in [projects/meta-audit/2026-06-21_cron-and-search-fixes.md](projects/meta-audit/2026-06-21_cron-and-search-fixes.md).
>
> Skip this if you don't care about automatic memory upkeep yet; the system works without it."

**5. Never delete, always archive:**
> "If a branch or piece of work needs to be retired, AI-OS archives it instead of deleting. Use:
> ```
> bash scripts/archive-branch.sh <branch-name> "<reason>"
> ```
> This creates an annotated tag `archive/<branch>-<date>`, pushes it to origin (so the cloud holds it forever), and removes the local branch. Inspect later with `git checkout archive/<name>`. List all archived branches with `git tag -l 'archive/*'`."

### Step 10: First Recommendation

End with ONE recommendation based on their business context:
"Given you're [situation], I'd start with [skill] - [reason]."

Do NOT present a menu and ask them to pick. Recommend.

### Step 11: Operations Setup (optional - offer after Step 10)

Brand setup is done. Now offer a short, optional pass on the operational side. Keep it to a few lines and let the user opt in or skip:

> "Want a quick tour of the operational side - the dashboard, connectors, backups, and team setup - or skip it for now?"

If they want it, cover these briefly, one or two lines each, pointing to the doc rather than dumping detail:

1. **The Command Centre dashboard** - an optional window showing projects, scheduled jobs, and clients. Start it with `bash scripts/centre.sh`. Guide: `docs/command-centre-guide.md`.
2. **Connectors and API keys** - most skills work with no keys; some are enhanced by them. See `.env.example` for what is available, and `docs/connectors.md` for the full map.
3. **Nightly memory jobs** - already introduced in Step 9. Turn-on guide: `docs/turn-on-nightly-jobs.md`.
4. **Client workspaces** - if they serve more than one brand or client, they can say "add a client" for a separate workspace. Guide: `docs/multi-client-guide.md`.
5. **Team access** - if more than one person will use this install, each teammate can join and build their own brand voice. Guide: `docs/team-sharing.md`.
6. **How it all works** - a plain-words explainer of memory, skills, and sessions: `docs/how-it-works.md`.
7. **Health check** - any time they wonder if something is set up or broken, they can say "run a systems check" (the `meta-systems-check` skill) for a plain-English scorecard.

If they skip, that is fine. Tell them they can ask for any of these later, then move on.

---

## Anti-Patterns

1. Never ask more than 4 questions before doing work
2. Never present all questions at once - ask one, wait, then ask the next
3. Never present a skill menu - recommend, don't ask
4. Never rebuild brand_context/ without explicitly asking first
5. Never give generic recommendations - tie them to the specific business
6. Never silently produce generic output when context is missing - note the gap
7. Never use a hardcoded skill list - always scan `.claude/skills/` dynamically
8. Frame gaps as opportunities, not failures
