# AI-OS Brand Voice Playbook

Read this when running **Mode 3: Build → Playbook** (the deep opt-in variant).
Use it when the user is starting from zero, has no usable content samples, and
wants a thorough voice extraction rather than a quick 8-question setup. Runs
in ~10-15 minutes.

## The 80/20 Formula

A brand voice that actually sounds like a person — not a template — is roughly:

- **80% Personality** — how they naturally think, speak, and react. Anti-corporate
  stance, origin story, the real "why this matters", communication reflexes.
- **20% Strategic Framework** — who they're talking to, what they're comfortable
  saying, and the language patterns they use to say it.

Ask personality questions first. Strategy questions lean on personality answers,
not the other way around.

**Ground rule for this flow:** every answer is raw material. You are *deriving*
the voice profile from what the user says. You are not pattern-matching their
answers onto pre-written archetypes. See the Synthesis Instructions at the
bottom.

---

## Step 1 — Personality (80%)

Ask these five questions one at a time. After each, offer:
*"Optional: paste an example of you saying something like this — a post, a
message, a line from a call. It goes straight into your samples."*

Anything they paste here is captured verbatim for `samples.md` during synthesis.

### Q1. Anti-Corporate Stance
**Question:** "What annoys you most about how business is typically done in
your industry? What do people in your space say that makes you roll your eyes?"

*Example answers from the playbook:*
- "I hate how everyone talks about 'synergy' and 'leveraging opportunities' when
  they really mean 'let's actually get stuff done.'"
- "Everyone is selling the dream but nobody's showing the actual work."
- "The whole 'thought leadership' thing — it's just recycled LinkedIn takes in a
  blazer."

*What this feeds:* Their **never list**, their anti-patterns, and the edge that
makes them sound different from the crowd. Whatever they say here maps directly
to the "Words/Phrases to Avoid" section and shapes the opening of their voice
summary.

### Q2. Problem-Solving Style (multiple choice)
**Question:** "When someone comes to you with a problem, how do you naturally
respond? Pick the closest — or describe your own."

- **Collaborative** — "Let's figure this out together"
- **Directive** — "Here's exactly what you need to do"
- **Experiential** — "I've been there too, here's what worked"
- **Diagnostic** — "Let me ask you a few questions first"

*What this feeds:* Their relationship stance — guide, teacher, peer, consultant,
challenger. This shapes sentence structure and POV ("we" vs "you" vs "I").

### Q3. Communication Preference (multiple choice)
**Question:** "In real conversations, are you more…"

- **Direct and blunt** — cut through the BS
- **Diplomatic but honest** — gentle truth-telling
- **Story-driven** — explain through examples
- **Question-focused** — get people thinking

*What this feeds:* Tone spectrum position (warm ↔ direct, reserved ↔ bold) and
rhythm patterns.

### Q4. Professional Background / Origin Story
**Question:** "What's the most interesting part of your journey that shaped how
you see your industry? Not the LinkedIn version — the real one."

*Example answers from the playbook:*
- "I studied engineering but never worked as one."
- "I was the customer service rep who saw what really frustrated clients."
- "I built my business while working corporate and hated the rules."

*What this feeds:* Core energy, credibility source, recurring themes. Often
surfaces the signature phrases they don't realise they use.

### Q5. "Why This Matters" Moment
**Question:** "What drives you personally about the work you do? Not the mission
statement — the real reason, the one you'd tell a friend at a bar."

*Example answers from the playbook:*
- "Freedom to work how I want."
- "Helping people escape the busy work that's killing their passion."
- "Proving there's a better way than what everyone else is doing."

*What this feeds:* The **opening line of the voice summary** in `voice-profile.md`.
This is the emotional anchor — every other section should be consistent with it.

---

## Step 2 — Strategic Framework (20%)

Four questions. **Skip Q1 if `brand_context/icp.md` already exists. Skip Q2 if
`brand_context/positioning.md` already exists** — same skip rule as
`build-questions.md`.

### Q1. Ideal Client Pain *(skip if icp.md exists)*
**Question:** "Who are you talking to, and what's the exact pain they're feeling
right now that makes them open your email or click your post? Be specific —
not 'entrepreneurs', but what kind, at what stage, stuck on what?"

*What this feeds:* Audience targeting, confidence zones, vocabulary level.

### Q2. Audience Personality Fit *(skip if positioning.md exists)*
**Question:** "What tone resonates with your audience? What kind of voice do
they already trust? What would immediately turn them off?"

*What this feeds:* Tone spectrum calibration against the audience, not just
against the user's own instincts.

### Q3. Content Comfort Zone
**Question:** "When you're creating content, you feel most authentic when you're…"

- Sharing personal stories and lessons
- Breaking down complex topics simply
- Calling out industry problems
- Providing step-by-step solutions
- Something else — describe it

*What this feeds:* **Content pillars** and the natural voice mode they should
default to on any platform.

### Q4. Natural Language Patterns
**Question:** "Think about how you actually talk. Do you…"

- Use "we/us" or "you/I"?
- Ask questions or make statements?
- Use technical terms or everyday language?
- Tell stories or stick to facts?
- Use any words or phrases so often that friends tease you about them?

*What this feeds:* POV, vocabulary level, rhythm patterns, and — critically —
their **signature phrases** for `voice-profile.md` and `samples.md`.

---

## Step 3 — Example Collection

This is non-negotiable for Playbook mode. The whole point of going deep is to
ground the profile in real language.

Ask:
> "Last thing — can you give me 3-5 real sentences or phrases you actually use?
> These can be things you say to clients, lines from your own posts, bits from
> emails, or even stuff you catch yourself saying in calls. The more real, the
> better. Three options:
> 1. **Paste them here** — anything from Slack, emails, drafts, notes
> 2. **Link me to posts** — I'll pull the content (WebFetch/Firecrawl)
> 3. **Skip** — I'll build from your answers above alone, but the profile will
>    be less grounded"

**Handling each path:**
- **Pasted examples** → capture verbatim; these feed `samples.md` directly with
  source noted as "user-provided during playbook interview".
- **Links** → use WebFetch first, fall back to `tool-firecrawl-scraper` if the
  site blocks. Extract representative sentences the same way Extract mode does.
- **Skip** → note in synthesis that samples are derived from answers only, and
  flag `samples.md` as "light — enrich later" in the output summary.

Anything they pasted about signature phrases, anti-corporate rants, or "why this
matters" in Step 1 *also* flows into `samples.md`. Don't make them repeat
themselves.

---

## Synthesis Instructions

Use the same 7-step synthesis process as `build-questions.md` (Extract core
energy → Tone spectrum → Linguistic habits → Vocabulary rules → Confidence zones
→ Example phrases → Platform adaptations). On top of that, the Playbook flow
has three hard rules:

### Rule 1 — Derive, don't template

Every Core Voice Characteristic in `voice-profile.md` must be named from the
user's actual words and reasoning. **Never default to labels like "Practical
Simplifier", "Collaborative Efficiency Expert", or "Diplomatic Truth-Teller"
unless the user's answers genuinely earn them.** If the answers don't clearly
support a label, invent one that does.

Check before writing each characteristic: *"Which specific answer made me pick
this label?"* If you can't answer that in one sentence, the label is wrong.

### Rule 2 — Use the example brief as structural reference only

The playbook's example brief (if the user has seen one) shows what the output
sections *look like* when filled out well: characteristics, signature phrases,
never list, platform-specific guidelines, content pillars. It is not a fill-in-
the-blanks template. Every value — every phrase, every rule, every example —
comes from the user's answers and pasted samples. Zero verbatim copying from
the example brief.

If you catch yourself about to write a phrase that came from the example brief
and not the user, stop and rewrite it from their answers.

### Rule 3 — Explicit mappings

Two mappings are non-negotiable:

- **Anti-corporate stance (Q1) → "Words/Phrases to Avoid" and the never list.**
  Every corporate cliché the user rolled their eyes at becomes an entry. The
  emotional charge in their answer shapes the tone of the never list (mild
  distaste vs. outright ban).
- **"Why this matters" moment (Q5) → the opening line of the voice summary.**
  The voice-profile.md opener should reflect the user's real motivation in
  their own phrasing, not a mission-statement paraphrase. If they said
  "helping people escape busy work that's killing their passion", the summary
  opens in that energy — not "empowering entrepreneurs to scale efficiently".

---

## Voice Test (Playbook-Flavoured)

After synthesis, run the standard 3-sample voice test from `SKILL.md` Step 5
with one addition specific to Playbook mode:

**Playbook sample:** Write one short LinkedIn post in their voice about
something they said they genuinely care about (pulled from Q5), using at least
two of their signature phrases from Q4 or Step 3 examples. This is the proof
that the profile actually captured their voice, not a generic version of it.

Ask: *"Does this sound like you when you're not overthinking it? Specifically
— does the way it opens match how you'd actually start that thought?"*

Same 3-round cap. If still off after round 3, save the current version and
offer to refine over time.

---

## Quick Synthesis Check (Playbook)

Before saving, verify:

- [ ] Every Core Voice Characteristic traces back to a specific answer
- [ ] The voice summary opening line reflects the user's Q5 answer in their
      own energy
- [ ] The never list covers every corporate cliché from Q1
- [ ] Signature phrases are the user's actual phrases (Q4 + Step 3), not
      paraphrases
- [ ] `samples.md` contains the examples they pasted during the interview
- [ ] No verbatim phrasing from the playbook's example brief appears in the
      output
- [ ] The playbook LinkedIn sample used at least two of their signature phrases
