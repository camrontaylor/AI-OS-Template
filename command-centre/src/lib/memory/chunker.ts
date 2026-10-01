/**
 * Memory — markdown-aware chunking.
 *
 * Splits a source document into chunk rows for the store to embed and persist.
 * Walks the document by markdown heading, flushing a chunk when a new heading
 * starts or the accumulated size hits the target; oversized sections are
 * hard-split into overlapping windows under the cap. Pure and deterministic.
 */

import crypto from "node:crypto";

export interface Chunk {
  /** 0-based dense position within the source. */
  index: number;
  content: string;
  /** Nearest enclosing markdown heading, or null for preamble before any heading. */
  heading: string | null;
  /** Markdown heading depth for `heading`, or null before any heading. */
  headingLevel: number | null;
  /** 1-based source line where this chunk's text starts. */
  startLine: number;
  /** 1-based source line where this chunk's text ends. */
  endLine: number;
  /** sha256 hex digest of this chunk's content. */
  contentHash: string;
  /** Rough token estimate (~chars / 4). */
  tokenCount: number;
}

export interface ChunkOptions {
  /** Soft target size; a section flushes once it reaches this. Default 1200. */
  targetChars?: number;
  /** Overlap carried between hard-split windows of an oversized section. Default 150. */
  overlapChars?: number;
  /** Hard cap; sections larger than this are window-split. Default 2000. */
  maxChars?: number;
}

const DEFAULTS: Required<ChunkOptions> = {
  targetChars: 1200,
  overlapChars: 150,
  maxChars: 2000,
};

const HEADING_RE = /^(#{1,6})\s+(.+?)\s*#*\s*$/;

interface LineEntry {
  lineNumber: number;
  text: string;
}

interface RawSection {
  heading: string | null;
  headingLevel: number | null;
  lines: LineEntry[];
  content: string;
}

/** Estimate token count for a string (~4 chars/token, the common heuristic). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** sha256 hex digest for stable chunk content identity. */
export function contentHash(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

/**
 * Chunk a markdown (or plain-text) document.
 *
 * Headings start new chunks and tag every chunk under them. Sections longer
 * than `maxChars` are split into windows of ~`targetChars` with `overlapChars`
 * of overlap. Empty/whitespace-only chunks are dropped; indices are dense.
 */
export function chunkMarkdown(text: string, opts: ChunkOptions = {}): Chunk[] {
  const { targetChars, overlapChars, maxChars } = { ...DEFAULTS, ...opts };
  const lines = text.split(/\r?\n/);

  const raw: RawSection[] = [];
  let currentHeading: string | null = null;
  let currentHeadingLevel: number | null = null;
  let buffer: LineEntry[] = [];

  const flushBuffer = () => {
    const section = normalizeSection(buffer);
    if (section) {
      raw.push({
        heading: currentHeading,
        headingLevel: currentHeadingLevel,
        lines: section.lines,
        content: section.content,
      });
    }
    buffer = [];
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      // A heading boundary closes the current section.
      flushBuffer();
      currentHeading = headingMatch[2].trim();
      currentHeadingLevel = headingMatch[1].length;
      continue;
    }
    buffer.push({ lineNumber: i + 1, text: line });
    // Soft flush so a long heading-less run still chunks at the target size.
    if (bufferLength(buffer) >= targetChars) flushBuffer();
  }
  flushBuffer();

  // Hard-split any section over the cap into overlapping windows.
  const chunks: Chunk[] = [];
  for (const section of raw) {
    for (const piece of splitToWindows(section, targetChars, overlapChars, maxChars)) {
      const content = piece.content;
      chunks.push({
        index: chunks.length,
        content,
        heading: section.heading,
        headingLevel: section.headingLevel,
        startLine: piece.startLine,
        endLine: piece.endLine,
        contentHash: contentHash(content),
        tokenCount: estimateTokens(content),
      });
    }
  }
  return chunks;
}

function bufferLength(lines: LineEntry[]): number {
  if (lines.length === 0) return 0;
  return lines.reduce((sum, line) => sum + line.text.length, 0) + lines.length - 1;
}

function normalizeSection(lines: LineEntry[]): { lines: LineEntry[]; content: string } | null {
  const first = lines.findIndex((line) => line.text.trim().length > 0);
  if (first === -1) return null;

  let last = lines.length - 1;
  while (last > first && lines[last].text.trim().length === 0) last -= 1;

  const active = lines.slice(first, last + 1).map((line, index, arr) => {
    let text = line.text;
    if (index === 0) text = text.trimStart();
    if (index === arr.length - 1) text = text.trimEnd();
    return { lineNumber: line.lineNumber, text };
  });

  const content = active.map((line) => line.text).join("\n");
  return content.length === 0 ? null : { lines: active, content };
}

interface WindowPiece {
  content: string;
  startLine: number;
  endLine: number;
}

interface LineSpan {
  lineNumber: number;
  start: number;
  end: number;
}

/** Split content into windows with overlap while keeping source line ranges. */
function splitToWindows(
  section: RawSection,
  targetChars: number,
  overlapChars: number,
  maxChars: number,
): WindowPiece[] {
  const { content } = section;
  if (content.length <= maxChars) {
    return [
      {
        content,
        startLine: section.lines[0].lineNumber,
        endLine: section.lines[section.lines.length - 1].lineNumber,
      },
    ];
  }

  const windows: WindowPiece[] = [];
  const spans = buildLineSpans(section);
  const windowSize = Math.min(targetChars, maxChars);
  const step = Math.max(1, targetChars - overlapChars);
  for (let start = 0; start < content.length; start += step) {
    const end = Math.min(start + windowSize, content.length);
    const raw = content.slice(start, end);
    const leading = raw.length - raw.trimStart().length;
    const trailing = raw.length - raw.trimEnd().length;
    const adjustedStart = start + leading;
    const adjustedEnd = end - trailing;
    const piece = content.slice(adjustedStart, adjustedEnd);
    if (piece.length > 0) {
      windows.push({
        content: piece,
        startLine: lineForOffset(spans, adjustedStart),
        endLine: lineForOffset(spans, Math.max(adjustedStart, adjustedEnd - 1)),
      });
    }
    if (end >= content.length) break;
  }
  return windows;
}

function buildLineSpans(section: RawSection): LineSpan[] {
  let offset = 0;
  return section.lines.map((line, index) => {
    const start = offset;
    const end = start + line.text.length;
    offset = end + (index === section.lines.length - 1 ? 0 : 1);
    return { lineNumber: line.lineNumber, start, end };
  });
}

function lineForOffset(spans: LineSpan[], offset: number): number {
  for (const span of spans) {
    if (offset >= span.start && offset <= span.end) return span.lineNumber;
  }
  return spans[spans.length - 1].lineNumber;
}

// ---------------------------------------------------------------------------
// Capture-block provenance — transcript-rung mapping (turn id + path).
//
// `.aos.md` sources write each turn's `turn:` marker on the line above its
// heading, so chunking-by-heading orphans the marker into the previous block's
// chunk. ingest resolves blocks once (parseCaptureBlocks) and stamps the turn id
// + transcript path onto each chunk by line overlap (captureMetadataForChunk),
// so the transcript rung reads that metadata instead of re-scraping content.
// Lives here, next to chunkMarkdown, to keep ingest.ts's imports acyclic.
// ---------------------------------------------------------------------------

export interface CaptureBlock {
  /** 1-based line of the opening `<!-- aos-capture … -->` marker. */
  startLine: number;
  /** 1-based line of the closing `<!-- /aos-capture -->` marker (or last line). */
  endLine: number;
  /** The turn id from the opening marker. */
  turnId: string;
  /** Repo-relative transcript path from the block's `Raw transcript:` line, or null. */
  transcriptPath: string | null;
}

/**
 * Metadata stamped onto a chunk so the transcript rung needs no content scrape.
 * A `type` (not `interface`) to keep it assignable to the store's
 * `metadata?: Record<string, unknown>` field.
 */
export type ChunkCaptureMetadata = {
  turnId: string;
  transcriptPath?: string;
};

const CAPTURE_OPEN_RE = /aos-capture\b[^>]*\bturn:(\S+?)\s*-->/;
const CAPTURE_CLOSE_RE = /<!--\s*\/aos-capture\s*-->/;
const CAPTURE_RAW_RE = /Raw transcript:\s*`([^`]+)`/;

/**
 * Parse every `aos-capture` block out of a source, with 1-based line ranges
 * matching this module's `startLine`/`endLine` provenance. Returns [] when no
 * capture markers are present (every non-`.aos.md` source).
 */
export function parseCaptureBlocks(text: string): CaptureBlock[] {
  const lines = text.split(/\r?\n/);
  const blocks: CaptureBlock[] = [];
  let open: { startLine: number; turnId: string; transcriptPath: string | null } | null = null;

  const flush = (endLine: number) => {
    if (open) {
      blocks.push({ startLine: open.startLine, endLine, turnId: open.turnId, transcriptPath: open.transcriptPath });
      open = null;
    }
  };

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    const openMatch = CAPTURE_OPEN_RE.exec(line);
    if (openMatch) {
      // A new marker defensively closes any unterminated previous block.
      flush(i);
      open = { startLine: i + 1, turnId: openMatch[1], transcriptPath: null };
      continue;
    }
    if (open) {
      const rawMatch = CAPTURE_RAW_RE.exec(line);
      if (rawMatch && open.transcriptPath === null) open.transcriptPath = rawMatch[1].trim();
      if (CAPTURE_CLOSE_RE.test(line)) flush(i + 1);
    }
  }
  flush(lines.length);
  return blocks;
}

/**
 * Pick the capture block a chunk belongs to by maximum line-range overlap, and
 * return its turn id + transcript path. Max-overlap (not first-marker) stays
 * robust to the marker-before-heading layout. Returns null when nothing overlaps.
 */
export function captureMetadataForChunk(
  chunk: { startLine: number; endLine: number },
  blocks: CaptureBlock[],
): ChunkCaptureMetadata | null {
  let best: CaptureBlock | null = null;
  let bestOverlap = 0;
  for (const block of blocks) {
    const overlap =
      Math.min(chunk.endLine, block.endLine) - Math.max(chunk.startLine, block.startLine) + 1;
    if (overlap > bestOverlap) {
      bestOverlap = overlap;
      best = block;
    }
  }
  if (!best || bestOverlap <= 0) return null;
  return best.transcriptPath
    ? { turnId: best.turnId, transcriptPath: best.transcriptPath }
    : { turnId: best.turnId };
}
