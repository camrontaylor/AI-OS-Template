/**
 * AIOS Memory Schema — scoped-search reranker.
 *
 * Implements the preserved three-stage ranking rules that turned raw vector
 * hits into the ranking the agent actually reads. It runs in application code on the rows `store.vectorSearch`
 * already returned — no second query — using the columns the indexer
 * snapshotted onto every chunk (`authorityWeight`, `contentDate`). That is the
 * design intent in docs/memory/memory-schema.md: "reranking runs on the
 * returned rows using the denormalized columns".
 *
 * The three stages:
 *   1. Authority — multiply by the per-source-prefix weight (already resolved at
 *      index time by discovery.authorityWeightFor and stored on the chunk).
 *   2. Recency  — exponential decay from the chunk's YYYY-MM-DD date, 14-day
 *      half-life, dampened by a recency floor; undated chunks decay by nothing.
 *   3. Floor-ratio gating — drop anything scoring below `floorRatio` of the top.
 *
 * The one non-obvious step: the store returns cosine *distance*
 * (`embedding <=> query`, smaller = nearer). We recover similarity as
 * `1 - distance` before applying the stages.
 *
 * This module is a leaf — it imports only node:fs / node:path and is generic
 * over the hit shape, so it never depends on the store or the DB.
 */

import fs from "node:fs";
import path from "node:path";

/** Reranker tunables. Mirrors the `reranker` block of context/memory-config.json. */
export interface RerankConfig {
  /** Exponential recency half-life, in days. */
  halfLifeDays: number;
  /** Keep results scoring `>= floorRatio * topScore`. */
  floorRatio: number;
  /** Recency dampening floor: factor = floor + (1 - floor) * decay. */
  recencyFloor: number;
  /**
   * Per-source-prefix authority weights. Retained for parity/diagnostics; the
   * rerank itself reads the weight already denormalized onto each hit, so this
   * map is informational here (the indexer applied it at index time).
   */
  authorityWeights: Record<string, number>;
}

/** Built-in reranker defaults. */
export const RERANK_DEFAULTS: RerankConfig = {
  halfLifeDays: 14,
  floorRatio: 0.3,
  recencyFloor: 0.7,
  authorityWeights: {
    "context/MEMORY.md": 2.0,
    "context/learnings.md": 1.5,
    "context/memory/": 1.0,
    "context/transcripts/": 0.8,
  },
};

/** The minimum a hit must carry to be reranked. {@link VectorSearchResult} satisfies it. */
export interface RerankInput {
  /** Authority weight snapshotted onto the chunk at index time. */
  authorityWeight: number;
  /** Chunk date `YYYY-MM-DD`, or null when the source carried no date. */
  contentDate: string | null;
  /** Cosine distance from the query (`embedding <=> query`); smaller is nearer. */
  distance: number;
}

/** A reranked hit: the input enriched with its final score and the reranked flag. */
export type RerankedHit<T> = T & { finalScore: number; reranked: true };

/**
 * Load the reranker config from context/memory-config.json, falling back to
 * {@link RERANK_DEFAULTS} on a missing or unreadable file.
 */
export function loadRerankerConfig(rootDir: string): RerankConfig {
  const configPath = path.join(rootDir, "context", "memory-config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const r = parsed?.reranker;
    if (r && typeof r === "object") {
      return {
        halfLifeDays: numberOr(r.half_life_days, RERANK_DEFAULTS.halfLifeDays),
        floorRatio: numberOr(r.floor_ratio, RERANK_DEFAULTS.floorRatio),
        recencyFloor: numberOr(r.recency_floor, RERANK_DEFAULTS.recencyFloor),
        authorityWeights:
          r.authority_weights && typeof r.authority_weights === "object"
            ? (r.authority_weights as Record<string, number>)
            : RERANK_DEFAULTS.authorityWeights,
      };
    }
  } catch {
    /* missing or unreadable config — use built-ins */
  }
  return RERANK_DEFAULTS;
}

/**
 * Exponential recency factor for a chunk date. `1.0` for an undated chunk (no
 * decay), else `exp(-ageDays / halfLifeDays)`. Age is whole calendar days in UTC,
 * clamped at 0 so a future-dated file never boosts above 1. `now` is injectable
 * so tests are deterministic.
 */
export function recencyFactor(
  contentDate: string | null,
  halfLifeDays: number,
  now: Date = new Date(),
): number {
  if (!contentDate) return 1.0;
  const dateMs = parseYmdUtc(contentDate);
  if (dateMs == null) return 1.0;
  const ageDays = Math.max(
    0,
    Math.floor((utcMidnight(now) - dateMs) / MS_PER_DAY),
  );
  return Math.exp(-ageDays / halfLifeDays);
}

/**
 * Apply the three-stage rerank to nearest-neighbour hits and return them sorted
 * by final score, descending, with low-relevance hits gated out.
 *
 * @param hits  results from `store.vectorSearch` (or anything matching {@link RerankInput})
 * @param cfg   reranker tunables (defaults to {@link RERANK_DEFAULTS})
 * @param now   "today" for recency (defaults to the current time)
 */
export function rerank<T extends RerankInput>(
  hits: T[],
  cfg: RerankConfig = RERANK_DEFAULTS,
  now: Date = new Date(),
): Array<RerankedHit<T>> {
  if (hits.length === 0) return [];

  const scored = hits.map((hit) => {
    // distance -> similarity before the stages run.
    const rawScore = 1 - hit.distance;
    // Stage 1 — authority boost (weight already resolved at index time).
    const s1 = rawScore * (Number.isFinite(hit.authorityWeight) ? hit.authorityWeight : 1.0);
    // Stage 2 — recency decay, dampened by the recency floor.
    const rf = recencyFactor(hit.contentDate, cfg.halfLifeDays, now);
    const s2 = s1 * (cfg.recencyFloor + (1.0 - cfg.recencyFloor) * rf);
    return { hit, s2 };
  });

  // Stage 3 — floor-ratio gating. Drop anything below `floorRatio` of the top
  // score. With non-negative similarities the top hit always survives
  // (floorRatio < 1).
  const topS2 = Math.max(...scored.map((x) => x.s2));
  const threshold = topS2 * cfg.floorRatio;

  return scored
    .filter((x) => x.s2 >= threshold)
    .map((x) => ({ ...x.hit, finalScore: round6(x.s2), reranked: true as const }))
    .sort((a, b) => b.finalScore - a.finalScore);
}

const MS_PER_DAY = 86_400_000;

/** UTC-midnight epoch ms for a Date (date part only). */
function utcMidnight(d: Date): number {
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Parse a leading `YYYY-MM-DD` to UTC-midnight epoch ms, else null. */
function parseYmdUtc(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(value);
  if (!m) return null;
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
}

/** Round to 6 decimals (matches Python `round(x, 6)` for the values seen here). */
function round6(x: number): number {
  return Number(x.toFixed(6));
}

function numberOr(value: unknown, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}
