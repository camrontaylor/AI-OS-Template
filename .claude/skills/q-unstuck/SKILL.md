---
name: q-unstuck
description: "The antidote to a roadblock or wall: refuses to take no for an answer, then runs lateral-thinking techniques (assumption autopsy, inversion, first principles, and more) until the wall cracks or is proven load-bearing."
when_to_use: 'Invoke when the request sounds like: "/unstuck", "I am stuck", "this seems impossible", "we hit a wall", "they said no", "dead end", "out of options", "work around this". Agents: use it on yourself before reporting a dead end'
metadata:
  version: 0.1.0
---

# Unstuck, the roadblock antidote

Turns "impossible" into angles. Classifies the wall, runs the right lateral-thinking techniques against it, and does not stop at the first mediocre workaround. Output is either a set of viable angles with next actions, or an honest "this wall is load-bearing, reroute the goal."

**Two modes:**
- **User-invoked**: someone is stuck and asks. Full 7-step workflow below.
- **Agent fast path**: YOU (the agent) hit the wall mid-task. See [Agent fast path](#agent-fast-path), run it before telling the user something cannot be done.

## The mental model: walls have types, and the type picks the crowbar

"Impossible" is a claim, not a fact. It almost always decompiles into something weaker: *expensive*, *against the rules*, *nobody has done it*, *I do not know how*. Only *actually impossible* (physics, math, arithmetic) ends the session, and it ends it honestly.

| Wall type | What "impossible" actually means | Lead techniques (see `references/techniques.md`) |
|---|---|---|
| **Assumption** | An inherited belief nobody re-verified | T1 assumption autopsy, T3 first principles |
| **Framing** | The goal is stated in a way that excludes the answer | T4 altitude shift, T2 inversion, T5 work backwards |
| **Gatekeeper** | A person or org said no | T10 interrogate the no, T6 analogical transfer |
| **Tool/tech** | "X does not support Y" | T9 SCAMPER (substitute the primitive), T6 analogical transfer |
| **Resource** | Not enough time, money, people | T7 constraint toggling, T8 provocation |
| **Physics/math** | Actually impossible (rare) | Honest exit, reroute the goal, the wall is load-bearing |

## Step 1, capture the wall

Get from the user (one structured message, do not round-trip):

- **The goal**: what are you ultimately trying to do? (Not the blocked step, the job it serves.)
- **The wall**: what exactly blocks it?
- **Attempts**: what have you already tried?
- **The source of the no**: who or what said no? Physics? A vendor's docs? A person? An error message? Your own assumption?
- **Stakes plus deadline**: how much does breaking this wall matter, by when?

If the user says "I have tried everything," ask for the list. "Everything" is usually 2 to 3 things.

## Step 2, classify the wall

Use the taxonomy above. State the classification and why. Two rules:

1. **Decompile the word "impossible."** Restate the wall without it: "expensive," "undocumented," "they refused," "I do not know how." The restatement usually names the wall type.
2. **Restate the problem at two altitudes** before proceeding, one level more abstract (*what job is this serving?*) and one level more concrete (*what literally fails, at which exact step?*). Many walls dissolve at a different altitude; if one does, say so and skip to Step 6.

## Step 3, assumption autopsy (always runs)

Run T1 from `references/techniques.md` regardless of wall type: enumerate every assumption embedded in the problem statement, mark each **verified fact** vs **inherited belief**, and attack the beliefs. Most walls die here, and the ones that do not are at least correctly framed for Step 4.

## Step 4, run the triaged techniques

Pick 2 to 3 more techniques by wall type (lead techniques in the table; full triage guidance in `references/techniques.md`). For each, generate 2 to 3 angles.

**Rules of generation:**
- **Quantity gate: minimum 10 angles total before evaluating any.** The first workaround is usually mediocre. No judging, no feasibility talk, no "but" during generation.
- Angles must be **different in kind**, not variations. Three flavors of "ask again nicer" is one angle.
- Wild angles are welcome at this stage; they get filtered in Step 5, and they often seed the viable ones.

## Step 5, triage the angles

Sort every angle into:

- **Try now**: feasible with what is in hand; has a concrete first action.
- **Needs research**: viable if an unknown checks out, route to the `deep-research` skill.
- **Wild but worth 30 min**: low odds, trivial cost, asymmetric payoff.
- **Dead**: violates a real constraint (say which).

## Step 6, commit

- Pick **1 to 3 angles** with a concrete next action each.
- If 2 or more viable angles are mutually exclusive, this is a genuine fork the user owns: surface it as one high-value question with your recommendation (per AGENTS.md Agency and Thinking Discipline), or route to `q-question` when it needs evidence weighing.
- If NOTHING survived triage and the wall is physics/math class: say so plainly. **"The wall is load-bearing, reroute the goal" is a legitimate, successful output.** Recommend what the rerouted goal looks like.

## Step 7, archive

Archive nontrivial walls to AI-OS project notes so the single memory store holds them (never a hidden dotfolder, and never inside this skill's own folder, updates re-sync from source and wipe it). Write to `projects/q-unstuck/{YYYY-MM-DD}_{slug}.md`:

```markdown
# Wall: <one-line>

**Date:** YYYY-MM-DD
**Invoked by:** user | agent
**Wall type:** assumption / framing / gatekeeper / tool / resource / physics
**Goal it blocked:** <one line>

## The wall as stated
<verbatim>

## The wall decompiled
<restated without "impossible">

## Assumptions attacked
- <belief> -> <held / broke>

## Techniques run
T1, T4, T7 - <one line on what each surfaced>

## Angles (all of them)
1. <angle> - try now / research / wild / dead
2. ...

## Committed
**<the angle(s) chosen>** - next action: <concrete step>
(or: "Wall is load-bearing, rerouted goal to <X>")

## Outcome (fill in later)
<did the angle work?>
```

Append to `projects/q-unstuck/INDEX.md` (create if missing):

```markdown
- 2026-07-21 - [<wall>](./<filename>.md) - <type> - **<committed angle or "rerouted">**
```

Over time this becomes a pattern library: grep it to learn which techniques actually crack *your* walls, and which wall types recur (a recurring wall is usually one unexamined assumption upstream).

## Agent fast path

For when YOU (the agent) hit the wall mid-task. Trigger condition: an API or tool does not support what is needed, an approach has failed twice, or you notice a "that is not possible," "unfortunately," or "the only option is" sentence forming in your response.

**Before reporting a dead end to the user, run inline (no interactive capture, you already have the wall in context):**

1. **Classify** the wall (taxonomy above), one line.
2. **Autopsy**: list the 3 to 5 assumptions in your framing; mark inherited beliefs. ("The cursor must be a text character." "This must happen client-side." "The API is the only way in.")
3. **Run 2 techniques** matched to the wall type, generate 5 or more angles minimum for inline recoveries. **If you end up reporting a dead end to the user, the full 10-angle gate applies first**, a dead-end report is exactly the moment the gate exists for.
4. **Then either:**
   - a viable angle exists, **proceed with it** (tell the user the wall you hit and the angle you took), or
   - nothing viable, report the dead end **with the angle inventory attached**: what you tried, what you considered, why each died. Never a naked "that is not supported."
5. **Archive** the run (Step 7 format, `Invoked by: agent`) when the wall was nontrivial, skip archiving for sub-minute walls.

The success metric: the user stops seeing dead-end reports without tried-angles receipts. This is the AGENTS.md Blocker Research Gate mechanism, unstuck is how you return options instead of a bare "no."

## Context Needs

| File | Load level | Purpose |
|------|------------|---------|
| `references/techniques.md` | Full when running Steps 3 to 5 or the fast path | The 10-technique inventory, triage table, and worked examples. |
| `context/learnings.md` | `## q-unstuck` section | Apply prior feedback about which techniques crack recurring walls and archive habits. |
| `projects/q-unstuck/` | Scan when a wall feels familiar | Prior wall archives, grep for the recurring assumption before starting fresh. |
| `context/MEMORY.md` | Summary when relevant | Active threads and constraints that make an angle viable or dead. |

## Dependencies

| Skill | Required? | What it provides | Without it |
|-------|-----------|------------------|------------|
| `deep-research` | Optional | Runs down "needs research" angles from Step 5 triage. | Note the unknown and hand the research angle back for the user to run. |
| `q-question` | Optional | Weighs evidence when a fork needs a judged call. | Surface the fork as one recommendation-led question. |
| `memory-recall` | Optional | Finds prior walls of the same type. | Grep `projects/q-unstuck/` directly. |

No external services, MCP servers, or `.env` keys. Fully self-contained.

## Guardrails

- **A no from consent, law, or ethics is a real no.** This skill routes around technical and imagination walls, not people's boundaries. If the wall is "they said no and meant it," the move is interrogating whether there is a *different door they would happily open* (T10), never pushing on the closed one.
- **Time-box: 20 to 40 minutes.** This is a crowbar, not a philosophy seminar. If the sprint ends without a crack, archive what was tried and either schedule a revisit or reroute.
- **Honest exit beats toxic positivity.** Declaring a wall load-bearing after a real attempt is a win, it converts an ambient frustration into a clear reroute.

## Notes on quality

- **The restatement is half the work.** Most "impossible" problems are impossible *as stated*. Two-altitude restatement (Step 2) before any technique, always.
- **Do not let the quantity gate become theater.** 10 angles that are secretly 3 angles in costumes fail the gate. Different in kind.
- **Attempts list beats attempts vibe.** "I have tried everything" means get the actual list. The gap between "everything" and the list is where the answer usually lives.
- **Archive even the failures.** A wall that did not crack today, with its angle inventory, is a 5-minute revisit when the landscape changes, instead of a from-scratch session.
