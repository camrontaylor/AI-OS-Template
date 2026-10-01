/**
 * Memory Schema — the single-source ingest pipeline.
 *
 * The per-source half of the indexer, extracted so the SAME pipeline serves two
 * transports:
 *
 *   - the filesystem indexer (indexer.ts) — discovery feeds it file contents
 *   - the hosted memory API (api.ts) — an HTTP body feeds it raw content
 *
 * One pipeline, two entry points — CLI-indexed and API-ingested memory can
 * never drift apart (the same philosophy as the backend-selection seam in
 * backend.ts: one rule, not parallel code paths).
 *
 * The pipeline, per source:
 *
 *   sha256 (computed when absent) → skip-if-unchanged → upsert source →
 *   chunk → embed in batches → upsert chunks → prune stale chunks →
 *   record an index_jobs audit row.
 *
 * Scope is REQUIRED and validated up front — explicit scope at ingest time, not
 * a default.
 */

import crypto from "node:crypto";

import type { MemoryStore } from "./store";
import type { Embedder } from "./embedder";
import { assertValidScope, normalizeScope } from "./scope";
import { parseVectorLiteral } from "./embedding";
import {
  chunkMarkdown,
  parseCaptureBlocks,
  captureMetadataForChunk,
  type Chunk,
} from "./chunker";
import type { IndexJobReason, Scope, SourceStatus, SourceType } from "./types";

export interface IngestContentOptions {
  store: MemoryStore;
  embedder: Embedder;
  /** The source's scope. REQUIRED and validated. */
  scope: Scope;
  /** Repo-relative, forward-slash path identifying the source (UNIQUE per scope). */
  sourcePath: string;
  sourceType: SourceType;
  title?: string | null;
  createdByUserId?: string | null;
  /** ISO `YYYY-MM-DD`, or null. Drives recency reranking downstream. */
  contentDate?: string | null;
  authorityWeight?: number;
  /** The normalized source text to chunk + embed. */
  content: string;
  /** sha256 of `content`. Computed here when omitted (the API path). */
  contentSha256?: string;
  /** Byte size of `content`. Computed here when omitted. */
  byteSize?: number | null;
  /** Re-embed even when the content hash is unchanged. */
  force?: boolean;
  /** Record index_jobs audit rows. Default true. */
  trackJobs?: boolean;
  /** Why this ingest ran — tagged on the index_jobs row. Default 'manual'. */
  reason?: IndexJobReason;
  /** Chunks embedded per model call. Default 32. */
  batchSize?: number;
  metadata?: Record<string, unknown>;
}

export interface IngestContentResult {
  /** The source row id (existing id when skipped). */
  sourceId: string;
  /** True when the content hash was unchanged and nothing was re-embedded. */
  skipped: boolean;
  chunksInserted: number;
  chunksPruned: number;
}

interface ExistingSource {
  id: string;
  contentSha256: string;
  modelCompatible: boolean;
}

interface KeyedChunk extends Chunk {
  chunkKey: string;
}

interface EmbeddingSpec {
  model: string;
  dim: number;
}

export interface PreparedIngestChunk extends Chunk {
  chunkKey?: string | null;
  embedding: number[];
}

export interface IngestPreparedContentOptions {
  store: MemoryStore;
  /** The source's scope. REQUIRED and validated. */
  scope: Scope;
  /** Repo-relative, forward-slash path identifying the source (UNIQUE per scope). */
  sourcePath: string;
  sourceType: SourceType;
  title?: string | null;
  createdByUserId?: string | null;
  /** ISO `YYYY-MM-DD`, or null. Drives recency reranking downstream. */
  contentDate?: string | null;
  authorityWeight?: number;
  /** sha256 of the original source content, computed by the client. */
  contentSha256: string;
  /** Byte size of the original source content, computed by the client. */
  byteSize?: number | null;
  /** Client-provided embedding model identifier. */
  embeddingModel: string;
  /** Client-provided embedding dimension. */
  embeddingDim: number;
  /** Client-chunked rows with embeddings already attached. */
  chunks: PreparedIngestChunk[];
  /** Re-index even when the content hash is unchanged. */
  force?: boolean;
  /** Record index_jobs audit rows. Default true. */
  trackJobs?: boolean;
  /** Why this ingest ran — tagged on the index_jobs row. Default 'manual'. */
  reason?: IndexJobReason;
  metadata?: Record<string, unknown>;
}

/** sha256 hex digest of a string (the content-change detection key). */
export function sha256Hex(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex");
}

export interface BuildChunkKeyInput {
  sourcePath: string;
  startLine: number;
  endLine: number;
  contentHash: string;
  embeddingModel: string;
}

/** Stable chunk identity for one source line range + content + embedding model. */
export function buildChunkKey(input: BuildChunkKeyInput): string {
  const material = JSON.stringify([
    input.sourcePath,
    input.startLine,
    input.endLine,
    input.contentHash,
    input.embeddingModel,
  ]);
  return `chunk:v1:${sha256Hex(material)}`;
}

/**
 * Ingest ONE source's content into the store: skip-if-unchanged, upsert the
 * source row, chunk + embed + upsert chunks, prune stale chunks, and record the
 * index_jobs audit trail. Idempotent — re-ingesting identical content is a
 * no-op (`skipped: true`) unless `force` is set.
 */
export async function ingestContent(
  opts: IngestContentOptions,
): Promise<IngestContentResult> {
  const {
    store,
    embedder,
    scope: requestedScope,
    sourcePath,
    sourceType,
    content,
    force = false,
    trackJobs = true,
    reason = "manual",
    batchSize = 32,
  } = opts;

  const scope = normalizeScope(requestedScope);
  assertValidScope(scope);
  if (embedder.dim !== store.embedDim) {
    throw new Error(
      `ingestContent: embedder dim ${embedder.dim} != store embedDim ` +
        `${store.embedDim}. They must match.`,
    );
  }

  const contentSha256 = opts.contentSha256 ?? sha256Hex(content);
  const byteSize = opts.byteSize ?? Buffer.byteLength(content, "utf-8");

  const existing = await findExistingSource(store, scope, sourcePath, embedder);
  let statusSourceId: string | null = existing?.id ?? null;

  // Idempotent skip — content unchanged since the last ingest and the current
  // chunks were produced by the same embedding model/dimension.
  if (existing && existing.contentSha256 === contentSha256 && existing.modelCompatible && !force) {
    if (trackJobs) {
      await recordJob(store, scope, sourcePath, reason, "skipped", existing.id);
    }
    await updateSourceLifecycle(store, existing.id, "indexed", null);
    return {
      sourceId: existing.id,
      skipped: true,
      chunksInserted: 0,
      chunksPruned: 0,
    };
  }

  const jobId = trackJobs
    ? await recordJobStart(store, scope, sourcePath, reason)
    : null;

  try {
    const src = await store.insertSource({
      scope,
      sourcePath,
      sourceType,
      title: opts.title ?? null,
      createdByUserId: opts.createdByUserId ?? null,
      contentDate: opts.contentDate ?? null,
      authorityWeight: opts.authorityWeight,
      contentSha256,
      byteSize,
      status: "indexing",
      errorMessage: null,
      indexedAt: null,
      archivedAt: null,
      metadata: opts.metadata,
    });
    statusSourceId = src.id;

    const chunks = chunkMarkdown(content).map((chunk): KeyedChunk => ({
      ...chunk,
      chunkKey: buildChunkKey({
        sourcePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        contentHash: chunk.contentHash,
        embeddingModel: embedder.model,
      }),
    }));
    // Capture-block provenance (turn id + transcript path) for the transcript
    // recall rung. Empty for non-capture sources, so this is a no-op there.
    const captureBlocks = parseCaptureBlocks(content);
    const embeddingsByKey = force
      ? new Map<string, number[]>()
      : await findReusableChunkEmbeddings(
          store,
          src.id,
          chunks.map((chunk) => chunk.chunkKey),
        );
    const chunksToEmbed = chunks.filter((chunk) => !embeddingsByKey.has(chunk.chunkKey));
    let chunksInserted = 0;

    for (let start = 0; start < chunksToEmbed.length; start += batchSize) {
      const batch = chunksToEmbed.slice(start, start + batchSize);
      const embeddings = await embedder.embed(batch.map((c) => c.content));
      for (let i = 0; i < batch.length; i += 1) {
        const chunk = batch[i];
        const embedding = embeddings[i];
        if (embedding.length !== store.embedDim) {
          throw new Error(
            `embedder returned dim ${embedding.length}, expected ${store.embedDim}`,
          );
        }
        embeddingsByKey.set(chunk.chunkKey, embedding);
      }
    }

    for (const chunk of chunks) {
      const embedding = embeddingsByKey.get(chunk.chunkKey);
      if (!embedding) {
        throw new Error(`Missing embedding for chunk key ${chunk.chunkKey}`);
      }
      const captureMeta =
        captureBlocks.length > 0 ? captureMetadataForChunk(chunk, captureBlocks) : null;
      await store.insertChunk({
        sourceId: src.id,
        sourceScope: scope,
        chunkScope: scope,
        chunkIndex: chunk.index,
        content: chunk.content,
        heading: chunk.heading,
        headingLevel: chunk.headingLevel,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        contentHash: chunk.contentHash,
        chunkKey: chunk.chunkKey,
        tokenCount: chunk.tokenCount,
        sourcePath,
        sourceType,
        contentDate: opts.contentDate ?? null,
        authorityWeight: opts.authorityWeight,
        embedding,
        embeddingModel: embedder.model,
        embeddingDim: embedder.dim,
        metadata: captureMeta ?? undefined,
      });
      chunksInserted += 1;
    }

    // Prune stale chunks left from previous versions of this source.
    const chunksPruned = await pruneChunks(
      store,
      src.id,
      chunks.map((chunk) => chunk.chunkKey),
    );

    if (jobId) await recordJobFinish(store, jobId, "succeeded", src.id, null);
    await updateSourceLifecycle(store, src.id, "indexed", null);

    return { sourceId: src.id, skipped: false, chunksInserted, chunksPruned };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (statusSourceId) {
      await updateSourceLifecycle(store, statusSourceId, "failed", message);
    }
    if (jobId) {
      await recordJobFinish(store, jobId, "failed", statusSourceId, message);
    }
    throw error;
  }
}

/**
 * Ingest ONE source whose chunks and embeddings were already produced by the
 * client. This is the hosted Team OS API path: the server validates and stores
 * vectors, but never loads or runs an embedding model.
 */
export async function ingestPreparedContent(
  opts: IngestPreparedContentOptions,
): Promise<IngestContentResult> {
  const {
    store,
    scope: requestedScope,
    sourcePath,
    sourceType,
    contentSha256,
    embeddingModel,
    embeddingDim,
    force = false,
    trackJobs = true,
    reason = "manual",
  } = opts;

  const scope = normalizeScope(requestedScope);
  assertValidScope(scope);
  if (embeddingDim !== store.embedDim) {
    throw new Error(
      `ingestPreparedContent: embedding dim ${embeddingDim} != store embedDim ` +
        `${store.embedDim}. They must match.`,
    );
  }

  const byteSize = opts.byteSize ?? null;
  const spec = { model: embeddingModel, dim: embeddingDim };
  const existing = await findExistingSource(store, scope, sourcePath, spec);
  let statusSourceId: string | null = existing?.id ?? null;

  if (existing && existing.contentSha256 === contentSha256 && existing.modelCompatible && !force) {
    if (trackJobs) {
      await recordJob(store, scope, sourcePath, reason, "skipped", existing.id);
    }
    await updateSourceLifecycle(store, existing.id, "indexed", null);
    return {
      sourceId: existing.id,
      skipped: true,
      chunksInserted: 0,
      chunksPruned: 0,
    };
  }

  const jobId = trackJobs
    ? await recordJobStart(store, scope, sourcePath, reason)
    : null;

  try {
    const src = await store.insertSource({
      scope,
      sourcePath,
      sourceType,
      title: opts.title ?? null,
      createdByUserId: opts.createdByUserId ?? null,
      contentDate: opts.contentDate ?? null,
      authorityWeight: opts.authorityWeight,
      contentSha256,
      byteSize,
      status: "indexing",
      errorMessage: null,
      indexedAt: null,
      archivedAt: null,
      metadata: opts.metadata,
    });
    statusSourceId = src.id;

    const chunks = opts.chunks.map((chunk): PreparedIngestChunk & { chunkKey: string } => {
      const normalizedHash = chunk.contentHash || sha256Hex(chunk.content);
      return {
        ...chunk,
        contentHash: normalizedHash,
        chunkKey: chunk.chunkKey || buildChunkKey({
          sourcePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          contentHash: normalizedHash,
          embeddingModel,
        }),
      };
    });

    let chunksInserted = 0;
    for (const chunk of chunks) {
      if (chunk.embedding.length !== store.embedDim) {
        throw new Error(
          `prepared embedding has ${chunk.embedding.length} dimensions, expected ${store.embedDim}`,
        );
      }
      await store.insertChunk({
        sourceId: src.id,
        sourceScope: scope,
        chunkScope: scope,
        chunkIndex: chunk.index,
        content: chunk.content,
        heading: chunk.heading,
        headingLevel: chunk.headingLevel,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        contentHash: chunk.contentHash,
        chunkKey: chunk.chunkKey,
        tokenCount: chunk.tokenCount,
        sourcePath,
        sourceType,
        contentDate: opts.contentDate ?? null,
        authorityWeight: opts.authorityWeight,
        embedding: chunk.embedding,
        embeddingModel,
        embeddingDim,
      });
      chunksInserted += 1;
    }

    const chunksPruned = await pruneChunks(
      store,
      src.id,
      chunks.map((chunk) => chunk.chunkKey),
    );

    if (jobId) await recordJobFinish(store, jobId, "succeeded", src.id, null);
    await updateSourceLifecycle(store, src.id, "indexed", null);

    return { sourceId: src.id, skipped: false, chunksInserted, chunksPruned };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (statusSourceId) {
      await updateSourceLifecycle(store, statusSourceId, "failed", message);
    }
    if (jobId) {
      await recordJobFinish(store, jobId, "failed", statusSourceId, message);
    }
    throw error;
  }
}

export interface DeleteSourceOptions {
  /** Why this delete ran — tagged on the index_jobs row. Default 'file_change'. */
  reason?: IndexJobReason;
  /** Record an index_jobs audit row. Default true. */
  trackJobs?: boolean;
}

export interface DeleteSourceResult {
  /** False when no source matched scope + sourcePath (a no-op, not an error). */
  deleted: boolean;
  /** The deleted source's id, or null when nothing matched. */
  sourceId: string | null;
}

/**
 * Delete a source (and its chunks, via ON DELETE CASCADE) when its file is gone
 * from disk. The indexer is pull-based and never notices a file's absence, so
 * callers that do (e.g. a watcher's unlink event) call this directly. A no-op
 * (`deleted: false`) when nothing matches scope + sourcePath.
 */
export async function deleteSource(
  store: MemoryStore,
  requestedScope: Scope,
  sourcePath: string,
  opts: DeleteSourceOptions = {},
): Promise<DeleteSourceResult> {
  const scope = normalizeScope(requestedScope);
  assertValidScope(scope);
  const { reason = "file_change", trackJobs = true } = opts;

  const jobId = trackJobs ? await recordJobStart(store, scope, sourcePath, reason) : null;

  try {
    const { rows } = await store.client.query<{ id: string }>(
      `DELETE FROM memory_sources
        WHERE source_path = $1 AND visibility = $2
          AND COALESCE(team_id, '')   = COALESCE($3, '')
          AND COALESCE(client_id, '') = COALESCE($4, '')
          AND COALESCE(user_id, '')   = COALESCE($5, '')
        RETURNING id`,
      [sourcePath, scope.visibility, scope.teamId, scope.clientId, scope.userId],
    );
    const sourceId = rows[0]?.id ?? null;

    // sourceId is already gone by now — index_jobs.source_id is ON DELETE SET
    // NULL, not a dangling reference, so the finish row must point at null too.
    if (jobId) await recordJobFinish(store, jobId, "succeeded", null, null);

    return { deleted: sourceId !== null, sourceId };
  } catch (error) {
    if (jobId) {
      const message = error instanceof Error ? error.message : String(error);
      await recordJobFinish(store, jobId, "failed", null, message);
    }
    throw error;
  }
}

async function findExistingSource(
  store: MemoryStore,
  scope: Scope,
  sourcePath: string,
  embedder?: EmbeddingSpec,
): Promise<ExistingSource | null> {
  const { rows } = await store.client.query<{
    id: string;
    content_sha256: string;
  }>(
    `SELECT id, content_sha256 FROM memory_sources
      WHERE source_path = $1 AND visibility = $2
        AND COALESCE(team_id, '')   = COALESCE($3, '')
        AND COALESCE(client_id, '') = COALESCE($4, '')
        AND COALESCE(user_id, '')   = COALESCE($5, '')
      LIMIT 1`,
    [sourcePath, scope.visibility, scope.teamId, scope.clientId, scope.userId],
  );
  if (rows.length === 0) return null;
  if (!embedder) {
    return { id: rows[0].id, contentSha256: rows[0].content_sha256, modelCompatible: true };
  }

  const chunkCheck = await store.client.query<{ n: number }>(
    `SELECT count(*)::int AS n
      FROM memory_chunks
      WHERE source_id = $1
        AND embedding IS NOT NULL
        AND (COALESCE(embedding_model, '') <> $2 OR COALESCE(embedding_dim, -1) <> $3)`,
    [rows[0].id, embedder.model, embedder.dim],
  );

  return {
    id: rows[0].id,
    contentSha256: rows[0].content_sha256,
    modelCompatible: Number(chunkCheck.rows[0]?.n ?? 0) === 0,
  };
}

async function findReusableChunkEmbeddings(
  store: MemoryStore,
  sourceId: string,
  chunkKeys: string[],
): Promise<Map<string, number[]>> {
  if (chunkKeys.length === 0) return new Map();
  const { rows } = await store.client.query<{ chunk_key: string; embedding: unknown }>(
    `SELECT chunk_key, embedding::text AS embedding
       FROM memory_chunks
      WHERE source_id = $1
        AND chunk_key = ANY($2::text[])
        AND embedding IS NOT NULL`,
    [sourceId, pgTextArrayLiteral(chunkKeys)],
  );

  const out = new Map<string, number[]>();
  for (const row of rows) {
    const embedding = parseVectorLiteral(row.embedding);
    if (embedding) out.set(row.chunk_key, embedding);
  }
  return out;
}

async function pruneChunks(
  store: MemoryStore,
  sourceId: string,
  keepChunkKeys: string[],
): Promise<number> {
  const { rows } = await store.client.query<{ id: string }>(
    `DELETE FROM memory_chunks
      WHERE source_id = $1
        AND (chunk_key IS NULL OR NOT (chunk_key = ANY($2::text[])))
      RETURNING id`,
    [sourceId, pgTextArrayLiteral(keepChunkKeys)],
  );
  return rows.length;
}

function pgTextArrayLiteral(items: string[]): string {
  if (items.length === 0) return "{}";
  return `{${items
    .map((item) => `"${String(item).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`)
    .join(",")}}`;
}

async function recordJobStart(
  store: MemoryStore,
  scope: Scope,
  sourcePath: string,
  reason: IndexJobReason,
): Promise<string> {
  const { rows } = await store.client.query<{ id: string }>(
    `INSERT INTO index_jobs
       (team_id, client_id, user_id, visibility, source_path, reason, status,
        attempts, started_at)
     VALUES ($1, $2, $3, $4, $5, $6, 'running', 1, now())
     RETURNING id`,
    [scope.teamId, scope.clientId, scope.userId, scope.visibility, sourcePath, reason],
  );
  return rows[0].id;
}

async function recordJobFinish(
  store: MemoryStore,
  jobId: string,
  status: "succeeded" | "failed",
  sourceId: string | null,
  errorMessage: string | null,
): Promise<void> {
  await store.client.query(
    `UPDATE index_jobs
        SET status = $2, source_id = $3, error_message = $4, finished_at = now()
      WHERE id = $1`,
    [jobId, status, sourceId, errorMessage],
  );
}

async function updateSourceLifecycle(
  store: MemoryStore,
  sourceId: string,
  status: SourceStatus,
  errorMessage: string | null,
): Promise<void> {
  await store.client.query(
    `UPDATE memory_sources
        SET status = $2,
            error_message = $3,
            indexed_at = CASE WHEN $2 = 'indexed' THEN now() ELSE indexed_at END,
            archived_at = CASE WHEN $2 = 'archived' THEN now() ELSE archived_at END,
            updated_at = now()
      WHERE id = $1`,
    [sourceId, status, errorMessage],
  );
}

/** Record a terminal job in one statement (used for skipped sources). */
async function recordJob(
  store: MemoryStore,
  scope: Scope,
  sourcePath: string,
  reason: IndexJobReason,
  status: "skipped",
  sourceId: string | null,
): Promise<void> {
  await store.client.query(
    `INSERT INTO index_jobs
       (team_id, client_id, user_id, visibility, source_path, source_id, reason,
        status, attempts, started_at, finished_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 1, now(), now())`,
    [scope.teamId, scope.clientId, scope.userId, scope.visibility, sourcePath, sourceId, reason, status],
  );
}
