/**
 * Memory — recall evaluation harness.
 *
 * Turns hand-judged search quality and the no-leak boundary into a repeatable
 * metric: runs a committed gold-set through the real {@link searchMemory} path
 * and reports recall@k and MRR (split exact vs semantic), leak-count (must be
 * 0), latency p50/p95, and hybrid-vs-vector-only rank for exact cases (proves
 * the FTS keyword leg lifts exact hits the vector leg ranks lower).
 *
 * Two halves for testability: {@link indexEvalCorpus} loads the committed corpus
 * into a store (fs + indexer), and {@link runEval} is pure over an
 * already-populated store + gold-set, so the metric math is unit-testable.
 *
 * Determinism: with `MEMORY_EMBEDDER=hash` the exact + leak results are
 * bit-stable (FTS + scope don't depend on the embedder), safe to wire into CI.
 * The semantic bar is meaningful only under bge-m3 and is enforced there.
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { searchMemory } from "./search";
import { indexSources } from "./indexer";
import type { MemoryStore, VectorSearchResult } from "./store";
import type { Embedder } from "./embedder";
import type { Scope, SearchScope } from "./types";

/** Whether a case measures exact-keyword recall, semantic recall, or a leak. */
export type EvalKind = "exact" | "semantic" | "leak";

/** A forbidden-source matcher: any returned hit whose path contains this leaks. */
export interface ForbidMatcher {
  sourcePathIncludes: string;
}

/** How a correct hit is recognised — by source path (+ optional content), never a chunk id. */
export interface GoldExpect {
  /** Substring the matched hit's sourcePath must contain. */
  sourcePath: string;
  /** Optional substring the matched hit's content must contain (disambiguates). */
  contentIncludes?: string;
}

/** One gold-set case. `expect` is required for exact/semantic, ignored for leak. */
export interface GoldCase {
  id: string;
  query: string;
  kind: EvalKind;
  /** Who is asking — drives the scope filter (see scope.ts buildScopeWhere). */
  scope: SearchScope;
  expect?: GoldExpect;
  /** Sources that must never appear for this scope (cross-tenant leak check). */
  forbid?: ForbidMatcher[];
}

/** Pass/fail bars; the CLI turns these into an exit code. */
export interface EvalThresholds {
  exactRecallAt5?: number;
  semanticRecallAt5?: number;
  maxLeaks?: number;
}

export interface GoldSet {
  cases: GoldCase[];
  thresholds?: EvalThresholds;
}

/** Per-case outcome. */
export interface CaseResult {
  id: string;
  kind: EvalKind;
  query: string;
  /** 1-based rank of the first correct hit; null = missed (or leak case). */
  hybridRank: number | null;
  /** 1-based vector-only rank (exact cases only); null otherwise. */
  vectorOnlyRank: number | null;
  reciprocalRank: number;
  /** Returned hits matching this case's `forbid`. */
  leaks: number;
  latencyMs: number;
}

/** Recall/MRR for a subset of cases. */
export interface KindMetrics {
  count: number;
  /** k -> recall@k (fraction of cases with a correct hit in the top k). */
  recallAtK: Record<number, number>;
  mrr: number;
}

export interface EvalReport {
  embedderModel: string;
  totalCases: number;
  ks: number[];
  overall: KindMetrics;
  byKind: Record<"exact" | "semantic", KindMetrics>;
  leakCount: number;
  latency: { p50: number; p95: number };
  hybridVsVector: {
    /** Exact cases compared. */
    cases: number;
    /** Exact cases where hybrid ranked the target strictly higher than vector-only. */
    hybridBetter: number;
    /** Exact cases where hybrid ranked the target at least as high as vector-only. */
    sameOrBetter: number;
  };
  cases: CaseResult[];
}

export interface RunEvalOptions {
  store: MemoryStore;
  embedder: Embedder;
  goldSet: GoldSet;
  /** Cutoffs for recall@k. Default [1, 5, 10]. */
  ks?: number[];
  /** "Today" for recency reranking. Defaults to the current time. */
  now?: Date;
}

const DEFAULT_KS = [1, 5, 10];

function matchesExpect(hit: VectorSearchResult, expect: GoldExpect): boolean {
  if (!hit.sourcePath.includes(expect.sourcePath)) return false;
  if (expect.contentIncludes && !String(hit.content).includes(expect.contentIncludes)) {
    return false;
  }
  return true;
}

function matchesForbid(hit: VectorSearchResult, forbid?: ForbidMatcher[]): boolean {
  if (!forbid || forbid.length === 0) return false;
  return forbid.some((f) => hit.sourcePath.includes(f.sourcePathIncludes));
}

/** 1-based rank of the first element satisfying `predicate`, else null. */
function rankOf<T>(items: T[], predicate: (item: T) => boolean): number | null {
  for (let i = 0; i < items.length; i += 1) {
    if (predicate(items[i])) return i + 1;
  }
  return null;
}

/** Nearest-rank percentile of an already-sorted ascending array. */
function percentile(sortedAsc: number[], p: number): number {
  if (sortedAsc.length === 0) return 0;
  const idx = Math.ceil((p / 100) * sortedAsc.length) - 1;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.max(0, idx))];
}

function metricsFor(subset: CaseResult[], ks: number[]): KindMetrics {
  const count = subset.length;
  const recallAtK: Record<number, number> = {};
  for (const k of ks) {
    const hits = subset.filter((c) => c.hybridRank != null && c.hybridRank <= k).length;
    recallAtK[k] = count ? hits / count : 0;
  }
  const mrr = count
    ? subset.reduce((sum, c) => sum + c.reciprocalRank, 0) / count
    : 0;
  return { count, recallAtK, mrr };
}

/**
 * Run the gold-set against an already-populated store. Pure: no filesystem, no
 * audit rows (search runs with `recordEvent: false` — no query-text logging).
 */
export async function runEval(opts: RunEvalOptions): Promise<EvalReport> {
  const { store, embedder, goldSet, now } = opts;
  const ks = opts.ks ?? DEFAULT_KS;
  const maxK = Math.max(...ks);
  const cases: CaseResult[] = [];

  for (const gc of goldSet.cases) {
    const res = await searchMemory({
      store,
      embedder,
      query: gc.query,
      searchScope: gc.scope,
      topK: maxK,
      recordEvent: false,
      now,
    });

    const hybridRank =
      gc.expect != null ? rankOf(res.results, (r) => matchesExpect(r, gc.expect!)) : null;
    const leaks = res.results.filter((r) => matchesForbid(r, gc.forbid)).length;

    let vectorOnlyRank: number | null = null;
    if (gc.kind === "exact" && gc.expect != null) {
      const [queryEmbedding] = await embedder.embed([gc.query]);
      const vectorHits = await store.vectorSearch(gc.scope, queryEmbedding, maxK);
      vectorOnlyRank = rankOf(vectorHits, (r) => matchesExpect(r, gc.expect!));
    }

    cases.push({
      id: gc.id,
      kind: gc.kind,
      query: gc.query,
      hybridRank,
      vectorOnlyRank,
      reciprocalRank: hybridRank ? 1 / hybridRank : 0,
      leaks,
      latencyMs: res.latencyMs,
    });
  }

  const recallCases = cases.filter((c) => c.kind === "exact" || c.kind === "semantic");
  const exactCases = cases.filter((c) => c.kind === "exact");

  let hybridBetter = 0;
  let sameOrBetter = 0;
  for (const c of exactCases) {
    const h = c.hybridRank ?? Number.POSITIVE_INFINITY;
    const v = c.vectorOnlyRank ?? Number.POSITIVE_INFINITY;
    if (h < v) hybridBetter += 1;
    if (h <= v) sameOrBetter += 1;
  }

  const latencies = cases.map((c) => c.latencyMs).sort((a, b) => a - b);

  return {
    embedderModel: embedder.model,
    totalCases: cases.length,
    ks,
    overall: metricsFor(recallCases, ks),
    byKind: {
      exact: metricsFor(exactCases, ks),
      semantic: metricsFor(cases.filter((c) => c.kind === "semantic"), ks),
    },
    leakCount: cases.reduce((sum, c) => sum + c.leaks, 0),
    latency: { p50: percentile(latencies, 50), p95: percentile(latencies, 95) },
    hybridVsVector: { cases: exactCases.length, hybridBetter, sameOrBetter },
    cases,
  };
}

/** One scope's slice of the committed corpus. */
export interface CorpusPlanEntry {
  /** Subdirectory under the corpus root holding this slice's source tree. */
  subdir: string;
  /** Base scope for the slice. clients/{slug}/ paths are auto-re-scoped to client. */
  scope: Scope;
  /** Source roots relative to the slice dir. Omit for the discovery defaults. */
  roots?: string[];
}

/**
 * How the committed corpus maps to scopes. `system/` indexes under the system
 * baseline; `tenants/` holds a `clients/{slug}/...` tree the indexer re-scopes to
 * each client automatically (scopeForSource), giving the cross-tenant leak cases
 * real data to fail against.
 */
export const EVAL_CORPUS_PLAN: CorpusPlanEntry[] = [
  { subdir: "system", scope: { teamId: null, clientId: null, userId: null, visibility: "system" } },
  {
    subdir: "tenants",
    scope: { teamId: null, clientId: null, userId: null, visibility: "system" },
    roots: ["clients"],
  },
];

export interface IndexEvalCorpusOptions {
  store: MemoryStore;
  embedder: Embedder;
  /** Absolute path to the corpus root (the dir holding the plan subdirs). */
  corpusDir: string;
  /** Override the default scope plan (tests). */
  plan?: CorpusPlanEntry[];
}

/** Index the committed corpus into `store`, one indexSources pass per scope slice. */
export async function indexEvalCorpus(opts: IndexEvalCorpusOptions): Promise<void> {
  const plan = opts.plan ?? EVAL_CORPUS_PLAN;
  for (const entry of plan) {
    const rootDir = path.join(opts.corpusDir, entry.subdir);
    if (!fs.existsSync(rootDir)) continue;
    await indexSources({
      store: opts.store,
      embedder: opts.embedder,
      scope: entry.scope,
      rootDir,
      roots: entry.roots,
      trackJobs: false,
    });
  }
}
