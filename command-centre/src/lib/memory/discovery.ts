/**
 * AIOS Memory Schema — source discovery & normalization.
 *
 * Walks the AI-OS memory source roots and turns each file into a
 * normalized {@link DiscoveredSource} the indexer can chunk, embed, and store.
 * This is the half of the indexer that knows the filesystem layout; the indexer
 * itself stays storage-focused.
 *
 * The default roots are the active AI-OS memory corpus:
 *   context/memory, context/learnings.md
 * Legacy .memsearch/memory folders are import-only and must be passed
 * explicitly as --root paths during migration.
 * Authority weights and the YYYY-MM-DD recency
 * date are snapshotted here from context/memory-config.json so the store carries
 * the reranking inputs used by the search pipeline.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import type { SourceType } from "./types";

/** A file ready to index. */
export interface DiscoveredSource {
  /** Absolute path on disk. */
  absPath: string;
  /** Repo-relative, forward-slash path. Matches authority-weight keys + the store UNIQUE index. */
  sourcePath: string;
  sourceType: SourceType;
  /** First H1, else the filename. */
  title: string | null;
  /** Parsed YYYY-MM-DD from the filename, else null. */
  contentDate: string | null;
  authorityWeight: number;
  /** sha256 over the NORMALIZED content (stable change detection). */
  contentSha256: string;
  byteSize: number;
  /** Normalized text (LF endings, trailing whitespace trimmed). */
  content: string;
  /** Slug from clients/{slug}/..., else null. Drives client-scope override. */
  clientSlug: string | null;
}

export interface DiscoverOptions {
  /** AI-OS workspace root. */
  rootDir: string;
  /** Roots to walk (relative to rootDir). Defaults to {@link DEFAULT_SOURCE_ROOTS}. */
  roots?: string[];
  /** Authority weights (longest-prefix match). Defaults to memory-config.json + built-ins. */
  authorityWeights?: Record<string, number>;
}

/** The default source roots for local and hosted memory indexing. */
export const DEFAULT_SOURCE_ROOTS: readonly string[] = [
  "context/memory",
  "context/learnings.md",
];

/** Built-in authority weights, used when memory-config.json is absent. */
export const DEFAULT_AUTHORITY_WEIGHTS: Record<string, number> = {
  "context/MEMORY.md": 2.0,
  "context/learnings.md": 1.5,
  "context/memory/": 1.0,
  "context/transcripts/": 0.8,
  "clients/": 0.9,
};

const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);
const DATE_RE = /(\d{4}-\d{2}-\d{2})/;
const CLIENT_RE = /^clients\/([^/]+)\//;
const H1_RE = /^#\s+(.+?)\s*#*\s*$/m;

/** Load authority weights from context/memory-config.json, falling back to defaults. */
export function loadAuthorityWeights(rootDir: string): Record<string, number> {
  const configPath = path.join(rootDir, "context", "memory-config.json");
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const weights = parsed?.reranker?.authority_weights;
    if (weights && typeof weights === "object") {
      return weights as Record<string, number>;
    }
  } catch {
    /* missing or unreadable config — use built-ins */
  }
  return { ...DEFAULT_AUTHORITY_WEIGHTS };
}

/** Longest-prefix authority weight for a repo-relative source path; 1.0 if none. */
export function authorityWeightFor(
  sourcePath: string,
  weights: Record<string, number>,
): number {
  const normalized = sourcePath.replace(/\\/g, "/");
  let best: { key: string; weight: number } | null = null;

  for (const [key, weight] of Object.entries(weights)) {
    const isExact = !key.endsWith("/");
    const matches = isExact ? normalized === key : normalized.startsWith(key);
    if (!matches) continue;
    // Prefer exact-file keys, then the longest prefix.
    if (
      best === null ||
      (isExact && best.key.endsWith("/")) ||
      key.length > best.key.length
    ) {
      best = { key, weight: Number(weight) };
    }
  }
  return best ? best.weight : 1.0;
}

/** Parse a YYYY-MM-DD date out of a filename, else null. */
export function parseContentDate(filename: string): string | null {
  const match = DATE_RE.exec(filename);
  return match ? match[1] : null;
}

/** Classify a repo-relative source path into a {@link SourceType}. */
export function sourceTypeFor(sourcePath: string): SourceType {
  const p = sourcePath.replace(/\\/g, "/");
  if (p === "context/learnings.md") return "learnings";
  if (p.startsWith("brand_context/")) return "brand";
  if (p.startsWith("context/transcripts/")) return "transcript";
  if (
    p.startsWith("context/memory/") ||
    p.startsWith(".memsearch/memory/") ||
    p.includes("/.memsearch/memory/")
  ) {
    return "memory";
  }
  if (p === "context/MEMORY.md") return "memory";
  return "other";
}

/** Walk the configured roots and return normalized sources. Missing roots are skipped. */
export function discoverSources(opts: DiscoverOptions): DiscoveredSource[] {
  const roots = opts.roots ?? [...DEFAULT_SOURCE_ROOTS];
  const weights = opts.authorityWeights ?? loadAuthorityWeights(opts.rootDir);

  const absFiles: string[] = [];
  for (const root of roots) {
    const absRoot = path.join(opts.rootDir, root);
    collectFiles(absRoot, absFiles);
  }

  const sources: DiscoveredSource[] = [];
  for (const absPath of absFiles) {
    const source = normalizeFile(absPath, opts.rootDir, weights);
    if (source) sources.push(source);
  }
  // Stable order across runs (deterministic indexing/tests).
  sources.sort((a, b) => a.sourcePath.localeCompare(b.sourcePath));
  return sources;
}

/** Recursively collect indexable files under `absRoot` (a file or a directory). */
function collectFiles(absRoot: string, out: string[]): void {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absRoot);
  } catch {
    return; // missing root
  }

  if (stat.isFile()) {
    if (isIndexable(absRoot)) out.push(absRoot);
    return;
  }
  if (!stat.isDirectory()) return;

  for (const entry of fs.readdirSync(absRoot, { withFileTypes: true })) {
    // Skip hidden entries (e.g. .gitkeep) — but NOT the .memsearch root itself,
    // which is reached as an explicit root path, not via this walk.
    if (entry.name.startsWith(".")) continue;
    const child = path.join(absRoot, entry.name);
    if (entry.isDirectory()) {
      collectFiles(child, out);
    } else if (entry.isFile() && isIndexable(child)) {
      out.push(child);
    }
  }
}

/** Whether a file's extension + non-zero size qualify it as a memory source. */
export function isIndexable(absPath: string): boolean {
  if (!TEXT_EXTENSIONS.has(path.extname(absPath).toLowerCase())) return false;
  try {
    return fs.statSync(absPath).size > 0; // skip zero-byte files (e.g. .gitkeep)
  } catch {
    return false;
  }
}

function normalizeFile(
  absPath: string,
  rootDir: string,
  weights: Record<string, number>,
): DiscoveredSource | null {
  let raw: string;
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }

  const content = normalizeContent(raw);
  if (content.trim().length === 0) return null;

  const sourcePath = path.relative(rootDir, absPath).split(path.sep).join("/");
  const filename = path.basename(absPath);
  const h1 = H1_RE.exec(content);

  return {
    absPath,
    sourcePath,
    sourceType: sourceTypeFor(sourcePath),
    title: h1 ? h1[1].trim() : filename,
    contentDate: parseContentDate(filename),
    authorityWeight: authorityWeightFor(sourcePath, weights),
    contentSha256: crypto.createHash("sha256").update(content).digest("hex"),
    byteSize: Buffer.byteLength(content, "utf-8"),
    content,
    clientSlug: clientSlugFor(sourcePath),
  };
}

/** Normalize line endings to LF and trim trailing whitespace per line. */
function normalizeContent(raw: string): string {
  return raw
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .split("\n")
    .map((line) => line.replace(/\s+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clientSlugFor(sourcePath: string): string | null {
  const match = CLIENT_RE.exec(sourcePath);
  return match ? match[1] : null;
}
