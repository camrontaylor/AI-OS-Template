/**
 * Memory — transcript drill-down window.
 *
 * Recall ladder rung below expand: given a chunk captured from a session turn,
 * return the raw conversation around that turn so an answer can be verified
 * against what was said, not just the summarized chunk text.
 *
 * Pure orchestration over the scoped-access.ts boundary: `resolveScopedChunk`
 * fetches the anchor (for the turn id) and `readScopedTranscriptWindow` re-runs
 * the same scope+permission check before touching the fs, confined under
 * context/transcripts/. A cross-scope or denied chunk returns null (deny ==
 * not-found), like expand.ts; the second check is one extra PK lookup so this
 * module never trusts a result it didn't independently verify.
 *
 * Parses the bounded raw JSONL tolerantly via capture.ts's
 * `parseTranscriptEntries`, locates the entry matching the chunk's turn id, and
 * returns a small window of turns around it. When no turn id derives or matches,
 * falls back to the bounded raw text rather than throwing.
 */

import { resolveScopedChunk, readScopedTranscriptWindow } from "./scoped-access";
import type { MemoryPermissionCheck, TranscriptFs } from "./scoped-access";
import { parseTranscriptEntries, roleOf, messageOf, extractText } from "./capture";
import type { SqlClient } from "./migrate";
import type { SearchScope } from "./types";

/** Default transcript entries returned on EACH side of the matched turn. */
export const DEFAULT_TRANSCRIPT_WINDOW_RADIUS = 2;
/** Default cap on the serialized window length (chars). */
export const DEFAULT_TRANSCRIPT_WINDOW_MAX_CHARS = 4000;

/**
 * Capture marker written by capture.ts's `upsertSessionCapture`:
 * `<!-- aos-capture session:… source:… turn:<id> -->`. The id is a hyphenated
 * UUID, so the group is a lazy run of non-whitespace up to the trailing `-->`
 * (an earlier `[^\s-]+` stopped at the first hyphen and never matched).
 */
const TURN_ID_RE = /turn:(\S+?)\s*-->/;

export interface TranscriptWindowTurn {
  role: string;
  text: string;
}

export interface ExpandTranscriptWindowOptions {
  /** The store escape hatch (`store.client`). */
  client: SqlClient;
  /** Workspace root; forwarded to {@link readScopedTranscriptWindow}. */
  rootDir: string;
  /** The chunk (turn) whose transcript is being drilled into. */
  chunkId: string;
  /** The scope the caller is asking under — the same object search ran with. */
  searchScope: SearchScope;
  /** Transcript entries returned on EACH side of the matched turn. Default 2. */
  radius?: number;
  /** Cap on the serialized window length. Default {@link DEFAULT_TRANSCRIPT_WINDOW_MAX_CHARS}. */
  maxChars?: number;
  /** Permission gate, forwarded to both scoped-access calls. Default allow. */
  permissionCheck?: MemoryPermissionCheck;
  /** Injected fs, forwarded to {@link readScopedTranscriptWindow}. Default node:fs. */
  fs?: TranscriptFs;
}

export interface TranscriptWindowResult {
  chunkId: string;
  sourceId: string;
  sourcePath: string;
  transcriptPath: string;
  /** The turn id extracted from the chunk's capture marker, or null when none was derivable. */
  turnId: string | null;
  /** True when `turnId` was found among the parsed transcript entries. */
  matched: boolean;
  /** The window of turns around the match (or empty when unmatched — see `matched`). */
  turns: TranscriptWindowTurn[];
  /** True when the serialized window (or the raw fallback) was truncated to maxChars. */
  truncated: boolean;
}

/**
 * Drill into the raw transcript a chunk was captured from, returning a small
 * window of turns around the one the chunk summarizes. Returns null when the
 * anchor is out of scope, denied, or {@link readScopedTranscriptWindow} can't
 * resolve a transcript (same deny/not-found semantics as scoped-access.ts).
 * Otherwise never throws: a transcript with no derivable or matching turn id
 * still returns `matched: false` with a bounded raw-text fallback.
 */
export async function expandTranscriptWindow(
  opts: ExpandTranscriptWindowOptions,
): Promise<TranscriptWindowResult | null> {
  // 1. Resolve the anchor chunk in-scope so we can read its capture marker. Deny
  //    == not-found, same as readScopedTranscriptWindow's own gate below.
  const anchor = await resolveScopedChunk({
    client: opts.client,
    chunkId: opts.chunkId,
    searchScope: opts.searchScope,
    operation: "transcript",
    permissionCheck: opts.permissionCheck,
  });
  if (anchor === null) return null;

  // 2. Derive the turn id from the anchor (metadata.turnId preferred, else the
  //    capture marker) BEFORE the read, so the read can window on it, not the head.
  const metaTurnId =
    typeof anchor.metadata?.turnId === "string" && anchor.metadata.turnId.length > 0
      ? anchor.metadata.turnId
      : null;
  const turnIdMatch = metaTurnId ? null : anchor.content.match(TURN_ID_RE);
  const turnId = metaTurnId ?? (turnIdMatch ? turnIdMatch[1] : null);

  // 3. Scope-safe read: re-verifies scope + permission before fs access, returns
  //    the confined raw JSONL windowed around `turnId`.
  const transcript = await readScopedTranscriptWindow({
    client: opts.client,
    rootDir: opts.rootDir,
    chunkId: opts.chunkId,
    searchScope: opts.searchScope,
    permissionCheck: opts.permissionCheck,
    fs: opts.fs,
    turnId: turnId ?? undefined,
  });
  if (transcript === null) return null;

  const maxChars = opts.maxChars ?? DEFAULT_TRANSCRIPT_WINDOW_MAX_CHARS;
  const radius = Math.max(0, Math.floor(opts.radius ?? DEFAULT_TRANSCRIPT_WINDOW_RADIUS));

  // 4. Parse the raw JSONL tolerantly (capture.ts's shared parser) and locate the
  //    matching entry, mirroring extractLastTurn's id precedence (uuid, then
  //    message.id).
  const entries = parseTranscriptEntries(transcript.raw);
  const matchedIndex = turnId === null ? -1 : findEntryIndexById(entries, turnId);

  if (matchedIndex === -1) {
    // No turn id derivable, or no matching entry — fall back to the bounded raw
    // text rather than throwing (null is reserved for denied/not-found above).
    const raw = transcript.raw;
    const bounded = raw.length > maxChars ? raw.slice(0, maxChars) : raw;
    return {
      chunkId: transcript.chunkId,
      sourceId: transcript.sourceId,
      sourcePath: transcript.sourcePath,
      transcriptPath: transcript.transcriptPath,
      turnId,
      matched: false,
      turns: bounded.trim() ? [{ role: "raw", text: bounded }] : [],
      truncated: raw.length > maxChars,
    };
  }

  // 5. Build a symmetric window of entries around the match, clamped to bounds.
  const fromIndex = Math.max(0, matchedIndex - radius);
  const toIndex = Math.min(entries.length - 1, matchedIndex + radius);
  const windowEntries = entries.slice(fromIndex, toIndex + 1);

  const turns: TranscriptWindowTurn[] = [];
  for (const entry of windowEntries) {
    const role = roleOf(entry) ?? "unknown";
    const text = extractText(messageOf(entry).content);
    if (text) turns.push({ role, text });
  }

  // 6. Bound the total serialized size.
  const { bounded: boundedTurns, truncated } = boundTurns(turns, maxChars);

  return {
    chunkId: transcript.chunkId,
    sourceId: transcript.sourceId,
    sourcePath: transcript.sourcePath,
    transcriptPath: transcript.transcriptPath,
    turnId,
    matched: true,
    turns: boundedTurns,
    truncated,
  };
}

/** Find the index of the entry whose uuid or message.id equals `turnId`. */
function findEntryIndexById(entries: Record<string, unknown>[], turnId: string): number {
  for (let i = 0; i < entries.length; i += 1) {
    const entry = entries[i];
    const msg = messageOf(entry);
    const uuid = typeof entry.uuid === "string" ? entry.uuid : null;
    const msgId = typeof msg.id === "string" ? msg.id : null;
    if (uuid === turnId || msgId === turnId) return i;
  }
  return -1;
}

/** Trim trailing turns so the combined text length stays within maxChars. */
function boundTurns(
  turns: TranscriptWindowTurn[],
  maxChars: number,
): { bounded: TranscriptWindowTurn[]; truncated: boolean } {
  let total = 0;
  const bounded: TranscriptWindowTurn[] = [];
  for (const turn of turns) {
    const remaining = maxChars - total;
    if (remaining <= 0) return { bounded, truncated: true };
    if (turn.text.length <= remaining) {
      bounded.push(turn);
      total += turn.text.length;
    } else {
      bounded.push({ role: turn.role, text: turn.text.slice(0, remaining) });
      return { bounded, truncated: true };
    }
  }
  return { bounded, truncated: false };
}
