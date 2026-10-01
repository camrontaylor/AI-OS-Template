/**
 * Memory Schema — local PGLite + pgvector store.
 *
 * It bootstraps a PGLite instance (Postgres-in-WASM) with pgvector, runs the
 * migrations, and exposes the core operations: insert a source, insert a chunk,
 * and run a scoped vector search (plus close). A Windows user gets searchable
 * memory with no external vector account; a hosted deployment selects the `pg`
 * adapter instead (openMemoryStore picks the engine via backend.ts) with no change to
 * the operations below — everything talks to the schema through the
 * engine-agnostic SqlClient and reuses scope.ts as the single source of the
 * leak boundary.
 *
 * This is intentionally thin. The normalize→chunk→embed pipeline lives in the
 * indexer; the full reranked search + search_events telemetry in the search
 * module. Here, `vectorSearch` and `keywordSearch` return scoped candidate rows
 * filtered by the real scope predicate.
 *
 * SQL is snake_case, the TS surface is camelCase; ./row-mappers bridges the two.
 */

import path from "node:path";

import { applyMigrations, DEFAULT_EMBED_DIM, type SqlClient } from "./migrate";
import { openPGlite } from "./pglite-adapter";
import { openPostgres, openPostgresPool } from "./postgres-adapter";
import { resolveMemoryBackend, type MemoryBackendSelector } from "./backend";
import { ensureLocalUserId } from "./local-identity.cjs";
import {
  assertChunkMatchesSource,
  assertValidScope,
  buildScopeWhere,
} from "./scope";
import { toVectorLiteral } from "./embedding";
import { mapChunkRow, mapContextDocumentRow, mapSourceRow } from "./row-mappers";
import type {
  ContextDocumentRow,
  ContextDocumentStatus,
  ContextKind,
  MemoryChunkRow,
  MemorySourceRow,
  Scope,
  SearchScope,
  SourceStatus,
  SourceType,
} from "./types";

export interface OpenMemoryStoreOptions {
  /** Persisted database directory. Omit for an ephemeral in-memory database. */
  dataDir?: string;
  /** Embedding dimension baked into the `vector(...)` columns. Default 1024. */
  embedDim?: number;
  /**
   * Storage engine selector. Overrides `MEMORY_STORE_BACKEND`. Default `auto`
   * (Postgres iff a connection string is set, else local PGLite). See backend.ts.
   */
  backend?: MemoryBackendSelector;
  /**
   * Hosted Postgres connection string. Overrides `MEMORY_DATABASE_URL` /
   * `DATABASE_URL`. Only used when the resolved engine is Postgres.
   */
  connectionString?: string;
  /**
   * Serve through a `pg.Pool` instead of a single pinned connection. For
   * long-lived servers (the hosted memory API): a dropped single connection
   * kills the process's DB access permanently, while a pool replaces broken
   * connections transparently. Migrations still run on a dedicated single
   * connection first (BEGIN/COMMIT must share one connection — see
   * PostgresPoolSqlClient). Ignored by the PGLite engine.
   */
  pool?: boolean;
}

/** Fields for inserting (or re-indexing) a source document. */
export interface InsertSourceInput {
  scope: Scope;
  sourcePath: string;
  sourceType: SourceType;
  title?: string | null;
  createdByUserId?: string | null;
  /** ISO `YYYY-MM-DD`, or null. Drives recency reranking downstream. */
  contentDate?: string | null;
  authorityWeight?: number;
  contentSha256: string;
  byteSize?: number | null;
  status?: SourceStatus;
  errorMessage?: string | null;
  indexedAt?: string | null;
  archivedAt?: string | null;
  metadata?: Record<string, unknown>;
}

/** Fields for inserting (or re-indexing) one chunk of a source. */
export interface InsertChunkInput {
  sourceId: string;
  /** The parent source's scope — `chunkScope` must match it exactly. */
  sourceScope: Scope;
  /** The chunk's denormalized scope. */
  chunkScope: Scope;
  chunkIndex: number;
  content: string;
  heading?: string | null;
  headingLevel?: number | null;
  startLine?: number | null;
  endLine?: number | null;
  contentHash?: string | null;
  chunkKey?: string | null;
  tokenCount?: number | null;
  sourcePath: string;
  sourceType: SourceType;
  contentDate?: string | null;
  authorityWeight?: number;
  /** L2-normalized embedding (contract of the indexer). Null until embedded. */
  embedding?: number[] | null;
  embeddingModel?: string | null;
  embeddingDim?: number | null;
  metadata?: Record<string, unknown>;
}

/** Fields for creating or updating one Team OS context document. */
export interface UpsertContextDocumentInput {
  scope: Scope;
  path: string;
  kind: ContextKind;
  content: string;
  contentSha256: string;
  updatedBy?: string | null;
}

/** Filter for listing Team OS context documents. */
export interface ListContextDocumentsInput {
  teamId?: string | null;
  clientId?: string | null;
  userId?: string | null;
  visibility?: Scope["visibility"];
  status?: ContextDocumentStatus;
  path?: string;
  pathPrefix?: string;
}

/** Fields for archiving one Team OS context document. */
export interface ArchiveContextDocumentInput {
  scope: Scope;
  path: string;
  updatedBy?: string | null;
}

/** A single nearest-neighbour search hit. */
export interface VectorSearchResult {
  id: string;
  sourceId: string;
  content: string;
  heading: string | null;
  headingLevel: number | null;
  startLine: number | null;
  endLine: number | null;
  contentHash: string | null;
  chunkKey: string | null;
  sourcePath: string;
  sourceType: SourceType;
  contentDate: string | null;
  authorityWeight: number;
  /** Cosine distance (`embedding <=> query`); smaller is nearer. */
  distance: number;
  /** How this hit entered the candidate pool. */
  matchType?: "vector" | "keyword" | "hybrid";
  /** One-based rank in the vector leg when present. */
  vectorRank?: number | null;
  /** One-based rank in the keyword leg when present. */
  keywordRank?: number | null;
  /** Keyword score when present. Higher is better. */
  keywordScore?: number | null;
  /** Reciprocal-rank-fusion score when hybrid search combines legs. */
  fusionScore?: number | null;
}

export interface MemoryStore {
  readonly embedDim: number;
  /** The underlying SqlClient — escape hatch for the indexer, search, and tests. */
  readonly client: SqlClient;
  insertSource(input: InsertSourceInput): Promise<MemorySourceRow>;
  insertChunk(input: InsertChunkInput): Promise<MemoryChunkRow>;
  upsertContextDocument(input: UpsertContextDocumentInput): Promise<ContextDocumentRow>;
  listContextDocuments(input?: ListContextDocumentsInput): Promise<ContextDocumentRow[]>;
  archiveContextDocument(input: ArchiveContextDocumentInput): Promise<ContextDocumentRow | null>;
  vectorSearch(
    searchScope: SearchScope,
    queryEmbedding: number[],
    topK?: number,
  ): Promise<VectorSearchResult[]>;
  keywordSearch(
    searchScope: SearchScope,
    query: string,
    topK?: number,
  ): Promise<VectorSearchResult[]>;
  close(): Promise<void>;
}

/** Escape characters that have special meaning inside a SQL LIKE pattern. */
function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

const INSERT_SOURCE_SQL = `
INSERT INTO memory_sources
  (team_id, client_id, user_id, visibility, source_path, source_type,
   title, created_by_user_id, content_date, authority_weight, content_sha256, byte_size,
   status, error_message, indexed_at, archived_at, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::date, $10, $11, $12,
        $13, $14, $15::timestamptz, $16::timestamptz, $17::jsonb)
ON CONFLICT (source_path, visibility,
             COALESCE(team_id, ''), COALESCE(client_id, ''), COALESCE(user_id, ''))
DO UPDATE SET
  source_type      = EXCLUDED.source_type,
  title            = EXCLUDED.title,
  created_by_user_id = EXCLUDED.created_by_user_id,
  content_date     = EXCLUDED.content_date,
  authority_weight = EXCLUDED.authority_weight,
  content_sha256   = EXCLUDED.content_sha256,
  byte_size        = EXCLUDED.byte_size,
  status           = EXCLUDED.status,
  error_message    = EXCLUDED.error_message,
  indexed_at       = EXCLUDED.indexed_at,
  archived_at      = EXCLUDED.archived_at,
  metadata         = EXCLUDED.metadata,
  updated_at       = now()
RETURNING id, team_id, client_id, user_id, visibility, source_path, source_type,
          title, created_by_user_id, content_date::text AS content_date, authority_weight,
          content_sha256, byte_size, status, error_message, metadata,
          created_at::text AS created_at, updated_at::text AS updated_at,
          indexed_at::text AS indexed_at, archived_at::text AS archived_at`;

const INSERT_CHUNK_SQL = `
INSERT INTO memory_chunks
  (source_id, team_id, client_id, user_id, visibility, chunk_index, content,
   heading, heading_level, start_line, end_line, content_hash, chunk_key,
   token_count, source_path, source_type, content_date, authority_weight,
   embedding, embedding_model, embedding_dim, metadata)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
        $16, $17::date, $18, $19::vector, $20, $21, $22::jsonb)
ON CONFLICT (source_id, chunk_key) WHERE chunk_key IS NOT NULL
DO UPDATE SET
  chunk_index     = EXCLUDED.chunk_index,
  content          = EXCLUDED.content,
  heading          = EXCLUDED.heading,
  heading_level    = EXCLUDED.heading_level,
  start_line       = EXCLUDED.start_line,
  end_line         = EXCLUDED.end_line,
  content_hash     = EXCLUDED.content_hash,
  token_count      = EXCLUDED.token_count,
  source_path      = EXCLUDED.source_path,
  source_type      = EXCLUDED.source_type,
  content_date     = EXCLUDED.content_date,
  authority_weight = EXCLUDED.authority_weight,
  embedding        = EXCLUDED.embedding,
  embedding_model  = EXCLUDED.embedding_model,
  embedding_dim    = EXCLUDED.embedding_dim,
  metadata         = EXCLUDED.metadata
RETURNING id, source_id, team_id, client_id, user_id, visibility, chunk_index,
          content, heading, heading_level, start_line, end_line, content_hash,
          chunk_key, token_count, source_path, source_type,
          content_date::text AS content_date, authority_weight,
          embedding::text AS embedding, embedding_model, embedding_dim,
          metadata, created_at::text AS created_at`;

const CONTEXT_DOCUMENT_SELECT_COLUMNS = `
id, team_id, client_id, user_id, visibility, path, kind, content, content_sha256,
status, updated_by, created_at::text AS created_at, updated_at::text AS updated_at`;

const FIND_ACTIVE_CONTEXT_DOCUMENT_SQL = `
SELECT ${CONTEXT_DOCUMENT_SELECT_COLUMNS}
FROM context_documents
WHERE status = 'active'
  AND visibility = $1
  AND path = $2
  AND team_id IS NOT DISTINCT FROM $3
  AND client_id IS NOT DISTINCT FROM $4
  AND user_id IS NOT DISTINCT FROM $5
LIMIT 1`;

const INSERT_CONTEXT_DOCUMENT_VERSION_SQL = `
INSERT INTO context_document_versions
  (document_id, content_sha256, content, updated_by)
VALUES ($1, $2, $3, $4)`;

const INSERT_CONTEXT_DOCUMENT_SQL = `
INSERT INTO context_documents
  (team_id, client_id, user_id, visibility, path, kind, content, content_sha256,
   status, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'active', $9)
RETURNING ${CONTEXT_DOCUMENT_SELECT_COLUMNS}`;

const UPDATE_CONTEXT_DOCUMENT_SQL = `
UPDATE context_documents
SET kind = $2,
    content = $3,
    content_sha256 = $4,
    updated_by = $5,
    updated_at = now()
WHERE id = $1
RETURNING ${CONTEXT_DOCUMENT_SELECT_COLUMNS}`;

const ARCHIVE_CONTEXT_DOCUMENT_SQL = `
UPDATE context_documents
SET status = 'archived',
    updated_by = $2,
    updated_at = now()
WHERE id = $1
RETURNING ${CONTEXT_DOCUMENT_SELECT_COLUMNS}`;

/**
 * Engine-neutral store: every operation runs through the {@link SqlClient}, so
 * the exact same class backs local PGLite and hosted Postgres. The only
 * engine-specific concern is teardown, injected as `closeFn` (PGLite closes the
 * handle; Postgres ends the connection).
 */
class SqlMemoryStore implements MemoryStore {
  constructor(
    readonly client: SqlClient,
    readonly embedDim: number,
    private readonly closeFn: () => Promise<void>,
  ) {}

  async insertSource(input: InsertSourceInput): Promise<MemorySourceRow> {
    assertValidScope(input.scope);

    const { rows } = await this.client.query<Record<string, unknown>>(
      INSERT_SOURCE_SQL,
      [
        input.scope.teamId,
        input.scope.clientId,
        input.scope.userId,
        input.scope.visibility,
        input.sourcePath,
        input.sourceType,
        input.title ?? null,
        input.createdByUserId ?? null,
        input.contentDate ?? null,
        input.authorityWeight ?? 1.0,
        input.contentSha256,
        input.byteSize ?? null,
        input.status ?? "indexed",
        input.errorMessage ?? null,
        input.indexedAt ?? null,
        input.archivedAt ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapSourceRow(rows[0]);
  }

  async insertChunk(input: InsertChunkInput): Promise<MemoryChunkRow> {
    assertValidScope(input.chunkScope);
    // The denormalized chunk scope must never be wider than its source.
    assertChunkMatchesSource(input.chunkScope, input.sourceScope);

    const embedding = input.embedding ?? null;
    if (embedding && embedding.length !== this.embedDim) {
      throw new Error(
        `insertChunk: embedding has ${embedding.length} dimensions but the ` +
          `store was built with ${this.embedDim}. Re-embed at the configured ` +
          `dimension.`,
      );
    }

    const { rows } = await this.client.query<Record<string, unknown>>(
      INSERT_CHUNK_SQL,
      [
        input.sourceId,
        input.chunkScope.teamId,
        input.chunkScope.clientId,
        input.chunkScope.userId,
        input.chunkScope.visibility,
        input.chunkIndex,
        input.content,
        input.heading ?? null,
        input.headingLevel ?? null,
        input.startLine ?? null,
        input.endLine ?? null,
        input.contentHash ?? null,
        input.chunkKey ?? null,
        input.tokenCount ?? null,
        input.sourcePath,
        input.sourceType,
        input.contentDate ?? null,
        input.authorityWeight ?? 1.0,
        embedding ? toVectorLiteral(embedding) : null,
        input.embeddingModel ?? null,
        input.embeddingDim ?? (embedding ? embedding.length : null),
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return mapChunkRow(rows[0]);
  }

  async upsertContextDocument(input: UpsertContextDocumentInput): Promise<ContextDocumentRow> {
    assertValidScope(input.scope);

    const existing = await this.findActiveContextDocument(input.scope, input.path);
    if (existing) {
      await this.client.query(INSERT_CONTEXT_DOCUMENT_VERSION_SQL, [
        existing.id,
        existing.contentSha256,
        existing.content,
        input.updatedBy ?? null,
      ]);
      const { rows } = await this.client.query<Record<string, unknown>>(
        UPDATE_CONTEXT_DOCUMENT_SQL,
        [
          existing.id,
          input.kind,
          input.content,
          input.contentSha256,
          input.updatedBy ?? null,
        ],
      );
      return mapContextDocumentRow(rows[0]);
    }

    const { rows } = await this.client.query<Record<string, unknown>>(
      INSERT_CONTEXT_DOCUMENT_SQL,
      [
        input.scope.teamId,
        input.scope.clientId,
        input.scope.userId,
        input.scope.visibility,
        input.path,
        input.kind,
        input.content,
        input.contentSha256,
        input.updatedBy ?? null,
      ],
    );
    return mapContextDocumentRow(rows[0]);
  }

  async listContextDocuments(
    input: ListContextDocumentsInput = {},
  ): Promise<ContextDocumentRow[]> {
    const clauses: string[] = [];
    const params: unknown[] = [];

    const add = (sql: string, value: unknown): void => {
      params.push(value);
      clauses.push(sql.replace("?", `$${params.length}`));
    };

    add("status = ?", input.status ?? "active");
    if (input.visibility != null) add("visibility = ?", input.visibility);
    if (input.teamId !== undefined) add("team_id IS NOT DISTINCT FROM ?", input.teamId);
    if (input.clientId !== undefined) add("client_id IS NOT DISTINCT FROM ?", input.clientId);
    if (input.userId !== undefined) add("user_id IS NOT DISTINCT FROM ?", input.userId);
    if (input.path != null) add("path = ?", input.path);
    if (input.pathPrefix != null) {
      add("path LIKE ? ESCAPE E'\\\\'", `${escapeLikePattern(input.pathPrefix)}%`);
    }

    const sql = `
SELECT ${CONTEXT_DOCUMENT_SELECT_COLUMNS}
FROM context_documents
WHERE ${clauses.join(" AND ")}
ORDER BY visibility ASC, path ASC`;
    const { rows } = await this.client.query<Record<string, unknown>>(sql, params);
    return rows.map(mapContextDocumentRow);
  }

  async archiveContextDocument(
    input: ArchiveContextDocumentInput,
  ): Promise<ContextDocumentRow | null> {
    assertValidScope(input.scope);

    const existing = await this.findActiveContextDocument(input.scope, input.path);
    if (!existing) return null;

    await this.client.query(INSERT_CONTEXT_DOCUMENT_VERSION_SQL, [
      existing.id,
      existing.contentSha256,
      existing.content,
      input.updatedBy ?? null,
    ]);
    const { rows } = await this.client.query<Record<string, unknown>>(
      ARCHIVE_CONTEXT_DOCUMENT_SQL,
      [existing.id, input.updatedBy ?? null],
    );
    return mapContextDocumentRow(rows[0]);
  }

  private async findActiveContextDocument(
    scope: Scope,
    documentPath: string,
  ): Promise<ContextDocumentRow | null> {
    const { rows } = await this.client.query<Record<string, unknown>>(
      FIND_ACTIVE_CONTEXT_DOCUMENT_SQL,
      [
        scope.visibility,
        documentPath,
        scope.teamId,
        scope.clientId,
        scope.userId,
      ],
    );
    return rows.length ? mapContextDocumentRow(rows[0]) : null;
  }

  async vectorSearch(
    searchScope: SearchScope,
    queryEmbedding: number[],
    topK = 10,
  ): Promise<VectorSearchResult[]> {
    // The scope predicate is the single source of the leak boundary. It emits
    // UNQUALIFIED column names, so the query below uses no table alias.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(searchScope, 0);
    const embedParam = scopeParams.length + 1;
    const limitParam = scopeParams.length + 2;

    const sql = `
SELECT id, source_id, content, heading, heading_level, start_line, end_line,
       content_hash, chunk_key, source_path, source_type,
       content_date::text AS content_date, authority_weight,
       (embedding <=> $${embedParam}::vector) AS distance
FROM memory_chunks
WHERE ${scopeSql}
  AND embedding IS NOT NULL
ORDER BY embedding <=> $${embedParam}::vector
LIMIT $${limitParam}`;

    const { rows } = await this.client.query<Record<string, unknown>>(sql, [
      ...scopeParams,
      toVectorLiteral(queryEmbedding),
      topK,
    ]);

    return rows.map((r, index) => ({
      ...mapSearchResultRow(r),
      vectorRank: index + 1,
      matchType: "vector" as const,
    }));
  }

  async keywordSearch(
    searchScope: SearchScope,
    query: string,
    topK = 10,
  ): Promise<VectorSearchResult[]> {
    if (query.trim().length === 0) return [];

    // The scope predicate is the single source of the leak boundary. It emits
    // UNQUALIFIED column names, so the query below uses no table alias.
    const { sql: scopeSql, params: scopeParams } = buildScopeWhere(searchScope, 0);
    const queryParam = scopeParams.length + 1;
    const limitParam = scopeParams.length + 2;
    const params = [...scopeParams, query, topK];

    // 'simple' config: lowercasing + tokenizing, no stemming — the embedder
    // (BGE-M3) is multilingual, so the keyword leg must not assume English.
    const sql = `
SELECT id, source_id, content, heading, heading_level, start_line, end_line,
       content_hash, chunk_key, source_path, source_type,
       content_date::text AS content_date, authority_weight,
       1.0::float8 AS distance,
       ts_rank_cd(content_tsv, websearch_to_tsquery('simple', $${queryParam})) AS keyword_score
FROM memory_chunks
WHERE ${scopeSql}
  AND content_tsv @@ websearch_to_tsquery('simple', $${queryParam})
ORDER BY keyword_score DESC, content_date DESC NULLS LAST, source_path ASC, chunk_index ASC
LIMIT $${limitParam}`;

    const { rows } = await this.client.query<Record<string, unknown>>(sql, params);

    return rows.map((r, index) => {
      const hit = mapSearchResultRow(r);
      const keywordScore = Number(r.keyword_score);
      return {
        ...hit,
        keywordRank: index + 1,
        keywordScore,
        // Convert keyword-only scores to a distance-like value. Hybrid fusion in
        // search.ts may overwrite this, but keywordSearch remains useful alone.
        distance: Math.max(0, 1 - Math.min(1, keywordScore)),
        matchType: "keyword" as const,
      };
    });
  }

  async close(): Promise<void> {
    await this.closeFn();
  }
}

function mapSearchResultRow(r: Record<string, unknown>): VectorSearchResult {
  return {
    id: r.id as string,
    sourceId: r.source_id as string,
    content: r.content as string,
    heading: (r.heading as string | null) ?? null,
    headingLevel: r.heading_level == null ? null : Number(r.heading_level),
    startLine: r.start_line == null ? null : Number(r.start_line),
    endLine: r.end_line == null ? null : Number(r.end_line),
    contentHash: (r.content_hash as string | null) ?? null,
    chunkKey: (r.chunk_key as string | null) ?? null,
    sourcePath: r.source_path as string,
    sourceType: r.source_type as SourceType,
    contentDate: r.content_date == null ? null : String(r.content_date),
    authorityWeight: Number(r.authority_weight),
    distance: Number(r.distance),
  };
}

/**
 * Open (and migrate) a memory store, selecting the engine via {@link
 * resolveMemoryBackend}: hosted Postgres when a connection string is configured
 * (or `backend: "postgres"`), else local PGLite.
 *
 * Local PGLite: with no `dataDir` the database is in-memory and ephemeral — ideal
 * for tests. Production callers persist it by passing a directory; e.g. the
 * server / the indexer pass
 * `path.join(getConfig().aiOsDir, ".command-centre", "memory")`.
 *
 * Safety: when the resolved engine is Postgres, a connection or migration failure
 * PROPAGATES — this function never substitutes the local PGLite store for a
 * hosted one. That is the "no silent fallback to an unsafe local source of
 * truth" guarantee, made structural (there is no catch-and-retry-local path).
 */
export async function openMemoryStore(
  opts: OpenMemoryStoreOptions = {},
): Promise<MemoryStore> {
  const embedDim = opts.embedDim ?? DEFAULT_EMBED_DIM;
  const backend = resolveMemoryBackend(
    {
      backend: opts.backend,
      connectionString: opts.connectionString,
      dataDir: opts.dataDir,
    },
    process.env,
  );

  if (backend.kind === "postgres") {
    if (opts.pool) {
      // Pooled serving (the hosted API path): migrations need BEGIN/COMMIT on
      // ONE connection, so they run on a dedicated single client first; only
      // then does the pool take over for single-statement serving traffic.
      const single = await openPostgres(backend.connectionString);
      try {
        await applyMigrations(single.client, { embedDim });
      } finally {
        await single.close();
      }
      const pg = await openPostgresPool(backend.connectionString);
      return new SqlMemoryStore(pg.client, embedDim, pg.close);
    }

    const pg = await openPostgres(backend.connectionString);
    try {
      await applyMigrations(pg.client, { embedDim });
    } catch (error) {
      // Release the pinned connection on a failed open; do NOT fall back to PGLite.
      await pg.close();
      throw error;
    }
    return new SqlMemoryStore(pg.client, embedDim, pg.close);
  }

  // The legacy identity used to live inside the PGLite directory. Promote and
  // validate it before openPGlite gets a chance to quarantine a corrupt local
  // cluster. Invalid identity data deliberately stops here for manual repair.
  const identityRoot = localMemoryWorkspaceRoot(backend.dataDir);
  if (identityRoot) ensureLocalUserId(identityRoot);

  // recreateCorruptDir: the local PGLite store is a DERIVED index (regenerable
  // from on-disk sources), so if a crash/unclean shutdown left the cluster
  // unopenable, quarantine it and start fresh rather than aborting every command.
  const { client, close } = await openPGlite(backend.dataDir, { recreateCorruptDir: true });
  try {
    await applyMigrations(client, { embedDim });
  } catch (error) {
    // Release the handle AND the advisory open-lock on a failed open.
    await close();
    throw error;
  }
  return new SqlMemoryStore(client, embedDim, close);
}

function localMemoryWorkspaceRoot(dataDir?: string): string | null {
  if (!dataDir) return null;
  const resolved = path.resolve(dataDir);
  const stateDir = path.dirname(resolved);
  if (
    path.basename(resolved) !== "memory" ||
    path.basename(stateDir) !== ".command-centre"
  ) {
    return null;
  }
  return path.dirname(stateDir);
}

// Re-exported so callers and tests can resolve the backend without a second
// import of ./backend (single source of truth for the selection rule).
export { resolveMemoryBackend };
export type { MemoryBackendSelector };
