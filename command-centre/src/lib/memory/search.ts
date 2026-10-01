/**
 * AIOS Memory Schema — scoped memory search.
 *
 * The reading side of the memory store. It ties the pieces together into one
 * call: embed the query (the embedder) -> scope-filtered vector + keyword
 * search (store.vectorSearch / store.keywordSearch, leak boundary from
 * scope.ts) -> RRF candidate fusion -> three-stage rerank (reranker.ts) ->
 * and an audit row in `search_events`.
 *
 * Privacy: by default neither the query text nor the query embedding is stored
 * (max-privacy default — the schema makes both columns nullable for exactly
 * this). `query_text` is written only when `storeQueryText` is set; the query
 * embedding is never persisted. The audit row still records the scope it ran
 * under, the result chunk ids, counts, and latency — enough for the no-leak
 * tests and citation auditing.
 *
 * The store is engine-agnostic, so this module talks to it through the
 * `MemoryStore` surface and the `store.client` escape hatch only.
 */

import { ALL_VISIBILITIES } from "./types";
import {
  RERANK_DEFAULTS,
  rerank,
  type RerankConfig,
  type RerankedHit,
} from "./reranker";
import { mapSearchEventRow } from "./row-mappers";
import type { SqlClient } from "./migrate";
import type { MemoryStore, VectorSearchResult } from "./store";
import type { Embedder } from "./embedder";
import type { SearchEventRow, SearchScope, Visibility } from "./types";

/** A reranked search hit returned to the caller. */
export type MemorySearchHit = RerankedHit<VectorSearchResult>;

export interface SearchMemoryOptions {
  store: MemoryStore;
  /**
   * Local embedder. Required unless `queryEmbedding` is already supplied by the
   * caller (the hosted Team OS API path).
   */
  embedder?: Embedder;
  /** Client-provided query vector for hosted/API search. */
  queryEmbedding?: number[];
  /** Model identifier for `queryEmbedding`. Defaults to `embedder.model`. */
  embeddingModel?: string;
  /** Dimension for `queryEmbedding`. Defaults to `embedder.dim`. */
  embeddingDim?: number;
  /** The natural-language query. */
  query: string;
  /** Who is asking — drives the scope filter (see scope.ts buildScopeWhere). */
  searchScope: SearchScope;
  /** How many reranked hits to return. Default 10. */
  topK?: number;
  /**
   * How many nearest neighbours to pull before reranking. A pool larger than
   * `topK` gives the floor-ratio gate material to work with. Default
   * `max(topK, 20)`.
   */
  candidateK?: number;
  /** Reranker tunables. Default {@link RERANK_DEFAULTS}. */
  rerankConfig?: RerankConfig;
  /** Write a `search_events` audit row. Default true. */
  recordEvent?: boolean;
  /** Ensure indexed chunks were produced by this embedder. Default true. */
  enforceEmbedderModel?: boolean;
  /**
   * Persist the query text on the audit row. Default false (max privacy). The
   * query embedding is never persisted regardless.
   */
  storeQueryText?: boolean;
  /** "Today" for recency scoring. Defaults to the current time. */
  now?: Date;
}

export interface SearchMemoryResult {
  /** Reranked hits, best first, already sliced to `topK`. */
  results: MemorySearchHit[];
  /** Wall-clock latency of embed + search + rerank, in milliseconds. */
  latencyMs: number;
  /** The audit row written, or null when `recordEvent` was false. */
  event: SearchEventRow | null;
  /** The visibility layers actually searched (what the scope filter included). */
  visibilitySet: Visibility[];
}

/**
 * The visibility layers a scope actually searches. Mirrors the branch logic in
 * scope.ts buildScopeWhere exactly: `system`/`team` whenever requested, but
 * `client`/`private` only when the matching id is present. This is what gets
 * recorded as `visibility_set`, so the audit reflects the real filter.
 */
export function resolveVisibilitySet(scope: SearchScope): Visibility[] {
  const include = scope.include ?? ALL_VISIBILITIES;
  const out: Visibility[] = [];
  if (include.includes("system")) out.push("system");
  if (include.includes("team")) out.push("team");
  if (include.includes("client") && scope.clientId != null) out.push("client");
  if (include.includes("private") && scope.userId != null) out.push("private");
  return out;
}

/**
 * Run a scoped, reranked memory search and (by default) record an audit row.
 */
export async function searchMemory(
  opts: SearchMemoryOptions,
): Promise<SearchMemoryResult> {
  const topK = opts.topK ?? 10;
  const candidateK = opts.candidateK ?? Math.max(topK, 20);
  const cfg = opts.rerankConfig ?? RERANK_DEFAULTS;
  const recordEvent = opts.recordEvent !== false;
  const enforceEmbedderModel = opts.enforceEmbedderModel !== false;
  const storeQueryText = opts.storeQueryText === true;
  const now = opts.now ?? new Date();
  const embeddingSpec = resolveSearchEmbeddingSpec(opts);

  const started = Date.now();
  if (enforceEmbedderModel) {
    await assertCompatibleEmbeddingModel(opts.store.client, embeddingSpec);
  }
  const queryEmbedding = opts.queryEmbedding ?? (await opts.embedder!.embed([opts.query]))[0];
  if (queryEmbedding.length !== embeddingSpec.dim) {
    throw new Error(
      `query embedding has ${queryEmbedding.length} dimensions, expected ${embeddingSpec.dim}`,
    );
  }
  const [vectorHits, keywordHits] = await Promise.all([
    opts.store.vectorSearch(opts.searchScope, queryEmbedding, candidateK),
    opts.store.keywordSearch(opts.searchScope, opts.query, candidateK),
  ]);
  const candidates = fuseCandidates(vectorHits, keywordHits);
  const results = rerank(candidates, cfg, now).slice(0, topK);
  const latencyMs = Date.now() - started;

  const visibilitySet = resolveVisibilitySet(opts.searchScope);

  let event: SearchEventRow | null = null;
  if (recordEvent) {
    event = await recordSearchEvent(opts.store.client, {
      scope: opts.searchScope,
      visibilitySet,
      queryText: storeQueryText ? opts.query : null,
      topK,
      resultCount: results.length,
      resultChunkIds: results.map((r) => r.id),
      latencyMs,
      metadata: {
        embedder: embeddingSpec.model,
        candidateK,
        searchMode: "hybrid",
        vectorCandidates: vectorHits.length,
        keywordCandidates: keywordHits.length,
      },
    });
  }

  return { results, latencyMs, event, visibilitySet };
}

interface EmbeddingSpec {
  model: string;
  dim: number;
}

function resolveSearchEmbeddingSpec(opts: SearchMemoryOptions): EmbeddingSpec {
  const model = opts.embeddingModel ?? opts.embedder?.model;
  const dim = opts.embeddingDim ?? opts.embedder?.dim;
  if (!model || typeof dim !== "number" || !Number.isInteger(dim) || dim <= 0) {
    throw new Error(
      "searchMemory requires either an embedder or embeddingModel + embeddingDim",
    );
  }
  if (!opts.queryEmbedding && !opts.embedder) {
    throw new Error("searchMemory requires queryEmbedding when no embedder is provided");
  }
  return { model, dim };
}

const RRF_K = 60;

function fuseCandidates(
  vectorHits: VectorSearchResult[],
  keywordHits: VectorSearchResult[],
): VectorSearchResult[] {
  const byId = new Map<string, VectorSearchResult>();

  for (let i = 0; i < vectorHits.length; i += 1) {
    const hit = vectorHits[i];
    byId.set(hit.id, {
      ...hit,
      vectorRank: hit.vectorRank ?? i + 1,
      matchType: "vector",
    });
  }

  for (let i = 0; i < keywordHits.length; i += 1) {
    const hit = keywordHits[i];
    const existing = byId.get(hit.id);
    if (existing) {
      byId.set(hit.id, {
        ...existing,
        keywordRank: hit.keywordRank ?? i + 1,
        keywordScore: hit.keywordScore ?? existing.keywordScore ?? null,
        matchType: "hybrid",
      });
    } else {
      byId.set(hit.id, {
        ...hit,
        keywordRank: hit.keywordRank ?? i + 1,
        matchType: "keyword",
      });
    }
  }

  const fused = [...byId.values()].map((hit) => {
    const vectorScore = hit.vectorRank ? 1 / (RRF_K + hit.vectorRank) : 0;
    const keywordScore = hit.keywordRank ? 1 / (RRF_K + hit.keywordRank) : 0;
    const fusionScore = vectorScore + keywordScore;
    return {
      ...hit,
      fusionScore,
      // Convert RRF into a distance-like score for the existing reranker. A
      // single rank-1 leg is about 0.49 similarity; rank-1 in both legs is
      // about 0.98, so hybrid exact+semantic matches naturally rise.
      distance: Math.max(0, 1 - Math.min(1, fusionScore * 30)),
    };
  });

  return fused.sort((a, b) => (b.fusionScore ?? 0) - (a.fusionScore ?? 0));
}

async function assertCompatibleEmbeddingModel(
  client: SqlClient,
  embedder: EmbeddingSpec,
): Promise<void> {
  const { rows } = await client.query<{
    embedding_model: string | null;
    embedding_dim: number | null;
    n: number;
  }>(
    `SELECT embedding_model, embedding_dim, count(*)::int AS n
       FROM memory_chunks
      WHERE embedding IS NOT NULL
      GROUP BY embedding_model, embedding_dim
      ORDER BY n DESC`,
  );

  const incompatible = rows.filter(
    (r) => r.embedding_model !== embedder.model || Number(r.embedding_dim) !== embedder.dim,
  );
  if (incompatible.length === 0) return;

  const seen = rows
    .map((r) => `${r.embedding_model ?? "unknown"}/${r.embedding_dim ?? "unknown"} (${r.n})`)
    .join(", ");
  throw new Error(
    `Memory index was built with a different embedding model. Expected ` +
      `${embedder.model}/${embedder.dim}; found ${seen}. Run AI-OS update ` +
      `or scripts/setup-memory to rebuild and reindex memory.`,
  );
}

interface RecordSearchEventInput {
  scope: SearchScope;
  visibilitySet: Visibility[];
  queryText: string | null;
  topK: number;
  resultCount: number;
  resultChunkIds: string[];
  latencyMs: number;
  metadata: Record<string, unknown>;
}

const INSERT_SEARCH_EVENT_SQL = `
INSERT INTO search_events
  (team_id, client_id, user_id, visibility_set, query_text, query_embedding,
   top_k, result_count, result_chunk_ids, latency_ms, metadata)
VALUES ($1, $2, $3, $4::text[], $5, $6, $7, $8, $9::uuid[], $10, $11::jsonb)
RETURNING id, team_id, client_id, user_id, visibility_set, query_text,
          query_embedding::text AS query_embedding, top_k, result_count,
          result_chunk_ids, latency_ms, metadata,
          created_at::text AS created_at`;

/**
 * Write one `search_events` audit row. `query_embedding` is always NULL — the
 * query vector is never persisted. `query_text` is NULL unless the caller opted
 * in. Returns the mapped row.
 */
async function recordSearchEvent(
  client: SqlClient,
  input: RecordSearchEventInput,
): Promise<SearchEventRow> {
  const { rows } = await client.query<Record<string, unknown>>(
    INSERT_SEARCH_EVENT_SQL,
    [
      input.scope.teamId ?? null,
      input.scope.clientId ?? null,
      input.scope.userId ?? null,
      pgArrayLiteral(input.visibilitySet),
      input.queryText,
      null, // query_embedding — never persisted (max-privacy default)
      input.topK,
      input.resultCount,
      pgArrayLiteral(input.resultChunkIds),
      input.latencyMs,
      JSON.stringify(input.metadata ?? {}),
    ],
  );
  return mapSearchEventRow(rows[0]);
}

/**
 * Build a Postgres array literal (`{"a","b"}`) for a `text[]` / `uuid[]` bind
 * param. Each element is double-quoted with `"`/`\` escaped, so it is valid for
 * both column types. An empty array yields `{}`.
 */
function pgArrayLiteral(items: string[]): string {
  if (items.length === 0) return "{}";
  const escaped = items.map(
    (it) => `"${String(it).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`,
  );
  return `{${escaped.join(",")}}`;
}
