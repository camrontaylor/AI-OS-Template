/**
 * Memory Schema — the memory indexer.
 *
 * The filesystem-facing half of ingestion: it discovers sources on disk
 * (discovery.ts), applies the client-scope override, and feeds each file through
 * the shared single-source pipeline in ingest.ts —
 *
 *   discover sources → (per source) ingestContent: skip unchanged → upsert
 *   source → chunk → embed → upsert chunks → prune stale chunks → record an
 *   index_jobs audit row.
 *
 * The per-source pipeline lives in ingest.ts so the hosted memory API ingests
 * through the exact same code path — one pipeline, two transports.
 *
 * Scope is REQUIRED and validated up front — explicit scope at indexing time,
 * not a default. A client source (under clients/{slug}/) is always re-scoped to
 * that client regardless of the base scope, so a single run can index the root
 * workspace and per-client folders without leaking one into the other.
 */

import type { MemoryStore } from "./store";
import type { Embedder } from "./embedder";
import { assertValidScope, normalizeScope } from "./scope";
import { ingestContent } from "./ingest";
import { discoverSources, loadAuthorityWeights } from "./discovery";
import type { DiscoveredSource } from "./discovery";
import type { IndexJobReason, Scope } from "./types";

export interface IndexOptions {
  store: MemoryStore;
  embedder: Embedder;
  /** Base scope for root-level sources. REQUIRED and validated. */
  scope: Scope;
  /** AI-OS workspace root. */
  rootDir: string;
  /** Source roots (relative to rootDir). Defaults to the discovery defaults. */
  roots?: string[];
  /** Chunks embedded per model call. Default 32. */
  batchSize?: number;
  /** Re-embed even when a source's content hash is unchanged. */
  force?: boolean;
  /** Record an index_jobs audit row per source. Default true. */
  trackJobs?: boolean;
  /** Why this index pass ran — tagged on each index_jobs row. Default 'manual'. */
  reason?: IndexJobReason;
  /** Progress logger. */
  log?: (msg: string) => void;
}

export interface IndexError {
  sourcePath: string;
  message: string;
}

export interface IndexSummary {
  sourcesIndexed: number;
  sourcesSkipped: number;
  chunksInserted: number;
  chunksPruned: number;
  errors: IndexError[];
}

/** Index every configured memory source into the store. */
export async function indexSources(opts: IndexOptions): Promise<IndexSummary> {
  const {
    store,
    embedder,
    scope,
    rootDir,
    roots,
    batchSize = 32,
    force = false,
    trackJobs = true,
    reason = "manual",
    log = () => {},
  } = opts;

  const baseScope = normalizeScope(scope);
  assertValidScope(baseScope);
  if (embedder.dim !== store.embedDim) {
    throw new Error(
      `indexSources: embedder dim ${embedder.dim} != store embedDim ` +
        `${store.embedDim}. They must match.`,
    );
  }

  const authorityWeights = loadAuthorityWeights(rootDir);
  const sources = discoverSources({ rootDir, roots, authorityWeights });
  log(`Discovered ${sources.length} source file(s).`);

  const summary: IndexSummary = {
    sourcesIndexed: 0,
    sourcesSkipped: 0,
    chunksInserted: 0,
    chunksPruned: 0,
    errors: [],
  };

  for (const source of sources) {
    try {
      const result = await ingestContent({
        store,
        embedder,
        scope: scopeForSource(source, baseScope),
        sourcePath: source.sourcePath,
        sourceType: source.sourceType,
        title: source.title,
        contentDate: source.contentDate,
        authorityWeight: source.authorityWeight,
        content: source.content,
        contentSha256: source.contentSha256,
        byteSize: source.byteSize,
        force,
        trackJobs,
        reason,
        batchSize,
      });

      if (result.skipped) {
        summary.sourcesSkipped += 1;
        log(`  = ${source.sourcePath} (unchanged)`);
      } else {
        summary.sourcesIndexed += 1;
        summary.chunksInserted += result.chunksInserted;
        summary.chunksPruned += result.chunksPruned;
        log(
          `  + ${source.sourcePath} (${result.chunksInserted} chunk(s)` +
            `${result.chunksPruned ? `, pruned ${result.chunksPruned}` : ""})`,
        );
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.errors.push({ sourcePath: source.sourcePath, message });
      log(`  ! ${source.sourcePath}: ${message}`);
    }
  }

  return summary;
}

/** Client sources are always client-scoped; everything else uses the base scope. */
function scopeForSource(source: DiscoveredSource, baseScope: Scope): Scope {
  if (source.clientSlug) {
    return {
      teamId: baseScope.teamId,
      clientId: source.clientSlug,
      userId: null,
      visibility: "client",
    };
  }
  return baseScope;
}
