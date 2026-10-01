import * as fs from "node:fs/promises";
import * as path from "node:path";

/**
 * AIOS Memory Schema — embedding generation.
 *
 * The store stores and searches vectors but never *generates* them —
 * that is this module's job. It defines the {@link Embedder} contract the
 * indexer (and the scoped search) program against, plus two implementations:
 *
 *   - {@link BgeM3Embedder} — real BGE-M3 (1024-dim) via Transformers.js. This
 *     is the production default for indexing and retrieval.
 *   - {@link HashEmbedder}  — deterministic, dependency-free, offline. Tests
 *     construct it directly; production callers must request it explicitly.
 *
 * Both return L2-normalized vectors — the contract the HNSW + cosine index in
 * migrations/0001_init.sql relies on.
 */

/** Generates L2-normalized embeddings for text. */
export interface Embedder {
  /** Model identifier stored on each chunk (e.g. 'bge-m3', 'hash-v1'). */
  readonly model: string;
  /** Output dimension. Must equal the store's embedDim. */
  readonly dim: number;
  /** Embed a batch of texts. Each returned vector is L2-normalized, length === dim. */
  embed(texts: string[]): Promise<number[][]>;
}

/** The Hugging Face model id used by the production embedder. */
export const BGE_M3_MODEL_ID = "Xenova/bge-m3";
/** Stable model label written to memory_chunks.embedding_model. */
export const BGE_M3_EMBED_MODEL = "bge-m3";
/** BGE-M3 embedding dimension. */
export const BGE_M3_EMBED_DIM = 1024;
/** Default local cache directory, relative to AI_OS_DIR / repo root. */
export const DEFAULT_MODEL_CACHE_DIR = ".command-centre/models";

const TOKEN_RE = /[a-z0-9]+/g;
const BGE_M3_CACHE_PATH_PARTS = BGE_M3_MODEL_ID.split("/");
const RECOVERABLE_BGE_M3_LOAD_ERROR_PATTERNS = [
  /Protobuf parsing failed/i,
  /Load model from .* failed/i,
  /Failed to load model/i,
  /Failed to create InferenceSession/i,
  /invalid model/i,
  /corrupt/i,
];

/** FNV-1a 32-bit hash of a string. Stable across platforms (pure integer math). */
function fnv1a(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

/** L2-normalize in place; returns a deterministic unit fallback for a zero vector. */
function l2normalize(vec: number[]): number[] {
  let sumSq = 0;
  for (const v of vec) sumSq += v * v;
  const norm = Math.sqrt(sumSq);
  if (norm === 0) {
    // Empty / token-less text. Return a fixed unit vector so callers never see
    // an all-zero embedding (toVectorLiteral is fine with it, but cosine
    // distance against zero is undefined).
    const fallback = new Array<number>(vec.length).fill(0);
    fallback[0] = 1;
    return fallback;
  }
  for (let i = 0; i < vec.length; i += 1) vec[i] /= norm;
  return vec;
}

/**
 * Deterministic, dependency-free embedder.
 *
 * Hashes each word into a bucket with a sign (a signed bag-of-words / hashing
 * trick), then L2-normalizes. Pure JS integer math ⇒ bit-identical output on
 * every machine ⇒ tests are deterministic and the persisted vectors are stable
 * across re-indexes. Not semantically deep, but lexical overlap drives cosine
 * similarity, which is enough to prove the pipeline and to power a usable
 * offline search until the real model is enabled.
 */
export class HashEmbedder implements Embedder {
  readonly model: string;
  readonly dim: number;

  constructor(opts: { dim?: number; model?: string } = {}) {
    this.dim = opts.dim ?? BGE_M3_EMBED_DIM;
    this.model = opts.model ?? `hash-v1-${this.dim}`;
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  private embedOne(text: string): number[] {
    const vec = new Array<number>(this.dim).fill(0);
    const lower = text.toLowerCase();
    let match: RegExpExecArray | null;
    TOKEN_RE.lastIndex = 0;
    while ((match = TOKEN_RE.exec(lower)) !== null) {
      const token = match[0];
      const h = fnv1a(token);
      const idx = h % this.dim;
      // Second, salted hash supplies a sign bit so co-occurring terms can cancel
      // rather than only accumulate — keeps distinct texts further apart.
      const sign = (fnv1a(`${token}`) & 1) === 0 ? 1 : -1;
      vec[idx] += sign;
    }
    return l2normalize(vec);
  }
}

/**
 * Real local embedder: BGE-M3 via Transformers.js.
 *
 * Lazily imports `@huggingface/transformers` so the dependency is only needed
 * when a caller actually embeds. The model downloads to `.command-centre/models`
 * by default on first use. Output is CLS-pooled + L2-normalized 1024-dim,
 * matching DEFAULT_EMBED_DIM.
 */
export class BgeM3Embedder implements Embedder {
  readonly model = BGE_M3_EMBED_MODEL;
  readonly dim = BGE_M3_EMBED_DIM;
  private pipe: ((texts: string[], opts: unknown) => Promise<unknown>) | null = null;
  private readonly cacheDir?: string;
  private readonly progress?: (event: EmbeddingProgressEvent) => void;

  constructor(opts: { cacheDir?: string; progress?: (event: EmbeddingProgressEvent) => void } = {}) {
    this.cacheDir = opts.cacheDir;
    this.progress = opts.progress;
  }

  private async ensurePipe(): Promise<void> {
    if (this.pipe) return;
    // `new Function` forces a true dynamic ESM import that survives the
    // CommonJS transpile used by load-ts-module.cjs (which would otherwise
    // rewrite `import()` to `require()` and break the ESM-only package).
    const dynamicImport = new Function(
      "specifier",
      "return import(specifier)",
    ) as (s: string) => Promise<{
      env?: { cacheDir?: string };
      pipeline: (task: string, model: string, opts?: unknown) => Promise<unknown>;
    }>;
    const transformers = await dynamicImport("@huggingface/transformers");
    if (this.cacheDir && transformers.env) {
      transformers.env.cacheDir = this.cacheDir;
    }
    this.pipe = (await transformers.pipeline(
      "feature-extraction",
      BGE_M3_MODEL_ID,
      { dtype: "q8", progress_callback: this.progress },
    )) as (texts: string[], opts: unknown) => Promise<unknown>;
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    await this.ensurePipe();
    const output = (await this.pipe!(texts, {
      pooling: "cls",
      normalize: true,
    })) as { tolist?: () => number[][]; data?: ArrayLike<number>; dims?: number[] };

    // transformers.js returns a Tensor. `.tolist()` yields nested arrays for a
    // batched run; fall back to reshaping the flat `.data` by `dims`.
    if (typeof output.tolist === "function") {
      return output.tolist();
    }
    const flat = Array.from(output.data ?? []);
    const dim = output.dims?.[output.dims.length - 1] ?? this.dim;
    const rows: number[][] = [];
    for (let i = 0; i < flat.length; i += dim) rows.push(flat.slice(i, i + dim));
    return rows;
  }
}

/** Which embedder implementation to build. */
export type EmbedderKind = "bge-m3" | "local" | "hash";

export interface EmbeddingProgressEvent {
  status?: string;
  file?: string;
  name?: string;
  progress?: number;
  loaded?: number;
  total?: number;
}

export interface CreateEmbedderOptions {
  /** Explicit override; falls back to `MEMORY_EMBEDDER`, then "bge-m3". */
  kind?: EmbedderKind;
  /** Dimension for the hash embedder. Default 1024. */
  dim?: number;
  /** Model cache directory for BGE-M3. */
  cacheDir?: string;
  /** Optional download/load progress callback for BGE-M3. */
  progress?: (event: EmbeddingProgressEvent) => void;
  /** Test hook for the BGE-M3 embedder factory. Production callers should not set this. */
  bgeM3Factory?: BgeM3EmbedderFactory;
}

export type BgeM3EmbedderFactory = (opts: {
  cacheDir?: string;
  progress?: (event: EmbeddingProgressEvent) => void;
}) => Embedder;

function errorText(error: unknown): string {
  if (error instanceof Error) {
    return `${error.message}\n${error.stack ?? ""}`;
  }
  return String(error);
}

function bgeM3UnavailableError(error: unknown): Error {
  const reason = error instanceof Error ? error.message : String(error);
  return new Error(
    `BGE-M3 embedder unavailable (${reason}). Run AI-OS update/setup ` +
      `again so the model can be downloaded and memory can be reindexed.`,
  );
}

function bgeM3RepairRetryError(firstError: unknown, retryError: unknown): Error {
  const firstReason = firstError instanceof Error ? firstError.message : String(firstError);
  const retryReason = retryError instanceof Error ? retryError.message : String(retryError);
  return new Error(
    `BGE-M3 embedder unavailable (${firstReason}; cache repair retry failed: ${retryReason}). ` +
      `Run AI-OS update/setup again so the model can be downloaded and memory can be reindexed.`,
  );
}

export function isRecoverableBgeM3LoadError(error: unknown): boolean {
  const message = errorText(error);
  return RECOVERABLE_BGE_M3_LOAD_ERROR_PATTERNS.some((pattern) => pattern.test(message));
}

export function getBgeM3ModelCacheDir(cacheDir?: string): string | null {
  if (!cacheDir) return null;
  const root = path.resolve(cacheDir);
  const modelDir = path.resolve(root, ...BGE_M3_CACHE_PATH_PARTS);
  const relative = path.relative(root, modelDir);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
    return null;
  }
  return modelDir;
}

export async function clearBgeM3ModelCache(cacheDir?: string): Promise<boolean> {
  const modelDir = getBgeM3ModelCacheDir(cacheDir);
  if (!modelDir) return false;
  await fs.rm(modelDir, { recursive: true, force: true });
  return true;
}

async function createAndProbeBgeM3Embedder(
  opts: {
    cacheDir?: string;
    progress?: (event: EmbeddingProgressEvent) => void;
    bgeM3Factory?: BgeM3EmbedderFactory;
  },
): Promise<Embedder> {
  const factory = opts.bgeM3Factory ?? ((factoryOpts) => new BgeM3Embedder(factoryOpts));
  const embedder = factory({
    cacheDir: opts.cacheDir,
    progress: opts.progress,
  });
  // Probe immediately so a missing dependency fails here (where we can fall
  // back with a clear setup error) rather than mid-index.
  await embedder.embed(["warmup"]);
  return embedder;
}

/**
 * Build an {@link Embedder}.
 *
 * Selection: `opts.kind` → `process.env.MEMORY_EMBEDDER` → `"bge-m3"`.
 * `local` is kept as a compatibility alias for BGE-M3. Hash is available only
 * when explicitly requested.
 */
export async function createEmbedder(
  opts: CreateEmbedderOptions = {},
): Promise<Embedder> {
  const dim = opts.dim ?? BGE_M3_EMBED_DIM;
  const kind: EmbedderKind =
    opts.kind ??
    ((process.env.MEMORY_EMBEDDER as EmbedderKind | undefined) || "bge-m3");

  if (kind === "hash") {
    return new HashEmbedder({ dim });
  }

  if (kind === "local" || kind === "bge-m3") {
    const cacheDir = opts.cacheDir ?? process.env.MEMORY_MODEL_CACHE_DIR;
    try {
      return await createAndProbeBgeM3Embedder({
        cacheDir,
        progress: opts.progress,
        bgeM3Factory: opts.bgeM3Factory,
      });
    } catch (firstError) {
      if (cacheDir && isRecoverableBgeM3LoadError(firstError)) {
        try {
          opts.progress?.({ status: "cache-repair", file: BGE_M3_MODEL_ID });
          await clearBgeM3ModelCache(cacheDir);
          return await createAndProbeBgeM3Embedder({
            cacheDir,
            progress: opts.progress,
            bgeM3Factory: opts.bgeM3Factory,
          });
        } catch (retryError) {
          throw bgeM3RepairRetryError(firstError, retryError);
        }
      }
      throw bgeM3UnavailableError(firstError);
    }
  }

  throw new Error(`Unknown memory embedder "${kind}". Use bge-m3 or hash.`);
}
