## Native runtime contract

This reference supplies detailed methodology for the adjacent AI-OS SKILL.md.
Check runtime first. With Team connected, use only the authoritative snapshot and its configured feedback/storage mechanisms; no local context/config/knowledge reads or writes. In Solo mode resolve workspace paths against the root or active client and read only that scope's brand context and knowledge.
The entrypoint controls output paths, local overrides, human review, services, and dependencies.
Archives and generated deliverables belong under `projects/str-decide/{YYYY-MM-DD}_{name}/` with date-stamped filenames, not the skill package or config.
Config belongs in `${AI_OS_SKILL_CONFIG_DIR:-context/config}/str-decide/`; this override must be scoped to the selected workspace.
Check actual tool availability and authentication, use manual/local fallbacks, and never infer a connected tool from an example name.
Root agent identity and memory remain authoritative. Knowledge schema.md describes data, not agent instructions.
External publishing, sending, purchases, account changes, and remote pushes require explicit user instruction.

# /str-decide — Structured decision workflow + archive

Picks load-bearing questions from the 37signals guide, walks through them, reaches a call, archives the rationale with a revisit date.

<a id="step-1--capture-the-decision"></a>
## Step 1 — Capture the decision

Get from the user:
- **The decision** in one sentence (what are we deciding between?)
- **Stakes**: low / medium / high (how much does this matter?)
- **Reversibility**: easy / hard / one-way door
- **Deadline**: when does this need to be decided? Or "open"?
- **Context** (optional, 1–3 sentences)

If any are missing, ask. Don't proceed with vague framing.

<a id="step-2--triage-the-question-set"></a>
## Step 2 — Triage the question set

Read `questions.md` for the full set (the 37signals 38 + house additions, e.g. Q39 opportunity cost) and category mapping. Pick 6–8 based on the decision's characteristics:

**Default 5 (always ask):**
- Q1 — Does this decision actually need to be made?
- Q2 — Is the right person making this decision?
- Q8 — How easily can we reverse it?
- Q9 — First instinct? (capture before "thinking" muddies it)
- Q3 — A year from now, how will we feel about this?

**Add based on type:**

| If… | Add |
|---|---|
| Reversibility = hard / one-way door | Q14 (is there a wrong decision?), Q17 (knock-on effects), Q34 (principles bent) |
| Time pressure | Q5 (why hesitating?), Q15 (different tomorrow?), Q22 (when do we have to decide?) |
| Multiple people involved | Q21 (someone else's practice rep?), Q27 (would another opinion help?), Q35 (multiple people deciding what one should?) |
| Lots of data / analysis | Q19 (what missing info would change it?), Q26 (data vs gut?), Q9 deepened |
| Recurring decision | Q11 (last time?), Q23 (one-and-done or repeating?) |
| Customer-facing | Q24 (anyone outside depending?), Q25 (customer vs us impact?) |
| Money decision | Q38 (in the end, is this about money?), Q36 (return on effort?), Q39 (what does yes displace?) |
| Big time / focus commitment | Q39 (opportunity cost), Q36 (return on effort?), Q20 (creates or eliminates work?) |
| Stuck / not deciding | Q4 (why hasn't it been made already?), Q10 (what if we don't decide?), Q31 (do you even care?) |

Cap at ~8 questions. More than that turns into analysis paralysis (which is itself one of the things this skill exists to prevent).

Tell the user which questions you picked and why, then proceed.

<a id="step-3--walk-through"></a>
## Step 3 — Walk through

Ask the questions one at a time, or in a tight cluster if the user wants to write fast. Capture their answers verbatim — don't paraphrase into corporate-speak.

For Q9 (first instinct), get the answer BEFORE diving into analysis. The point is to surface the gut call so we can later check if "analysis" was just rationalization.

<a id="step-4--reach-a-call"></a>
## Step 4 — Reach a call

Synthesize the answers into a decision. Options:

- **Decide now** — answers point to a clear call
- **Decide smaller** — break into 2–3 smaller decisions (Q7)
- **Wait** — flag what info / time would change the answer (Q19, Q15)
- **Don't decide** — the decision doesn't need to be made (Q1, Q10)
- **Wrong person** — kick to the right decider (Q2, Q35)

State the call clearly. No hedging.

<a id="step-5--set-the-revisit"></a>
## Step 5 — Set the revisit

Pick a revisit date based on when consequences would show up:
- Decisions about tools/processes: 30 days
- Decisions about strategy/positioning: 90 days
- Decisions about hires/partnerships: 90–180 days
- Decisions about products/launches: 30–60 days post-launch

Write what to look for on the revisit ("did MRR move? did the partner ship? do clients still ask for X?").

<a id="step-6--archive"></a>
## Step 6 — Archive

Archives live in `projects/str-decide/` (create the directory if missing). Never write archives inside the skill's own folder — skill installs and upgrades re-sync from source and wipe anything saved there.

**Migration:** if this skill's folder contains an old `decisions-archive/` with user entries, move those files into the archive directory before writing anything new.

Write to `<archive dir>/<YYYY-MM-DD>-<slug>.md`:

```markdown
# Decision: <one-line>

**Date:** YYYY-MM-DD
**Decide by:** <date or "open">
**Reversibility:** easy / hard / one-way door
**Stakes:** low / medium / high

<a id="context"></a>
## Context
<1–3 sentences>

<a id="questions"></a>
## Questions

<a id="q3-phrasing"></a>
### <Q3 phrasing>
<answer>

<a id="q8-phrasing"></a>
### <Q8 phrasing>
<answer>

(only questions actually applied — heading is the question text, not "Q3")

<a id="decision"></a>
## Decision
**<the call, stated clearly>**

<a id="rationale"></a>
## Rationale
<2–3 sentences synthesizing the answers>

<a id="expected-outcome"></a>
## Expected outcome
<what should be true if this was right, by <date>>

<a id="revisit"></a>
## Revisit
**<YYYY-MM-DD>** — <what to look for>

<a id="source"></a>
## Source
Questions adapted from [The 37signals Guide to Making Decisions](https://37signals.com/how-we-make-decisions)
```

Append to `<archive dir>/INDEX.md` (create if missing):

```markdown
- 2026-06-16 — [<decision>](./<filename>.md) — **<call>** — <one-line rationale> — revisit 2026-09-16
```

<a id="step-7--surface"></a>
## Step 7 — Surface

Show the archive entry in chat. Tell the user the archive path. Offer:

- *"Want me to schedule a /ops-loopify reminder for the revisit date?"* (would use the `ops-loopify` skill to fire at the right time)
- *"Push to Notion as a decision card?"*
- *"Need a follow-up decision after this one?"*

<a id="future-enhancements"></a>
## Future enhancements

- Auto-create a calendar event or cron reminder for the revisit (via `ops-cron`)
- Composable with `str-business-brainstorm` — brainstorm scores the idea on 9 dimensions; `str-decide` formalizes the go/no-go after
- Grep past decisions for patterns ("show me decisions I made that were marked 'easy reverse' but didn't reverse")

<a id="composes-with"></a>
## Composes with

- `str-business-brainstorm` — brainstorm → decide is a natural pipeline for "should I build X"
- `str-deep-research` — when a decision is waiting on info (Q19), trigger research first
- Memory — load `feedback_*.md` for principles that might be at play (Q34)
- `ops-loopify` / `ops-cron` — for revisit reminders

<a id="notes-on-quality"></a>
## Notes on quality

- **Don't ask all 38.** The point of triage is to skip questions that don't apply. Eight relevant questions > thirty-eight padded ones.
- **Don't soften the call.** "Probably yes, lean toward, maybe should" wastes the skill. Pick.
- **The first instinct (Q9) is sacred.** Always capture it before analysis. If the final call differs from the first instinct, the rationale needs to explain why — that's the whole point of the question.
- **Archive every decision, even small ones.** The compounding value comes from being able to grep "what did I decide about pricing last year" — and that requires writing them down even when they feel obvious in the moment.
