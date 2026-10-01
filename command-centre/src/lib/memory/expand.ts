/**
 * Memory — expand.
 *
 * Recall ladder rung after search: given a chunk from a scoped search result,
 * return the surrounding source context so an answer is easy to verify.
 *
 * Pure orchestration over the scoped-access.ts boundary — every read goes
 * through `resolveScopedChunk` and `fetchScopedSiblingChunks`, so a cross-scope
 * or denied anchor returns null (deny == not-found) and neighbours can only come
 * from the same source and scope.
 *
 * Keyed off `chunk_index` (dense, NOT NULL), so expand works even for legacy
 * rows lacking start_line/end_line; line provenance only drives the citation
 * span and degrades to null when missing. Output is bounded by maxChars.
 */

import { fetchScopedSiblingChunks, resolveScopedChunk } from "./scoped-access";
import type { MemoryPermissionCheck } from "./scoped-access";
import type { SqlClient } from "./migrate";
import type { MemoryChunkRow, SearchScope, SourceType } from "./types";

/** Default chunks of context returned on EACH side of the anchor. */
export const DEFAULT_EXPAND_RADIUS = 1;
/** Default cap on the stitched context length (chars). */
export const DEFAULT_EXPAND_MAX_CHARS = 4000;

/** Blank line between stitched chunks, mirroring how markdown sections read. */
const CHUNK_SEPARATOR = "\n\n";

export interface ExpandMemoryOptions {
  /** The store escape hatch (`store.client`). */
  client: SqlClient;
  /** The anchor chunk id, from a scoped search result. */
  chunkId: string;
  /** The scope the caller is asking under — the same object search ran with. */
  searchScope: SearchScope;
  /** Chunks of context on EACH side of the anchor. Default 1, clamped to >= 0. */
  radius?: number;
  /** Hard cap on neighbouring chunks fetched. Forwarded to the primitive. */
  limit?: number;
  /** Cap on the stitched content length. Default {@link DEFAULT_EXPAND_MAX_CHARS}. */
  maxChars?: number;
  /** Permission gate, forwarded to both primitive calls. Default allow. */
  permissionCheck?: MemoryPermissionCheck;
}

export interface ExpandedMemory {
  /** The chunk the expansion is centred on. */
  anchorChunkId: string;
  sourceId: string;
  sourcePath: string;
  sourceType: SourceType;
  /** The anchor's nearest enclosing heading, for citation. */
  heading: string | null;
  /** chunk_index window actually returned (inclusive). */
  fromIndex: number;
  toIndex: number;
  /** Combined source line span across the returned chunks, or null when any
   *  returned chunk lacks line provenance (legacy rows). */
  startLine: number | null;
  endLine: number | null;
  /** True only when every returned chunk carried start/end line provenance. */
  hasLineProvenance: boolean;
  /** Ordered chunk ids included in the context (anchor + neighbours). */
  chunkIds: string[];
  /** The stitched surrounding context, bounded by maxChars. */
  content: string;
  /** True when maxChars truncated the stitched content. */
  truncated: boolean;
}

/**
 * Expand a scoped search-result chunk into its surrounding source context.
 * Returns null when the anchor is out of scope or denied (matching the
 * scoped-access contract); otherwise the anchor plus a symmetric `radius` window
 * of in-scope neighbours from the same source, stitched and bounded.
 */
export async function expandMemoryChunk(
  opts: ExpandMemoryOptions,
): Promise<ExpandedMemory | null> {
  // 1. Resolve the anchor in-scope (scope WHERE + permission). Deny == not-found.
  const anchor = await resolveScopedChunk({
    client: opts.client,
    chunkId: opts.chunkId,
    searchScope: opts.searchScope,
    operation: "expand",
    permissionCheck: opts.permissionCheck,
  });
  if (anchor === null) return null;

  // 2. chunk_index window around the anchor. chunk_index is dense + NOT NULL, so
  //    this works even when line provenance is missing.
  const radius = Math.max(0, Math.floor(opts.radius ?? DEFAULT_EXPAND_RADIUS));
  const fromIndex = Math.max(0, anchor.chunkIndex - radius);
  const toIndex = anchor.chunkIndex + radius;

  // 3. Fetch neighbours; the primitive re-applies the scope filter to every row,
  //    so a mis-scoped sibling can never ride along.
  const siblings = await fetchScopedSiblingChunks({
    client: opts.client,
    sourceId: anchor.sourceId,
    searchScope: opts.searchScope,
    fromIndex,
    toIndex,
    limit: opts.limit,
    permissionCheck: opts.permissionCheck,
  });

  // The anchor is already resolved + permitted, so keep it even if a tight
  // `limit` or sibling-only denial clipped it from the neighbour fetch (it's
  // never a leak — the caller already has it).
  const chunks = ensureAnchorPresent(siblings, anchor);

  // 4. Citation span only when every returned chunk carries line provenance;
  //    otherwise degrade to null (legacy missing-provenance rows).
  const { startLine, endLine, hasLineProvenance } = lineSpan(chunks);

  const maxChars = opts.maxChars ?? DEFAULT_EXPAND_MAX_CHARS;
  const stitched = chunks.map((c) => c.content).join(CHUNK_SEPARATOR);
  const truncated = stitched.length > maxChars;

  return {
    anchorChunkId: anchor.id,
    sourceId: anchor.sourceId,
    sourcePath: anchor.sourcePath,
    sourceType: anchor.sourceType,
    heading: anchor.heading,
    fromIndex: chunks[0].chunkIndex,
    toIndex: chunks[chunks.length - 1].chunkIndex,
    startLine,
    endLine,
    hasLineProvenance,
    chunkIds: chunks.map((c) => c.id),
    content: truncated ? stitched.slice(0, maxChars) : stitched,
    truncated,
  };
}

/** Merge the anchor back into the neighbour set if a clip dropped it, keeping order. */
function ensureAnchorPresent(
  siblings: MemoryChunkRow[],
  anchor: MemoryChunkRow,
): MemoryChunkRow[] {
  if (siblings.some((c) => c.id === anchor.id)) return siblings;
  return [...siblings, anchor].sort((a, b) => a.chunkIndex - b.chunkIndex);
}

/** Combined [min(start_line), max(end_line)] span, or null when any chunk lacks it. */
function lineSpan(chunks: MemoryChunkRow[]): {
  startLine: number | null;
  endLine: number | null;
  hasLineProvenance: boolean;
} {
  const complete =
    chunks.length > 0 &&
    chunks.every((c) => c.startLine != null && c.endLine != null);
  if (!complete) {
    return { startLine: null, endLine: null, hasLineProvenance: false };
  }
  return {
    startLine: Math.min(...chunks.map((c) => c.startLine as number)),
    endLine: Math.max(...chunks.map((c) => c.endLine as number)),
    hasLineProvenance: true,
  };
}
