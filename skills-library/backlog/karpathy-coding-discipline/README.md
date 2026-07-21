# Karpathy Coding Discipline (provenance only)

This folder exists for **license and provenance**, not for loading. Nothing here is
auto-loaded, auto-routed, or reconciled. It is the paper trail for a posture that was
absorbed directly into `AGENTS.md`, the same way `thinking-partner/` is the paper trail
for the Thinking Discipline section.

## What it is

The source is the viral single-file `CLAUDE.md` from the community repo
[`multica-ai/andrej-karpathy-skills`](https://github.com/multica-ai/andrej-karpathy-skills),
built from Andrej Karpathy's public notes on where LLM-driven coding goes wrong. It sat at
roughly 180k combined GitHub stars (personal repo plus org mirror) as the number one
trending repo when it was absorbed on 2026-07-08.

Its whole value is four rules that stop an agent from quietly breaking a working codebase:

1. **Think before you code** - state assumptions, name ambiguous readings, flag a simpler
   path before building, do not guess silently.
2. **Simplicity first** - write the least code that solves the real ask, no speculative
   features or unrequested abstraction. If 200 lines could be 50, write the 50.
3. **Surgical changes** - change only what the task needs, match surrounding style, do not
   refactor or reformat or delete unrelated code. Every changed line traces to the ask.
4. **Goal-driven execution** - turn a vague instruction into a runnable check, and do not
   claim it works until you have run it and watched it pass.

## How AI-OS uses it

Absorbed, not installed. AI-OS already had the documented move for a viral behavioral repo:
make it a posture in `AGENTS.md`, not a `/` skill (see the `thinking-partner` case in the
"Skills Library" section of `AGENTS.md`). So these four rules live as the **Coding
Discipline** section in `AGENTS.md`, scoped to fire only on code and system-file turns, and
cross-linked to the Thinking Discipline, Agency Discipline, State Proof, and Next Actions
rules they build on. The canonical home is that section, not this file.

The source file is **not copied in.** The four rules in `AGENTS.md` are re-expressed in
AI-OS's own plain-English voice. If you want to redistribute the original wording, check the
current license on the source repo first; this folder only links to it.

## Why absorbed instead of a skill

A behavioral ruleset is always-on posture, not an invokable tool. AI-OS's own guidance
(`AGENTS.md` -> Skills Library) says: "when the capability is core posture rather than an
invokable tool ... absorb it directly into `AGENTS.md` and `context/` ... instead of
creating a `/` skill at all." Same call made here.

- **Source:** https://github.com/multica-ai/andrej-karpathy-skills
- **Absorbed:** 2026-07-08
- **Canonical home:** `AGENTS.md` -> "Coding Discipline"
