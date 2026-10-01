## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/str-business-brainstorm/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-business-brainstorm/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /str-business-brainstorm — Pressure-test a business idea

Takes a vague idea, runs it through the user's filter, and outputs a structured viability brief. Composes with `str-deep-research` (for market) and `/str-domain` (for naming).

<a id="step-1--capture-the-idea"></a>
## Step 1 — Capture the idea

Get from the user:
- The idea in 1–2 sentences (the *what*)
- The reason it's on their mind (the *why now*)
- Any starting context (a chat where this came up, a tweet that inspired it, a problem they've hit)

If they point at a past chat / doc, load it first. Memory has `project_*.md` files for in-flight projects — check there before assuming the idea is brand-new.

If the idea is too vague to score, ask 1–2 clarifying questions and stop. Don't pad the brief with assumptions.

<a id="step-2--load-the-framework--personal-overlay"></a>
## Step 2 — Load the framework + personal overlay

Read `framework.md` — the user's filter. Apply each dimension in order.

Also try to load `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-business-brainstorm/portfolio.local.md` if it exists — this is where the user lists their real in-flight businesses, properties, audiences, and partners. When present, use it for the "portfolio fit," "distribution," and "opportunity cost" dimensions instead of asking the user to name each one.

<a id="step-3--score-each-dimension"></a>
## Step 3 — Score each dimension

For each of the 9 dimensions in `framework.md`, give a 1-line take + a verdict (✅ strong / 🟡 OK / ❌ weak / ❓ unknown — needs research).

Don't BS the unknowns. Mark them ❓ and route to deep-research in Step 4.

<a id="step-4--trigger-research-where-needed-optional"></a>
## Step 4 — Trigger research where needed (optional)

If 2+ dimensions are ❓ unknown, offer the user: *"Want me to run `/str-deep-research` on [topic] before scoring?"*

Useful research targets:
- Market size / who pays signal → `current web research <space>` + `WebSearch`
- Competitive landscape → search for "alternatives to X", "X vs Y" pages
- ICP signal → forums / Reddit / X where the audience hangs out
- Pricing benchmarks → look at competitor pricing pages

If the user says yes, run `Skill({skill: "deep-research", args: "<topic>"})` and incorporate the brief.

<a id="step-5--check-the-com"></a>
## Step 5 — Check the .com

Use `/str-domain` for working names when naming is relevant. A perfect idea with a $50k domain is a worse idea than a B+ idea with a free .com.

If naming is wide open, brainstorm 5–10 candidate names through `/str-domain` and report which are available.

<a id="step-6--output-the-brief"></a>
## Step 6 — Output the brief

Use this template:

```markdown
# Business brainstorm: <name or idea slug>

**Date:** <YYYY-MM-DD>
**Idea:** <1–2 sentences>
**Why now:** <1 sentence>

<a id="verdict"></a>
## Verdict
**Build** / **Sleep on it** / **Pass** / **Steal an angle for [existing property]**

<2–3 sentence rationale>

<a id="score"></a>
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

<a id="domain"></a>
## Domain
- <name>.com — available / taken / aftermarket $<price>
- (other candidates if relevant)

<a id="research-applied"></a>
## Research applied
- <link to deep-research brief in projects/str-deep-research/, if run>

<a id="open-questions"></a>
## Open questions
- <what would change the verdict>

<a id="if-you-build-it-sketch"></a>
## If you build it (sketch)
- **First 100 customers:** <how>
- **Wedge offer:** <what>
- **Price:** <range>
- **MVP scope:** <1–3 features>

<a id="if-you-dont-build-it"></a>
## If you don't build it
- **Angle to steal for existing properties:**
  - Property A: …
  - Property B: …
  - Property C: …
  - (etc., only where relevant)
```

<a id="step-7--archive"></a>
## Step 7 — Archive

Archives live in `projects/str-business-brainstorm/` (create the directory if missing). Never write archives inside the skill's own folder — skill installs and upgrades re-sync from source and wipe anything saved there. **Migration:** if this skill's folder contains an old `ideas-archive/` with user entries, move those files into the archive directory first.

Write to `<archive dir>/<YYYY-MM-DD>-<slug>.md`. Append to `<archive dir>/INDEX.md` (create if missing):

```markdown
- 2026-06-16 — [<idea>](./<filename>.md) — **<verdict>** — <one-line rationale>
```

<a id="step-8--surface"></a>
## Step 8 — Surface

Show the brief in chat. Tell the user the archive path. Offer:
- *"Want to push to Notion as a positioning canvas?"*
- *"Want me to scaffold a project repo / landing page?"* (if verdict = Build)
- *"Want me to revisit in 30 days?"* (if verdict = Sleep on it)

<a id="composes-with"></a>
## Composes with

- `str-deep-research` — for market validation when dimensions are ❓
- `/str-domain` — for .com availability and naming brainstorm
- current web research — for audience/market recency signal (via deep-research)
- Memory (`project_*.md`) — for portfolio context (don't pitch an idea that already exists)

<a id="notes-on-quality"></a>
## Notes on quality

- **Nine dimensions, not one hero metric.** Ideas fail because one dimension quietly rots even when the rest score high. Force each dimension to be scored — no "we'll figure that out later" cop-outs.
- **Verdict discipline: Ship / Sleep on it / Kill.** Not "maybe." Ambiguity in the verdict compounds into ambiguity in the commit; the brief exists to prevent that.
- **Portfolio-context check is non-negotiable.** Before writing, grep memory + wiki for existing property overlap. If the new idea is 80% one of your existing properties, propose extending the existing property instead of forking a new one — 4x cheaper to compound.
- **Archive every brief, even Kills.** Killed ideas resurface — the brief with rationale prevents re-litigating. The archive dir + INDEX.md makes revisit trivial.
- **"Angle to steal" section forces value from Kills.** Even ideas you won't build often have an angle that improves an existing property. Don't skip this section — it's the highest-leverage output of a Kill verdict.
- **30-day revisit for "Sleep on it."** Record the revisit date; create a reminder only when requested. Sleep-on-it ideas that never get revisited become dead weight in the archive; ideas that get revisited resurface with better context.
