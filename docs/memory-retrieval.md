# Memory Retrieval

## How recall works

Tier 1 recall is a three-rung ladder, all served by the scoped PGLite/pgvector store (or hosted Postgres when `MEMORY_DATABASE_URL`/`DATABASE_URL` is set). Each rung is a `memory:recall` invocation from `command-centre/`; stop at the lowest rung that answers the question — never escalate "just in case."

1. **Search** — hybrid retrieval: BGE-M3 vector search plus scoped Postgres full-text keyword search, fused and reranked by source authority and recency.
   ```bash
   npm run memory:recall -- "<query>" --system --json
   ```
   Swap `--system` for `--team <id>` / `--client <slug>` / `--user <id>` depending on whose memory you're answering for (each also includes the `system` baseline). Note the `chunk_id` of the best hit.

2. **Expand** — only if the best hit is too short to answer confidently. Returns the surrounding source context (neighbouring chunks from the same document) around a `chunk_id`.
   ```bash
   npm run memory:recall -- --expand <chunk_id> --system --json
   ```

3. **Transcript** — only if exact wording, a command, or an output is needed and expand wasn't enough. Returns a window of the raw conversation turns behind that chunk.
   ```bash
   npm run memory:recall -- --transcript <chunk_id> --system --json
   ```

Reuse the identical scope flags across all three rungs in one recall — never widen scope mid-ladder.

For an agent, this ladder is driven automatically by the `meta-memory-recall` skill (`.claude/skills/meta-memory-recall/SKILL.md`): it decides when to escalate a rung, enforces the same-scope-flags rule, and applies the citation pattern below. Read that skill for the full step-by-step mechanics; this doc covers what the ladder does and why, not how the skill orchestrates it turn-by-turn.

## Scope and safety

Every memory row carries a visibility: `system` (shared baseline, everyone in the tenant), `team`, `client`, or `private` (one user). A recall only ever sees its own scope plus the `system` baseline — never another client's `client`-scoped memory or another user's `private` memory. See `docs/memory/memory-schema.md` for the full schema and the enforced scope predicate; this is the plain-language version agents and users should rely on day to day.

## Evaluating recall quality (`memory:eval`)

Recall quality and the no-leak boundary are measured by a repeatable harness, not hand-judged. From `command-centre/`:

```bash
npm run memory:eval                    # bge-m3, against the committed gold-set corpus
npm run memory:eval -- --embedder hash # deterministic/offline (FTS + scope don't need the model)
npm run memory:eval -- --json          # machine output (full report + gate)
```

The harness indexes a small committed corpus (`command-centre/src/lib/memory/eval/corpus/`) into an ephemeral store, runs the committed gold-set (`command-centre/src/lib/memory/eval/gold-set.json`) through the real search path, and reports:

- **recall@k and MRR**, split by case `kind` — `exact` (literal filenames/IDs/settings, served by the FTS keyword leg) vs `semantic` (paraphrases with little lexical overlap, served by bge-m3).
- **leak-count** — returned hits that cross a scope they must not. Must be `0`.
- **latency** p50/p95, and a **hybrid-vs-vector-only** rank comparison for exact cases (hybrid should never rank an exact target below vector-only; the keyword leg's *lift* over vector-only only becomes clearly visible on a larger, noisier corpus).

**Gold-set cases** match by `sourcePath` (+ optional `contentIncludes`), never by chunk id, so they survive re-chunking. Add a case by appending `{ id, query, kind, scope, expect, forbid? }` to `gold-set.json`; use `kind: "leak"` (with `forbid`) for a cross-tenant query that must return nothing.

**Gate / exit code.** `memory:eval` exits non-zero when `leak-count` exceeds `thresholds.maxLeaks` or recall falls below a threshold, so it can act as a CI gate. The `exact` and `leak` bars are embedder-independent (deterministic under `--embedder hash`); the `semanticRecallAt5` bar is enforced only under bge-m3 (informational under hash). Wiring it into CI is tracked separately.

## Memsearch status

Memsearch is retired as the active runtime. `memory:recall` rejects `--backend memsearch` outright — the only supported backend is PGLite locally or hosted Postgres. If an install still has old `.memsearch` data, run `bash scripts/setup-memory.sh` to migrate it into the current store.

## Citing sources

Structure every recall response based on what was found:

**Found:** answer + cite source inline ("Based on the session log from 2026-05-11 and a decision in MEMORY.md...") + temporal context ("This was last discussed 3 days ago"). If the source is >14 days old: "Note: this information is from [date] — it may be outdated."

**Partial:** state what you know + what you don't + where you looked + temporal gap ("Last mention of [topic] was [date]. No records since then.") + what might fill the gap.

**Absent:** "I checked MEMORY.md, daily logs back to [earliest date], and ran semantic search across all indexed sources. No mentions of [topic]. If discussed, it may predate capture or occurred in a session that wasn't logged."

For partial or absent responses: run `bash scripts/lib/memory-meta.sh "[topic]"` to get exact coverage before responding.

Auto-captured `.aos.md` files contain summarized per-turn memory, are indexed, and are
tracked for private GitHub backups so memory can be re-chunked and re-embedded later.
Raw transcripts are archived locally under `context/transcripts/` and are the source
the transcript rung drills into. Do not fabricate sources.

## Importing prior Claude Code sessions

Live capture only records sessions from the moment AI-OS is installed. If you used
Claude Code before, you can backfill that history into the same memory store so recall
works from day one:

```bash
cd command-centre
npm run memory:import-sessions -- --dry-run        # detect + count, no writes
npm run memory:import-sessions                      # interactive menu (source → size → confirm)
```

It is **user-controlled and never silent**: a bare run in a terminal opens a menu, and
`--dry-run` only reports counts. `scripts/setup-memory.sh` / `.ps1` also offer the import
once memory is set up.

- **Sources** — Current workspace sessions (Claude Code's store for this repo), all global
  Claude Code history (`~/.claude/projects/`), existing AI-OS archives
  (`context/transcripts/`), or an explicit `--source <path>`.
- **Size (newest first)** — `--all`, `--sessions N` (most recent N), `--days N` (past N days),
  or `--since/--until` a date range. The menu offers the same choices.
- **Summaries** — `--summary session` (default; one summary per session), `--summary turn`
  (one block per turn, like live capture), or `--summary none` (raw digest, no LLM).
  Summarization uses your Claude subscription usage, and large histories can take a while —
  importing fewer now and more later is fine.
- **Idempotent** — a small ledger under `.command-centre/memory-import/` plus each block's
  `source:` hash mean re-running never duplicates blocks, sources, or chunks, and
  already-imported sessions are not offered again unless you pass `--force`/`--reimport`.
- **Scope & privacy** — local PGLite imports default to the stable private owner in
  `.command-centre/local-memory-user.json`. Hosted Postgres requires an explicit
  `--visibility`; `system`/`team`/`client` imports additionally require
  `--allow-shared` so
  personal sessions are not silently pushed into a shared scope. Explicit imports
  still honor `--team/--client/--user`. Raw transcripts are only copied (locally,
  gitignored) when you pass `--copy-raw`.
- **When searchable** — the importer writes the memory blocks, then runs the indexer; recall
  finds the imported sessions as soon as indexing completes.
