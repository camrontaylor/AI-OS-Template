# Divergence: widen before you narrow

Lazy-loaded depth for the Thinking Discipline's widen-before-you-narrow step
(AGENTS.md). The always-on posture already tells you to reach past the first
plausible answer and then commit. This file is *how*, and *when* it is worth
spending real compute on. Absorbed from UditAkhourii/adhd (2026-07-23), whose
divergent-ideation engine this operationalizes. The frame techniques it lists
already live in AI-OS, so they are cited below, not duplicated.

## The loop

Two phases, kept apart. Mixing them is what kills idea quality, because the
critic strangles the generator.

1. **Diverge** (generate, no judging). Produce a wide, varied candidate set
   fast. Suspend evaluation. Do not stop at the first three; the first three
   are the obvious ones everyone already thought of. Push into the awkward
   middle where the interesting options live.
2. **Converge** (select with judgment). Cluster, kill the dead ones, name the
   few worth pursuing, flag the traps with one-line reasons, call out the one
   non-obvious-but-viable pick explicitly, and commit.

Divergence rewards "yes, and." Convergence rewards "no, because." Do them at
once and you get neither.

## Techniques to force breadth (already in AI-OS, do not duplicate)

The frames are the same lateral moves AI-OS already carries. Use them from
their existing homes:

- **`q-unstuck` skill:** assumption autopsy, inversion, first principles,
  remove the load-bearing assumption, push to extremes. It fires on a wall, but
  the moves are exactly the ones you want here.
- **`context/thinking/model-catalog.md`:** 150+ mental models, including
  cross-domain transplant and frame-shifting (how would a hardware person, a
  regulator, a ten-year-old, a competitor trying to make it fail, solve this).

Reach for a handful per problem, not all of them. Free-associating drifts back
toward the familiar; the structured frames push attention into corners it would
not go on its own.

## When to escalate to isolated parallel exploration

Most turns, the widen-then-commit happens inside your own reasoning and the
output is just the committed call. That is the default, and it stays cheap.

Escalate to genuinely isolated parallel exploration only when the call is both
**high-stakes and open-ended**: an irreversible design or architecture choice,
a name or API surface you will live with, a strategy or positioning fork, or an
explicit "give me a few ways to...". On those, the anchoring problem is real:
one mind walking one context anchors on whatever it thought first, and asking
that same context for "more angles" mostly rationalizes the first one.

The fix is mechanical, not a prompt (this is the one genuinely novel piece
absorbed from adhd): spawn several subagents (the `Task` or `Workflow` tool)
that each explore the problem under a different frame with **zero shared
context**, so they cannot anchor on each other, then run a **separate** critic
pass over the pooled ideas to score, cluster, prune the traps, and deepen the
survivors. Generator and critic must be different calls with opposite postures,
never one call trying to do both.

Cost is real: isolated fan-out plus a critic runs roughly 2x the time and
output of a single pass. That is why it is reserved for high-stakes, open-ended
calls and is never the default. On anything smaller, widen in your head and
commit.

## Output shape (this is where brevity is won)

After diverging, converge hard and hand over the *decision*, not the search.

- Lead with the committed call or recommendation.
- Name the one non-obvious-but-viable option explicitly.
- Flag the traps in one line each.
- Keep the wide set in your reasoning; surface only what changes the user's
  decision.

Anti-patterns: convergence disguised as divergence (ten minor variants of one
idea); weird-for-weird's-sake with no convergence; a wall of equally-weighted
prose hiding the good idea; refusing to commit. After diverging, take a
position.
