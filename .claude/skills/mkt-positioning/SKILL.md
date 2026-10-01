---
name: mkt-positioning
description: >
  Find the angle that makes something sell. Use when launching a product,
  writing a landing page, crafting an offer, or when marketing feels flat.
  Searches competitor messaging to map the landscape, loads brand context,
  then generates 3-5 distinct positioning angles with a recommended pick.
  Writes chosen angle to brand_context/positioning.md. Optionally seeds
  an ad testing matrix. Triggers on: "find angles for", "how should I
  position", "what's the hook", "why isn't this selling", "make this stand
  out", "differentiate", "USP", "positioning". Foundation skill — run
  before execution skills that need an angle to write from.
  Does NOT trigger for voice extraction, audience research, or content writing.
---

# Positioning

The same product can sell dramatically better with a different angle. Not a different product — just a different way of framing what it already does. This skill finds those angles.

## Outcome

`brand_context/positioning.md` containing: primary positioning angle, competitive landscape summary, market sophistication assessment, and all explored alternatives.

The structured data format is defined in `references/positioning-output.md`.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/icp.md` | Full | Audience segments, pain points, and language patterns inform angle generation |
| `brand_context/voice-profile.md` | Tone only | Ensures angle language matches brand register |
| `context/learnings.md` | `## mkt-positioning` section | Apply previous feedback on what converted |

Load if they exist. Proceed without them if not.

---

## Before You Start

**Check if `brand_context/positioning.md` exists.**

If it exists → **Update mode.** Read the file, show the current primary angle and statement, and ask: "Want to refine this with fresh competitive data, or start from scratch?" Refine mode runs a fresh competitive search and suggests adjustments. Start fresh runs the full process below.

If it doesn't exist → proceed to Step 1.

---

## Step 1: Identify the Transformation

Not the product. The transformation. What does the customer's life look like after? What pain disappears? What capability appears?

Ask: "What does your customer's life look like after using this? What changes?"

A fitness program sells "fit into your old jeans." A SaaS tool sells "close your laptop at 5pm." The transformation is the raw material for angles.

---

## Step 2: Map Alternatives

What would customers do if this didn't exist? Not just competitors — all alternatives:
- Do nothing (live with the problem)
- DIY (cobble together a solution)
- Hire someone (consultant, freelancer, agency)
- Buy a different category entirely
- Buy a direct competitor

Each alternative has weaknesses. Those weaknesses become angle opportunities.

---

## Step 3: Competitive Messaging Search

Search the web for real competitor messaging. This grounds angles in current market reality.

Read `references/competitive-search.md` for the full search process and landscape map format.

Key output: a map showing saturated claims (everyone says it), partially claimed territory, and white space (nobody is talking about it). Angles built on white space outperform echoed claims.

---

## Step 4: Assess Market Sophistication

Read `references/market-sophistication.md` for Schwartz's 5 stages.

The market stage determines which angle type will work. A new category needs simple announcement. A crowded market needs mechanism explanation. A jaded market needs identity framing.

---

## Step 5: Generate Angles

Run the product through multiple angle frameworks. Read `references/angle-frameworks.md` for the full set (Contrarian, Unique Mechanism, Transformation, Enemy, Speed/Ease, Specificity, Social Proof, Risk Reversal).

Generate 3-5 distinct options. For each:
- **Statement** — one sentence positioning
- **Psychology** — why this works with this audience at this market stage
- **Headline direction** — how it would sound in copy
- **Best for** — market conditions and audience segments

Before presenting, check each angle: specific, differentiated against the landscape map, believable given the available proof, relevant to the ICP, and concrete enough to picture as a headline or ad. Sharpen or drop any that fail.

Mark one with a recommendation and explain why it's the strongest fit given their competitive white space and market stage.

Ask: "Which angle resonates? Pick a number, or tell me to combine elements from multiple."

---

## Step 6: Save Output

After the user selects an angle, write `brand_context/positioning.md`.
Read `references/positioning-output.md` for the exact format.

If the file already existed, show what changed and confirm before overwriting.

After saving, offer: "Want me to generate a 12-ad testing matrix for this angle? I'll map 4 hooks across 3 formats."

---

## Step 7: Collect Feedback

Ask: "How did this angle perform once you used it?"
Log feedback to `context/learnings.md` under `## mkt-positioning` with date and context.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue with the output, add a dated entry under `## Rules` in this skill's `SKILL.local.md` (create it if missing) and log it to `context/learnings.md` under `## mkt-positioning`. Write the general rule the correction implies, not the one-off fix.

---

## Troubleshooting

**User can't articulate the transformation:** Ask what their best customers say about the product — the transformation is in their words, not the founder's.
**No competitors found:** The product may be category-creating (Stage 1). Lead with simple announcement angles.
**All angles feel similar:** The mechanism isn't clear enough. Go back to Step 1 and dig deeper on what makes their approach different.
**Positioning exists but feels stale:** Run a fresh competitive search and compare — the market may have moved.
