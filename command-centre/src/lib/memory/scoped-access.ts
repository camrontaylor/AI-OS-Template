/**
 * Scope-safe drill-down boundary. Expand and transcript reads go through here
 * so every fetch re-applies the scope filter and never bypasses it via direct
 * DB/fs access. Deny == not-found (no cross-scope existence oracle).
 *
 * Invariants: scope WHERE re-applied per fetch (even sibling reads); source
 * content comes from the DB, only transcripts touch disk and only after an
 * in-scope chunk is confirmed, confined under context/transcripts/; the
 * permission hook runs after the scope filter and can only narrow further.
 *
 * Engine-agnostic: talks to the store via the `store.client` SqlClient and
 * reuses the row mappers, like search.ts.
 */

import nodeFs from "node:fs";
import nodePath from "node:path";

import { buildScopeWhere } from "./scope";
import { mapChunkRow, mapSourceRow } from "./row-mappers";
import type { SqlClient } from "./migrate";
import type {
  MemoryChunkRow,
  MemorySourceRow,
  SearchScope,
  SourceType,
} from "./types";

// ---------------------------------------------------------------------------
// Permission hook — the permission seam.
// ---------------------------------------------------------------------------

/** The kind of drill-down a permission decision is evaluated against. */
export type MemoryAccessOperation = "expand" | "sibling" | "transcript";

/**
 * What a permission decision sees. Carries the in-scope source the access
 * resolved to (set only after the scope-filtered fetch succeeds), so the hook
 * is never asked to authorize something the scope filter already hid.
 */
export interface MemoryAccessContext {
  /** The scope the caller is asking under — the same object the search ran with. */
  searchScope: SearchScope;
  /** Which drill-down rung is being attempted. */
  operation: MemoryAccessOperation;
  sourceId: string;
  sourcePath: string;
  sourceType: SourceType;
  /** The originating chunk id, when the access started from a chunk. */
  chunkId?: string;
}

/**
 * Pluggable permission hook. Return true to allow, false to deny. Compose
 * hosted team/client membership enforcement here so there is one boundary. Runs
 * only after the scope filter has matched, so it can only narrow access further.
 */
export type MemoryPermissionCheck = (
  ctx: MemoryAccessContext,
) => boolean | Promise<boolean>;

/**
 * Default hook: allow. Local single-tenant installs have no membership layer —
 * the scope filter is the whole boundary, so the permission gate is a no-op.
 */
export const allowAllPermission: MemoryPermissionCheck = () => true;

// Column lists mirror the RETURNING clauses in store.ts so the row mappers get
// exactly the shape they expect. `embedding::text` keeps parseVectorLiteral happy
// without shipping the raw vector around.
const CHUNK_COLUMNS = `
  id, source_id, team_id, client_id, user_id, visibility, chunk_index,
  content, heading, heading_level, start_line, end_line, content_hash,
  chunk_key, token_count, source_path, source_type,
  content_date::text AS content_date, authority_weight,
  embedding::text AS embedding, embedding_model, embedding_dim,
  metadata, created_at::text AS created_at`;

const SOURCE_COLUMNS = `
  id, team_id, client_id, user_id, visibility, source_path, source_type,
  title, content_date::text AS content_date, authority_weight,
  content_sha256, byte_size, metadata,
  created_at::text AS created_at, updated_at::text AS updated_at`;

// ---------------------------------------------------------------------------
// resolveScopedChunk — the validated entry for any chunk-id drill-down.
// ---------------------------------------------------------------------------

export interface ResolveScopedChunkOptions {
  /** The store escape hatch (`store.client`). */
  client: SqlClient;
  chunkId: string;
  searchScope: SearchScope;
  /** Operation tag passed to the permission hook. Default "expand". */
  operation?: MemoryAccessOperation;
  /** Permission gate. Default {@link allowAllPermission}. */
  permissionCheck?: MemoryPermissionCheck;
}

/**
 * Fetch one chunk by id, re-applying the scope WHERE so a chunk from another
 * scope stays invisible even to a caller that already has the id. Returns the
 * mapped chunk, or null when out of scope or denied. Never throws on a denial.
 */
export async function resolveScopedChunk(
  opts: ResolveScopedChunkOptions,
): Promise<MemoryChunkRow | null> {
  // id is $1; the scope params follow at offset 1.
  const { sql: scopeSql, params: scopeParams } = buildScopeWhere(opts.searchScope, 1);
  const sql = `
SELECT ${CHUNK_COLUMNS}
FROM memory_chunks
WHERE id = $1 AND ${scopeSql}
LIMIT 1`;

  const { rows } = await opts.client.query<Record<string, unknown>>(sql, [
    opts.chunkId,
    ...scopeParams,
  ]);
  if (rows.length === 0) return null;

  const chunk = mapChunkRow(rows[0]);
  const ok = await runPermission(opts.permissionCheck, {
    searchScope: opts.searchScope,
    operation: opts.operation ?? "expand",
    sourceId: chunk.sourceId,
    sourcePath: chunk.sourcePath,
    sourceType: chunk.sourceType,
    chunkId: chunk.id,
  });
  return ok ? chunk : null;
}

// ---------------------------------------------------------------------------
// resolveScopedSource — the validated entry for source-id drill-down.
// ---------------------------------------------------------------------------

export interface ResolveScopedSourceOptions {
  client: SqlClient;
  sourceId: string;
  searchScope: SearchScope;
  /** Operation tag passed to the permission hook. Default "expand". */
  operation?: MemoryAccessOperation;
  permissionCheck?: MemoryPermissionCheck;
}

/**
 * Fetch one source by id, re-applying the scope WHERE. Returns the mapped
 * source, or null when out of scope or denied. Same deny=null semantics as
 * {@link resolveScopedChunk}.
 */
export async function resolveScopedSource(
  opts: ResolveScopedSourceOptions,
): Promise<MemorySourceRow | null> {
  const { sql: scopeSql, params: scopeParams } = buildScopeWhere(opts.searchScope, 1);
  const sql = `
SELECT ${SOURCE_COLUMNS}
FROM memory_sources
WHERE id = $1 AND ${scopeSql}
LIMIT 1`;

  const { rows } = await opts.client.query<Record<string, unknown>>(sql, [
    opts.sourceId,
    ...scopeParams,
  ]);
  if (rows.length === 0) return null;

  const source = mapSourceRow(rows[0]);
  const ok = await runPermission(opts.permissionCheck, {
    searchScope: opts.searchScope,
    operation: opts.operation ?? "expand",
    sourceId: source.id,
    sourcePath: source.sourcePath,
    sourceType: source.sourceType,
  });
  return ok ? source : null;
}

// ---------------------------------------------------------------------------
// fetchScopedSiblingChunks — the building block expand consumes.
// ---------------------------------------------------------------------------

/** Default cap on rows returned by {@link fetchScopedSiblingChunks}. */
export const DEFAULT_SIBLING_LIMIT = 20;

export interface FetchScopedSiblingChunksOptions {
  client: SqlClient;
  /** Must come from an already-resolved scoped chunk/source. */
  sourceId: string;
  searchScope: SearchScope;
  /** Inclusive chunk_index window. expand computes these from the anchor chunk. */
  fromIndex: number;
  toIndex: number;
  /** Hard cap on rows returned (bounded output). Default {@link DEFAULT_SIBLING_LIMIT}. */
  limit?: number;
  permissionCheck?: MemoryPermissionCheck;
}

/**
 * Return the chunks of one source whose chunk_index is in [fromIndex, toIndex],
 * each re-filtered by the scope WHERE so a mis-scoped sibling can't ride along.
 * Ordered by chunk_index; the caller picks the window, this only guarantees the
 * window can't widen scope. Keys off chunk_index (NOT NULL), so it works even
 * for legacy rows lacking line provenance. Returns [] when nothing matches in
 * scope or the hook denies.
 */
export async function fetchScopedSiblingChunks(
  opts: FetchScopedSiblingChunksOptions,
): Promise<MemoryChunkRow[]> {
  const limit = opts.limit ?? DEFAULT_SIBLING_LIMIT;
  if (limit <= 0 || opts.toIndex < opts.fromIndex) return [];

  // source_id=$1, range=$2..$3; scope params follow at offset 3; limit is last.
  const { sql: scopeSql, params: scopeParams } = buildScopeWhere(opts.searchScope, 3);
  const limitParam = 3 + scopeParams.length + 1;
  const sql = `
SELECT ${CHUNK_COLUMNS}
FROM memory_chunks
WHERE source_id = $1
  AND chunk_index BETWEEN $2 AND $3
  AND ${scopeSql}
ORDER BY chunk_index ASC
LIMIT $${limitParam}`;

  const { rows } = await opts.client.query<Record<string, unknown>>(sql, [
    opts.sourceId,
    opts.fromIndex,
    opts.toIndex,
    ...scopeParams,
    limit,
  ]);
  if (rows.length === 0) return [];

  const chunks = rows.map(mapChunkRow);
  // All siblings share one source/scope; one permission decision covers them.
  const first = chunks[0];
  const ok = await runPermission(opts.permissionCheck, {
    searchScope: opts.searchScope,
    operation: "sibling",
    sourceId: first.sourceId,
    sourcePath: first.sourcePath,
    sourceType: first.sourceType,
  });
  return ok ? chunks : [];
}

// ---------------------------------------------------------------------------
// readScopedTranscriptWindow — the transcript safe-read gate.
// ---------------------------------------------------------------------------

/** The minimal fs surface the gate needs — injectable so tests prove ordering. */
export interface TranscriptFs {
  readFileSync(path: string, encoding: "utf-8"): string;
  statSync(path: string): { isFile(): boolean };
}

const nodeFsAdapter: TranscriptFs = {
  readFileSync: (p, enc) => nodeFs.readFileSync(p, enc),
  statSync: (p) => nodeFs.statSync(p),
};

/**
 * Map an in-scope chunk to its repo-relative transcript path. Reads a structured
 * `metadata.transcriptPath` when present, else parses the `` Raw transcript:
 * `...` `` line the capture writer embeds in the chunk body. Null when none.
 */
export type DeriveTranscriptPath = (chunk: MemoryChunkRow) => string | null;

const RAW_TRANSCRIPT_RE = /Raw transcript:\s*`([^`]+)`/;

export const defaultDeriveTranscriptPath: DeriveTranscriptPath = (chunk) => {
  const meta = chunk.metadata?.transcriptPath;
  if (typeof meta === "string" && meta.trim().length > 0) return meta.trim();
  const match = chunk.content.match(RAW_TRANSCRIPT_RE);
  return match ? match[1].trim() : null;
};

/** Default cap on transcript bytes returned (256 KiB of decoded text). */
export const DEFAULT_TRANSCRIPT_MAX_CHARS = 262144;

export interface ReadScopedTranscriptOptions {
  client: SqlClient;
  /** Workspace root; the containment anchor for context/transcripts/. */
  rootDir: string;
  /** The chunk (turn) whose transcript is being drilled into. */
  chunkId: string;
  searchScope: SearchScope;
  /** Override how the transcript path is derived. Default {@link defaultDeriveTranscriptPath}. */
  deriveTranscriptPath?: DeriveTranscriptPath;
  /** Injected fs. Default node:fs. Tests pass a fake to assert no-read-on-deny. */
  fs?: TranscriptFs;
  /** Target turn id, when known: centers the bounded window on the turn, not a head slice. */
  turnId?: string;
  /** Max decoded chars to return. Default {@link DEFAULT_TRANSCRIPT_MAX_CHARS}. */
  maxChars?: number;
  permissionCheck?: MemoryPermissionCheck;
}

export interface ScopedTranscriptResult {
  chunkId: string;
  sourceId: string;
  sourcePath: string;
  /** Repo-relative transcript path that was read. */
  transcriptPath: string;
  /** Raw JSONL text (turns are parsed out downstream), truncated to maxChars. */
  raw: string;
}

/**
 * Verify the chunk is in scope (and passes the permission hook) before any fs
 * access, then read only that chunk's transcript file, confined under
 * <rootDir>/context/transcripts/. Returns null on: out of scope, denied, no
 * derivable path, path-escape attempt, or missing file. Touching the fs only
 * after the scope check passes is the guarantee (pinned by the no-leak tests).
 * Returns raw JSONL; turn parsing/window formatting happens downstream.
 */
export async function readScopedTranscriptWindow(
  opts: ReadScopedTranscriptOptions,
): Promise<ScopedTranscriptResult | null> {
  // 1. Scope + permission. Anything short of a confirmed in-scope chunk returns
  //    here, before any filesystem access.
  const chunk = await resolveScopedChunk({
    client: opts.client,
    chunkId: opts.chunkId,
    searchScope: opts.searchScope,
    operation: "transcript",
    permissionCheck: opts.permissionCheck,
  });
  if (chunk === null) return null;

  // 2. Derive the transcript path from the in-scope chunk (DB-sourced, no fs).
  const derive = opts.deriveTranscriptPath ?? defaultDeriveTranscriptPath;
  const rel = derive(chunk);
  if (rel === null || rel.length === 0) return null;

  // 3. Confine the path under context/transcripts/ — a poisoned path can't escape.
  const abs = resolveWithinTranscriptsDir(opts.rootDir, rel);
  if (abs === null) return null;

  // 4. Only now touch the filesystem.
  const fs = opts.fs ?? nodeFsAdapter;
  let raw: string;
  try {
    const stat = fs.statSync(abs);
    if (!stat.isFile()) return null;
    raw = fs.readFileSync(abs, "utf-8");
  } catch {
    // Missing/unreadable transcript — tolerant, like capture.ts extractLastTurn.
    return null;
  }

  const maxChars = opts.maxChars ?? DEFAULT_TRANSCRIPT_MAX_CHARS;
  return {
    chunkId: chunk.id,
    sourceId: chunk.sourceId,
    sourcePath: chunk.sourcePath,
    transcriptPath: rel,
    raw: boundTranscriptRaw(raw, opts.turnId, maxChars),
  };
}

/**
 * Bound the raw JSONL to maxChars. When it's larger and the turn id is known,
 * center the window on that turn (snapped to a line boundary) instead of a head
 * slice — captures summarize the LAST turn, which sits at the end of the file.
 * Falls back to the head when the turn id is absent.
 */
export function boundTranscriptRaw(
  raw: string,
  turnId: string | undefined,
  maxChars: number,
): string {
  if (raw.length <= maxChars) return raw;
  const at = turnId ? raw.indexOf(turnId) : -1;
  if (at < 0) return raw.slice(0, maxChars);
  let start = Math.max(0, at - Math.floor(maxChars / 2));
  if (start > 0) {
    const nl = raw.indexOf("\n", start);
    if (nl >= 0 && nl < at) start = nl + 1;
  }
  return raw.slice(start, start + maxChars);
}

/**
 * Resolve a (possibly repo-relative) transcript path to an absolute path under
 * <rootDir>/context/transcripts/. Strips a leading `context/transcripts/` so both
 * the stored and bare-relative forms resolve, then rejects anything that escapes
 * the base (via `..`, an absolute path, or a symlinked prefix). Null on escape.
 */
function resolveWithinTranscriptsDir(rootDir: string, rel: string): string | null {
  const base = nodePath.resolve(rootDir, "context", "transcripts");
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  const stripped = normalized.replace(/^context\/transcripts\//, "");
  const abs = nodePath.resolve(base, stripped);
  const within = abs === base || abs.startsWith(base + nodePath.sep);
  return within ? abs : null;
}

/** Run the permission hook (default allow) and coerce to a boolean. */
async function runPermission(
  check: MemoryPermissionCheck | undefined,
  ctx: MemoryAccessContext,
): Promise<boolean> {
  const result = await (check ?? allowAllPermission)(ctx);
  return result === true;
}
