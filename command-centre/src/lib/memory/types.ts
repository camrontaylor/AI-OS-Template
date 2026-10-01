/**
 * AIOS Memory Schema — row & scope types.
 *
 * These types are the TypeScript contract for the Phase 3 memory store. They
 * mirror the DDL in ./migrations/0001_init.sql exactly. Downstream modules
 * (store, indexer, search, no-leak tests, capture) import
 * from here so there is a single source of truth for the row shapes.
 *
 * Naming: snake_case in SQL, camelCase in TS. The store layer is
 * responsible for mapping between the two when reading/writing rows.
 */

/**
 * The four memory scopes.
 * - `private`  — visible only to one user; requires `userId`.
 * - `client`   — visible within one client workspace; requires `clientId`.
 * - `team`     — visible within one team; requires `teamId`.
 * - `system`   — baseline knowledge, visible to everyone within the tenant.
 */
export type Visibility = "private" | "client" | "team" | "system";

/** Context document classification for Team OS snapshots. */
export type ContextKind =
  | "agents"
  | "user"
  | "brand"
  | "memory"
  | "learnings"
  | "preferences"
  | "other";

/** Lifecycle state of a context document. */
export type ContextDocumentStatus = "active" | "archived";

/** Coarse source classification — drives authority weighting and UI. */
export type SourceType =
  | "memory"
  | "learnings"
  | "brand"
  | "transcript"
  | "session"
  | "other";

/** Why an index job was enqueued. */
export type IndexJobReason =
  | "manual"
  | "file_change"
  | "session_capture"
  | "refresh"
  | "backfill";

/** Lifecycle state of an index job. */
export type IndexJobStatus =
  | "queued"
  | "running"
  | "succeeded"
  | "failed"
  | "skipped";

/** Lifecycle state of a memory source. */
export type SourceStatus =
  | "pending"
  | "indexing"
  | "indexed"
  | "failed"
  | "archived";

/**
 * The four scope columns that ride on every memory-bearing row
 * (sources, chunks, index jobs).
 *
 * `teamId` is nullable: local single-tenant installs leave it `null`. The scope
 * invariants in ./scope.ts enforce which of clientId/userId/teamId must be
 * present for a given visibility — these mirror the DB CHECK constraints.
 */
export interface Scope {
  teamId: string | null;
  clientId: string | null;
  userId: string | null;
  visibility: Visibility;
}

/** Team OS context document. Maps to `context_documents`. */
export interface ContextDocumentRow extends Scope {
  id: string;
  path: string;
  kind: ContextKind;
  content: string;
  contentSha256: string;
  status: ContextDocumentStatus;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Historical version of a context document. Maps to `context_document_versions`. */
export interface ContextDocumentVersionRow {
  id: string;
  documentId: string;
  contentSha256: string;
  content: string;
  updatedBy: string | null;
  createdAt: string;
}

/** A normalized source document. Maps to `memory_sources`. */
export interface MemorySourceRow extends Scope {
  id: string;
  sourcePath: string;
  sourceType: SourceType;
  title: string | null;
  /** User that created/published this source. Distinct from private-scope userId. */
  createdByUserId: string | null;
  /** ISO date `YYYY-MM-DD`, or null when the source carries no date. */
  contentDate: string | null;
  authorityWeight: number;
  contentSha256: string;
  byteSize: number | null;
  status: SourceStatus;
  errorMessage: string | null;
  metadata: Record<string, unknown>;
  /** ISO timestamptz. */
  createdAt: string;
  updatedAt: string;
  indexedAt: string | null;
  archivedAt: string | null;
}

/** An embedded chunk of a source. Maps to `memory_chunks`. */
export interface MemoryChunkRow extends Scope {
  id: string;
  sourceId: string;
  chunkIndex: number;
  content: string;
  heading: string | null;
  headingLevel: number | null;
  startLine: number | null;
  endLine: number | null;
  contentHash: string | null;
  chunkKey: string | null;
  tokenCount: number | null;
  // Denormalized from the parent source for the reranking hot path.
  sourcePath: string;
  sourceType: SourceType;
  contentDate: string | null;
  authorityWeight: number;
  /** Length === the configured embedding dimension (default 1024). Null until embedded. */
  embedding: number[] | null;
  embeddingModel: string | null;
  embeddingDim: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/** A unit of indexing work. Maps to `index_jobs`. */
export interface IndexJobRow extends Scope {
  id: string;
  sourcePath: string;
  sourceId: string | null;
  reason: IndexJobReason;
  status: IndexJobStatus;
  attempts: number;
  errorMessage: string | null;
  payload: Record<string, unknown>;
  enqueuedAt: string;
  startedAt: string | null;
  finishedAt: string | null;
}

/** Audit record for one scoped search. Maps to `search_events`. */
export interface SearchEventRow {
  id: string;
  teamId: string | null;
  clientId: string | null;
  userId: string | null;
  visibilitySet: Visibility[];
  /** May be null for privacy (e.g. private-scope searches). */
  queryText: string | null;
  queryEmbedding: number[] | null;
  topK: number;
  resultCount: number;
  resultChunkIds: string[];
  latencyMs: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

/**
 * Describes who is asking — drives the search WHERE clause built by
 * ./scope.ts `buildScopeWhere`.
 *
 * `include` limits which visibility layers the caller may read. When omitted it
 * defaults to all four. A `team`/`system` search omits other users' `private`
 * rows and other clients' `client` rows automatically.
 */
export interface SearchScope {
  teamId: string | null;
  clientId?: string | null;
  userId?: string | null;
  include?: Visibility[];
}

/** All four visibilities, in canonical order. */
export const ALL_VISIBILITIES: readonly Visibility[] = [
  "private",
  "client",
  "team",
  "system",
];
