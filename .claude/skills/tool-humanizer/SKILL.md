---
name: tool-humanizer
version: 1.1.0
description: >
  Remove AI-generated writing patterns and restore natural human voice.
  Detects and fixes 50+ AI tells: inflated symbolism, promotional language,
  hedging, corporate buzzwords, robotic structure, em dash overuse, rule of
  three, vague attributions, negative parallelisms, conjunctive phrase abuse.
  Four modes: quick (obvious patterns), standard (full scan + score),
  deep (voice-matched using brand_context/voice-profile.md), detect
  (audit only — name patterns and quote lines, no rewrite).
  Called automatically by execution skills as a post-processing step.
  Also invoked standalone: "humanize this", "de-AI this", "make this sound
  human", "remove AI patterns", "clean up this copy", "is this AI slop",
  "audit this draft for AI patterns".
  Does NOT trigger for brand voice extraction, positioning, or ICP work.
  Does NOT trigger for content that is intentionally formal or academic.
---

# Humanizer

Strip AI-generated patterns from text. Make it sound like a person wrote it.

## Outcome

Input text returned with AI patterns removed, scored before and after on a 0-10 human-ness scale. Change log shows exactly what was fixed. Output either replaces the original or is saved alongside it.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/voice-profile.md` | full | Replacements use the brand's actual vocabulary, rhythm, and connectors instead of generic "human" phrasing |
| `brand_context/samples.md` | tone refs | Reference for what on-brand sounds like |
| `context/learnings.md` | `## tool-humanizer` section | Patterns the user cares about most, false positives to skip |

Load if they exist. Works standalone with generic replacements.

---

## Instructions

### Step 1: Detect Mode

Choose from context or ask: *"Quick pass, full cleanup, or voice-matched?"*

| Mode | What happens | Best for |
|------|-------------|----------|
| `quick` | Remove obvious AI cliches + buzzwords. Single pass, no scoring. | Fast social edits, internal docs |
| `standard` | Full pattern scan (50+ detections) + human-ness score + change log | Any content going public |
| `deep` | Full scan + replace with voice-profile patterns. Loads `brand_context/voice-profile.md` | Blog posts, landing pages, emails — anything that must sound like the brand |
| `detect` | Audit only — name each pattern found, quote the line, suggest the fix in a few words. No rewrite, no score. | "Is this AI slop?" checks, reviewing someone else's draft before committing to an edit |

**Default: `standard`.** When called by another skill as a post-processing step, use `deep` if voice-profile exists, `standard` if not.

**`detect` mode short-circuits the rest of this workflow.** Run Step 2 (Load Context) and Step 3 (Identify Voice to Preserve) as normal, then skip straight to Detect Mode Output below and stop — no scoring, no rewrite.

### Detect Mode Output

For each pattern found, one line: **[pattern name]** — quote the offending phrase — the fix, in a few words. Do not rewrite the draft, do not score it, and do not guess whether AI wrote it — AI detectors guess, named patterns are evidence the user can check themselves. End with: "Want me to edit this?"

### Step 2: Load Context

If mode is `deep`, load `brand_context/voice-profile.md`. Extract:
- Preferred vocabulary (use these as replacements)
- Avoided words (flag these as AI tells even if not in pattern library)
- Linguistic habits (connectors, intensifiers, rhythm patterns)
- Samples for tone reference

Read `context/learnings.md` → `## tool-humanizer` for known false positives or priority patterns.

### Step 3: Identify Voice to Preserve

Before touching the text, name 3-5 traits that make this specific piece sound like its author: vocabulary choices, sentence cadence, bluntness, humor, uncertainty, digressions, level of polish. Keep this note for yourself — it's the guardrail for every step that follows. If the draft reads as generic to begin with and no real voice traits are findable, skip the note and proceed normally.

**Rule: make the minimum effective edit.** Fix AI patterns, errors, and genuinely unclear passages. Leave strong, distinctive sentences alone. Don't make every paragraph equally tidy — a rough draft with a real voice should still sound like the same person after editing.

### Step 4: Score Original

Rate the input text 0-10 on the human-ness scale:

| Score | Meaning |
|-------|---------|
| 0-3 | Obviously AI — multiple cliches, robotic structure, hedging everywhere |
| 4-5 | AI-heavy — some human touches but needs major work |
| 6-7 | Mixed — could go either way, lacks distinctive voice |
| 8-9 | Human-like — natural voice, minimal AI patterns |
| 10 | Indistinguishable from a skilled human writer |

Scoring factors:
- AI pattern count per 500 words (fewer = better)
- Sentence length variance (higher variance = more human)
- Specificity ratio (concrete terms vs vague qualifiers)
- Structural variety (not every paragraph same shape)

### Step 5: Apply Pattern Detection + Removal

Read `references/pattern-library.md` for the full detection list. Categories:

1. **AI cliches & openers** — "In today's fast-paced world", "Let's dive in", "It's no secret"
2. **Hedging language** — "It's important to note", "arguably", "one might argue"
3. **Corporate buzzwords** — "leverage", "utilize", "facilitate", "optimize"
4. **Robotic structure** — rhetorical Q+A, obsessive parallelism, always-three lists, "Here are the top X"
5. **Overused transitions** — "Moreover", "Furthermore", "Additionally", "Nevertheless"
6. **Promotional inflation** — "transformative", "game-changer", "unprecedented"
7. **Wikipedia AI tells** — inflated symbolism, em dash overuse, rule of three, vague attributions, negative parallelisms, superficial -ing analyses, excessive conjunctive phrases
8. **Vocabulary tells** — "delve", "tapestry", "multifaceted", "landscape", "nuanced", "foster", "realm"
9. **Rhetorical & structural slop** — binary contrasts, faux-insight setups, colon reveals, fake-profound kickers, synonym cycling, formatting slop (emoji headings, mid-sentence bold, bullets over prose)

Read `references/replacement-guide.md` for what to replace with.

### Step 6: Enhance Human Markers

After removing AI patterns, add natural voice signals — but only where Step 3's traits don't already cover it. This step adds texture; it doesn't override the voice you already found.

- **Varied sentence rhythm** — break up same-length sentences
- **Contractions** — "it's" not "it is" (unless formal context)
- **Active voice** — flip passive constructions
- **Confident assertions** — remove hedging unless genuinely uncertain or part of the writer's real voice (real "I think"/"maybe" stays)
- **Specific examples** — flag vague references for the user to make specific

Don't apply these uniformly across the whole draft — that's how a distinctive voice gets sanded down into generic "human" prose. Sentences with no AI pattern and real voice get left alone.

In `deep` mode, apply voice-profile patterns:
- Insert brand-preferred connectors and transitions
- Match sentence length patterns from samples
- Use brand vocabulary as replacements for generic terms

### Step 7: Score Revised + Output

Score the revised text. Show the change summary:

```
ORIGINAL: 4.2/10
REVISED:  8.4/10

Changes:
  [N] AI cliches removed
  [N] buzzwords replaced
  [N] hedging phrases cut
  [N] structural patterns fixed
  [N] voice markers added

Flags for review:
  [paragraph/line] — [what needs manual attention]
```

If called standalone, present the cleaned text directly.
If called as a post-processing step by another skill, return the cleaned text silently (the calling skill handles output).

### Step 8: Final Self-Check

Before returning output (skip in `quick` mode), check the revised draft against `references/quality-gate.md`. If any item fails, fix the draft and re-check. This catches over-editing — a flattened voice, an invented specific, a concrete detail smoothed into something vague — that the before/after score alone won't show.

### Step 9: Log Learnings

If the user gives feedback ("that was too aggressive", "keep the em dashes", "good catch on X"), log to `context/learnings.md` → `## tool-humanizer`.

---

## Pipeline Mode

When called by another skill (not standalone), this skill:
1. Receives text as input
2. Runs Steps 2-8 silently
3. Returns cleaned text
4. Only shows the score summary if the change was significant (delta > 2 points)

The calling skill is responsible for saving the final output.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue with the output, add a dated entry under `## Rules` in this skill's `SKILL.local.md` (create it if missing) and log it to `context/learnings.md` under `## tool-humanizer`. Write the general rule the correction implies, not the one-off fix.
