# Ad Copy and Hook Methodology

This is the shared copy and hook layer for the ad-creative skills. It is engine-agnostic. The copy frameworks, hooks, UGC script shape, and Google search-ad rules below are the same no matter which image engine the skill uses. Only the image-generation step differs (that lives elsewhere).

Use this file as the copy-angle and hook layer when you build an ad variation matrix.

## A note on the numbers

Some lines below cite a percentage (for example "71% decide in about 3 seconds"). Treat every cited percentage as a directional agency or vendor figure, not a guarantee. They show the size of an effect, not a promise of a result. Re-verify any number you plan to lean on before a real launch.

## Contents

- [1. The four copy frameworks](#1-the-four-copy-frameworks)
- [2. The scroll-stopping hook](#2-the-scroll-stopping-hook)
- [3. The UGC 4-beat script](#3-the-ugc-4-beat-script)
- [4. Google RSA best practices](#4-google-rsa-best-practices)
- [5. Operating modes](#5-operating-modes)
- [6. Angle architecture](#6-angle-architecture)
- [7. Batch generation waves](#7-batch-generation-waves)
- [8. Performance-data iteration](#8-performance-data-iteration)
- [9. Upload-ready linting](#9-upload-ready-linting)

---

## 1. The four copy frameworks

Use these as the copy-angle layer of the matrix. Pick a framework per ad, then write the lines.

### PAS - Problem, Agitate, Solution

Three beats:

1. **Problem.** Name the exact pain the buyer already feels, in plain words.
2. **Agitate.** Make the cost of doing nothing feel real and urgent. Do not get pushy.
3. **Solution.** Show the product as the fix.

Best for landing pages, email, and paid-social main text.

Example (software):
- P: "Your to-do list keeps growing, but your productivity doesn't."
- A: "Deadlines slip, projects pile up, stress builds."
- S: "Our scheduler helps you focus and finish on time."

### AIDA - Attention, Interest, Desire, Action

Four beats:

1. **Attention.** A scroll-stopping hook.
2. **Interest.** Tie to a problem or benefit.
3. **Desire.** Give an emotional reason to care, plus proof.
4. **Action.** One clear next step.

This maps cleanly onto a video ad's timeline.

### Problem-Solution (direct-benefit)

Lead with the pain, deliver the fix. This is a lower-friction version of PAS. Use it for people who already know the category and the problem (high-awareness audiences).

### Offer frames - gain, loss, mechanism

Three frames to test for any product. Test all three.

| Frame | What it says | Best for |
|---|---|---|
| **Gain** | What the viewer gets. Outcome first, direct. | People who already know the category. |
| **Loss** | What they lose by not acting. | Considered purchases and B2B. Often beats gain framing here, but it varies by category, so test both. |
| **Mechanism** | Why this approach works when others don't. | People who tried other things and need a reason to believe. |

WHY framing matters: one HBR analysis (cited by AdLibrary) found message framing accounted for about 28% average variance in conversion rate. That was larger than headline length, visual type, or CTA text. Treat the 28% as a directional figure, not a promise.

---

## 2. The scroll-stopping hook

The hook is the highest-leverage variable. It is the first 3 seconds of a video, OR the opening 1 to 2 lines of a static ad's main text.

WHY it matters so much:
- About 71% of viewers decide whether to scroll within roughly 3 seconds (average 1.7 seconds).
- Per Meta data cited by AdLibrary, about 65% of ads with real view-through results win on hook strength.
- Viewers who skip the first 3 seconds almost never come back, no matter how good the offer is.

Treat the 71% and 65% as directional vendor figures, not guarantees.

### Four testable hook structures

Test the structure, not just the words.

| # | Structure | Example |
|---|---|---|
| 1 | **Pattern interrupt** - an unexpected visual or line | "Nobody talks about this." A dark frame in a light feed. |
| 2 | **Specific outcome** - exact result plus timeline | "We cut CPA from 42 euros to 19 in 11 days. Here's the one change." |
| 3 | **Audience identification** - call out the viewer's exact situation | "If you run Meta ads over 3,000 euros a month and ROAS has dropped for 3 weeks..." |
| 4 | **Social proof** - a concrete third-party result | "47 DTC brands used this to exit learning in under 6 days." |

### Hook families (idea bank)

A broader set of angles to fill out the matrix:

- direct pain
- hidden cost
- mistake
- before / after
- contrarian belief
- time-sensitive trigger
- proof-first
- founder story

### Rule: two executions per structure

For each hook structure, produce **2 production versions**. WHY: this lets you tell apart how the structure performs from how that one execution performs. A good structure made badly still loses, so two versions stop you from killing a structure for the wrong reason.

---

## 3. The UGC 4-beat script

This is the script skeleton every winning UGC ad follows. Timing is for short-form vertical video.

```
HOOK     0 to 3s     Stop the scroll. A creator-native line, a real first frame:
                     face, product, problem, or result.
PROBLEM  3 to 10s    Name the pain the viewer already feels.
SOLUTION 10 to 20s   Show the product as the answer. Show proof fast.
CTA      last 3 to 5s  One clear next step.
```

The hook should do ONE of these:
- **Curiosity:** "I tested this for 30 days and..."
- **Recognition:** "POV: you've been buying the wrong..."
- **Urgency or shock:** "Stop doing this if you run Meta ads."

Keep the opener under about 7 seconds. Real UGC openers sound like a buying moment, not a slogan.

Opener examples:
- "I almost returned this."
- "I didn't get the hype."
- "I found this because of a comment."

Alternate micro-structure for the first frames: **Pain, then Proof, then Next step.**

### Top 5 UGC mistakes to avoid

Lint every script against these:

1. Starting with the brand name.
2. Leading with features, not the problem.
3. An over-polished opener before any trust is built.
4. No clear single CTA.
5. A hook that does not connect to the next spoken block.

---

## 4. Google RSA best practices

RSA means Responsive Search Ad. This is the search-side copy engine.

### Exact limits (confirmed via Google Help)

Re-verify these before a launch, since platform limits drift.

| Field | Max count | Max length each |
|---|---|---|
| Headlines | 15 | 30 characters |
| Descriptions | 4 | 90 characters |
| Path fields | 2 | 15 characters |
| Final URL | 1 | 2,048 characters |
| Business name | 1 | 25 characters |

Other confirmed rules:
- Minimum to publish: 3 headlines and 2 descriptions.
- Max 3 RSAs per ad group.
- Double-width languages (Japanese, Chinese, Korean) count each character as 2.

### Best practices

- **Give all 15 headlines and 4 descriptions** for the best Ad Strength. If you can't, aim for at least 8 to 10 headlines and 3 descriptions.
- **Each headline and description must stand alone.** Google shows them in any order and any mix. Do not write copy that depends on a sequence (no "Step 1.../Step 2...").
- **Mix on purpose.** Blend keyword-rich headlines, value props, CTAs, and unique features. A practical split: about 3 with the primary keyword, about 3 benefit, about 3 CTA, about 2 to 3 USP.
- **Put value first, not the brand.** 30 characters is too tight to spend on the brand, and the display URL already shows it. Use numbers ("Save 20%" not "Save Twenty Percent"), cut filler words ("your", "our"), and abbreviate naturally ("24/7").
- **Pinning restricts the algorithm.** Pinning one position can cut testable combinations by about 75% and can drop Ad Strength from Excellent to Poor. Pin only for legal, compliance, or brand-consistency reasons. If you must pin, pin **multiple variants** to the same position so the algorithm can still test.
- **Ad Strength** measures the relevance, quality, and diversity of your assets (it shows a live checklist). Higher Ad Strength means more reach, because Google's machine learning needs diverse assets. Aim for "Good" or "Excellent".

Treat Google's reported lifts ("61% more conversions / +5% CTR vs ETAs") as vendor figures, not guarantees.

---

## 5. Operating modes

Every ad creative run starts in one of two modes. Name the mode in `brief.md`.

### Mode 1 - Generate from scratch

Use when there is no reliable creative performance data yet.

Required sequence:

1. Define the offer, audience, platform, placement, and conversion goal.
2. Pick 3 to 5 buyer problems.
3. Build hook families for each problem.
4. Produce at least 2 executions for each hook structure.
5. Validate copy and creative against platform specs before generation/export.

### Mode 2 - Iterate from performance data

Use when the user provides ads, metrics, exports, screenshots, or a plain-language summary of what has been running.

Required sequence:

1. Pick the decision metric: CTR, CVR, CPA, ROAS, thumb-stop, hold rate, or another campaign metric.
2. Separate winners, losers, and inconclusive assets.
3. Extract winning patterns from the winners.
4. Identify patterns to avoid from the losers.
5. Preserve one proven control and test one new variable at a time.
6. Write an iteration report before creating the next matrix.

Never blend scratch strategy and performance iteration vaguely. If data exists, let it constrain the next creative batch.

---

## 6. Angle architecture

Before writing copy or prompts, establish the angles: different reasons a buyer would click. Do not generate 20 surface-level rewrites of the same reason.

| Angle category | What it tests | Example |
|---|---|---|
| Pain point | Does the buyer recognize the problem? | "Stop rebuilding reports by hand." |
| Outcome | Does the result matter enough? | "Cut weekly reporting to 5 minutes." |
| Social proof | Does third-party confidence help? | "Used by 10,000+ operators." |
| Curiosity | Does the knowledge gap pull attention? | "The reporting step teams skip." |
| Comparison | Does positioning against alternatives help? | "Spreadsheets are the slow way." |
| Urgency | Does a deadline or timing trigger help? | "Fix Q4 reporting before planning starts." |
| Identity | Does role-specific language increase relevance? | "Built for ops leads, not analysts." |
| Contrarian | Does challenging the default belief create attention? | "Dashboards don't fix reporting." |
| Mechanism | Does explaining why it works create belief? | "Connect once. Reports update themselves." |

Angle rule: each angle must have a distinct hypothesis. If two angles would teach the same thing when they win or lose, merge them.

---

## 7. Batch generation waves

Use waves so the batch has enough breadth to learn but does not test everything at once.

### Wave 1 - Core hooks

- 3 to 5 angles.
- 2 executions per hook structure.
- One shared offer, CTA, and audience.
- Goal: find the hook/angle family worth scaling.

### Wave 2 - Extend winners

- Keep the top 1 to 2 hooks or angles.
- Vary specificity, proof, visual metaphor, or opening line.
- Keep the same landing page and offer unless the first wave clearly exposes message mismatch.

### Wave 3 - Controlled wild cards

- Add 1 to 2 new angles that are intentionally different: contrarian, proof-first, founder story, before/after, or mechanism-first.
- Do not let wild cards dominate the batch. They are exploration, not the control.

Quality filter every wave:

- Remove duplicates and near-duplicates.
- Remove generic "best/leading/amazing" claims unless the proof exists.
- Remove lines that depend on a previous line when the platform may reorder assets.
- Remove unsupported numerical claims.
- Flag compliance or platform-policy risk.

---

## 8. Performance-data iteration

When performance data is available, write a short iteration report with this structure:

```markdown
## Performance Summary
- Analyzed:
- Primary metric:
- Top performers:
- Worst performers:
- Winning themes:
- Winning structures:
- Losing patterns:
- Inconclusive assets:

## Next Test Hypothesis
- Preserve:
- Change:
- Control creative:
- New variable:
- Minimum evidence threshold:

## New Creative Direction
- Double down:
- Extend:
- Retire:
- Explore:
```

Read winners for:

- Theme: pain, outcome, proof, identity, mechanism, urgency.
- Structure: question, command, statement, number, comparison, before/after.
- Specificity: numbers, timeframe, audience callout, proof source.
- Character utilization: short punch versus longer explanatory copy.
- Visual/copy match: whether the image/video makes the hook easier to believe.

Read losers for:

- Generic or unsupported claims.
- Weak audience specificity.
- Visual mismatch.
- Long setup before the hook.
- Too many ideas in one asset.
- Copy that promises more than the landing page proves.

Default next move: double down on winning structures, extend winning angles, test 1 to 2 new angles, and avoid the repeated loser patterns.

---

## 9. Upload-ready linting

Before any asset is called ready, lint it like a media buyer would:

- Character limits: every field has a count and fits the platform's recommended visible limit.
- Standalone test: every RSA headline/description makes sense independently.
- Pairing test: headlines, descriptions, primary text, image, and CTA do not contradict each other.
- Message match: the ad promise appears on the landing page.
- One-variable rule: each test row changes only the declared variable.
- Slate uniqueness: no duplicate tuple of `buyer_problem | hook_structure | copy_angle | format | aspect_ratio`.
- Policy scan: no unsupported claims, misleading urgency, prohibited before/after, sensitive attribute callouts, or regulated-category gaps.
- Trafficking readiness: file name, platform, placement, ratio, UTM, naming convention, owner, and approval status are present.

If any lint fails, fix it before generation/export or mark the asset as not launch-ready.

---

## Quick reference: the cited percentages

These four are directional agency or vendor figures only. They show effect size, not a promised result. Re-verify before any launch.

| Figure | What it claims | Source flag |
|---|---|---|
| 71% (avg 1.7s) | Viewers decide whether to scroll within about 3 seconds | Directional, vendor |
| About 65% | Ads with real view-through results win on hook strength | Directional, Meta data via AdLibrary |
| About 28% | Average conversion-rate variance from message framing | Directional, HBR analysis via AdLibrary |
