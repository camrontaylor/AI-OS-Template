# Notion Sync — Optimisation Suggestions

Running list of improvements for the Notion sync. Not committed work, just the
backlog of ideas and their assessment. Newest thinking at the bottom of each
section. Nothing here is implemented unless its status says so.

Current baseline: one-way, read-only mirror. Notion to local markdown
(`context/notion/`). Weekly, Sundays 22:30, via launchd. Pure Python REST, zero
model credits. The integration ("AI-OS Sync") holds Read content only.

---

## Verdict (2026-06-15)

Decision after reviewing full context.

- **Do #1, #2, #3 (single-indexer, incremental, daily) as one change.** Cheap,
  closes the real corruption bug, keeps the second brain current. Clear yes.
- **#4 (pure-bash nightly index): optional, low priority.** Trivial credit saving.
- **#5 (two-way sync): NOT recommended now.** Notion is an INPUT store; the OS
  reads from it to get smarter. Writing OS work back creates dual sources of
  truth (the seam that rots solo systems) for a convenience with no concrete
  need today. Revisit only under the named condition in #5. If ever built,
  scoped write-back (B) only, never bidirectional mirror (A).

Empirical note that informs this: the body trim is NOT lossy for thinking. Full
prose bodies are preserved (Notes bodies run up to 27,686 words, median 241);
only images, embeds, and boilerplate are stripped. So read-fidelity for journal
and essays is high and does not need rebuilding.

Higher-leverage than any of the above: test whether RETRIEVAL surfaces the right
items during real work (drafting, deciding). The mechanics are solid; the open
question is whether recall is actually useful in the moment. Tune retrieval
before expanding surface area.

Principle going forward: one source of truth per thing. Inputs (Notion, notes,
transcripts) are read-only sources the OS pulls from. Outputs live in the OS's
native home (`projects/`, `context/memory/`). Pull in, produce in the native
home. Minimise external write targets.

---

## Open suggestions

### 1. Remove the double-indexer (concurrency safety) — HIGH PRIORITY
Two schedulers call `memsearch index` against single-process Milvus Lite with no
lock: the sync at Sun 22:30, the nightly memory index daily at 23:30. They
survive today on a ~40-minute gap, which is luck not safety. This is the exact
failure mode that corrupted the index once already.
Fix: drop the `memsearch index` call from `run-notion-sync.sh`; have the nightly
index own Notion semantic indexing. Current implementation keeps raw
`context/notion/` source paths but uses AI-OS's fast index wrapper to avoid one
existing-hash lookup per file, so one indexer owns Milvus Lite and scheduled
maintenance stays tractable. Cost: synced notes searchable within 24h instead of
instantly (fine for a knowledge base).
Status: implemented for single-indexer ownership and fast scheduled indexing.

### 2. Incremental sync (only changed pages) — HIGH PRIORITY
Today every run re-queries every database and re-pulls every page body: ~1,200
API calls, ~7 minutes, even when nothing changed. Notion's query API supports a
`last_edited_time` filter. Store the last-run timestamp, fetch only pages edited
since. A run drops from ~7 minutes to seconds when little changed. This is the
change that makes frequent syncing essentially free.
Status: proposed.

### 3. Move to daily — MEDIUM
After #2, daily costs almost nothing and keeps journal entries and saved
resources at most a day stale in recall instead of a week. Could go twice-daily
trivially once incremental is in.
Status: proposed.

### 4. Make the nightly index pure bash — LOW
The nightly memory index is an agentic cron (`model: haiku`) to run its steps,
the only place any cloud-model credit touches the memory pipeline. The
embeddings are already local (ONNX). Converting the orchestration to plain bash
(like the Notion runner) takes model cost on the memory system to zero.
Status: optional.

### 5. Two-way / write-back sync — NEEDS A DECISION (added 2026-06-15)
Idea: let the OS write to Notion, not just read from it, possibly via an agentic
cron. Moving forward only, not retroactive.

Assessment: "two-way sync" bundles two very different systems.

- **(A) Bidirectional mirror** — keep local files and Notion pages identical,
  propagate edits both directions. Advise against this for the existing knowledge
  mirror, for two reasons:
  - The local bodies are intentionally LOSSY (images, embeds, bookmarks, and
    boilerplate stripped; body trimmed). Pushing a local file back would
    overwrite the rich Notion page with a degraded text-only version. Real data
    loss.
  - Conflict resolution. A page edited in Notion AND locally between runs forces
    last-write-wins (silent data loss) or field-level merge (a genuine
    engineering project). Not worth it for a personal knowledge base.

- **(B) Scoped write-back, single-writer-per-database** — the recommended shape.
  Human-curated DBs (Stack, Resources, Notes) stay READ-ONLY: you own them in
  Notion, the OS only reads. The OS writes only to OS-owned destinations it is
  the sole author of: e.g. a "Session Log", "Deliverables", or "Agent Inbox"
  database/page. Because each resource has exactly one writer, conflicts cannot
  happen and nothing of yours is ever overwritten. Write-back here is CREATE and
  APPEND (new pages, appended blocks), never full-body overwrite, which also
  matches what the Notion API does cleanly.

Agentic or not: mechanical write-back (push a session note, log a deliverable)
needs no model and stays credit-free, same as the read sync. Only make it
agentic when the write itself needs judgment (summarise, transform, decide what
to capture). Default to non-agentic; reach for the agent only where it earns the
credits.

New risks introduced by ANY write capability (absent today):
- Loss of the read-only safety net. Right now the OS literally cannot harm
  Notion. Write access removes that. Needs dry-run mode and scoping to OS-owned
  DBs only.
- The local `overwrite-guard` hook protects local files, not Notion. Write-back
  needs its own guardrail (never delete, scoped target, dry-run preview).
- Integration capability change: needs "Insert content" / "Update content" added
  to the Notion integration (currently Read only).
- Notion write rate limit is also ~3 rps; batch and throttle.

Recommendation: do NOT make the read mirror bidirectional. If write-back is
wanted, build it as a separate, scoped capability into OS-owned databases only,
non-agentic unless judgment is required. Pick the concrete use case first
(capture sessions? publish deliverables? push decisions to an inbox?) because it
determines the destination schema.
Status: needs a decision on use case before any build.
