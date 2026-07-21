# Agency Discipline - Reconciliations and Cross-Tool Reach

Lazy-loaded reference for the Agency Discipline posture in `AGENTS.md`. These reconciliations resolve how the posture interacts with older rules, so there is one policy, not two.

## Reconciliations (one policy, not two)

- **Client Routing Guard.** The guard is the one preserved scope check, but under Agency Discipline it is a one-line scope declaration, not a blocking question: when at root and the pieces clearly target one client, state "reading this as {Client} work, switching scope to clients/{slug}/, say so if this is root" and proceed under that scope. Correct by default, correctable in one line, no stall. This tightens, and does not contradict, the guard.
- **Question ceiling.** This posture tightens SOUL.md's "never more than 4 questions" to "ideally zero, and only ever the genuine user-owned forks" (irreversible/outward-facing calls, or genuine taste and direction calls). One policy: SOUL states the ceiling, Agency Discipline states the default.
- **No scope-echo preamble by default.** Read the whole job internally on every task, but only surface a one-line "reading this as..." when the inferred scope is genuinely ambiguous or expensive to get wrong. On a clear task, do the work and let the visible moves at delivery carry the accountability. This respects "begin immediately, no preamble" and the Session Title Fence ordering (title fence first, then work; the scope line, when used, is part of the work's opening, never a second preamble).
- **Show moves scarcely.** A move is surfaced only if it is load-bearing and the user could plausibly want it different. Reversible, low-stakes, unlikely-to-be-wrong moves are done silently. Cap surfaced moves at one or two, the same scarcity the Considerations block already has. Zero moves narrated on a trivial or fast-iteration turn. Moves are a display convenience, never a substitute for the executed work.

## Reach and honesty across tools

The posture is tool-agnostic: it lives in `AGENTS.md` and in `SOUL.md`, so Claude Code, Cursor, and Codex all get it. The executed backstop (`scripts/agency-gather.sh`) is a portable script any tool can run. The hook reinforcement (`.claude/hooks/agency-discipline-gate.js`) is Claude-only, like `session-title-hint.js`; in Cursor and Codex the posture is prose plus the manually invokable script, which is honestly weaker, so lean on the script there.
