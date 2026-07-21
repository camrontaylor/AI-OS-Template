# Future idea: champion/challenger skill refinement (SHELVED)

**Status:** shelved 2026-06-16. Not built. Revisit only if the manual `triage → review`
refinement ever feels slow.

## The idea
A **pull-only** loop that lets a live skill get better over time without waiting on the user
to drive it:
- **Champion** = the current skill/output.
- **Challenger** = a variant the system researches and drafts on its own.
- **Judge** = an independent critic comparing both against *real past work*
  (`projects/`, `context/memory/`, `learnings.md`, transcripts), trying to break the challenger.
- Only convincing challengers reach the user's review (the existing `review/` gate). Nothing
  changes without a yes; the champion stays until clearly beaten.

## Why it fits AI-OS
Rides existing bones: markdown-as-program (`SKILL.md`/`learnings.md`), the `review/` gate, the
cron runtime, git as reversible memory, human approval. It's the active engine for the passive
"log feedback after deliverables → `learnings.md`" intent AI-OS already has.

## Why it's shelved (the guardrail)
It fits ONLY as **pull** (dormant; the user points it at one skill), not **push** (always-on).
Always-on would violate AI-OS's core: **restraint** (no unasked work), **stability** (skills
don't shift under you), and **load-reduction** (no review backlog).

## Imported discipline (the useful bits from karpathy/autoresearch)
- Ground "simulations" in **real past artifacts**, not invented examples (the honest version
  of "no synthetic data").
- **Independent/adversarial judge** — avoid the model grading its own homework (Goodhart).
- Keep champion until clearly beaten; log rejected variants so dead-ends aren't retried.
- **Comparative + provisional** judgment, never a frozen success metric (don't ossify
  evolving craft).
- **Skip** the fixed 5-min budget + autonomous-overnight loop — those need a cheap auto-metric
  the user's domains (positioning, copy, delivery) lack.

## When to build
After the library settles, and only if `triage → review` becomes a bottleneck. Needs a design
pass on two things: what "the metric" is for a non-ML domain, and where the outcome signal
comes from.
