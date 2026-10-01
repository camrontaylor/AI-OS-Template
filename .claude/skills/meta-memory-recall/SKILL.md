---
name: meta-memory-recall
description: >
  Drives the scoped recall ladder (search -> expand -> transcript) over the
  PGLite/pgvector memory store. Triggers on "what did we decide about",
  "do we have a record of", "search memory", "look up in memory", "what do
  we know about X", or any question about past context, decisions, or facts
  that Tier 0 (MEMORY.md, today's log) doesn't already answer. Composes with
  the always-on Tier 0/1 retrieval flow in AGENTS.md: this skill is what to
  reach for once Tier 0 comes up empty or thin. Stops at the lowest rung
  that answers the question and never widens scope mid-ladder. Does NOT
  trigger for memory writes (handled by meta-memory-write) or for facts
  already present in loaded context.
---

# Memory Recall

Drives the scoped recall ladder over the PGLite/pgvector memory store: search for a candidate, expand it for surrounding context only if needed, drill into the raw transcript only if exact wording is needed. Stops at the lowest rung that answers.

## Outcome

- A sourced answer following the Found / Partial / Absent pattern from `docs/memory-retrieval.md`
- The answer cites the lowest rung that answered (search hit, expanded chunk, or transcript window) — never a raw file read
- No scope widening mid-ladder: every rung in one recall uses the same scope flags

## Context Needs

None beyond what each rung's CLI already returns. Don't read `context/memory/` or `context/transcripts/` files directly — always go through the CLI.

---

## Step 1: Tier 0 Recap (one line)

Tier 0 (`context/MEMORY.md` + today's daily log) is already loaded at session start per `AGENTS.md`. If the answer is already there, answer directly — do not invoke this skill's ladder. Only proceed to Step 2 if Tier 0 has nothing or is too thin to answer confidently.

## Step 2: Search

From `command-centre/`:

```
npm run memory:recall -- "<query>" --system --json
```

Swap `--system` for `--team <id>` / `--client <slug>` / `--user <id>` depending on whose memory you're answering for (each also includes the `system` baseline). Read the top hits. Note the `chunk_id` of the best candidate.

If search returns nothing in scope, stop here — go to Step 5 with an Absent/Partial answer. Do not escalate rungs on an empty result.

## Step 3: Expand (only if the best hit is too short to answer confidently)

```
npm run memory:recall -- --expand <chunk_id> --system --json
```

Use the exact same scope flags as the Step 2 search call. This returns the surrounding source context (neighbouring chunks from the same source). If this answers the question, stop here.

## Step 4: Transcript (only if exact wording, a command, or an output is needed and expand wasn't enough)

```
npm run memory:recall -- --transcript <chunk_id> --system --json
```

Again, the exact same scope flags as Steps 2-3. This returns a window of raw conversation turns around the one the chunk summarizes.

## Step 5: Answer

Stop at the lowest rung that answered. Apply the Found / Partial / Absent citation pattern from `docs/memory-retrieval.md`:

- **Found** — answer + inline source citation + temporal context (flag if >14 days old)
- **Partial** — what's known + what's missing + where you looked + temporal gap
- **Absent** — state what was checked (MEMORY.md, daily logs, semantic search across indexed sources) and that nothing matched

---

## Rules

*Updated automatically when the user flags issues. Read before every run.*

- **Stop-early discipline.** Don't drill to expand or transcript "just in case" — only escalate when the current rung's content is genuinely too short or imprecise to answer.
- **Identical scope flags across rungs.** Once a recall starts with `--system` (or `--team`/`--client`/`--user`), every subsequent expand/transcript call in that same recall uses the identical flags. Never widen scope mid-ladder.
- **Never bypass the CLI.** All three rungs go through `npm run memory:recall --` (which wraps `memory-search.cjs` / `memory-expand.cjs` / `memory-transcript.cjs`). Never query the database or read `context/transcripts/` files directly.
- **Null/empty means stop and say so.** If a rung returns `null` or no matches, that is a real answer (not found in scope) — report it as Partial/Absent rather than guessing or fabricating a source.
- **Explain scope in plain terms.** You only ever see your own memory plus your team's plus the system baseline — never another client's or another user's private memory. If a result seems surprising in scope, say so plainly rather than implying broader access.

---

## Self-Update

If the user flags an issue with how recall escalates rungs or cites sources, update the `## Rules` section in this SKILL.md immediately with the correction and today's date.

---

## Graceful Degradation

- **Memory backend unavailable** (exit code 3 from any rung) → tell the user to run `bash scripts/setup-memory.sh`, don't retry silently
- **Empty result at any rung** → Absent or Partial response per `docs/memory-retrieval.md`, never fabricate a source
- **Ambiguous scope** (unclear which tenant to search as) → ask the user rather than guessing a scope flag
