# Session Capture

Session capture runs from the Claude Stop hook. The hook itself returns immediately and
starts `command-centre/scripts/memory-capture.cjs` in the background.

## What Gets Written

- `context/memory/{YYYY-MM-DD}.aos.md` gets one summarized block per captured turn.
- `context/transcripts/{YYYY-MM-DD}/*.jsonl` stores a raw copy of the transcript.
- Both are machine-owned. The `.aos.md` file is indexed and tracked for private
  GitHub backups because it is the source for future re-chunking and re-embedding.
  Raw transcripts are local archives and are gitignored.

Each capture block includes a SHA-256 hash of the source turn. If the same Stop event is
replayed, the existing block is detected and nothing new is written.

## Summarizer Config

Defaults live in `context/memory-config.json`:

```json
{
  "capture": {
    "summarize": {
      "enabled": true,
      "provider": "claude",
      "model": "haiku",
      "timeout_ms": 120000
    }
  }
}
```

`provider` supports `claude`, `codex`, or `none`. Claude is the default and shells out to
`claude -p --model haiku --no-session-persistence` with `CLAUDECODE` removed from the
environment. Codex support is best-effort through `codex exec` with hooks disabled. If the
summarizer is missing, fails, or times out, capture writes a bounded fallback summary.

## Capture Scope

When Team OS is signed in, Stop-hook capture sends the captured session block to
the hosted Memory API as a raw capture event. The event is staging data: it is
not returned by recall and does not create `memory_sources` until consolidation
publishes a durable team/client memory. The local `.aos.md` file is still written
as the durable source for backup/replay.

Consolidation is not just embedding. The client claims a batch of staged
captures, sends the combined session block to Claude headless
(`claude -p --model haiku --no-session-persistence`), and asks for structured
JSON: publish clear durable memories, send uncertain/sensitive items to review,
or discard captures with no durable value. Only published items are embedded and
written to `memory_sources`.

The hosted server does not run the LLM consolidation step in the normal workflow.
It stores captures, enforces scope, issues claim tokens, and accepts the final
publish/review/discard result. Local user instances run
`memory-consolidation-tick.cjs`, which calls `memory-consolidate.cjs`. The tick
runs after capture, schedules a delayed retry for the capture quiet period, and
also runs from SessionStart/Command Centre status checks so captures do not stay
pending just because the first attempt was too early.

Local solo capture defaults to private local memory. The local user id is stored
under `.command-centre/local-memory-user.json`, so capture, bootstrap, reindex
and recall use the
same private scope without extra flags. Shared `system` capture is now only for
explicit admin/service paths.

| Mode | Required context | Default visibility | Access rule |
|------|------------------|--------------------|-------------|
| Local solo | none | `private` | Uses the stable local user id. |
| TeamOS root | saved Team OS login | staging `team` | Active member can stage; publication waits for consolidation. |
| TeamOS client | saved Team OS login + `clients/{slug}` cwd | staging `client` | Server validates client write access on capture/sync. |
| Direct hosted ingest | `--api-ingest`/`--team-api` + hosted auth | explicit | Legacy/admin path that writes final memory directly. |
| Hosted system | team + user + `MEMORY_CAPTURE_VISIBILITY=system` + `MEMORY_CAPTURE_ALLOW_SYSTEM=1` or `--allow-system` | explicit `system` | Admin/service only. Not used by normal Stop-hook capture. |

The same rules apply when passing `--team`, `--user`, `--client`, and
`--visibility` flags directly. Missing hosted scope fails closed instead of
falling back to shared memory.

## Manual Test

From `command-centre/`:

```bash
node scripts/memory-capture.cjs --session --session-id testrun --transcript "<path-to-transcript.jsonl>" --force
npm run memory:consolidate
npm run memory:status
```

Expected result:

- today's `.aos.md` file exists under `context/memory/`
- a raw `.jsonl` copy exists under `context/transcripts/{YYYY-MM-DD}/`
- when signed in to Team OS, the captured block appears as a pending capture event
- when signed out or using `--local`, `memory:status` shows today's capture as private local memory

Run the offline coverage with:

```bash
npm run test:memory
```
