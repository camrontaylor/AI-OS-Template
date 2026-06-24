# Creative Slate

The creative slate is the anti-duplication ledger. It is a running list of every ad
creative you have already produced. Before you make a new variation, you check the
slate first. If the exact combination already exists, you do NOT remake it. You make
a new combination instead.

One row in the slate equals one creative equals one cell in the test matrix. Keep
that one-to-one rule in your head the whole time.

Starter file: `assets/slate.template.csv`. Copy it per client and fill it as you go.

These platform specs and rules drift. Re-verify the live numbers (spend floors,
learning-phase thresholds, Advantage+ limits) against the current platform docs
before any launch.

## Table of contents

- [Why the slate exists](#why-the-slate-exists)
- [Naming convention](#naming-convention)
- [Code dictionaries](#code-dictionaries)
- [Slate table skeleton](#slate-table-skeleton)
- [The dedup check before you generate](#the-dedup-check-before-you-generate)
- [Fair-test guardrails](#fair-test-guardrails)

## Why the slate exists

Without a ledger, the agent re-makes the same ad over and over by accident. It wastes
generation budget and it muddies the test, because two near-identical ads teach you
nothing new. The slate is the memory that stops that. Read it, then build only what is
missing.

## Naming convention

Every creative gets a structured name. Keep each field short and in a fixed order, so
the name itself becomes sortable, filterable data, not free text. The order is the
contract. Do not reorder fields.

Canonical full template:

```
CHANNEL | GOAL | GEO | AUD_TYPE | AUD_DETAIL | OFFER_FORMAT | YYYYMMDD | PLACEMENT | BID | FORMAT | VARIANT | ASSET_ID | TESTTAG | UNIQUE_ID
```

Worked example:

```
FB | CV | US-CA | LAL | L1_1pct | Demo_Carousel | 20250421 | Reels | tCPA | Video_15s | V2_IMG_A | ASSET_1234 | T1 | 1234
```

Shorter ad-level identifier example:

```
V_A_A+30s_H1_ASSET123
```

That reads as: Video, Variant A, 30 second hook, Headline 1, Asset 123.

Naming rules:

- No PII and no long targeting strings in the name. Names leak into ad-platform
  reporting, so anything private leaks too.
- Keep a shared decode sheet so anyone can read a name.
- `ASSET_ID` / `UNIQUE_ID` is the field that joins a name to the master asset. It is
  the field that stops you re-generating a combination that already exists.

## Code dictionaries

Use these short codes so the fields stay tight and consistent.

| Field | Codes |
|---|---|
| Channel | FB, IG, GL (Google), TT (TikTok) |
| Goal | AW (awareness), TR (traffic), CV (conversion) |
| Audience | Cold, Warm, Retarget, L1 (lookalike 1%) |
| Format | V (video), S (static); also `Video_15s`, `Img_1x1` |
| Variant | V1, V2, or IMG_A |
| Date | YYYYMMDD only, one style, never mixed |

## Slate table skeleton

Drop this into `assets/slate.template.csv`, or keep it as a markdown table. Each row is
one creative you have already planned or produced.

| slate_id | date | client | buyer_problem | hook_structure | hook_text | copy_angle | proof_point | objection | cta | format | aspect_ratio | variant | asset_path | full_name | engine | phase | status | spend | impressions | hook_rate | ctr | cpa | conversions | decision |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|

Three columns carry fixed value sets. Use only these values:

- `status`: planned, generated, live, paused, winner, loser.
- `phase`: 1 (hook test), 2 (angle test), 3 (CTA test).
- `decision`: only set this after at least 7 days AND at least 50 conversions on the
  row. Rows marked "winner" become the control for the next phase and feed the
  repurpose loop.

## The dedup check before you generate

Before generating any new creative, check the slate for this exact tuple:

```
buyer_problem | hook_structure | copy_angle | format | aspect_ratio
```

This five-part combination must be unique per client. That is the dedup guard.

- If the tuple already exists in the slate, do NOT remake it. Generate a different
  combination instead (swap one part of the tuple).
- If the tuple is not there, it is safe to generate. Add the row.

One allowed exception: for Advantage+ tests, you may put up to 10 asset combinations
under a single test row, because Advantage+ rotates them internally. Re-verify that
limit before launch, since platform numbers change.

## Fair-test guardrails

The slate also keeps tests fair. Only compare rows that are truly comparable. A
"winner" called on a lopsided test is a false winner.

Before you compare two rows or call a winner, confirm all of these:

- **Same objective.** Only compare rows with the same goal.
- **Comparable spend.** Spend should be close or normalized across the rows. If one
  row got far more spend, its lead is a delivery artifact, not a real win.
- **Same audience tags.** Identical audience, or the audience is not held equal.
- **Close start dates.** Rows should have started near the same time, so seasonality
  hits them the same way.
- **Minimum thresholds set first.** Decide your minimum spend and minimum conversions
  BEFORE you call any winner. Below those floors the test is underpowered.

Two more rules:

- Do not call a winner on a single metric. Weigh CPA, conversion rate, ROAS, and
  frequency together.
- Re-check winners after a wider window. Winners change over time, so an early lead is
  not final.
