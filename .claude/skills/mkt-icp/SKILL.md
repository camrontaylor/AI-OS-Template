---
name: mkt-icp
description: "Build or refine an ideal customer profile so every skill speaks to the right person. Not for positioning, voice, or content writing."
when_to_use: 'Invoke when the request sounds like: "target audience", "buyer persona", "ideal customer", "who am I selling to", "ICP", "customer avatar", "audience research". Modes: Interview or Research. Foundation skill, run before execution skills that read audience'
---

# ICP — Ideal Customer Profile

Generic marketing talks to everyone and resonates with no one. A sharp ICP doesn't just describe demographics — it captures how the customer thinks, what words they use, what they've already tried, and why they're still stuck.

## Outcome

`brand_context/icp.md` — a customer profile detailed enough that any skill can write copy, choose angles, or build content that feels like it was written by someone who knows the reader personally.

## Context Needs

| File | Load level | How it shapes this skill |
|------|-----------|--------------------------|
| `brand_context/positioning.md` | Summary | The chosen angle tells us which audience segment to focus on |
| `context/learnings.md` | `## mkt-icp` section | Apply previous insights about what resonates |

Load if they exist. Proceed without them if not.

---

## Before You Start

**Check if `brand_context/icp.md` exists.**

If it exists → **Update mode.** Read the file, show a one-paragraph summary, and ask what they'd like to change. Offer targeted updates (add a segment, refine language, update objections) rather than rebuilding from scratch.

If it doesn't exist → **Mode selection.** Ask:

> "Do you already know who your ideal customer is, or should I research them?
> 1. I know them — ask me questions and I'll describe them
> 2. Research them — I'll pull signals from reviews, forums, and social media
> 3. Both — interview me, then validate with research"

If the user provides a URL or mentions a specific platform in their opening message, skip to Research mode.

---

## Mode 1: Interview

Best for: founders who know their customer but haven't documented the profile systematically.

Read `references/interview-questions.md` for the full question bank.

Ask a maximum of 8 questions. Prioritise based on what you already know from context. If positioning.md is loaded, skip questions it already answers.

Focus on surfacing **their customer's own language** — not marketing language. The words a customer uses to describe their problem are more valuable than how the founder frames it.

---

## Mode 2: Research

Best for: validating assumptions, finding customer language, or starting without founder knowledge.

Read `references/research-methods.md` for the full process.

Sources to mine (in priority order):
1. Customer reviews of the product or competitors (Amazon, G2, Capterra, app stores)
2. Reddit/forum threads where the target audience discusses their problem
3. Social media comments on competitor content
4. YouTube comments on related videos
5. Survey data or testimonials (if the user provides them)

The goal is to extract patterns in: how they describe the problem, what they've tried, what frustrated them, and what outcome they're after — in their exact words.

---

## Mode 3: Interview + Research

Run Interview mode first to build a hypothesis, then Research mode to validate and enrich with real customer language. Flag any gaps between founder assumptions and actual customer signals.

---

## Step 4: Build the Profile

After gathering inputs from either mode, synthesise into the ICP profile.

Read `references/icp-template.md` for the exact output format.

The profile must include all of these (each explained in the template):
1. **Who they are** — not just demographics, but situation and identity
2. **Primary pain** — the problem that keeps them up at night, in their words
3. **What they've tried** — alternatives and why those didn't work
4. **Desired outcome** — what "after" looks like for them
5. **Objections** — why they hesitate, what makes them skeptical
6. **Their language** — exact phrases, words, and framings they use
7. **Where they hang out** — platforms, communities, publications they trust
8. **Buying triggers** — what pushes them from "considering" to "buying"

---

## Step 5: Validate

After building the profile, present a validation check:

Write 2 sentences as if speaking directly to this customer about their primary pain — one that should resonate, one that shouldn't.

Ask: *"Would your ideal customer read that first sentence and think 'this person gets me'?"*

- **Yes** → save
- **Close but off** → ask what feels wrong, adjust, retest
- **Not right** → dig deeper on language and pain

Cap at 3 rounds.

---

## Step 6: Save Output

Write `brand_context/icp.md` using the format in `references/icp-template.md`.

If the file already existed, show what changed and confirm before overwriting.

After saving, show the user actual excerpts — the primary pain statement and 3-4 key phrases from their language section.

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

---

## Self-Update

If the user flags an issue with the output — wrong audience, bad language, missed segment, incorrect assumption — update the `## Rules` section in this SKILL.md immediately with the correction and today's date. Don't just log it to learnings; fix the skill so it doesn't repeat the mistake.

---

## Troubleshooting

**Founder describes the customer too broadly:** Push for specifics. "Entrepreneurs" is too broad. "Solo founders making $5-15k/month who do their own marketing" is useful.
**Can't find customer language online:** Ask the founder to share actual emails, DMs, or support tickets from customers.
**Multiple distinct segments emerge:** Build the primary ICP for the most valuable segment. Note secondary segments at the bottom of the file for future reference.
**Positioning not loaded:** Proceed, but note that the positioning angle would help prioritise which segment to focus on.
**ICP and positioning conflict:** Flag it. The ICP might reveal the positioning angle needs adjustment — that's valuable signal.
