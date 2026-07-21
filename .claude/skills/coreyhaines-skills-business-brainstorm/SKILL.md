---
name: coreyhaines-skills-business-brainstorm
description: "Pressure-test a new business, product, or side-project idea against a 9-dimension founder filter (problem, wedge, monetization, moat, distribution, energy fit, opportunity cost, and more), check the .com, and output a build/sleep-on-it/pass viability brief. Not for marketing ideas for an existing product (see coreyhaines-marketing-marketing-ideas)."
when_to_use: 'Invoke when the request sounds like: "business brainstorm", "should I build X", "pressure test this idea", "validate this idea", "is X a good business"'
metadata:
  version: 0.2.0
---

# /business-brainstorm - Pressure-test a business idea

Takes a vague idea, runs it through the user's filter, and outputs a structured viability brief. Composes with `coreyhaines-skills-deep-research` (for market) and `coreyhaines-skills-domain` (for naming).

## Context Needs

Load only what the task needs. Missing files never block the work: ask for what
is missing, or produce solid generic output and say what would sharpen it.

| File | Load level | Why |
|---|---|---|
| `context/learnings.md` | `## coreyhaines-skills-business-brainstorm` | Past corrections and preferences for this skill |

## Step 1 - Capture the idea

Get from the user:
- The idea in 1-2 sentences (the *what*)
- The reason it's on their mind (the *why now*)
- Any starting context (a chat where this came up, a tweet that inspired it, a problem they've hit)

If they point at a past chat / doc, load it first. Check AI-OS memory for in-flight projects before assuming the idea is brand-new: scan `projects/` folders and `context/MEMORY.md`, and run `coreyhaines-skills-deep-research`'s sibling `memory-recall` if you need to search past sessions.

If the idea is too vague to score, ask 1-2 clarifying questions and stop. Don't pad the brief with assumptions.

## Step 2 - Load the framework + personal overlay

Read `references/framework.md` - the user's filter. Apply each dimension in order.

Also try to load `projects/coreyhaines-skills-business-brainstorm/portfolio.local.md` if it exists. This is where the user lists their real in-flight businesses, properties, audiences, and partners. When present, use it for the "portfolio fit," "distribution," and "opportunity cost" dimensions instead of asking the user to name each one.

## Step 3 - Score each dimension

For each of the 9 dimensions in `framework.md`, give a 1-line take + a verdict (✅ strong / 🟡 OK / ❌ weak / ❓ unknown - needs research).

Don't BS the unknowns. Mark them ❓ and route to research in Step 4.

## Step 4 - Trigger research where needed (optional)

If 2+ dimensions are ❓ unknown, offer the user: *"Want me to run `coreyhaines-skills-deep-research` on [topic] before scoring?"* (For a single feasibility or should-I question, `q-question` is the lighter AI-OS route.)

Useful research targets:
- Market size / who pays signal → recent web search + `WebSearch`
- Competitive landscape → search for "alternatives to X", "X vs Y" pages
- ICP signal → forums / Reddit / X where the audience hangs out
- Pricing benchmarks → look at competitor pricing pages

If the user says yes, run `Skill({skill: "coreyhaines-skills-deep-research", args: "<topic>"})` and incorporate the brief.

## Step 5 - Check the .com

Always run `coreyhaines-skills-domain` on the working name(s). A perfect idea with a $50k domain is a worse idea than a B+ idea with a free .com.

If naming is wide open, brainstorm 5-10 candidate names through `coreyhaines-skills-domain` and report which are available.

## Step 6 - Output the brief

Use this template:

```markdown
# Business brainstorm: <name or idea slug>

**Date:** <YYYY-MM-DD>
**Idea:** <1-2 sentences>
**Why now:** <1 sentence>

## Verdict
**Build** / **Sleep on it** / **Pass** / **Steal an angle for [existing property]**

<2-3 sentence rationale>

## Score

| Dimension | Take | Verdict |
|---|---|---|
| 1. Problem | … | ✅ |
| 2. Audience | … | 🟡 |
| 3. Wedge | … | ❓ |
| 4. Monetization | … | ✅ |
| 5. Moat | … | ❌ |
| 6. Portfolio fit | … | ✅ |
| 7. Distribution | … | ✅ |
| 8. Energy fit | … | 🟡 |
| 9. Opportunity cost | … | ❌ |

## Domain
- <name>.com - available / taken / aftermarket $<price>
- (other candidates if relevant)

## Research applied
- <link to deep-research brief in projects/coreyhaines-skills-deep-research/, if run>

## Open questions
- <what would change the verdict>

## If you build it (sketch)
- **First 100 customers:** <how>
- **Wedge offer:** <what>
- **Price:** <range>
- **MVP scope:** <1-3 features>

## If you don't build it
- **Angle to steal for existing properties:**
  - Property A: …
  - Property B: …
  - Property C: …
  - (etc., only where relevant)
```

## Step 7 - Archive

Archives live in `projects/coreyhaines-skills-business-brainstorm/` (create the directory if missing). Never write archives inside the skill's own folder. Skill installs and upgrades re-sync from source and wipe anything saved there. **Migration:** if this skill's folder contains an old `references/ideas-archive/` with user entries, move those files into the archive directory first.

Write to `projects/coreyhaines-skills-business-brainstorm/<YYYY-MM-DD>-<slug>.md`. Append to `projects/coreyhaines-skills-business-brainstorm/INDEX.md` (create if missing):

```markdown
- 2026-06-16 - [<idea>](./<filename>.md) - **<verdict>** - <one-line rationale>
```

## Step 8 - Surface

Show the brief in chat. Tell the user the archive path. Offer:
- *"Want to push to Notion as a positioning canvas?"*
- *"Want me to scaffold a project repo / landing page?"* (if verdict = Build)
- *"Want me to revisit in 30 days?"* (if verdict = Sleep on it)

## Composes with

- `coreyhaines-skills-deep-research` (or `q-question` for a single feasibility question) - for market validation when dimensions are ❓
- `coreyhaines-skills-domain` - for .com availability and naming brainstorm
- `str-trending-research` - for audience/market recency signal
- AI-OS memory (`projects/`, `context/MEMORY.md`, `memory-recall`) - for portfolio context (don't pitch an idea that already exists)

## Notes on quality

- **Nine dimensions, not one hero metric.** Ideas fail because one dimension quietly rots even when the rest score high. Force each dimension to be scored - no "we'll figure that out later" cop-outs.
- **Verdict discipline: Ship / Sleep on it / Kill.** Not "maybe." Ambiguity in the verdict compounds into ambiguity in the commit; the brief exists to prevent that.
- **Portfolio-context check is non-negotiable.** Before writing, grep memory + wiki for existing property overlap. If the new idea is 80% one of your existing properties, propose extending the existing property instead of forking a new one - 4x cheaper to compound.
- **Archive every brief, even Kills.** Killed ideas resurface - the brief with rationale prevents re-litigating. The archive dir + INDEX.md makes revisit trivial.
- **"Angle to steal" section forces value from Kills.** Even ideas you won't build often have an angle that improves an existing property. Don't skip this section - it's the highest-leverage output of a Kill verdict.
- **30-day revisit for "Sleep on it."** Set the calendar reminder. Sleep-on-it ideas that never get revisited become dead weight in the archive; ideas that get revisited resurface with better context.
