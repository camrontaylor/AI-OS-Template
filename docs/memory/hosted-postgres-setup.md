# Hosted Postgres + pgvector setup

Run the AI-OS memory store on **hosted Postgres with pgvector** so a team
can share one central source of truth. The schema, migrations, and scope model
are identical to local PGLite — this guide only covers provisioning a hosted
Postgres, enabling pgvector, and applying the schema.

> This is the foundation of hosted team memory: a hosted database running the
> shared schema. The memory commands select that backend at runtime (see
> [Backend selection](#backend-selection) below). The hosted ingest/search API
> sits on top — deploy it next to this database so consumers get a URL + token
> instead of database credentials (see [`hosted-api.md`](hosted-api.md)).
> `memory:reindex` seeds a fresh hosted database with the memory you already
> have (see [Seed the store](#seed-the-store-with-existing-memory)). Backing this
> database up and restoring it is covered in
> [`backup-restore.md`](backup-restore.md). Cross-references at the end.

## What you get

- A Postgres database with the `vector` extension and the memory schema
  (`memory_sources`, `memory_chunks` with a `vector(1024)` column + HNSW index,
  `index_jobs`, `search_events`, `schema_migrations`).
- One command to apply or re-apply the schema: `npm run memory:migrate`.
- The same `pgvector/pgvector` image on Railway, on a VPS, and locally — so what
  you test locally is what runs in production.

## Why the `pgvector/pgvector` image

The schema needs the `vector` extension (for `vector(1024)` columns and the HNSW
index). The official [`pgvector/pgvector`](https://hub.docker.com/r/pgvector/pgvector)
images ship pgvector preinstalled, and migration `0001_init.sql` runs
`CREATE EXTENSION IF NOT EXISTS vector` for you. Using the same image everywhere
(Railway, VPS, local) guarantees identical behavior and avoids depending on
whether a managed Postgres add-on happens to bundle pgvector.

Pin a tag matching your Postgres major version, e.g. `pgvector/pgvector:pg16`.

## Required environment variables

| Variable | Required | Purpose |
|----------|----------|---------|
| `MEMORY_DATABASE_URL` | yes (or `DATABASE_URL`) | Connection string for the hosted memory database. |
| `DATABASE_URL` | fallback | Used if `MEMORY_DATABASE_URL` is unset. Railway injects this automatically when you attach a database. |
| `PGSSLMODE` | optional | `disable` \| `require` \| `no-verify`. Default: SSL **on** for remote hosts, **off** for localhost. Use `disable` for a Railway private/internal URL. |
| `MEMORY_STORE_BACKEND` | optional | `auto` (default) \| `pglite` \| `postgres`. `auto` selects Postgres iff a connection string is set, else local PGLite. `postgres` **requires** a URL (errors rather than using the local store); `pglite` forces local. See [Backend selection](#backend-selection). |

Connection string form:

```
postgres://USER:PASSWORD@HOST:PORT/DBNAME
```

**Never commit a real value.** Document names in `.env.example`; set actual
values in Railway's variables UI, your VPS shell/secret manager, or a local
untracked `.env`.

### SSL behavior

`memory:migrate` resolves SSL in this order: an explicit option → `PGSSLMODE` →
an `?sslmode=` query param on the URL → the host (localhost → off, any remote
host → on). "On" means `{ rejectUnauthorized: false }` — transport is encrypted,
but the client does not chain-verify the certificate, which is what managed
providers (Railway included) require. For a Railway **private** URL (no SSL
offered), set `PGSSLMODE=disable` or append `?sslmode=disable`.

---

## Backend selection

The memory store runs the **same** schema, indexer, search, and scope leak
boundary on local PGLite and hosted Postgres. `openMemoryStore()` picks the
engine; every `memory:*` command goes through it, so the choice is one rule, not
a per-command flag:

| `MEMORY_STORE_BACKEND` | Connection string set? | Engine |
|------------------------|------------------------|--------|
| _unset_ / `auto` (default) | yes (`MEMORY_DATABASE_URL` / `DATABASE_URL`) | hosted Postgres |
| _unset_ / `auto` (default) | no | local PGLite |
| `postgres` | yes | hosted Postgres |
| `postgres` | **no** | **error** — refuses to fall back to local |
| `pglite` | (ignored) | local PGLite |

So pointing the whole toolchain at hosted memory is just:

```bash
cd command-centre
export MEMORY_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/ai_memory'
npm run memory:migrate                          # apply schema (idempotent)
npm run memory:index  -- --visibility system    # index into hosted Postgres
npm run memory:search -- "release process" --system   # search hosted; logs `backend: postgres`
```

Unset `MEMORY_DATABASE_URL` and the same commands use local PGLite again.

**No silent fall back to an unsafe local source of truth.** Two guarantees back
this:

- `MEMORY_STORE_BACKEND=postgres` with no connection string is a hard error —
  a deployment that asks for hosted memory never quietly serves the local store.
- When the hosted engine is selected and the database is unreachable, the failure
  is a hard error (exit 1). It is **not** silently replaced with local PGLite or
  any legacy backend.

---

## Seed the store with existing memory

A freshly provisioned hosted database is empty. `memory:reindex` is the one-shot
migration that backfills it with the active AI-OS memory **already on disk**
(`context/memory`, `context/learnings.md`) so the shared team brain
starts with the existing history instead of nothing. Old `.memsearch/memory` folders
are import-only; run `scripts/setup-memory.*` or pass them explicitly with `--root`
when migrating a pre-PGLite install.

It runs the same indexer as `memory:index`, so chunking, embedding, and metadata
are identical — and it is **idempotent**: re-running skips unchanged sources and
never duplicates chunks (a changed source replaces its chunks in place).

```bash
cd command-centre
export MEMORY_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/ai_memory'

npm run memory:reindex -- --visibility system --dry-run # preview only
npm run memory:reindex -- --visibility system           # intentional shared baseline
npm run memory:reindex -- --visibility system           # run again → all skipped
```

Expected summary on the first run, then the idempotent second run:

```text
  backend: postgres
  scope: visibility=system ...
  sources indexed : 9
  chunks inserted : 46
# second run:
  sources indexed : 0
  sources skipped : 9  (unchanged — no duplicate chunks)
  chunks inserted : 0
```

**Scope.** The default is `system` — the shared project baseline (learnings and
curated memory), identical for everyone and safe to seed once.
Sources under `clients/{slug}/` auto-scope to that client. **Run it once from the
canonical workspace** — it is a backfill of shared memory, not a per-person
push: do not have every team member seed their personal session captures into
the shared `system` scope. Normal TeamOS session capture now goes to
`memory_capture_events` staging first, and local solo AIOS capture uses a
stable private local user id.

**Guard rail.** Because the point is to seed *hosted* Postgres, the command
**refuses to write the local PGLite store** when no `MEMORY_DATABASE_URL` is set
— it exits rather than silently backfilling nowhere useful. Pass `--allow-local`
to rebuild a Solo installation; that local path defaults to the stable private
user. Hosted Postgres has no default visibility: pass `--visibility system`,
`team`, `client`, or `private` deliberately. Use `--force` for a full re-embed
(for example after an embedding model upgrade).

---

## Railway (first-class target)

1. **Create the database service.** In your Railway project: **New → Deploy a
   Docker Image** and use `pgvector/pgvector:pg16`. Set the standard Postgres
   variables on the service:
   - `POSTGRES_USER` (e.g. `postgres`)
   - `POSTGRES_PASSWORD` (a strong secret)
   - `POSTGRES_DB` (e.g. `ai_memory`)
   - Add a **persistent volume** mounted at `/var/lib/postgresql/data` so data
     survives redeploys.
2. **Get a connection string.** Railway exposes both a private URL
   (`postgres.railway.internal`, no SSL — use within Railway) and a public proxy
   URL (use from your machine, SSL on). Compose
   `MEMORY_DATABASE_URL` from the service variables, or copy the provided URL.
3. **Apply the schema.** Run the migration once, from your machine against the
   public URL, or from a Railway shell against the private URL:

   ```bash
   cd command-centre
   # From your machine (public URL → SSL on by default):
   MEMORY_DATABASE_URL='postgres://postgres:PASSWORD@HOST.proxy.rlwy.net:PORT/ai_memory' \
     npm run memory:migrate

   # From inside Railway (private URL → disable SSL):
   MEMORY_DATABASE_URL='postgres://postgres:PASSWORD@postgres.railway.internal:5432/ai_memory' \
   PGSSLMODE=disable npm run memory:migrate
   ```

4. **Verify.** `npm run memory:migrate -- --check` lists the applied migrations.

> Prefer Railway's **managed** Postgres add-on instead of the image? It only
> works if that add-on provides pgvector. If `CREATE EXTENSION vector` fails
> with "extension is not available", switch to the `pgvector/pgvector` image as
> above — that is the supported, portable path.

---

## VPS (Docker)

The repo ships a compose file using the same image. On the VPS:

```bash
cd command-centre
# Set strong credentials (or put them in an untracked .env next to the compose file):
POSTGRES_PASSWORD='a-strong-secret' docker compose up -d

MEMORY_DATABASE_URL='postgres://postgres:a-strong-secret@localhost:5432/ai_memory' \
PGSSLMODE=disable npm run memory:migrate
```

Notes for VPS operators:
- The compose file persists data in the named volume `aios_memory_pgdata`.
- Do not expose port 5432 publicly. Keep Postgres on the private network / behind
  the firewall, or bind it to localhost and reach it over SSH/WireGuard.
- If you front Postgres with TLS, set `PGSSLMODE=require` (or `no-verify` for a
  self-signed cert).
- `CREATE EXTENSION` needs a superuser or a role with `CREATE` on the database.
  The image's default `postgres` user qualifies. If you run the migration as a
  restricted role, have a superuser run `CREATE EXTENSION vector;` once first.

---

## Local development & verification

Prove the same schema + pgvector works on real Postgres before deploying:

```bash
cd command-centre
docker compose up -d

# 1) Apply the schema (idempotent — re-running applies nothing).
MEMORY_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_memory \
  npm run memory:migrate

# 2) Run the integration test: migration + pgvector + vector-search round-trip.
TEST_DATABASE_URL=postgres://postgres:postgres@localhost:5432/ai_memory \
  npm run test:memory:pg

# 3) Inspect with psql.
docker exec -it aios-memory-postgres \
  psql -U postgres -d ai_memory -c '\dx'              # vector extension present
docker exec -it aios-memory-postgres \
  psql -U postgres -d ai_memory -c '\d memory_chunks' # embedding vector(1024) + HNSW index

# Tear down (add -v to also delete the data volume).
docker compose down
```

`TEST_DATABASE_URL` makes the integration test **drop and recreate** the memory
tables — point it only at a throwaway database, never production.

---

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `no connection string` | Set `MEMORY_DATABASE_URL` (or `DATABASE_URL`). |
| `Cannot find module 'pg'` | Run `npm install` in `command-centre/` (adds the `pg` driver). |
| `extension "vector" is not available` | The server lacks pgvector. Use a `pgvector/pgvector` image. |
| `permission denied to create extension "vector"` | Run the migration as a superuser, or have one run `CREATE EXTENSION vector;` once. |
| `no pg_hba.conf entry ... no encryption` | Server requires SSL — set `PGSSLMODE=require` (or `no-verify`). |
| `The server does not support SSL connections` | Server has no SSL — set `PGSSLMODE=disable` (typical for a Railway private URL). |
| `Embedding dimension mismatch` | The database was built with a different dimension. Current memory uses BGE-M3 at 1024 dimensions. Run `scripts/setup-memory.sh` or `scripts/setup-memory.ps1`; hosted setup exports existing memory rows, re-embeds chunks with BGE-M3, rebuilds only AI-OS memory tables, then reindexes. |

## Related

- Schema design and scope model: [`memory-schema.md`](memory-schema.md)
- Backend selection (PGLite ↔ Postgres): see [Backend selection](#backend-selection) above
- Hosted ingest/search API: [`hosted-api.md`](hosted-api.md)
- Re-index existing memory into hosted Postgres: see [Seed the store](#seed-the-store-with-existing-memory)
- Backup & restore: [`backup-restore.md`](backup-restore.md)
