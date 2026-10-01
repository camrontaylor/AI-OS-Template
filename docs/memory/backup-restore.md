# Backup & restore hosted team memory

Back up the hosted memory database and restore it after a lost host, a deleted
volume, or a bad migration. The memory store is the team's shared source of
truth, so this is its recovery plan — kept to **two commands** so an operator
never has to remember a long `pg_dump` invocation.

> This guide assumes you have already provisioned hosted Postgres + pgvector,
> wired the `memory:*` commands to it, and seeded it from existing memory (see
> [`hosted-postgres-setup.md`](hosted-postgres-setup.md)). It covers backing that
> database up and getting it back. Cross-references at the end.

## What you get

- One command to back up whichever backend is configured — hosted Postgres or
  local PGLite: `npm run memory:backup`.
- One command to restore from a backup file: `npm run memory:restore -- <file>`.
- A ready-to-run nightly backup job (`cron/jobs/nightly-memory-backup.md`),
  shipped **off** so you can enable it once a destination is in place.

Both commands resolve the active engine through the same rule every memory
command uses (`MEMORY_DATABASE_URL` set → hosted Postgres, else local PGLite), so
you do not pick a strategy — the tool does.

## What's protected, and what's not

A database backup captures **everything inside the memory database**. A private GitHub
backup captures the source files used to rebuild that database, including
`context/memory/*.aos.md` summarized captures.

| Captured by a backup | Not captured (recover another way) |
|----------------------|-------------------------------------|
| `memory_sources`, `memory_chunks` (incl. the `vector(1024)` BGE-M3 embeddings) | The source markdown on disk (`context/memory/`, `context/learnings.md`) — lives in private git |
| `index_jobs` (the indexing/queue history) | Secrets / env (`MEMORY_DATABASE_URL`, `MEMORY_API_TOKEN`) — keep these in your secret manager |
| `search_events` (the audit trail of every scoped search) | The hosted host/volume itself — reprovision per [`hosted-postgres-setup.md`](hosted-postgres-setup.md) |
| `schema_migrations` (the applied schema version) | |

This split gives you **two recovery paths** — pick by what you lost:

1. **Regenerable memory (fastest for source-backed memory).** The memory corpus
   (daily logs, `.aos.md` summarized captures, and learnings) is
   derived from files in private git. If that is all you need, you do not even need
   a database backup: reprovision, `npm run memory:migrate`, then run
   `npm run memory:reindex -- --allow-local` for a private Solo rebuild or
   `npm run memory:reindex -- --visibility system` for an intentional hosted
   shared baseline.
2. **Full / non-regenerable recovery.** The `search_events` audit history and any
   database rows created from sources that are not in git cannot be rebuilt by
   re-indexing — they only come back from a database backup. Restore with
   `memory:restore`.

### Repair a local derived index

If a local index contains duplicate legacy scopes or an incomplete schema,
rebuild only the derived index:

```bash
cd command-centre
npm run memory:backup
npm run memory:reset -- --yes
npm run memory:reindex -- --allow-local --force
```

`memory:reset` preserves the Markdown sources and the stable local user
identity, recreates the current schema, and removes the bootstrap sentinel. It
refuses hosted Postgres because shared TeamOS data may not be reconstructible
from one machine. Normal updates never run this reset automatically.

> When in doubt, take database backups. Path 1 is a convenience for the
> source-backed corpus; path 2 is the real safety net.

## Prerequisites

The Postgres paths use the standard client tools `pg_dump` and `pg_restore`
(`backup`/`restore` of the local PGLite store only needs `tar`). Install them if
missing:

- macOS: `brew install libpq` (then add its `bin` to `PATH`), or `brew install postgresql@16`
- Debian/Ubuntu: `apt-get install postgresql-client`

The scripts print this hint if the tools are not found.

## Quick start

```bash
cd command-centre

# Back up the configured store → backups/memory/<name>_<timestamp>.dump (or .tar.gz)
MEMORY_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/ai_memory' \
  npm run memory:backup

# Restore it (destructive — requires --yes). Into a fresh, empty database:
MEMORY_DATABASE_URL='postgres://USER:PASSWORD@HOST:PORT/ai_memory' \
  npm run memory:restore -- backups/memory/ai_memory_20260612_031500.dump --yes
```

Without `--yes`, `memory:restore` prints exactly what it would run and exits —
a dry run, so you can confirm the target before overwriting it.

Backups are written to `<repo>/backups/memory/` by default (gitignored). Override
with `--out <dir>` or `MEMORY_BACKUP_DIR`. **Copy them off the box** — a backup
sitting on the same volume as the database does not survive losing that volume.

## Railway

Two layers, used together:

1. **Volume backups (platform-automatic, disk-level).** Your Postgres service
   stores data on a volume mounted at `/var/lib/postgresql/data`. Enable
   Railway's scheduled backups/snapshots for that volume in the service settings
   so the disk is captured without any cron of your own. (See the `use-railway`
   skill or Railway's docs for the exact UI — features vary by plan.) This is the
   zero-maintenance baseline.
2. **Logical dumps (portable, the recommended primary).** A `pg_dump` is
   Postgres-version-independent and restores into any pgvector database, on
   Railway or elsewhere — the safer bet for a clean restore. Run it against the
   **public** proxy URL from your machine (SSL on by default):

   ```bash
   cd command-centre
   MEMORY_DATABASE_URL='postgres://postgres:PASSWORD@HOST.proxy.rlwy.net:PORT/ai_memory' \
     npm run memory:backup -- --keep 14
   ```

   To run it *inside* Railway against the private URL, set `PGSSLMODE=disable`
   (the private URL offers no SSL), the same as `memory:migrate`.

## VPS (Docker)

The repo's compose file runs Postgres as `aios-memory-postgres` with its data in
the `aios_memory_pgdata` volume. Back it up the same way:

```bash
cd command-centre
MEMORY_DATABASE_URL='postgres://postgres:PASSWORD@localhost:5432/ai_memory' \
PGSSLMODE=disable npm run memory:backup -- --keep 14
```

Then ship the file in `backups/memory/` off the host (object storage, another
server, `rsync`/`scp`). A backup that never leaves the box is not a backup.

### Schedule it (automatic)

`cron/jobs/nightly-memory-backup.md` runs `memory:backup -- --keep 14` nightly
through the managed cron runtime. It ships **inactive** — turn it on once a real
target and an off-box destination are in place:

1. Edit the job and set `active: 'true'` (and `MEMORY_DATABASE_URL` in the job's
   environment / `.env`).
2. `bash scripts/start-crons.sh` (or rely on the Command Centre server).
3. `bash scripts/status-crons.sh` to confirm it is scheduled.

`--keep 14` prunes to the 14 newest backups in the destination so the directory
does not grow without bound. Add an off-box copy step for true durability.

## Restore: failed deployment or bad migration

A backup only matters if the restore works. Two situations:

**Into a fresh, empty database** (lost host / new Railway service / new VPS):

```bash
cd command-centre
# 1. Provision a new pgvector Postgres and point MEMORY_DATABASE_URL at it.
# 2. Restore — recreates the extension, schema, and all rows from the dump.
npm run memory:restore -- backups/memory/ai_memory_<ts>.dump --yes
# 3. Sanity-check the schema version and a search.
npm run memory:migrate -- --check
npm run memory:search -- "release process" --system
```

**Replace a broken state in place** (a bad migration left the live database
wrong). `--clean` drops and recreates objects before loading the dump:

```bash
npm run memory:restore -- backups/memory/ai_memory_<ts>.dump --clean --yes
```

The restore target **must run a `pgvector/pgvector` image** — the dump recreates
the `vector` extension. Restoring onto plain Postgres fails with
`extension "vector" is not available`.

## Local PGLite

With no `MEMORY_DATABASE_URL` set, the store is local PGLite at
`.command-centre/memory`. `memory:backup` packages the store together with
`.command-centre/local-memory-user.json` and a versioned manifest. Restore
opens the staged PGLite database, validates its memory schema and identity, then
installs the store and its private owner together.
The previous store and identity remain together under
`.command-centre/memory-restore-backup-<ts>-<pid>/` for rollback.

```bash
cd command-centre
npm run memory:backup                                            # → pglite_memory_<ts>.tar.gz
npm run memory:restore -- backups/memory/pglite_memory_<ts>.tar.gz --yes
npm run memory:status                                            # counts match the backup
```

If the workspace identity is missing during backup, the command uses the only
private `user_id` proven by the database without writing a new identity into the
live workspace. Missing or ambiguous ownership stops the backup; after verifying
the intended owner, retry with `memory:backup -- --local-user-id <id>`.

Backups made before the manifest existed are still accepted. If the legacy
archive contains `memory/local-user.json`, that identity is promoted to the
current location. Otherwise restore uses the only private `user_id` present in
the database. If there is no provable owner, or several private owners exist,
restore stops without changing the live set; select the intended owner
explicitly:

```bash
npm run memory:restore -- backups/memory/old-pglite.tar.gz \
  --local-user-id local-<expected-id> --yes
```

## Troubleshooting

| Symptom | Cause / fix |
|---------|-------------|
| `pg_dump`/`pg_restore` not found | Install the Postgres client tools (`brew install libpq`, `apt-get install postgresql-client`). |
| Restore: `extension "vector" is not available` | The target is plain Postgres. Use a `pgvector/pgvector` image (same as the source). |
| `this is a Postgres dump (.dump), but no hosted database is configured` | Set `MEMORY_DATABASE_URL` to the target database before restoring a `.dump`. |
| `pg_restore` exits non-zero on a populated database | Objects already exist. Restore into a fresh database, or re-run with `--clean`. |
| `server version mismatch` from `pg_dump` | Your client tools are older than the server. Install a `pg_dump` matching the server's major version. |
| SSL errors (`no encryption` / `does not support SSL`) | Set `PGSSLMODE` — `require`/`no-verify` for TLS, `disable` for a Railway private URL. |
| `Embedding dimension mismatch` after restore | The dump was built at a different dimension. Current memory uses BGE-M3 at 1024 dimensions; rebuild and reindex with `scripts/setup-memory.sh` or `scripts/setup-memory.ps1`. |
| Legacy PGLite restore reports ambiguous/missing ownership | Verify the intended private owner, then pass it with `--local-user-id`. The live store is not changed on this error. |

## Related

- Provisioning + schema: [`hosted-postgres-setup.md`](hosted-postgres-setup.md)
- Re-index existing memory (regenerable-memory recovery path): [Seed the store](hosted-postgres-setup.md#seed-the-store-with-existing-memory)
- Hosted ingest/search API: [`hosted-api.md`](hosted-api.md)
- Schema design and scope model: [`memory-schema.md`](memory-schema.md)
- Scheduled job: `cron/jobs/nightly-memory-backup.md`
