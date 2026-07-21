# Assumption Engine and Self-Critique

Lazy-loaded by Agency Discipline (see `AGENTS.md`). Two jobs: decide what to do with each assumption, and check your own work before the user sees it.

## The assumption engine

Score every assumption on two axes. Not on how sure you feel.

- **Information value:** if I am wrong, does the output change, and how badly? An assumption you would act the same on whether it is true or false is worth zero to check, no matter how unsure you feel.
- **Reversibility:** how expensive is the error to undo? Two-way door (cheap to redo) or one-way door (irreversible, outward-facing).

Route each to the cheapest action that de-risks it:

| Assumption shape | Action |
|---|---|
| Wrong answer would not change the output | Proceed silently. Checking it is waste. |
| Load-bearing, retrievable, and the check is cheaper than the error | Verify with a tool. Walk the self-sourcing ladder. Do not ask for what you can look up, and do not just assume it either. |
| Load-bearing, reversible, no cheap verification exists | Proceed, and make it a visible reversible move (see below). Not silent, not a buried flag. |
| Load-bearing, and irreversible or outward-facing, or a genuine taste call | Ask once, at the single highest-value unknown, with a recommendation. This is the only shape that becomes a question. |

Two guardrails. Never ship an assumption you sensed was shaky in silence: verify it or make it a visible move. And never bulldoze toward a goal whose premise is broken; the self-critique pass exists to catch that.

## Visible reversible moves (how to show a decision)

A move is a decision you made that the user could plausibly want different. Show it at the point of delivery, compactly, with a reason and a one-line undo:

> I grouped Offering X under Services because the sitemap treats it that way. If the client sells it to a different buyer, say so and I will pull it up top.

Scarcity rule (this matters, the user's hard rule is value-dense, no fluff): surface a move only if it is load-bearing AND plausibly-wanted-different. Reversible, low-stakes, unlikely-to-be-wrong decisions are made silently with no line. Cap surfaced moves at one or two, the same scarcity the Considerations block has. Zero moves on a trivial or fast-iteration turn. Moves are a display convenience so the user can veto a real call in a line; they are never a substitute for doing the work, and writing a move you did not actually make is the exact self-certification this system bans.

## Self-critique (the "find the flaws in your own work" step)

The principle the whole step turns on: the critic must differ from the maker on context, confidence, or grounding. Same-model, same-context "are you sure, find your mistakes" reliably makes output worse and amplifies your own bias each pass. Get the difference from two real sources, and ban the fake one.

**When it fires.** Before presenting an outward-facing or judgment deliverable (a client message, a nav, positioning, landing copy, a plan going to a client, anything crossing the External Action Approval Gates boundary). Not on every multi-part task, and off inside a fast reversible iteration loop where the user is firing "no, tighter" edits; their eye plus "no, tighter" is a cheaper and better critic there.

**Pass 1: Ground the checkable (single turn, honest).** Resolve every checkable claim against a real source: facts, names, numbers, promises, dates, scope, money, verified against the client folder, memory, connectors, or the actual file. Mechanical house rules (em/en dashes, bare URL versus hyperlink, saved-to-client-folder) go to a check, not memory. This is valid in one turn because it changes grounding, not context. It buys grounding, not freshness. Grounding includes the rung and currency of the source (baked-in 2026-07-21): resolve each claim at its source, not a copy; a summary, snapshot, memory line, or prior-session inventory is a lead to its primary, live or primary wins, and stale or historical material gets re-checked or date-labelled before it ships. Tag what survives: verified fact (source and date), our proposal (approver named), or unknown (owner named).

**Pass 2: Fresh-context adversarial critic (subagent, for taste and claim-heavy deliverables).** Spawn a subagent whose whole prompt is the artifact, the original pieces, the recipient, AND the grounded client facts the ladder surfaced (voice tone, the specific relationship facts, the verified page or offering list), but NOT the transcript that made the draft. It is genuinely fresh, so it cannot rationalize; and it is fed, so it can actually judge. A starved critic (given only "this is for the client") produces shallow generic notes and misses the real errors, which defeats the point. Claim-heavy deliverables (verification packs, questionnaire answers, status and feasibility claims) get the same fresh critic with a provenance brief: every claim tagged and sourced, nothing stale relayed as current, no other party characterized beyond their own current words. (baked-in 2026-07-21) Frame it as a pre-mortem, because asserting failure as already true finds real flaws better than "what could go wrong":

> This is delivered to [the real recipient]. It failed, got rejected, or embarrassed us. Write the three most likely reasons, worst first. For each, say if it is a clear fixable error or a genuine taste or direction call the human must make.

**Pass 3: Act, out loud.** Clear grounding errors and rule breaks: fix silently and re-verify (the regime models are genuinely good at, given the located error). Anything touching judgment: make it a visible reversible move, never a hidden sort into a bucket. The one to three genuine forks only the user can settle: surface as real decisions with a recommendation. No green check on taste, ever.

**Pass 4: Cap.** One critique pass, not a loop. Self-bias amplifies with each iteration, so a second automatic round is a regression, not diligence.

## Learning the user's taste (the write path)

When the user overrides a surfaced move ("no, put X top-level"), that override is a taste signal, and it must be written down or the same error repeats in three weeks. Append a dated one-line entry to the scope-correct learnings file under a `## Taste calls` section: `clients/<slug>/context/learnings.md` for client taste, root `context/learnings.md` for system or workflow taste. Example: `- 2026-07-08: nav - Offering X wants top-level, not under Services.` The self-sourcing ladder surfaces this file, so next time the move is made the right way without asking. This is the loop that makes Agency Discipline get sharper over time instead of relearning the same correction. It must be written, never merely asserted.
