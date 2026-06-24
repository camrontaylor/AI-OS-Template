# Creative Testing Method (the variation matrix)

How to test ad creative so each test teaches you something you can reuse. This is the
shared method for every ad-creative variant skill. The image engine does not change any
of this. Only the generate step differs per engine.

Specs here drift (budgets, Meta thresholds, platform rules). Numbers marked directional,
reference, or as-of a date are starting points, not law. Re-verify against the current
platform docs before a launch.

## Contents

- [1. The matrix as a document](#1-the-matrix-as-a-document)
- [2. The layer skeleton (give each ad one job)](#2-the-layer-skeleton-give-each-ad-one-job)
- [3. One-variable isolation across three phases](#3-one-variable-isolation-across-three-phases)
- [4. How many, how much, how long](#4-how-many-how-much-how-long)
- [5. Reading winners (metrics in priority order)](#5-reading-winners-metrics-in-priority-order)
- [6. Scaling winners without resetting learning](#6-scaling-winners-without-resetting-learning)
- [7. Refresh rules](#7-refresh-rules)

---

## 1. The matrix as a document

Write the matrix down as a document BEFORE you launch. The document must say three things:

1. Which single variable you are testing this phase.
2. The controlled baseline (everything you hold equal).
3. How many variants you will run.

Why: without this document, every test is ad hoc. You learn nothing you can carry to the
next test. The matrix is what turns a batch of ads into a real test.

---

## 2. The layer skeleton (give each ad one job)

Each ad should do ONE job. The layers below are the jobs. Pick one layer to vary; hold
the rest equal.

| Layer | Examples | Why it matters |
|---|---|---|
| Buyer problem | "Your ads stopped working" | Defines the demand trigger |
| Hook family | cost, urgency, fear, proof, contrarian | Changes who stops scrolling |
| Proof point | founder, metric, demo, testimonial, process | Makes the promise believable |
| Objection | too expensive, too hard, too slow | Reduces friction |
| CTA | see pricing, calculate ROI, book call | Tests next-step intent |
| Variant | length, cut, first line, caption | Execution diversity |

### Build order (do NOT start with formats)

Build from the buyer out, not from the ad format in. Start with the problem, end with the
next step:

1. List 3 to 5 buyer problems.
2. Build hook families per problem.
3. Add proof, objection, status-quo, and next step per lane.

Why start with problems: the problem is the demand trigger. Formats are just how you
dress it. Starting with formats means you test how the ad looks before you know if anyone
cares about what it says.

---

## 3. One-variable isolation across three phases

The core failure is mixing up variation with isolation. Lots of different ads is not a
test. A real test changes ONE thing and holds the rest equal. Phase the test in three
layers, in order.

| Phase | What you test | How many | What you hold equal |
|---|---|---|---|
| Phase 1 | Hook and format (first 3s of video, or opening line plus composition for static) | 3 to 4 hook variants | Same body, offer, CTA. Keep format constant (all video OR all static, do not mix). |
| Phase 2 | Offer and copy angle (e.g. PAS vs direct-benefit vs social-proof; gain vs loss vs mechanism) | 3 angle variants | Hold the winning hook constant. Do not touch visual or CTA. |
| Phase 3 | CTA and closing (button text, closing line, urgency framing) | (small set) | Hook and angle already resolved. |

Notes:

- Phase 1 is the highest-impact phase. The hook decides who stops scrolling.
- Phase 3 wins are smaller (around 5 to 15 percent on CPA, directional) but they stack on
  top of the Phase 1 and Phase 2 wins.

### Visual and format choices to test on purpose

- Aspect ratio: 1:1 vs 4:5 vs 9:16.
- Static vs video: video tends to win for cold audiences; static can win for warm.
- UGC-style vs branded production: UGC for prospecting and younger audiences; branded for
  retargeting.

---

## 4. How many, how much, how long

### Concepts per test

- Run 3 to 5 variants per ad set.
- Below 3 is not enough spread to call a winner.
- Above 5 or 6, Meta spreads delivery so thin that variants never exit learning.
- Exception: Advantage+ Creative manages rotation itself and can take up to 10 asset
  combinations.

### Lane-to-creative-count sizing (agency reference, directional)

| Problem lanes | Rough ad count |
|---|---|
| 1 lane | ~100 ads |
| 3 lanes | ~300 ads |
| 5 lanes | ~500 ads |
| 10 lanes | ~1,000 ads |

Start at 3 to 5 lanes. Go to 10 lanes only if you have the spend and team to support it.

### Budget per variant (EUR, directional, re-verify)

- Minimum about EUR 30 per day per variant for a CPA target under EUR 40.
- Scale up for higher CPA targets: roughly EUR 75 to 100 per day per variant for a
  CPA over EUR 100.
- Below the threshold, the variant is underpowered no matter how long it runs.

### Duration and sample size

- Run each variant at least 7 days AND get at least 50 conversions per variant. Use
  whichever takes longer.
- Why 7 days: it captures the full weekday and weekend swing.
- Why 50 conversions: that is Meta's learning-phase exit point (about 50 optimization
  events). Only compare variants after all of them have exited learning.

### Campaign structure for a clean test

- Single campaign.
- CBO (campaign budget optimization) OFF.
- Equal ad-set budgets.

Why CBO off: CBO shifts budget to the variant it predicts will win and starves the rest.
That defeats the test, because one variant wins on budget, not on merit.

---

## 5. Reading winners (metrics in priority order)

Read the metrics in this order. The first one decides; the rest are diagnostics.

1. **Cost-per-result (CPA / CPL) - the decision metric.** A 1.6 percent CTR at EUR 34 CPA
   beats a 2.8 percent CTR at EUR 55 CPA every time.
2. **Hook rate / 3-second video views.** Diagnoses Phase 1. A 28 percent hold vs a 14
   percent hold means the low one loses on CPA no matter how good the offer is.
3. **CTR.** Diagnoses the copy and offer frame. High CTR with poor CPA points to a
   landing-page problem. Low CTR everywhere points to a hook or relevance problem.
4. **CPM.** Diagnoses fatigue. CPM up 40 percent or more over 7 days with frequency above
   3.5 is a delivery or fatigue signal, not a creative failure.

### Two false-positive traps

- **Day 2-3 peak.** Early strong numbers come from your highest-intent users. They
  normalize down by day 4 to 7. Never call a winner before 7 days.
- **Budget-favored winner.** If one variant got about 5x the spend (CBO was left on), its
  "win" is a delivery artifact, not a real result. Check budget distribution first.

---

## 6. Scaling winners without resetting learning

- **The 20 percent rule.** Raise the daily budget by no more than 20 percent every 48 to
  72 hours. Bigger jumps reset the learning phase and spike CPA.
- **Horizontal duplication.** Duplicate the winning ad set at the target budget. Let the
  copy learn while the original keeps running as a control.
- **Audience expansion.** Keep the budget, widen the audience. This lowers frequency,
  extends the ad's life, and keeps CPM stable. This is the cleanest option.
- **New campaign at target budget.** Start a fresh campaign on the proven creative.
- **Never pause-and-reactivate a winner at a higher budget.** The pause resets delivery
  and you lose the learning.

### Meta Andromeda note (2026, re-verify)

Meta's 2026 algorithm (Andromeda) rewards creative diversity, not raw volume. When you
find a winner, repurpose its message across new formats. Turn a winning video into a
static or a 3-frame carousel by pulling out its hook. Do not crank out 20 near-duplicates
of the same ad.

---

## 7. Refresh rules

Bake these into the matrix:

- Pause weak hooks.
- Expand winning problem lanes.
- Refresh winners with adjacent variants.
- Retest a losing lane only if the hypothesis changed.
- Never let the whole account depend on one winner for too long.

**Refresh cadence (Meta 2026 reference, re-verify):** add 2 to 3 new creatives per week
to stay ahead of fatigue.
