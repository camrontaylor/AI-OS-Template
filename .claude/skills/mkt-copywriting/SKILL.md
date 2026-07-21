---
name: mkt-copywriting
description: "Persuasive writing that needs to sell: landing pages, sales pages, emails, ads, social posts, headlines, CTAs. Not for content repurposing (mkt-content-repurposing) or SEO articles."
when_to_use: 'Invoke when the request sounds like: "write copy for", "landing page copy", "sales page", "make this convert", "write a headline", "score this copy", "review my copy", "ad copy". Gives multiple variants and scores them'
---

# Copywriting

Good copy reads like a smart person explaining something they care about. No one notices they're being persuaded — they just keep reading because it's useful and specific. Every technique in this skill exists to serve that feeling.

## Outcome

Persuasive copy saved to `projects/mkt-copywriting/{campaign-name}/`, scored on 7 dimensions, with multiple variants for testing. Headline variants (5-10), body variants (2-3 for long-form), and A/B test suggestions included.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/voice-profile.md` | full | Match tone, vocabulary, rhythm in all copy |
| `brand_context/positioning.md` | angle only | The chosen angle determines lead, proof hierarchy, CTA framing |
| `brand_context/icp.md` | full | Know who you're writing to: awareness level, pain points, objections |
| `brand_context/samples.md` | yes | Reference for voice consistency |
| `context/learnings.md` | `## mkt-copywriting` section | Apply previous feedback before starting |

Load if they exist. Proceed without them if not — this skill works standalone.

---

## Step 1: Load Context

Check `brand_context/` and load per the table above. Show a brief status:

- Voice loaded: "[tone summary]. All copy will match."
- Positioning loaded: "Building around '[angle]' frame."
- ICP loaded: "Writing for [audience]. Awareness level: [level]."
- Nothing found: "No brand context yet. I'll write solid copy — we can build your brand profile anytime to make it on-brand."

Read `context/learnings.md` → `## mkt-copywriting` section. Apply any previous corrections.

## Step 2: Establish Format

Ask or infer from context:

| Format | Typical length | Structure |
|--------|---------------|-----------|
| Landing page | 800-2000 words | Full sequence (see references/persuasion-toolkit.md) |
| Sales page | 2000-5000 words | Extended full sequence with founder story, FAQ |
| Email | Under 500 words | Hook → single value → CTA |
| Ad copy | Platform limits | Hook → benefit → CTA within char limits |
| Social post | Under 300 words | Hook → value → CTA |
| General | Custom | Apply methodology with user-specified constraints |

State which format before generating.

## Step 3: Check for Existing Work

If `projects/mkt-copywriting/{campaign-name}/` exists, read what's there. Show a summary and ask: "Revise existing, add a new piece, or start fresh?"

## Step 4: Pre-Generation Checklist

Before writing, confirm these (ask the user if unclear):

1. **Audience awareness level** — Schwartz 1-5 (read `references/classic-frameworks.md` for the full model). Determines headline approach and copy length.
2. **Core transformation** — Not features. Run the "So What?" chain three levels deep until you hit something emotional or financial. Read `references/persuasion-toolkit.md` § The So What? Chain.
3. **Proof inventory** — What testimonials, data, case studies are available?
4. **Positioning angle** — From brand_context or stated by user.

## Step 5: Write the Copy

Read `references/persuasion-toolkit.md` and apply the techniques that fit the format:

- **Headlines**: Generate 5-10 using different angles (outcome, curiosity, proof, contrarian, story). Star your recommendation.
- **Openings**: Pick the entry style that best matches the audience's awareness level. Scene-setting for cold audiences, data or challenge for warm ones.
- **Body**: Keep the reader moving — vary sentence length, bridge sections, plant unanswered questions. Make pain concrete with numbers. Dig three levels past features to find the real benefit.
- **Evidence**: Every claim needs backup. Structure results as mini-stories: who they were, what they did, what changed, how long it took.
- **CTAs**: Name the reward, not the action. Below the button, reduce friction: remove risk, show peers, emphasise speed.

For landing/sales pages, use the full arc from the persuasion toolkit — hook through final CTA — adapting which sections to include based on format and audience awareness.

## Step 6: Generate Variants

Read `references/variants-and-scoring.md` for the full protocol.

- **Headlines**: 5-10 variants across different frameworks. Lead with a QUICK PICK summary.
- **Body copy** (landing/sales pages): 2-3 variants — Control (strongest primary angle), Contrarian (counterintuitive entry), Proof-Led (evidence first).
- **Email subject lines**: 5-7 variants when writing emails.

## Step 7: Score the Copy

Use the 7-dimension rubric from `references/variants-and-scoring.md`:

Clarity, Specificity, Voice, Desire, Proof, Urgency, Flow — each 1-10. Total out of 70.
- 90%+ = ship it
- 80-89% = ship with tweaks
- 70-79% = functional but leaving performance on the table
- Below 70% = rewrite priority areas

Self-score generated copy honestly. If any dimension is below 7, note what would fix it and offer to revise.

When the user asks to "score this" or "review my copy" — score first, show weaknesses, then offer to rewrite.

## Step 8: Humanizer Gate

Before saving, run all generated copy through `tool-humanizer` in pipeline mode. Use `deep` mode if `brand_context/voice-profile.md` was loaded, `standard` otherwise. Read `tool-humanizer/SKILL.md` and apply its pattern detection + replacement process. Only show the score summary if the delta exceeds 2 points.

## Step 9: Save Output

Save to `projects/mkt-copywriting/{campaign-name}/`:

| Format | Filename |
|--------|----------|
| Landing page | `{YYYY-MM-DD}_landing-page.md` |
| Sales page | `{YYYY-MM-DD}_sales-page.md` |
| Email | `{YYYY-MM-DD}_email_{subject-slug}.md` |
| Ad copy | `{YYYY-MM-DD}_ad_{platform}_{variant}.md` |
| Social post | `{YYYY-MM-DD}_social_{platform}.md` |

Include YAML frontmatter: type, campaign, awareness_level, variant, platform, word_count, date, score.

After saving, show the user actual copy excerpts — not just file paths.

Suggest A/B tests from `references/variants-and-scoring.md` § A/B Testing.

## Step 10: Collect Feedback

Ask: "Does this sound like you? Which headline/variant direction resonates most?"

Log feedback to `context/learnings.md` → `## mkt-copywriting`. If the user flags voice issues, note them so next run adapts.

Suggest logical next skills based on what was created (e.g., after landing page → email sequences, content repurposing).

---

## Troubleshooting

- **No brand context**: Proceed standalone. Note what would make it better.
- **No proof/testimonials available**: Write placeholder sections marked `[ADD TESTIMONIAL]`. Suggest the user gather 2-3 specific results.
- **User can't articulate the transformation**: Run the So What? chain with them. Start with features, dig three levels.
- **Copy sounds generic after generation**: Check if ICP was loaded. If not, ask 2 questions about who they're writing for.
- **Voice doesn't match**: Re-read voice-profile.md and samples.md. Adjust sentence length, vocabulary, formality.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- **LinkedIn posts must NOT end with a question.** Close with a strong declarative statement, a CTA, or a punchy fragment instead. This overrides any "end with a question" guidance in reference files. (2026-03-13)

---

## Self-Update

If the user flags an issue — wrong tone, weak copy, bad format — update the `## Rules` section immediately with the correction and today's date.
