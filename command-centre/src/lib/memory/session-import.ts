/**
 * AIOS Memory — prior Claude Code session import.
 *
 * Live capture (capture.ts, driven by the Stop hook) only records the LAST turn
 * of the CURRENT session. This module backfills the rest: it discovers Claude
 * Code's own session transcripts on disk (under `~/.claude/projects/`), parses
 * each into ordered user→assistant turns, summarizes them, and writes the same
 * machine-owned `context/memory/{date}.aos.md` capture blocks the live hook
 * writes — so a fresh AI-OS install can recall what happened in Claude Code
 * sessions that predate it.
 *
 * It is deliberately user-controlled and additive:
 *   - It REUSES capture.ts (parsing, source-hash dedup, block writer, the
 *     injectable summarizer) rather than forking the capture path.
 *   - Idempotency falls out of capture's `source:${hash}` marker: re-importing an
 *     unchanged session writes nothing, even if the ledger or DB is rebuilt.
 *   - Each imported block is dated to the session's ORIGINAL day, so recency
 *     reranking treats it as historical, not as "today".
 *
 * It writes only markdown + a local JSON ledger; indexing the blocks into the
 * PGLite/Postgres store is the caller's job (the CLI runs the existing indexer),
 * which keeps this module store-free and unit-testable.
 */

import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  computeTurnSourceHash,
  upsertSessionCapture,
  summarizeTurn,
  loadCaptureSummaryConfig,
  type LastTurn,
  type SummaryRunner,
  type CaptureSummaryConfig,
} from "./capture";

/** Cap on any single prompt/response/summary input, mirroring capture.ts. */
const MAX_FIELD_CHARS = 8000;
/** Cap on the raw/none-mode session digest written as a block body. */
const MAX_DIGEST_CHARS = 8000;
const LEDGER_VERSION = 1;

// ── Candidate discovery ─────────────────────────────────────────────────────

/** Where a candidate transcript came from. Drives the menu + per-source counts. */
export type SessionSourceKind =
  | "current-workspace"
  | "global"
  | "aos-archive"
  | "other";

/** One discovered transcript file, ready to import. */
export interface SessionCandidate {
  sourceKind: SessionSourceKind;
  /** Absolute path to the `.jsonl` transcript. */
  absPath: string;
  /** Session id (from filename, else a scanned entry), or null. */
  sessionId: string | null;
  /** The `~/.claude/projects/{slug}` folder, when applicable. */
  projectSlug: string | null;
  byteSize: number;
  /** File mtime (ms). Fallback time key when the transcript has no timestamps. */
  modifiedMs: number;
  /** First transcript timestamp (ms), or null. */
  startedAtMs: number | null;
  /** Last transcript timestamp (ms), or null. */
  endedAtMs: number | null;
  /** Stable identity for the import ledger (session id, else a path hash). */
  fingerprint: string;
}

export interface DiscoverSessionsOptions {
  /** AI-OS workspace root (its slug picks out current-workspace sessions). */
  rootDir: string;
  /** Claude Code home. Default `~/.claude`. */
  claudeHome?: string;
  /** Limit discovery to these kinds. Default: all. */
  includeKinds?: SessionSourceKind[];
  /** Extra files/dirs to scan as `other` sources (`--source` / `--root`). */
  extraPaths?: string[];
}

const HEX12_SUFFIX_RE = /-[0-9a-f]{12}$/i;
const TIMESTAMP_KEYS = ["timestamp"];

function sha256Hex(text: string): string {
  return crypto.createHash("sha256").update(text).digest("hex");
}

function bound(text: string, max = MAX_FIELD_CHARS): string {
  const t = text ?? "";
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

// ── Transcript parsing helpers ──────────────────────────────────────────────
// Kept local (not imported from capture.ts) so this importer never depends on
// capture.ts's internal export surface, which differs across branches. The
// behavior mirrors capture.ts exactly: tolerant of partial/corrupt lines and of
// both `{role}` and `{type}` entry shapes.

/** Tolerantly parse a JSONL blob into entries, skipping any non-JSON line. */
function parseTranscriptEntries(raw: string): Record<string, unknown>[] {
  const entries: Record<string, unknown>[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && typeof parsed === "object") entries.push(parsed as Record<string, unknown>);
    } catch {
      /* ignore non-JSON lines (e.g. partial writes) */
    }
  }
  return entries;
}

/** The role of a transcript entry, tolerating both `{role}` and `{type}` shapes. */
function roleOf(entry: Record<string, unknown>): string | null {
  const msg = (entry.message ?? entry) as Record<string, unknown>;
  const role = msg.role ?? entry.type;
  return typeof role === "string" ? role : null;
}

/** The message object of an entry, tolerating `{message}` and bare shapes. */
function messageOf(entry: Record<string, unknown>): Record<string, unknown> {
  return (entry.message ?? entry) as Record<string, unknown>;
}

/** Concatenate the text blocks of a message `content` (string or block array). */
function extractText(content: unknown): string {
  if (typeof content === "string") return content.trim();
  if (!Array.isArray(content)) return "";
  const parts: string[] = [];
  for (const block of content) {
    if (block && typeof block === "object" && (block as { type?: string }).type === "text") {
      const text = (block as { text?: unknown }).text;
      if (typeof text === "string") parts.push(text);
    }
  }
  return parts.join("\n").trim();
}

/** Claude Code slugifies a project's cwd by replacing non-alphanumerics with `-`. */
export function workspaceSlug(rootDir: string): string {
  return path.resolve(rootDir).replace(/[^A-Za-z0-9]/g, "-");
}

/** Strip `.jsonl` and any archived `-{12hex}` suffix to recover a session id. */
export function sessionIdFromFilename(fileName: string): string | null {
  const stem = fileName.replace(/\.jsonl$/i, "");
  if (!stem) return null;
  return stem.replace(HEX12_SUFFIX_RE, "");
}

/** Immediate `*.jsonl` children of a directory (no recursion → no subagent sidecars). */
function listJsonlDirect(dir: string): string[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((e) => e.isFile() && e.name.toLowerCase().endsWith(".jsonl"))
    .map((e) => path.join(dir, e.name));
}

/** Recursively collect `*.jsonl`, skipping nested subagent/workflow sidecars. */
function listJsonlRecursive(dir: string, out: string[]): void {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    const child = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "subagents" || entry.name === "workflows") continue;
      listJsonlRecursive(child, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith(".jsonl")) {
      out.push(child);
    }
  }
}

/** Parse an entry's ISO `timestamp` into epoch ms, or null. */
function entryTimestampMs(entry: Record<string, unknown>): number | null {
  for (const key of TIMESTAMP_KEYS) {
    const value = entry[key];
    if (typeof value === "string") {
      const ms = Date.parse(value);
      if (!Number.isNaN(ms)) return ms;
    }
  }
  return null;
}

/**
 * Light first/last timestamp + sessionId scan without parsing every line.
 * Walks inward from both ends until a timestamped entry is found.
 */
function scanSessionMeta(raw: string): {
  startedAtMs: number | null;
  endedAtMs: number | null;
  sessionId: string | null;
} {
  const lines = raw.split("\n");
  let startedAtMs: number | null = null;
  let endedAtMs: number | null = null;
  let sessionId: string | null = null;

  const tryParse = (line: string): Record<string, unknown> | null => {
    const trimmed = line.trim();
    if (!trimmed) return null;
    try {
      const parsed = JSON.parse(trimmed);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
      return null;
    }
  };

  for (let i = 0; i < lines.length && (startedAtMs == null || sessionId == null); i += 1) {
    const entry = tryParse(lines[i]);
    if (!entry) continue;
    if (startedAtMs == null) startedAtMs = entryTimestampMs(entry);
    if (sessionId == null && typeof entry.sessionId === "string") sessionId = entry.sessionId;
  }
  for (let i = lines.length - 1; i >= 0 && endedAtMs == null; i -= 1) {
    const entry = tryParse(lines[i]);
    if (entry) endedAtMs = entryTimestampMs(entry);
  }

  return { startedAtMs, endedAtMs, sessionId };
}

function makeCandidate(
  absPath: string,
  sourceKind: SessionSourceKind,
  projectSlug: string | null,
): SessionCandidate | null {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(absPath);
  } catch {
    return null;
  }
  if (!stat.isFile() || stat.size === 0) return null;

  let raw = "";
  try {
    raw = fs.readFileSync(absPath, "utf-8");
  } catch {
    return null;
  }

  const meta = scanSessionMeta(raw);
  const sessionId = meta.sessionId ?? sessionIdFromFilename(path.basename(absPath));
  const fingerprint = sha256Hex(sessionId ? `session:${sessionId}` : `path:${absPath}`).slice(0, 32);

  return {
    sourceKind,
    absPath,
    sessionId,
    projectSlug,
    byteSize: stat.size,
    modifiedMs: stat.mtimeMs,
    startedAtMs: meta.startedAtMs,
    endedAtMs: meta.endedAtMs,
    fingerprint,
  };
}

/**
 * Discover candidate transcripts across Claude Code's project store, this repo's
 * existing AOS archives, and any explicit `--source`/`--root` paths. Deduplicated
 * by absolute path and sorted newest-first.
 */
export function discoverSessions(opts: DiscoverSessionsOptions): SessionCandidate[] {
  const claudeHome = opts.claudeHome ?? path.join(os.homedir(), ".claude");
  const projectsDir = path.join(claudeHome, "projects");
  const want = (kind: SessionSourceKind): boolean =>
    !opts.includeKinds || opts.includeKinds.includes(kind);

  const seen = new Set<string>();
  const candidates: SessionCandidate[] = [];
  const add = (absPath: string, kind: SessionSourceKind, slug: string | null): void => {
    const key = path.resolve(absPath);
    if (seen.has(key)) return;
    const candidate = makeCandidate(key, kind, slug);
    if (candidate) {
      seen.add(key);
      candidates.push(candidate);
    }
  };

  // Claude Code project store: one folder per workspace, depth-1 `*.jsonl` main
  // sessions only (nested `{sessionId}/subagents/*.jsonl` are excluded).
  if (want("current-workspace") || want("global")) {
    const currentSlug = workspaceSlug(opts.rootDir);
    let projectFolders: fs.Dirent[] = [];
    try {
      projectFolders = fs.readdirSync(projectsDir, { withFileTypes: true });
    } catch {
      projectFolders = [];
    }
    for (const folder of projectFolders) {
      if (!folder.isDirectory()) continue;
      const isCurrent = folder.name === currentSlug;
      const kind: SessionSourceKind = isCurrent ? "current-workspace" : "global";
      if (!want(kind)) continue;
      for (const file of listJsonlDirect(path.join(projectsDir, folder.name))) {
        add(file, kind, folder.name);
      }
    }
  }

  // Existing AOS raw archives under this repo (depth-2: {date}/{session}.jsonl).
  if (want("aos-archive")) {
    const archiveRoot = path.join(opts.rootDir, "context", "transcripts");
    const nested: string[] = [];
    listJsonlRecursive(archiveRoot, nested);
    for (const file of nested) add(file, "aos-archive", null);
  }

  // Explicit user-provided files or folders.
  if (want("other") && opts.extraPaths) {
    for (const raw of opts.extraPaths) {
      const abs = path.resolve(raw);
      let stat: fs.Stats | null = null;
      try {
        stat = fs.statSync(abs);
      } catch {
        stat = null;
      }
      if (!stat) continue;
      if (stat.isFile()) {
        add(abs, "other", null);
      } else if (stat.isDirectory()) {
        const nested: string[] = [];
        listJsonlRecursive(abs, nested);
        for (const file of nested) add(file, "other", null);
      }
    }
  }

  return sortNewestFirst(candidates);
}

/** Best available time for ordering: transcript start, else end, else file mtime. */
export function sessionTimeMs(candidate: SessionCandidate): number {
  return candidate.startedAtMs ?? candidate.endedAtMs ?? candidate.modifiedMs;
}

function sortNewestFirst(candidates: SessionCandidate[]): SessionCandidate[] {
  return [...candidates].sort((a, b) => {
    const diff = sessionTimeMs(b) - sessionTimeMs(a);
    if (diff !== 0) return diff;
    return a.absPath.localeCompare(b.absPath); // stable tiebreak
  });
}

// ── Full-session parsing (the new core) ─────────────────────────────────────

/** One ordered user→assistant exchange from a full session. */
export interface SessionTurn {
  index: number;
  userPrompt: string;
  assistantMessage: string;
  turnId: string;
  sourceHash: string;
}

/**
 * Parse a full JSONL transcript into ordered meaningful turns.
 *
 * Unlike capture.extractLastTurn (which returns only the final exchange), this
 * walks the whole session: every human prompt with text opens a turn, all
 * assistant text that follows (across multiple assistant entries) is merged into
 * that turn, and the next human prompt closes it. Tool-only entries, empty
 * assistant messages, thinking-only entries, and corrupt lines are skipped — the
 * parser never throws.
 */
export function parseSessionTurns(raw: string, sessionId?: string | null): SessionTurn[] {
  const entries = parseTranscriptEntries(raw);
  const turns: SessionTurn[] = [];

  let pendingUser: string | null = null;
  let assistantParts: string[] = [];

  const flush = (): void => {
    const assistantMessage = bound(assistantParts.join("\n").trim());
    if (assistantMessage) {
      const userPrompt = bound(pendingUser ?? "");
      const index = turns.length;
      const sourceHash = computeTurnSourceHash({ userPrompt, assistantMessage });
      const turnId = sha256Hex(`${sessionId ?? "session"}:${index}:${sourceHash}`).slice(0, 16);
      turns.push({ index, userPrompt, assistantMessage, turnId, sourceHash });
    }
    assistantParts = [];
    pendingUser = null;
  };

  for (const entry of entries) {
    const role = roleOf(entry);
    if (role === "user") {
      const text = extractText(messageOf(entry).content);
      if (text) {
        flush(); // a new human prompt closes the previous turn
        pendingUser = text;
      }
    } else if (role === "assistant") {
      const text = extractText(messageOf(entry).content);
      if (text) assistantParts.push(text);
    }
  }
  flush();

  return turns;
}

/** Deterministic per-session content hash — the block dedup marker for session mode. */
export function sessionContentHash(turns: SessionTurn[]): string {
  return sha256Hex(turns.map((t) => t.sourceHash).join("|"));
}

/** A readable, bounded transcript digest used for `none` mode and summary input. */
export function buildSessionDigest(turns: SessionTurn[], maxChars = MAX_DIGEST_CHARS): string {
  const lines: string[] = [];
  for (const turn of turns) {
    if (turn.userPrompt) lines.push(`- **User:** ${turn.userPrompt}`);
    lines.push(`- **Claude Code:** ${turn.assistantMessage}`);
  }
  return bound(lines.join("\n"), maxChars);
}

// ── Import ledger ───────────────────────────────────────────────────────────

export type ImportSummaryStatus = "session" | "turn" | "none" | "fallback" | "failed";

/** One row in the import ledger, keyed by {@link SessionCandidate.fingerprint}. */
export interface ImportLedgerEntry {
  fingerprint: string;
  sourceKind: SessionSourceKind;
  originalPath: string;
  sessionId: string | null;
  contentSha256: string;
  byteSize: number;
  modifiedMs: number;
  importedAt: string;
  memorySourcePath: string | null;
  rawArchivePath: string | null;
  turnsImported: number;
  summaryStatus: ImportSummaryStatus;
  lastError: string | null;
}

export interface ImportLedger {
  version: number;
  entries: Record<string, ImportLedgerEntry>;
}

/**
 * Path of the import ledger. It lives in a sibling of the PGLite data dir
 * (`.command-centre/memory-import/`), NOT inside `.command-centre/memory/`:
 * opening the PGLite store turns its data dir into a pure Postgres cluster and
 * deletes any foreign file there, which would wipe the ledger. Still gitignored
 * (all of `.command-centre/` is).
 */
export function ledgerPath(rootDir: string): string {
  return path.join(rootDir, ".command-centre", "memory-import", "import-ledger.json");
}

export function emptyLedger(): ImportLedger {
  return { version: LEDGER_VERSION, entries: {} };
}

export function loadLedger(rootDir: string): ImportLedger {
  try {
    const parsed = JSON.parse(fs.readFileSync(ledgerPath(rootDir), "utf-8"));
    if (parsed && typeof parsed === "object" && parsed.entries && typeof parsed.entries === "object") {
      return { version: Number(parsed.version) || LEDGER_VERSION, entries: parsed.entries };
    }
  } catch {
    /* missing or corrupt → start clean */
  }
  return emptyLedger();
}

export function saveLedger(rootDir: string, ledger: ImportLedger): void {
  const file = ledgerPath(rootDir);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(ledger, null, 2)}\n`);
}

/** New (never imported), imported (unchanged), or changed (re-importable). */
export type ImportStatus = "new" | "imported" | "changed";

/**
 * Status of a candidate vs the ledger — cheap (size+mtime), no content read.
 * A transcript cannot grow without its size or mtime changing, so this is a safe
 * proxy for "already imported and unchanged".
 */
export function importStatus(ledger: ImportLedger, candidate: SessionCandidate): ImportStatus {
  const entry = ledger.entries[candidate.fingerprint];
  if (!entry || entry.summaryStatus === "failed") return "new";
  if (entry.byteSize === candidate.byteSize && entry.modifiedMs === candidate.modifiedMs) {
    return "imported";
  }
  return "changed";
}

// ── Per-source counts ───────────────────────────────────────────────────────

export interface SourceReport {
  sourceKind: SessionSourceKind;
  total: number;
  alreadyImported: number;
  available: number;
}

/** Candidates belonging to a selectable source. `global` spans all Claude Code history. */
export function candidatesForKind(
  candidates: SessionCandidate[],
  kind: SessionSourceKind,
): SessionCandidate[] {
  if (kind === "global") {
    return candidates.filter(
      (c) => c.sourceKind === "global" || c.sourceKind === "current-workspace",
    );
  }
  return candidates.filter((c) => c.sourceKind === kind);
}

/** Per-source totals for the dry-run preview and the interactive menu. */
export function reportSources(
  candidates: SessionCandidate[],
  ledger: ImportLedger,
): SourceReport[] {
  const kinds: SessionSourceKind[] = ["current-workspace", "global", "aos-archive", "other"];
  const reports: SourceReport[] = [];
  for (const kind of kinds) {
    const group = candidatesForKind(candidates, kind);
    if (group.length === 0) continue;
    const alreadyImported = group.filter((c) => importStatus(ledger, c) === "imported").length;
    reports.push({
      sourceKind: kind,
      total: group.length,
      alreadyImported,
      available: group.length - alreadyImported,
    });
  }
  return reports;
}

// ── Selection (newest-first + limits) ───────────────────────────────────────

export interface LimitSpec {
  mode: "all" | "recent" | "days" | "range" | "count";
  /** recent N / custom count. */
  count?: number;
  /** past N days. */
  days?: number;
  /** range start (epoch ms). */
  sinceMs?: number;
  /** range end (epoch ms). */
  untilMs?: number;
}

/**
 * Sort newest-first, then apply the chosen limit. Selection is always over the
 * already-sorted candidates so "recent N" is unambiguous.
 */
export function selectSessions(
  candidates: SessionCandidate[],
  spec: LimitSpec,
  now: Date = new Date(),
): SessionCandidate[] {
  const sorted = sortNewestFirst(candidates);
  switch (spec.mode) {
    case "all":
      return sorted;
    case "recent":
    case "count":
      return sorted.slice(0, Math.max(0, spec.count ?? 0));
    case "days": {
      const cutoff = now.getTime() - Math.max(0, spec.days ?? 0) * 86_400_000;
      return sorted.filter((c) => sessionTimeMs(c) >= cutoff);
    }
    case "range": {
      const since = spec.sinceMs ?? -Infinity;
      const until = spec.untilMs ?? Infinity;
      return sorted.filter((c) => {
        const t = sessionTimeMs(c);
        return t >= since && t <= until;
      });
    }
    default:
      return sorted;
  }
}

// ── Raw transcript archival (opt-in, privacy-sensitive) ─────────────────────

function safeFilePart(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "session"
  );
}

function dateStrLocal(now: Date): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

/**
 * Copy a prior transcript into the repo's local, gitignored archive under
 * `context/transcripts/imported/{sessionDate}/`. Opt-in only; idempotent.
 */
export function archiveImportedTranscript(opts: {
  rootDir: string;
  sourcePath: string;
  sessionId: string | null;
  fingerprint: string;
  sessionDate: Date;
}): string | null {
  const dir = path.join(opts.rootDir, "context", "transcripts", "imported", dateStrLocal(opts.sessionDate));
  const name = `${safeFilePart(opts.sessionId ?? "session")}-${opts.fingerprint.slice(0, 12)}.jsonl`;
  const dest = path.join(dir, name);
  const rel = path.relative(opts.rootDir, dest).split(path.sep).join("/");
  try {
    fs.accessSync(opts.sourcePath, fs.constants.R_OK);
  } catch {
    return null;
  }
  if (fs.existsSync(dest)) return rel;
  fs.mkdirSync(dir, { recursive: true });
  fs.copyFileSync(opts.sourcePath, dest);
  return rel;
}

// ── Import ───────────────────────────────────────────────────────────────────

export type SummaryMode = "session" | "turn" | "none";

export interface ImportSessionsOptions {
  rootDir: string;
  /** Candidates to import (already selected by the caller). */
  candidates: SessionCandidate[];
  /** session = one summary per session (default); turn = per-turn; none = raw digest. */
  summaryMode: SummaryMode;
  /** Injectable summarizer (tests pass a fake → no real Claude calls). */
  summaryRunner?: SummaryRunner;
  /** Summary provider/model/timeout override; defaults to context/memory-config.json. */
  summaryConfig?: CaptureSummaryConfig;
  /** Copy the raw transcript locally (privacy-sensitive; off by default). */
  copyRaw?: boolean;
  /** Re-import even already-imported, unchanged sessions. */
  force?: boolean;
  /** Preloaded ledger (else loaded/saved internally). */
  ledger?: ImportLedger;
  /** Timestamp for `importedAt`. Block dates derive from each session's own date. */
  now?: Date;
  log?: (msg: string) => void;
}

export interface ImportOutcome {
  fingerprint: string;
  sessionId: string | null;
  status: "imported" | "skipped" | "failed";
  turnsImported: number;
  blocksWritten: number;
  memorySourcePath: string | null;
  error: string | null;
}

export interface ImportSummary {
  imported: number;
  skipped: number;
  failed: number;
  turnsImported: number;
  blocksWritten: number;
  sourcePaths: string[];
  outcomes: ImportOutcome[];
}

/**
 * Import the selected sessions into `context/memory/*.aos.md` blocks + the ledger.
 *
 * Idempotent: a session already imported and unchanged is skipped (unless
 * `force`), and even when re-attempted, capture's `source:${hash}` dedup makes the
 * block write a no-op. The caller indexes the resulting files afterward.
 */
export async function importSessions(opts: ImportSessionsOptions): Promise<ImportSummary> {
  const log = opts.log ?? (() => {});
  const now = opts.now ?? new Date();
  const ledger = opts.ledger ?? loadLedger(opts.rootDir);
  const config = opts.summaryConfig ?? loadCaptureSummaryConfig(opts.rootDir);

  const summary: ImportSummary = {
    imported: 0,
    skipped: 0,
    failed: 0,
    turnsImported: 0,
    blocksWritten: 0,
    sourcePaths: [],
    outcomes: [],
  };
  const touchedPaths = new Set<string>();

  for (const candidate of opts.candidates) {
    const status = importStatus(ledger, candidate);
    if (!opts.force && status === "imported") {
      summary.skipped += 1;
      summary.outcomes.push(outcome(candidate, "skipped", 0, 0, null, null));
      continue;
    }

    try {
      const raw = fs.readFileSync(candidate.absPath, "utf-8");
      const turns = parseSessionTurns(raw, candidate.sessionId);
      if (turns.length === 0) {
        summary.skipped += 1;
        summary.outcomes.push(outcome(candidate, "skipped", 0, 0, null, null));
        log(`  - ${candidate.sessionId ?? candidate.absPath}: no meaningful turns, skipped`);
        continue;
      }

      const sessionDate = new Date(candidate.startedAtMs ?? candidate.modifiedMs);
      const sessionId = candidate.sessionId ?? candidate.fingerprint.slice(0, 12);
      const rawArchivePath = opts.copyRaw
        ? archiveImportedTranscript({
            rootDir: opts.rootDir,
            sourcePath: candidate.absPath,
            sessionId: candidate.sessionId,
            fingerprint: candidate.fingerprint,
            sessionDate,
          })
        : null;

      let turnsImported = 0;
      let blocksWritten = 0;
      let memorySourcePath: string | null = null;
      let summaryStatus: ImportSummaryStatus;

      if (opts.summaryMode === "turn") {
        for (const turn of turns) {
          const summaryText = await summarizeTurnMaybe(opts, config, candidate, turn);
          const res = upsertSessionCapture({
            rootDir: opts.rootDir,
            sessionId,
            turn: toLastTurn(turn),
            summaryText,
            sourceHash: turn.sourceHash,
            rawTranscriptPath: rawArchivePath,
            now: sessionDate,
          });
          memorySourcePath = repoRelative(opts.rootDir, res.filePath);
          if (res.written) blocksWritten += 1;
          turnsImported += 1;
        }
        summaryStatus = "turn";
      } else {
        const contentHash = sessionContentHash(turns);
        const digest = buildSessionDigest(turns);
        let summaryText = digest;
        summaryStatus = "none";
        if (opts.summaryMode === "session") {
          const llm = await summarizeSessionMaybe(opts, config, candidate, turns);
          if (llm) {
            summaryText = llm;
            summaryStatus = "session";
          } else {
            summaryStatus = "fallback";
          }
        }
        const res = upsertSessionCapture({
          rootDir: opts.rootDir,
          sessionId,
          turn: toSessionPseudoTurn(turns, sessionId, contentHash),
          summaryText,
          sourceHash: contentHash,
          rawTranscriptPath: rawArchivePath,
          now: sessionDate,
        });
        memorySourcePath = repoRelative(opts.rootDir, res.filePath);
        if (res.written) blocksWritten += 1;
        turnsImported = turns.length;
      }

      if (memorySourcePath) touchedPaths.add(memorySourcePath);
      ledger.entries[candidate.fingerprint] = {
        fingerprint: candidate.fingerprint,
        sourceKind: candidate.sourceKind,
        originalPath: candidate.absPath,
        sessionId: candidate.sessionId,
        contentSha256: sha256Hex(raw),
        byteSize: candidate.byteSize,
        modifiedMs: candidate.modifiedMs,
        importedAt: now.toISOString(),
        memorySourcePath,
        rawArchivePath,
        turnsImported,
        summaryStatus,
        lastError: null,
      };
      summary.imported += 1;
      summary.turnsImported += turnsImported;
      summary.blocksWritten += blocksWritten;
      summary.outcomes.push(
        outcome(candidate, "imported", turnsImported, blocksWritten, memorySourcePath, null),
      );
      log(
        `  + ${sessionId} (${turnsImported} turn(s), ${blocksWritten} new block(s)) → ${memorySourcePath}`,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      summary.failed += 1;
      ledger.entries[candidate.fingerprint] = {
        fingerprint: candidate.fingerprint,
        sourceKind: candidate.sourceKind,
        originalPath: candidate.absPath,
        sessionId: candidate.sessionId,
        contentSha256: "",
        byteSize: candidate.byteSize,
        modifiedMs: candidate.modifiedMs,
        importedAt: now.toISOString(),
        memorySourcePath: null,
        rawArchivePath: null,
        turnsImported: 0,
        summaryStatus: "failed",
        lastError: message,
      };
      summary.outcomes.push(outcome(candidate, "failed", 0, 0, null, message));
      log(`  ! ${candidate.sessionId ?? candidate.absPath}: ${message}`);
    }
  }

  if (!opts.ledger || opts.candidates.length > 0) saveLedger(opts.rootDir, ledger);
  summary.sourcePaths = [...touchedPaths].sort();
  return summary;
}

function outcome(
  candidate: SessionCandidate,
  status: ImportOutcome["status"],
  turnsImported: number,
  blocksWritten: number,
  memorySourcePath: string | null,
  error: string | null,
): ImportOutcome {
  return {
    fingerprint: candidate.fingerprint,
    sessionId: candidate.sessionId,
    status,
    turnsImported,
    blocksWritten,
    memorySourcePath,
    error,
  };
}

function repoRelative(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}

function toLastTurn(turn: SessionTurn): LastTurn {
  return {
    userPrompt: turn.userPrompt,
    assistantMessage: turn.assistantMessage,
    turnId: turn.turnId,
    sourceHash: turn.sourceHash,
  };
}

/**
 * A synthetic single "turn" standing in for the whole session, so the per-session
 * block reuses upsertSessionCapture unchanged. `source:${contentHash}` makes
 * re-imports of an unchanged session a no-op; `turn:${sessionId}` ties the block
 * back to the session for transcript drill-down.
 */
function toSessionPseudoTurn(turns: SessionTurn[], sessionId: string, contentHash: string): LastTurn {
  const userPrompt = bound(turns.map((t) => t.userPrompt).filter(Boolean).join("\n"));
  const assistantMessage = bound(turns.map((t) => t.assistantMessage).join("\n")) || "(imported session)";
  return { userPrompt, assistantMessage, turnId: sessionId, sourceHash: contentHash };
}

async function summarizeTurnMaybe(
  opts: ImportSessionsOptions,
  config: CaptureSummaryConfig,
  candidate: SessionCandidate,
  turn: SessionTurn,
): Promise<string | null> {
  return summarizeTurn({
    rootDir: opts.rootDir,
    turn: toLastTurn(turn),
    config,
    runner: opts.summaryRunner,
    cwd: opts.rootDir,
  });
}

/**
 * Session-level summary: reuse the injectable turn summarizer by framing the
 * whole session as one synthetic turn (all asks / all replies). Returns null when
 * summarization is disabled or fails, so the caller falls back to the raw digest.
 */
async function summarizeSessionMaybe(
  opts: ImportSessionsOptions,
  config: CaptureSummaryConfig,
  candidate: SessionCandidate,
  turns: SessionTurn[],
): Promise<string | null> {
  const synthetic: SessionTurn = {
    index: 0,
    userPrompt: bound(turns.map((t) => t.userPrompt).filter(Boolean).join("\n")),
    assistantMessage: buildSessionDigest(turns),
    turnId: candidate.sessionId ?? "session",
    sourceHash: sessionContentHash(turns),
  };
  return summarizeTurn({
    rootDir: opts.rootDir,
    turn: toLastTurn(synthetic),
    config,
    runner: opts.summaryRunner,
    cwd: opts.rootDir,
  });
}
