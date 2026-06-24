# Media-Buying Workflow

This is the operator layer that makes the ad creative useful in a real account. Use it before generating, during QA, and when reading performance data. The image engine is not the strategy; the engine only produces assets. The media-buying workflow decides what is worth making, what is safe to launch, and what to do after the market gives feedback.

## Contents

- [1. Creative operating system](#1-creative-operating-system)
- [2. Brief before batch](#2-brief-before-batch)
- [3. Creative scorecard](#3-creative-scorecard)
- [4. Launch-readiness gate](#4-launch-readiness-gate)
- [5. Performance diagnostics](#5-performance-diagnostics)
- [6. Iteration rules](#6-iteration-rules)
- [7. Client handoff](#7-client-handoff)

---

## 1. Creative operating system

Treat every batch as one step in a creative learning loop:

```text
Intake -> Hypothesis -> Matrix -> Produce -> QA -> Launch-ready handoff -> Performance read -> Next matrix
```

The loop is the product. A beautiful asset that does not teach anything is weaker than a slightly less polished asset that cleanly tests a buyer problem, hook, or offer frame.

Every batch should answer:

1. What are we testing?
2. What is held constant?
3. What metric will decide?
4. What will we do if it wins?
5. What will we do if it loses?

## 2. Brief before batch

Before generation, write `brief.md` and `creative-matrix.csv`. The brief is human-readable. The matrix is the upload/testing ledger.

Minimum brief sections:

- Offer and landing page.
- Target audience and awareness stage.
- Funnel stage and campaign objective.
- Primary metric and target CPA/ROAS if known.
- One-sentence test hypothesis.
- Buyer problems being tested.
- Hook families.
- Offer frames: gain, loss, mechanism.
- Proof points and objections.
- Platforms, placements, and aspect ratios.
- Approval owner and launch status default.

Use `assets/creative-matrix.template.csv` for the matrix. Keep one row per creative concept or export, depending on how granular the operator wants the slate.

## 3. Creative scorecard

Score concepts before generation so weak ideas do not burn tokens or media spend.

| Dimension | Strong signal | Red flag |
|---|---|---|
| Audience specificity | Calls out a situation the buyer recognizes | Could apply to anyone |
| Problem clarity | Names a felt problem in plain language | Starts with brand or features |
| Offer force | The viewer understands why now | Vague value proposition |
| Proof | Concrete demo, result, testimonial, or mechanism | Unsupported "best/leading" claim |
| Visual thumbstop | First frame has a reason to stop | Pretty but generic |
| Message match | Ad promise matches landing page | Clickbait or mismatch |
| Compliance | Claims, disclaimers, and category rules are handled | Risky or absolute claims |
| Test cleanliness | One variable is changing | Hook, offer, format, and audience all change |

Use a simple 1 to 5 score. Anything under 3 on audience specificity, problem clarity, offer force, or compliance should be revised before generation.

## 4. Launch-readiness gate

The creative skill should not launch ads, but it should hand off assets that are launch-ready. Write `launch-readiness.md` alongside `qa-report.md`.

Check:

- Campaign objective matches funnel stage.
- Conversion event exists and tracking status is known.
- Landing page URL is live, mobile-usable, and message-matched to the ad.
- UTM convention is present.
- Campaign/ad/ad-set naming convention is present.
- Budget or test budget notes are present.
- Special ad category or regulated-category risk is noted.
- Required disclaimers appear where needed.
- Default launch status is `paused_for_review` unless the operator explicitly overrides it.
- Exclusions are noted: customers, recent converters, irrelevant geos, or audiences the client should not pay to reach.
- AI-content disclosure flag is present for generative engines.

If any launch-readiness item is unknown, mark it `unknown` and put it in `open_gaps`. Do not invent account facts.

## 5. Performance diagnostics

When performance data exists, diagnose before generating more ads. Use `assets/performance-read.template.csv` and write `performance-read.md`.

Read metrics as a funnel:

| Symptom | Likely diagnosis | Next creative action |
|---|---|---|
| Low hook rate or 3-second views | First frame/opening line is weak | Test new hook structures, keep offer and audience constant |
| Hook rate good, CTR low | Message is not creating click intent | Test offer frame, proof point, or objection handling |
| CTR good, CPA bad | Post-click or offer issue | Check landing page, qualification, price/offer, and message match |
| CPA good, frequency rising | Winner is fatiguing | Refresh execution around the same winning problem/hook |
| CPM high from start | Audience/placement/relevance issue | Check targeting, exclusions, creative relevance, and account structure |
| One creative gets most spend under CBO | Delivery artifact | Do not call winner without fair budget distribution |

Decision metric hierarchy:

1. CPA, CPL, or ROAS: the business decision.
2. Hook rate / 3-second views / thumbstop: Phase 1 diagnostic.
3. CTR / CPC: click-intent diagnostic.
4. CVR: post-click diagnostic.
5. CPM, frequency, spend distribution: delivery and fatigue diagnostic.

## 6. Iteration rules

Turn performance into the next matrix:

- **Scale** a winner by extending its message across new formats, not by making near-duplicates.
- **Refresh** a fatigued winner by keeping the winning buyer problem and hook structure while changing execution.
- **Retire** a loser only after the test has enough signal and delivery was fair.
- **Retest** a losing lane only when the hypothesis changes.
- **Separate creative and funnel problems.** Do not ask creative to fix a landing page or conversion tracking issue.
- **Keep one control.** Every new batch should preserve one known winner or baseline so the read is anchored.

## 7. Client handoff

Every client handoff should include:

- Folder path.
- Batch goal.
- What was tested.
- What should be launched first.
- What should stay paused.
- Open setup gaps.
- AI-label/compliance notes.
- Exact next read date or data threshold.
- What the next iteration will test if this batch wins or loses.

This makes the work feel like media buying, not image generation.
