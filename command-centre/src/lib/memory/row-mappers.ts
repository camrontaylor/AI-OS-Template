/**
 * AIOS Memory Schema — row mappers.
 *
 * SQL is snake_case; the TS contract in ./types is camelCase. These mappers are
 * the single place that bridges the two when reading rows out of the store, so
 * column renames touch exactly one file. Source/chunk, index_jobs, and
 * search_events row shapes are all mapped here.
 *
 * Numeric/date columns are normalized defensively: the store SELECTs cast
 * timestamps and `content_date` to `::text`, so values arrive as plain strings,
 * but `Number(...)`/`String(...)` keep the mappers robust across PGLite versions
 * and a future hosted-`pg` type parser.
 */

import { parseVectorLiteral } from "./embedding";
import type {
  ContextDocumentRow,
  ContextDocumentStatus,
  ContextDocumentVersionRow,
  ContextKind,
  IndexJobReason,
  IndexJobRow,
  IndexJobStatus,
  MemoryChunkRow,
  MemorySourceRow,
  SearchEventRow,
  SourceStatus,
  SourceType,
  Visibility,
} from "./types";

type Row = Record<string, unknown>;

/** Map a `memory_sources` row to {@link MemorySourceRow}. */
export function mapSourceRow(r: Row): MemorySourceRow {
  return {
    id: r.id as string,
    teamId: (r.team_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    visibility: r.visibility as Visibility,
    sourcePath: r.source_path as string,
    sourceType: r.source_type as SourceType,
    title: (r.title as string | null) ?? null,
    createdByUserId: (r.created_by_user_id as string | null) ?? null,
    contentDate: r.content_date == null ? null : String(r.content_date),
    authorityWeight: Number(r.authority_weight),
    contentSha256: r.content_sha256 as string,
    byteSize: r.byte_size == null ? null : Number(r.byte_size),
    status: (r.status as SourceStatus | null) ?? "indexed",
    errorMessage: (r.error_message as string | null) ?? null,
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
    indexedAt: r.indexed_at == null ? null : String(r.indexed_at),
    archivedAt: r.archived_at == null ? null : String(r.archived_at),
  };
}

/** Map a `memory_chunks` row to {@link MemoryChunkRow}. */
export function mapChunkRow(r: Row): MemoryChunkRow {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    teamId: (r.team_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    visibility: r.visibility as Visibility,
    chunkIndex: Number(r.chunk_index),
    content: r.content as string,
    heading: (r.heading as string | null) ?? null,
    headingLevel: r.heading_level == null ? null : Number(r.heading_level),
    startLine: r.start_line == null ? null : Number(r.start_line),
    endLine: r.end_line == null ? null : Number(r.end_line),
    contentHash: (r.content_hash as string | null) ?? null,
    chunkKey: (r.chunk_key as string | null) ?? null,
    tokenCount: r.token_count == null ? null : Number(r.token_count),
    sourcePath: r.source_path as string,
    sourceType: r.source_type as SourceType,
    contentDate: r.content_date == null ? null : String(r.content_date),
    authorityWeight: Number(r.authority_weight),
    embedding: parseVectorLiteral(r.embedding),
    embeddingModel: (r.embedding_model as string | null) ?? null,
    embeddingDim: r.embedding_dim == null ? null : Number(r.embedding_dim),
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    createdAt: String(r.created_at),
  };
}

/** Map an `index_jobs` row to {@link IndexJobRow}. */
export function mapIndexJobRow(r: Row): IndexJobRow {
  return {
    id: r.id as string,
    teamId: (r.team_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    visibility: r.visibility as Visibility,
    sourcePath: r.source_path as string,
    sourceId: (r.source_id as string | null) ?? null,
    reason: r.reason as IndexJobReason,
    status: r.status as IndexJobStatus,
    attempts: Number(r.attempts),
    errorMessage: (r.error_message as string | null) ?? null,
    payload: (r.payload as Record<string, unknown> | null) ?? {},
    enqueuedAt: String(r.enqueued_at),
    startedAt: r.started_at == null ? null : String(r.started_at),
    finishedAt: r.finished_at == null ? null : String(r.finished_at),
  };
}

/** Map a `context_documents` row to {@link ContextDocumentRow}. */
export function mapContextDocumentRow(r: Row): ContextDocumentRow {
  return {
    id: r.id as string,
    teamId: (r.team_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    visibility: r.visibility as Visibility,
    path: r.path as string,
    kind: r.kind as ContextKind,
    content: r.content as string,
    contentSha256: r.content_sha256 as string,
    status: r.status as ContextDocumentStatus,
    updatedBy: (r.updated_by as string | null) ?? null,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

/** Map a `context_document_versions` row to {@link ContextDocumentVersionRow}. */
export function mapContextDocumentVersionRow(r: Row): ContextDocumentVersionRow {
  return {
    id: r.id as string,
    documentId: r.document_id as string,
    contentSha256: r.content_sha256 as string,
    content: r.content as string,
    updatedBy: (r.updated_by as string | null) ?? null,
    createdAt: String(r.created_at),
  };
}

/** Map a `search_events` row to {@link SearchEventRow}. */
export function mapSearchEventRow(r: Row): SearchEventRow {
  return {
    id: r.id as string,
    teamId: (r.team_id as string | null) ?? null,
    clientId: (r.client_id as string | null) ?? null,
    userId: (r.user_id as string | null) ?? null,
    visibilitySet: parsePgTextArray(r.visibility_set) as Visibility[],
    queryText: (r.query_text as string | null) ?? null,
    queryEmbedding: parseVectorLiteral(r.query_embedding),
    topK: Number(r.top_k),
    resultCount: Number(r.result_count),
    resultChunkIds: parsePgTextArray(r.result_chunk_ids),
    latencyMs: r.latency_ms == null ? null : Number(r.latency_ms),
    metadata: (r.metadata as Record<string, unknown> | null) ?? {},
    createdAt: String(r.created_at),
  };
}

/**
 * Parse a Postgres array column (`text[]` / `uuid[]`) to a string[].
 *
 * Engine-defensive like the rest of this file: PGLite may hand back a native JS
 * array or the textual literal form `{a,b}` / `{"a","b"}`. The values stored
 * here (visibility words, UUIDs) never contain commas, so a simple split is
 * sufficient; surrounding double-quotes are stripped.
 */
function parsePgTextArray(value: unknown): string[] {
  if (value == null) return [];
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (typeof value === "string") {
    const inner = value.replace(/^\{/, "").replace(/\}$/, "");
    if (inner.length === 0) return [];
    return inner.split(",").map((s) => s.replace(/^"|"$/g, ""));
  }
  return [];
}
