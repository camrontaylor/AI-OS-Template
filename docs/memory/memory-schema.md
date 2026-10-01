# Memory Schema & Scope Model

Engineering reference for the scoped memory store that replaced the legacy
MemSearch runtime. The schema is documented here and expressed as an executable contract
(DDL + types + scope logic) that the memory store, indexer, and search all build on.

---

## Why this exists

Memory is what lets the agent recall past sessions, decisions, and learnings
across conversations. The semantic layer now runs on PGLite locally or
hosted Postgres when a database URL is configured. The old MemSearch stack was
removed for three reasons:

1. **Windows is fragile.** The old vector stack depended on an external account
   on native Windows, with API-key setup friction and watcher processes that accumulated.
2. **Heavy stack.** Docker/Milvus and a separate Python CLI were a lot of infrastructure for a template.
3. **No isolation.** MemSearch indexes everything into one global space. There is no
   concept of *scope* — in a multi-client install (`clients/{slug}/`) or a future
   hosted/multi-team deployment, one client's memory could surface in another's search.

The store replaces this with **PGLite locally + Postgres when hosted, both with
pgvector** — one schema, one SQL dialect, one vector engine — and makes **scope** a
first-class column on every memory row, with tests that prove no cross-tenant leak.

### How it fits together

- The local **PGLite + pgvector** store runs this DDL and persists it on disk.
- The **indexer** normalizes files → chunks → embeddings → scoped rows.
- **Search** runs hybrid retrieval: BGE-M3 vector search plus scoped keyword search via Postgres full-text search (a generated `tsvector` column + GIN index, ranked with `ts_rank_cd`, `'simple'` config to stay multilingual-safe), fused with RRF and filtered by team / client / visibility / user.
- **No-leak tests** prove one client never sees another's memory, one team never another's, and so on.
- **Recall** uses this store only. Legacy `MEMORY_BACKEND=memsearch` now exits with migration guidance instead of running an unscoped backend.
- Local session-capture and refresh hooks keep the index current as files change.
  TeamOS session capture first writes staging rows and only enters recall after
  consolidation.

---

## Scope model

Every memory-bearing row carries four scope columns: `team_id`, `client_id`,
`user_id`, and `visibility`. `visibility` selects which of the others is required.

| Visibility | Who can read it | Required column |
|------------|-----------------|-----------------|
| `private`  | one user        | `user_id`       |
| `client`   | within one client workspace | `client_id` |
| `team`     | within one team | `team_id`       |
| `system`   | baseline — everyone within the tenant | (none) |

The rule is exact: private⇒`user_id`, client⇒`client_id`,
team⇒`team_id`. `system` is the shipped/baseline layer.

### How scope maps to the existing system

- **`client_id` = the folder slug** under `clients/{slug}/`, already validated by
  `assertValidClientId()` in `command-centre/src/lib/clients.ts`. The root workspace
  has no client (`client_id = NULL`).
- **`team_id` is nullable.** There is no "team" concept in a local single-tenant
  install, so local rows leave `team_id = NULL`. Hosted/multi-team deployments populate
  it. Making it nullable turns `team ⇒ team_id IS NOT NULL` into a *real* enforced rule
  rather than a trivially-true one, and keeps the CHECK faithful to the acceptance
  criteria.
- **`user_id` is access scope, not authorship.** Private memory requires
  `user_id`; shared team/client memories normally leave it `NULL`. Authorship for
  final sources is stored separately in `memory_sources.created_by_user_id`.

### Local mapping (consequence of the decisions above)

- Root Stop-hook capture in local AIOS → `visibility = 'private'` with a
  stable local user id stored in `.command-centre/local-memory-user.json`.
- Root baseline/admin imports can still use `visibility = 'system'`, all scope
  columns `NULL`, but this is no longer the default Stop-hook capture path.
- Client memory (`clients/{slug}/`) → `visibility = 'client'`, `client_id = {slug}`,
  `team_id = NULL`.

### Locked decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Embedding dimension | **1024** | Uses BGE-M3 for the shipped semantic memory model. Indexing and recall must use the same model; older 384-dim stores are rebuilt during setup/update. |
| `team_id` for local | **Nullable** (`NULL` locally) | Makes the `team` CHECK a real rule; clean local mapping; a forgotten team filter returns nothing, never everything. |
| `system` read scope | **Per-team baseline** | `system` rows are still filtered by `team_id` — "baseline" means visible to all users/clients *within* the tenant. No cross-tenant hole in v1. |

---

## Tables

Full DDL lives in `command-centre/src/lib/memory/migrations/0001_init.sql`. The single
token `:EMBED_DIM` is substituted at bootstrap by `migrate.ts` (default 1024). pgvector
requires a fixed dimension at column-definition time, so the dimension is a build-time
substitution, not a runtime variable.

### `memory_sources`

One row per normalized source document (a file, a captured session). Carries the four
scope columns plus the provenance metadata the reranker needs (`source_path`,
`source_type`, `content_date`, `authority_weight`) and `content_sha256` for change
detection on re-index.

`created_by_user_id` records the user who caused a final source to be created
when that is known. Do not use `user_id` as author: `user_id` is still the
private-read scope and is intentionally `NULL` for shared team/client memory.

### `memory_chunks`

One row per embedded chunk, with the `embedding vector(:EMBED_DIM)` column. **Scope and
reranking metadata are denormalized from the parent source.** The vector search must
filter by scope *during* the ANN scan; pgvector's HNSW pre-filter works on columns of
the same table, so a JOIN-before-WHERE would both slow the plan and make the leak
surface harder to reason about. `scope.ts` (`assertChunkMatchesSource`) keeps a chunk's
scope identical to its source in application code.

Chunks also store source provenance: `start_line`, `end_line`, `heading_level`,
`content_hash`, and `chunk_key`. `chunk_index` remains the ordered display position, but
the ingest path uses `chunk_key` as the stable identity for re-indexing. The key is built
from source path, source line range, chunk content hash, and embedding model. Existing
rows from older local stores can have these fields as `NULL`; a force reindex rebuilds
them from source files.

### `index_jobs`

Work queue for the indexer and capture hooks. Scope is required at
enqueue time — explicit scope at indexing is a hard requirement.

### `search_events`

Telemetry/audit for every scoped search, and the artifact the no-leak tests
can assert against. `query_text` and `query_embedding` are nullable for
privacy (see Open risks).

### `memory_capture_events`

Raw TeamOS capture staging. These rows store summarized session blocks with
`team_id`, optional `client_id`, `actor_user_id`, `session_id`, `source_hash`,
`status`, `sync_status`, and metadata. They are not joined into search and must
not be returned by recall. Active members can create team staging rows; client
staging still requires write access. Offline client queues use
`sync_status = 'local_pending'` until the server accepts them.

Each new capture defers pending captures from the same session so the batch is
eligible only after a quiet period, unless the volume threshold is reached.
Processed/review/failed raw content is redacted after 30 days. Minimal metadata
remains for audit and deduplication.

### `memory_consolidation_batches`

A claim ledger for consolidation. The server groups eligible pending captures
into a batch and issues a claim token. In v1, an online client performs the
LLM-based consolidation; a server worker can claim the same table later without
schema changes. Expired claims are released before the next claim so captures do
not stay stuck in `claimed`.

### `memory_source_provenance`

Links final `memory_sources` rows to the capture events that produced them.
This lets the UI/audit layer explain that a durable team memory came from one
or more users/sessions while normal recall only sees the final curated source.

### `schema_migrations`

The migration ledger (created by `migrate.ts`), recording `version`, `name`,
`applied_at`, and the `embed_dim` the DB was built with.

> **Future migration/reset contract (0024 and later):** `memory-reset` is
> deliberately fail-closed. Its canonical repair migration must always be the
> final migration. After adding any migration, add a new final and idempotent
> repair migration after it, include the complete definition of every
> rebuildable memory index table, update `MEMORY_REPAIR_VERSION` and
> `MEMORY_REPAIR_NAME`, and update the catalog snapshots, schema validation, and
> reset tests. Do not only bump the constant. The reset will not automatically
> replay migrations that come after its canonical repair migration.

---

## Scope invariants — the leak boundary

The same row-local, subquery-free CHECK guards `memory_sources`, `memory_chunks`, and
`index_jobs`:

```sql
CHECK (
  (visibility = 'private' AND user_id   IS NOT NULL) OR
  (visibility = 'client'  AND client_id IS NOT NULL) OR
  (visibility = 'team'    AND team_id   IS NOT NULL) OR
  (visibility = 'system')
)
```

It is a legal Postgres CHECK (no subqueries, no volatile functions) and is enforced
identically in PGLite.

**Defense in depth.** The same predicate is implemented in
`command-centre/src/lib/memory/scope.ts` (`assertValidScope` / `isValidScope`) and runs
in application code before any INSERT, so a bad scope fails with a typed error before the
DB rejects it — and the no-leak tests can exercise the predicate without a database.

---

## Indexes and the scoped search

### Vector index — HNSW + cosine

```sql
CREATE INDEX idx_memory_chunks_embedding_hnsw
  ON memory_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);
```

HNSW over IVFFlat: no training step and good recall on a cold/small corpus — exactly the
local PGLite case, which often starts with a few hundred chunks. Cosine matches the
BGE-M3 embeddings; the indexer **must L2-normalize at embed time**.
Query-time recall knob: `SET hnsw.ef_search = 40;` (a session GUC set by the search path).

### Scope-filter indexes

```sql
CREATE INDEX idx_memory_chunks_scope
  ON memory_chunks (team_id, visibility, client_id, user_id);
CREATE INDEX idx_memory_chunks_source_id
  ON memory_chunks (source_id);
```

A btree indexes NULLs, so `idx_memory_chunks_scope` serves both `team_id = $1` (hosted)
and `team_id IS NULL` (local).

### Canonical search query

The scope predicate is built by `buildScopeWhere` in `scope.ts` — the single source of
the leak boundary, imported by both the search and the no-leak tests. Resolved for a local search:

```sql
-- $1 = client_id, $2 = user_id, $3 = query_embedding, $4 = top_k
SELECT c.id, c.source_id, c.content, c.heading, c.source_path, c.source_type,
       c.content_date, c.authority_weight, (c.embedding <=> $3) AS distance
FROM memory_chunks c
WHERE c.team_id IS NULL            -- hosted: c.team_id = $teamId
  AND c.embedding IS NOT NULL
  AND ( c.visibility = 'system'
     OR c.visibility = 'team'
     OR (c.visibility = 'client'  AND c.client_id = $1)
     OR (c.visibility = 'private' AND c.user_id   = $2) )
ORDER BY c.embedding <=> $3
LIMIT $4;
```

- The team predicate is the first leak boundary — Team A never sees Team B. With a
  nullable `team_id`, forgetting the team filter resolves to `IS NULL`, returning nothing
  in a hosted DB rather than everything (the catastrophic-default safeguard).
- The `OR`-block excludes other users' `private` rows and other clients' `client` rows,
  while including `team` + `system` baseline. This is the exact predicate the no-leak tests
  assert; removing it returns cross-tenant rows and fails the tests.
- `ORDER BY embedding <=> $3 LIMIT k` is served by the HNSW index; pgvector applies the
  WHERE as a pre-filter during the scan.

### Reranking (preserved from memsearch)

The legacy three-stage reranker is preserved and runs in application code on the returned
rows using the denormalized columns — no second query:

1. **Authority** — per source-path-prefix weights from `context/memory-config.json`
   (e.g. `context/MEMORY.md` = 2.0, `context/learnings.md` = 1.5),
   snapshotted into `authority_weight`.
2. **Recency** — exponential decay, 14-day half-life, 0.7 floor, computed from
   `content_date` (the indexer parses `YYYY-MM-DD` from the filename).
3. **Floor-ratio gating** — keep results `>= top * 0.3`.

### Scale-out lever (documented, not shipped in v1)

If profiling on a hosted corpus shows the visibility filter is the bottleneck, add
partial HNSW indexes so private/client searches traverse only their own subgraph:

```sql
CREATE INDEX idx_chunks_embedding_team_system_hnsw
  ON memory_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE visibility IN ('team','system') AND embedding IS NOT NULL;
CREATE INDEX idx_chunks_embedding_private_hnsw
  ON memory_chunks USING hnsw (embedding vector_cosine_ops)
  WHERE visibility = 'private' AND embedding IS NOT NULL;
```

v1 ships the single full HNSW index — simpler and correct. Partial indexes are supported
in PGLite and can be added later without a schema change to the columns.

---

## Embedding dimension strategy

One schema *shape*, one dimension per database instance. The SQL text is identical except
for the `:EMBED_DIM` token, substituted at bootstrap and recorded in
`schema_migrations.embed_dim`. Default **1024** for BGE-M3. The
`memory_chunks.embedding_model` and `embedding_dim` columns record what produced each
vector so an audit can detect drift.

**Changing the dimension later is a full re-embed + reindex, not an `ALTER`.** pgvector
fixes the dimension at column definition, and an HNSW index requires it. `migrate.ts`
**fails loudly** if the requested dimension differs from the one the DB was built with.
Treat a dimension change as "rebuild `memory_chunks` from `memory_sources`" — sources
hold `content_sha256` and content metadata, so the indexer can re-chunk and re-embed
everything. This is why the default is chosen deliberately now.

---

## PGLite vs hosted Postgres

The schema runs identically in both. Every feature used is confirmed available in PGLite:

| Feature | Notes |
|---------|-------|
| `CREATE EXTENSION vector` | The store must register the `vector` extension in the `new PGlite({ extensions })` constructor. |
| `vector(N)` + `<=>` + HNSW | From the same pgvector source; `hnsw.ef_search` GUC works. |
| `gen_random_uuid()` | Built into PGLite; core in Postgres 13+. On very old hosted PG, `CREATE EXTENSION pgcrypto` first. |
| `uuid`, `jsonb`, `timestamptz`, `now()`, `text[]`/`uuid[]` | Core in both. |
| Row-local CHECK constraints | Enforced on insert/update in both. |
| Partial indexes | Supported (used by the optional scale-out lever). |

**Deliberately avoided for parity:** native `CREATE TYPE ... AS ENUM` (used `text` +
CHECK instead — diffable and extensible via migration), generated/`STORED` columns
(`authority_weight` derives from external config, not from the row, so a generated column
could not express it), and plpgsql triggers in v1 (parent/child scope sync lives in
`scope.ts`). Filename `YYYY-MM-DD` parsing is done in TypeScript by the indexer, not in
SQL. The bootstrap is a pure-SQL string runnable verbatim in both engines.

Primary keys use `uuid` via `gen_random_uuid()` rather than the ops DB's
`Date.now()+counter` text-id pattern: ids can be generated client-side (the indexer) or
DB-side without coordination, which matters because both the indexer and the capture
hooks write to this store.

---

## Migrations and versioning

A `schema_migrations` ledger plus ordered `NNNN_name.sql` files, applied by a single
`applyMigrations()` (`command-centre/src/lib/memory/migrate.ts`) that runs identically
against a PGLite handle or a hosted `pg` client. This departs from the ops DB's
imperative PRAGMA style on purpose: Postgres has no `PRAGMA table_info`, and the no-leak
tests and CI need a deterministic, reproducible schema state. The store bootstraps with
one `applyMigrations(db, { embedDim })` call.

`migrate.ts` is DB-agnostic via a thin `SqlClient` interface (`exec` + `query`); the store
supplies the adapter over `@electric-sql/pglite` (or `pg`). `0001_init.sql` uses
`CREATE ... IF NOT EXISTS`, so it is safe to re-run.

---

## TypeScript contract

In `command-centre/src/lib/memory/`:

- `types.ts` — `Visibility`, `SourceType`, `Scope`, the row types (`MemorySourceRow`,
  `MemoryChunkRow`, `IndexJobRow`, `SearchEventRow`), `SearchScope`, and
  `ALL_VISIBILITIES`. Naming is snake_case in SQL, camelCase in TS; the store layer
  maps between them.
- `scope.ts` — `isValidScope`, `assertValidScope`, `assertChunkMatchesSource`, and
  `buildScopeWhere`. This is the single source of the leak boundary; the search and the
  no-leak tests import it so the tests cover the real filter.
- `migrate.ts` — `SqlClient`, `Migration`, `applyMigrations`, plus pure helpers
  (`renderMigrationSql`, `sortMigrations`, `loadMigrationsFromDir`).

This store uses snake_case + standard Postgres DDL, distinct from the ops DB
(`command-centre/src/lib/schema.sql`, better-sqlite3, camelCase, PRAGMA migrations). Two
stores, two conventions, each idiomatic to its engine — intentional.

---

## What each downstream component consumes

- **The store** imports `applyMigrations` to bootstrap, supplies the PGLite `SqlClient`,
  and implements insert/search against the live schema.
- **The indexer** inserts final/curated content into `memory_sources`/`memory_chunks`
  with explicit scope and enqueues `index_jobs`; populates
  `authority_weight`/`content_date` from `memory-config.json` and the filename.
- **The search** uses `buildScopeWhere` + the canonical query + the reranker, and writes
  `search_events`. It never reads `memory_capture_events`.
- **The no-leak tests** import `scope.ts` and assert the invariants and the leak boundary
  against seeded data.
- **Session capture** writes local private sources in solo AIOS. In TeamOS it
  writes `memory_capture_events`; consolidation later publishes selected durable
  memories as `memory_sources`.

---

## Session capture

The Stop hook stays fire-and-forget. It starts `command-centre/scripts/memory-capture.cjs`
in a detached process, then returns immediately so it does not slow the agent turn.

Capture now mirrors the useful part of Memsearch's behavior:

- `extractLastTurn()` reads the latest user-to-assistant turn and removes tool-result noise.
- The capture process summarizes that turn into 2-10 third-person bullets using the
  configured summarizer. Defaults live in `context/memory-config.json`:
  `capture.summarize.provider=claude`, `model=haiku`, and `timeout_ms=120000`.
- The summary is appended to `context/memory/{YYYY-MM-DD}.aos.md`; it no longer replaces
  the previous block from the same session.
- Each block is keyed by a SHA-256 hash of the source turn, so replaying the same Stop
  event is a no-op.
- The raw transcript is copied to `context/transcripts/{YYYY-MM-DD}/` and is gitignored.
  If summarization fails or times out, capture writes a bounded fallback summary instead
  of dropping the turn.

In local AIOS, `context/memory/*.aos.md` is indexed like other memory files,
using the stable local private user id. In TeamOS, the `.aos.md` block is sent to
`memory_capture_events` first and does not enter recall until consolidation
publishes a final team/client source. The `.aos.md` file remains tracked for
private backup/replay.

The local file watcher and prior-session importer use that same private identity
when no scope flags are supplied. Hosted Postgres never guesses an ingest scope:
both commands require explicit `--visibility`, and shared session imports retain
the additional `--allow-shared` confirmation. Existing `system` rows are left
unchanged; these defaults affect only new ingestion.

---

## Open risks

1. **Catastrophic default.** Every search path MUST use `buildScopeWhere` (it always
   emits the team predicate). Raw SQL that omits the predicate is the only leak vector —
   a code-review rule, not a code-enforceable one.
2. **Chunk/source scope drift.** Enforced in `scope.ts` in v1. A plpgsql BEFORE-INSERT
   trigger that copies scope from the parent is an optional hardening if the no-leak tests
   reveal a gap; deferred to avoid adding a PGLite↔Postgres parity surface.
3. **`search_events` privacy.** `query_text` and `query_embedding` are nullable.
   Recommendation for the search path: store `query_text` only for non-private searches and never
   store `query_embedding` by default (a config flag).
4. **Normalized embeddings.** `vector_cosine_ops` assumes L2-normalized vectors — a
   contract for the indexer.

---

## The indexer

`memory-indexer` is the replacement for `memsearch index`. It walks the source roots,
normalizes each file, chunks it, embeds the chunks, and writes scope-tagged rows into the
store — idempotently. Module: `command-centre/src/lib/memory/`
(`embedder.ts`, `chunker.ts`, `discovery.ts`, `indexer.ts`); CLI:
`command-centre/scripts/memory-index.cjs` (`npm run memory:index`).

**Pipeline.** `discoverSources` → (skip if `content_sha256` unchanged) → `insertSource`
(UPSERT) → `chunkMarkdown` with line metadata → stable `chunk_key` → reuse embeddings
for unchanged keys → `embedder.embed` for new keys → `insertChunk` per chunk → prune
stale keys → record an `index_jobs` audit row (`running` → `succeeded`/`failed`, or a
single `skipped`).

**Sources.** The standard roots — `context/memory` and `context/learnings.md` —
are walked for `.md`/`.markdown`/`.txt`. Brand context is loaded through the
skill/context-matrix file path, not indexed by default; pass `--root brand_context`
only when you intentionally want it in memory. Legacy `.memsearch/memory` folders
are import-only and must be passed explicitly with `--root` during migration.
Dotfiles and zero-byte files (e.g. `.gitkeep`) are skipped. `authority_weight` and the
`YYYY-MM-DD` `content_date` are snapshotted from `context/memory-config.json` + the
filename, so the store carries the reranking inputs used by the current search pipeline.
`content_sha256` is computed over **normalized** content (LF endings, trimmed) so re-index
detection is stable.

**Embeddings.** `Embedder` interface returning L2-normalized vectors. The shipped default
is BGE-M3 (`MEMORY_EMBEDDER=bge-m3`, with `local` kept as an alias) using
`@huggingface/transformers`; the model is cached under `.command-centre/models` and may
download during setup. `HashEmbedder` remains available only as an explicit offline/test
mode. There is no automatic fallback from BGE-M3 to hash, because mixed vectors make
semantic recall unreliable.

**Scope at index time.** The low-level `memory:index` command requires
`--visibility`. The rebuild command is backend-aware: local PGLite defaults to
the stable private user, while hosted Postgres requires an explicit visibility.
Any source under `clients/{slug}/` is re-scoped to that client
(`visibility = 'client'`, `client_id = slug`) regardless of the base scope, so a
run never leaks a client's memory into the system scope.

```bash
npm run memory:reindex -- --allow-local               # normal local private rebuild
npm run memory:index -- --visibility system           # explicit admin baseline
npm run memory:index -- --visibility system --dry-run # discovery + chunk counts only
npm run memory:index -- --visibility client --client acme
MEMORY_EMBEDDER=bge-m3 npm run memory:reindex -- --allow-local
```

Tests: `command-centre/src/lib/memory/indexer.test.cjs` (offline; injects `HashEmbedder`),
run with the rest via `npm run test:memory`.
