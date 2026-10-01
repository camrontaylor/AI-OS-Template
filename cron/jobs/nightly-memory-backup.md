---
name: Nightly Memory Backup
time: '02:30'
days: daily
active: 'false'
memoryCapture: false
model: haiku
notify: on_failure
description: 'Backs up the hosted memory database nightly and keeps the 14 newest'
timeout: 20m
retry: '1'
---
You are running as a scheduled job for AI-OS.

Task: Take a nightly backup of the hosted team-memory database so it can be
restored after a lost host, a deleted volume, or a bad migration.

This job ships INACTIVE (`active: 'false'`). Enable it only once a hosted database
is configured (MEMORY_DATABASE_URL is set in the environment) AND you have a place
to copy the dump off-box. See docs/memory/backup-restore.md.

Steps:

1. From the repo root, run the backup with retention:
   - `cd command-centre && npm run memory:backup -- --keep 14`
   - With MEMORY_DATABASE_URL set this runs `pg_dump -Fc` against hosted Postgres
     and writes `backups/memory/ai_memory_<timestamp>.dump`, then prunes to
     the 14 newest backups.

2. Report the result:
   - Output the written file path and size from the command's summary.
   - If a destination is configured, copy/sync the new dump off the host (object
     storage, another server). A backup that stays on the same volume as the
     database does not survive losing that volume.

Notes:
- Requires the Postgres client tools (`pg_dump`) on PATH and `MEMORY_DATABASE_URL`
  pointing at the hosted database. Without a URL the command would target the
  LOCAL PGLite store instead — not what a team backup wants.
- Runs at 02:30, after the nightly index (23:45), so the day's captures are in the
  database before it is dumped.
- On failure, the job retries once automatically (retry: 1) and notifies.
- Restore any dump with: `npm run memory:restore -- <file> --yes` (add `--clean`
  to replace a broken database in place). Full steps in docs/memory/backup-restore.md.
