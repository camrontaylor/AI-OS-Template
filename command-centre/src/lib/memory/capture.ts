/**
 * AIOS Memory — session capture & refresh.
 *
 * The AI-OS-owned replacement for the legacy memsearch Stop hook + watcher.
 * It does three jobs, all without Memsearch:
 *
 *   1. capture  — pull the last turn out of a session transcript and write a
 *      summarized, idempotent block into context/memory/{date}.aos.md (a
 *      machine-owned sibling of the agent's curated {date}.md, so it is indexed
 *      but never injected into the SessionStart prompt). The raw transcript is
 *      archived separately under context/transcripts/.
 *   2. refresh  — run the incremental indexer over the memory sources,
 *      debounced + locked so the per-turn Stop hook can fire freely without
 *      re-indexing on every keystroke or racing concurrent PGLite opens.
 *   3. status   — report enough local state to confirm capture + indexing work.
 *
 * Only ./indexer is a value import (so refreshIndex can drive the real pipeline);
 * everything else is `import type` and therefore erased by the transpile, so the
 * CLIs/tests only have to stub ./indexer when loading this module.
 */

import crypto from "node:crypto";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

import { indexSources, type IndexSummary } from "./indexer";
import type { MemoryStore } from "./store";
import type { Embedder } from "./embedder";
import type { IndexJobReason, Scope, Visibility } from "./types";

const MAX_FIELD_CHARS = 8000;
const MAX_SUMMARY_CHARS = 8000;
const CAPTURE_HEADER = "## Auto-capture (machine-owned — do not edit)";
const DEFAULT_SUMMARY_PROVIDER: CaptureSummaryProvider = "claude";
const DEFAULT_CLAUDE_SUMMARY_MODEL = "haiku";
const DEFAULT_CODEX_SUMMARY_MODEL = "gpt-5.1-codex-mini";
const DEFAULT_SUMMARY_TIMEOUT_MS = 120_000;

// ── Transcript parsing ──────────────────────────────────────────────────────

/** The last human/assistant exchange pulled from a transcript. */
export interface LastTurn {
  userPrompt: string;
  assistantMessage: string;
  turnId: string;
  sourceHash?: string;
}

/** Concatenate the text blocks of a transcript message `content` (string or blocks). */
export function extractText(content: unknown): string {
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

/** The role of a transcript entry, tolerating both `{role}` and `{type}` shapes. */
export function roleOf(entry: Record<string, unknown>): string | null {
  const msg = (entry.message ?? entry) as Record<string, unknown>;
  const role = msg.role ?? entry.type;
  return typeof role === "string" ? role : null;
}

export function messageOf(entry: Record<string, unknown>): Record<string, unknown> {
  return (entry.message ?? entry) as Record<string, unknown>;
}

/**
 * Tolerantly parse a JSONL transcript blob into entries, skipping any line that
 * isn't valid JSON (e.g. a partial write mid-append). Never throws. Shared by
 * {@link extractLastTurn} and the transcript-window module.
 */
export function parseTranscriptEntries(raw: string): Record<string, unknown>[] {
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

function bound(text: string): string {
  return text.length > MAX_FIELD_CHARS ? `${text.slice(0, MAX_FIELD_CHARS - 1)}…` : text;
}

export function computeTurnSourceHash(turn: Pick<LastTurn, "userPrompt" | "assistantMessage">): string {
  return crypto
    .createHash("sha256")
    .update(JSON.stringify({ userPrompt: turn.userPrompt, assistantMessage: turn.assistantMessage }))
    .digest("hex");
}

/**
 * Extract the last user→assistant exchange from a JSONL transcript file.
 *
 * Deterministic and dependency-free: it parses each line as JSON (ignoring
 * unparseable lines), walks from the tail to the last assistant message with
 * text, then back to the nearest preceding user prompt. Returns null — never
 * throws — when the file is missing, empty, corrupt, or has no assistant text.
 */
export function extractLastTurn(transcriptPath: string): LastTurn | null {
  let raw: string;
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const entries = parseTranscriptEntries(raw);

  let assistantIdx = -1;
  let assistantMessage = "";
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    if (roleOf(entries[i]) !== "assistant") continue;
    const text = extractText(messageOf(entries[i]).content);
    if (text) {
      assistantIdx = i;
      assistantMessage = text;
      break;
    }
  }
  if (assistantIdx === -1) return null;

  let userPrompt = "";
  for (let i = assistantIdx - 1; i >= 0; i -= 1) {
    if (roleOf(entries[i]) !== "user") continue;
    const text = extractText(messageOf(entries[i]).content); // empty for tool_result-only turns
    if (text) {
      userPrompt = text;
      break;
    }
  }

  const entry = entries[assistantIdx];
  const msg = messageOf(entry);
  const turnId =
    (typeof entry.uuid === "string" && entry.uuid) ||
    (typeof msg.id === "string" && msg.id) ||
    crypto.createHash("sha256").update(assistantMessage).digest("hex").slice(0, 12);

  return {
    userPrompt: bound(userPrompt),
    assistantMessage: bound(assistantMessage),
    turnId,
    sourceHash: computeTurnSourceHash({ userPrompt, assistantMessage }),
  };
}

// ── Session capture file ────────────────────────────────────────────────────

export interface UpsertCaptureOptions {
  rootDir: string;
  sessionId: string;
  turn: LastTurn;
  summaryText?: string | null;
  rawTranscriptPath?: string | null;
  sourceHash?: string;
  now?: Date;
}

export interface UpsertCaptureResult {
  filePath: string;
  written: boolean;
  sourceHash: string;
}

function dateStr(now: Date): string {
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, "0");
  const dd = String(now.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function repoRelativePath(rootDir: string, absPath: string): string {
  return path.relative(rootDir, absPath).split(path.sep).join("/");
}

function safeFilePart(value: string): string {
  return (
    value
      .replace(/[^A-Za-z0-9._-]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 80) || "session"
  );
}

function normalizeSummaryText(text: string): string {
  return bound(text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim()).slice(0, MAX_SUMMARY_CHARS);
}

function fallbackSummary(turn: LastTurn): string {
  const user = turn.userPrompt.trim() || "(no prompt captured)";
  const assistant = turn.assistantMessage.trim();
  return [
    `- User asked: ${bound(user)}`,
    assistant ? `- Assistant responded: ${bound(assistant)}` : "- Assistant response was empty.",
  ].join("\n");
}

/**
 * Idempotently write one capture block for `sessionId` into
 * context/memory/{date}.aos.md.
 *
 * One block per source turn: a repeat call for the same source hash is a no-op
 * (`written:false`, so the file sha stays stable and the indexer skips it); a new
 * turn in the same session is appended so the full session remains searchable.
 * An empty assistant message writes nothing (there is nothing worth indexing).
 */
export function upsertSessionCapture(opts: UpsertCaptureOptions): UpsertCaptureResult {
  const now = opts.now ?? new Date();
  const filePath = path.join(opts.rootDir, "context", "memory", `${dateStr(now)}.aos.md`);
  const { sessionId, turn } = opts;
  const sourceHash = opts.sourceHash ?? turn.sourceHash ?? computeTurnSourceHash(turn);

  if (!turn.assistantMessage.trim()) return { filePath, written: false, sourceHash };

  let existing = "";
  try {
    existing = fs.readFileSync(filePath, "utf-8");
  } catch {
    /* new file */
  }

  // Same source turn already captured -> nothing to do.
  if (existing.includes(`source:${sourceHash}`)) return { filePath, written: false, sourceHash };

  const summaryText = normalizeSummaryText(opts.summaryText || "") || fallbackSummary(turn);
  const rawTranscriptRel = opts.rawTranscriptPath
    ? opts.rawTranscriptPath.replace(/\\/g, "/")
    : null;
  const blockLines = [
    `<!-- aos-capture session:${sessionId} source:${sourceHash} turn:${turn.turnId} -->`,
    `### Session ${sessionId} - ${now.toISOString()}`,
    "",
    summaryText,
    "",
  ];
  if (rawTranscriptRel) blockLines.push(`Raw transcript: \`${rawTranscriptRel}\``, "");
  blockLines.push("<!-- /aos-capture -->");
  const block = blockLines.join("\n");

  const next = existing.trim()
    ? `${existing.replace(/\s*$/, "")}\n\n${block}\n`
    : [
        `# ${dateStr(now)} - session auto-capture`,
        "",
        "<!-- Machine-owned. Headless / no-wrap-up session captures land",
        "     here and are indexed into the PGLite memory store. Do not hand-edit. -->",
        "",
        CAPTURE_HEADER,
        "",
        block,
        "",
      ].join("\n");

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, next);
  return { filePath, written: true, sourceHash };
}

export interface ArchiveRawTranscriptOptions {
  rootDir: string;
  transcriptPath: string;
  sessionId: string;
  turn: LastTurn;
  now?: Date;
}

export interface ArchiveRawTranscriptResult {
  filePath: string | null;
  relativePath: string | null;
  written: boolean;
}

export function archiveRawTranscript(opts: ArchiveRawTranscriptOptions): ArchiveRawTranscriptResult {
  const now = opts.now ?? new Date();
  const sourceHash = opts.turn.sourceHash ?? computeTurnSourceHash(opts.turn);
  const filePath = path.join(
    opts.rootDir,
    "context",
    "transcripts",
    dateStr(now),
    `${safeFilePart(opts.sessionId)}-${sourceHash.slice(0, 12)}.jsonl`,
  );

  try {
    fs.accessSync(opts.transcriptPath, fs.constants.R_OK);
  } catch {
    return { filePath: null, relativePath: null, written: false };
  }

  if (fs.existsSync(filePath)) {
    return { filePath, relativePath: repoRelativePath(opts.rootDir, filePath), written: false };
  }

  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.copyFileSync(opts.transcriptPath, filePath);
  return { filePath, relativePath: repoRelativePath(opts.rootDir, filePath), written: true };
}

// ── Turn summarization ──────────────────────────────────────────────────────

export type CaptureSummaryProvider = "claude" | "codex" | "none";

export interface CaptureSummaryConfig {
  enabled: boolean;
  provider: CaptureSummaryProvider;
  model: string;
  timeoutMs: number;
}

export interface SummaryRequest {
  provider: CaptureSummaryProvider;
  model: string;
  timeoutMs: number;
  systemPrompt: string;
  turnText: string;
  cwd?: string;
}

export type SummaryRunner = (request: SummaryRequest) => Promise<string | null>;

export interface SummarizeTurnOptions {
  rootDir: string;
  turn: LastTurn;
  config?: CaptureSummaryConfig;
  runner?: SummaryRunner;
  cwd?: string;
}

export interface CaptureSessionTurnOptions {
  rootDir: string;
  sessionId: string;
  turn: LastTurn;
  transcriptPath?: string | null;
  now?: Date;
  summaryConfig?: CaptureSummaryConfig;
  summaryRunner?: SummaryRunner;
}

export interface CaptureSessionTurnResult extends UpsertCaptureResult {
  rawTranscriptPath: string | null;
  rawTranscriptWritten: boolean;
  summarySource: "summarized" | "fallback" | "skipped";
}

export function loadCaptureSummaryConfig(rootDir: string): CaptureSummaryConfig {
  const defaults: CaptureSummaryConfig = {
    enabled: true,
    provider: DEFAULT_SUMMARY_PROVIDER,
    model: DEFAULT_CLAUDE_SUMMARY_MODEL,
    timeoutMs: DEFAULT_SUMMARY_TIMEOUT_MS,
  };

  let block: Record<string, unknown> | null = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(rootDir, "context", "memory-config.json"), "utf-8"));
    const candidate = parsed?.capture?.summarize;
    if (candidate && typeof candidate === "object") block = candidate as Record<string, unknown>;
  } catch {
    return defaults;
  }
  if (!block) return defaults;

  const provider = normalizeProvider(block.provider, defaults.provider);
  const model =
    typeof block.model === "string" && block.model.trim()
      ? block.model.trim()
      : provider === "codex"
        ? DEFAULT_CODEX_SUMMARY_MODEL
        : defaults.model;
  const timeoutRaw = block.timeout_ms ?? block.timeoutMs;
  const timeoutMs = typeof timeoutRaw === "number" && Number.isFinite(timeoutRaw)
    ? Math.max(1_000, timeoutRaw)
    : defaults.timeoutMs;

  return {
    enabled: block.enabled === false ? false : defaults.enabled,
    provider,
    model,
    timeoutMs,
  };
}

function normalizeProvider(value: unknown, fallback: CaptureSummaryProvider): CaptureSummaryProvider {
  return value === "claude" || value === "codex" || value === "none" ? value : fallback;
}

export function buildTurnSummaryInput(turn: LastTurn, agentName = "Claude Code"): string {
  const user = turn.userPrompt.trim() || "(no prompt captured)";
  return [
    `=== Transcript of one conversation turn between User and ${agentName} ===`,
    `[User]: ${user}`,
    `[${agentName}]: ${turn.assistantMessage.trim()}`,
  ].join("\n");
}

export function buildSummarySystemPrompt(agentName = "Claude Code"): string {
  return [
    "You are a third-person note-taker.",
    `You will receive one conversation turn between a human and ${agentName}.`,
    "Record what happened as factual third-person notes.",
    `You are an external observer, not ${agentName}, and you must not answer the human's question.`,
    "Output 2-10 bullet points, each starting with '- ', and nothing else.",
    "First bullet: what the user asked or wanted.",
    "Remaining bullets: what was done, files or tools used, and key findings or outcomes.",
    "Write in the same primary language as the user's message.",
  ].join(" ");
}

export async function summarizeTurn(opts: SummarizeTurnOptions): Promise<string | null> {
  const config = opts.config ?? loadCaptureSummaryConfig(opts.rootDir);
  if (!config.enabled || config.provider === "none") return null;

  const agentName = config.provider === "codex" ? "Codex" : "Claude Code";
  const runner = opts.runner ?? runSummaryCommand;
  try {
    const summary = await runner({
      provider: config.provider,
      model: config.model,
      timeoutMs: config.timeoutMs,
      systemPrompt: buildSummarySystemPrompt(agentName),
      turnText: buildTurnSummaryInput(opts.turn, agentName),
      cwd: opts.cwd ?? opts.rootDir,
    });
    return summary ? normalizeSummaryText(summary) : null;
  } catch {
    return null;
  }
}

async function runSummaryCommand(request: SummaryRequest): Promise<string | null> {
  if (request.provider === "claude") {
    return runClaudeSummary(request);
  }
  if (request.provider === "codex") {
    return runCodexSummary(request);
  }
  return null;
}

function runClaudeSummary(request: SummaryRequest): Promise<string | null> {
  return spawnWithInput({
    command: "claude",
    args: [
      "-p",
      "--model",
      request.model || DEFAULT_CLAUDE_SUMMARY_MODEL,
      "--no-session-persistence",
      "--system-prompt",
      request.systemPrompt,
    ],
    input: request.turnText,
    timeoutMs: request.timeoutMs,
    cwd: request.cwd,
    // Tells the session-sync hook this Claude is the summary, not a session,
    // so it doesn't add a task to the board (same flag as the Codex summary).
    extraEnv: { AI_OS_MEMORY_CAPTURE: "1" },
  });
}

function runCodexSummary(request: SummaryRequest): Promise<string | null> {
  const prompt = `${request.systemPrompt}\n\nHere is the transcript:\n${request.turnText}`;
  return spawnWithInput({
    command: "codex",
    args: [
      "exec",
      "--ephemeral",
      "--skip-git-repo-check",
      "-s",
      "read-only",
      "-c",
      "features.hooks=false",
      "-c",
      "model_reasoning_effort=\"low\"",
      "-m",
      request.model || DEFAULT_CODEX_SUMMARY_MODEL,
      prompt,
    ],
    input: "",
    timeoutMs: request.timeoutMs,
    cwd: request.cwd,
    extraEnv: { AI_OS_MEMORY_CAPTURE: "1" },
  });
}

interface SpawnWithInputOptions {
  command: string;
  args: string[];
  input: string;
  timeoutMs: number;
  cwd?: string;
  extraEnv?: Partial<NodeJS.ProcessEnv>;
}

function spawnWithInput(opts: SpawnWithInputOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const cleanEnv: NodeJS.ProcessEnv = { ...process.env, ...opts.extraEnv };
    delete cleanEnv.CLAUDECODE;
    // Inherited from the session being captured; a summary Claude that kept it
    // would register itself on that task through the session-sync hook.
    delete cleanEnv.AI_OS_TASK_ID;

    const child = spawnCli(opts.command, opts.args, {
      cwd: opts.cwd,
      env: cleanEnv,
    });

    let stdout = "";
    let settled = false;
    let timeout: NodeJS.Timeout;
    const finish = (value: string | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve(value);
    };
    timeout = setTimeout(() => {
      finish(null);
      killProcessTree(child);
    }, opts.timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.on("close", (code) => {
      finish(code === 0 && stdout.trim() ? stdout.trim() : null);
    });
    child.on("error", () => finish(null));

    if (child.stdin) {
      child.stdin.end(opts.input);
    }
  });
}

function spawnCli(command: string, args: string[], options: { cwd?: string; env?: NodeJS.ProcessEnv }): ChildProcess {
  const spawnOptions = {
    cwd: options.cwd,
    env: options.env,
    stdio: ["pipe", "pipe", "pipe"] as ["pipe", "pipe", "pipe"],
    windowsHide: true,
    detached: process.platform !== "win32",
  };
  if (process.platform === "win32") {
    return spawn("cmd", ["/d", "/s", "/c", command, ...args], { ...spawnOptions, detached: false });
  }
  return spawn(command, args, spawnOptions);
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  if (process.platform === "win32") {
    spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    return;
  }
  try {
    process.kill(-child.pid, "SIGKILL");
  } catch {
    try {
      child.kill("SIGKILL");
    } catch {
      /* already gone */
    }
  }
}

export async function captureSessionTurn(opts: CaptureSessionTurnOptions): Promise<CaptureSessionTurnResult> {
  const now = opts.now ?? new Date();
  const sourceHash = opts.turn.sourceHash ?? computeTurnSourceHash(opts.turn);
  const filePath = sessionCaptureFilePath(opts.rootDir, now);

  if (sourceAlreadyCaptured(filePath, sourceHash)) {
    return {
      filePath,
      written: false,
      sourceHash,
      rawTranscriptPath: null,
      rawTranscriptWritten: false,
      summarySource: "skipped",
    };
  }

  const rawArchive = opts.transcriptPath
    ? archiveRawTranscript({
        rootDir: opts.rootDir,
        transcriptPath: opts.transcriptPath,
        sessionId: opts.sessionId,
        turn: { ...opts.turn, sourceHash },
        now,
      })
    : { filePath: null, relativePath: null, written: false };

  const summaryText = await summarizeTurn({
    rootDir: opts.rootDir,
    turn: opts.turn,
    config: opts.summaryConfig,
    runner: opts.summaryRunner,
    cwd: opts.rootDir,
  });
  const written = upsertSessionCapture({
    rootDir: opts.rootDir,
    sessionId: opts.sessionId,
    turn: { ...opts.turn, sourceHash },
    summaryText,
    sourceHash,
    rawTranscriptPath: rawArchive.relativePath,
    now,
  });

  return {
    ...written,
    rawTranscriptPath: rawArchive.relativePath,
    rawTranscriptWritten: rawArchive.written,
    summarySource: summaryText ? "summarized" : "fallback",
  };
}

function sessionCaptureFilePath(rootDir: string, now: Date): string {
  return path.join(rootDir, "context", "memory", `${dateStr(now)}.aos.md`);
}

function sourceAlreadyCaptured(filePath: string, sourceHash: string): boolean {
  try {
    return fs.readFileSync(filePath, "utf-8").includes(`source:${sourceHash}`);
  } catch {
    return false;
  }
}

// ── Debounced + locked refresh ──────────────────────────────────────────────

export interface RefreshIndexOptions {
  store: MemoryStore;
  embedder: Embedder;
  scope: Scope;
  rootDir: string;
  roots?: string[];
  reason?: IndexJobReason;
  force?: boolean;
  /** Skip when the last index ran within this many ms (unless `force`). Default 30s. */
  debounceMs?: number;
  /** Where capture-state.json + the lock live. Default <rootDir>/.command-centre/memory. */
  stateDir?: string;
  /** A lock older than this is treated as stale and reclaimed. Default 120s. */
  staleLockMs?: number;
  now?: Date;
}

export interface RefreshIndexResult {
  summary: IndexSummary | null;
  skipped: "debounced" | "locked" | null;
}

interface CaptureState {
  lastIndexAt: number;
  lastReason: IndexJobReason;
}

function readState(stateFile: string): CaptureState | null {
  try {
    const parsed = JSON.parse(fs.readFileSync(stateFile, "utf-8"));
    if (parsed && typeof parsed.lastIndexAt === "number") return parsed as CaptureState;
  } catch {
    /* missing / corrupt → treat as no prior run */
  }
  return null;
}

function scopeStateSuffix(scope: Scope): string {
  if (scope.visibility === "system") return "";
  const id = scope.clientId ?? scope.teamId ?? scope.userId ?? "scope";
  return `.${`${scope.visibility}-${id}`.replace(/[^A-Za-z0-9._-]/g, "_")}`;
}

/**
 * Run the incremental indexer, debounced and serialized.
 *
 * The Stop hook can fire every turn; this collapses bursts via a timestamp in
 * capture-state.json and serializes concurrent runs with an atomic mkdir lock
 * (PGLite is single-process and file-locked, so an unguarded second open would
 * hard-error — the lock turns that into a clean skip). The caller owns the store
 * open/close, which keeps this unit-testable with an ephemeral store. The
 * embedder/store dimension-mismatch guard is allowed to throw through.
 */
export async function refreshIndex(opts: RefreshIndexOptions): Promise<RefreshIndexResult> {
  const now = opts.now ?? new Date();
  const nowMs = now.getTime();
  const debounceMs = opts.debounceMs ?? 30_000;
  const staleLockMs = opts.staleLockMs ?? 120_000;
  const reason: IndexJobReason = opts.reason ?? "refresh";
  const stateDir = opts.stateDir ?? path.join(opts.rootDir, ".command-centre", "memory");
  const stateFile = path.join(stateDir, `capture-state${scopeStateSuffix(opts.scope)}.json`);
  const lockDir = path.join(stateDir, ".capture.lock");

  fs.mkdirSync(stateDir, { recursive: true });

  if (!opts.force) {
    const state = readState(stateFile);
    if (state && nowMs - state.lastIndexAt < debounceMs) {
      return { summary: null, skipped: "debounced" };
    }
  }

  if (!acquireLock(lockDir, nowMs, staleLockMs)) {
    return { summary: null, skipped: "locked" };
  }

  try {
    const summary = await indexSources({
      store: opts.store,
      embedder: opts.embedder,
      scope: opts.scope,
      rootDir: opts.rootDir,
      roots: opts.roots,
      force: opts.force === true,
      reason,
    });
    const state: CaptureState = { lastIndexAt: nowMs, lastReason: reason };
    fs.writeFileSync(stateFile, `${JSON.stringify(state, null, 2)}\n`);
    return { summary, skipped: null };
  } finally {
    try {
      fs.rmSync(lockDir, { recursive: true, force: true });
    } catch {
      /* best effort */
    }
  }
}

/** Acquire an atomic mkdir lock, reclaiming it once if it is stale. */
function acquireLock(lockDir: string, nowMs: number, staleLockMs: number): boolean {
  try {
    fs.mkdirSync(lockDir);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
  }
  // Held — reclaim if the holder is gone (stale) and try once more.
  try {
    const age = nowMs - fs.statSync(lockDir).mtimeMs;
    if (age > staleLockMs) {
      fs.rmSync(lockDir, { recursive: true, force: true });
      fs.mkdirSync(lockDir);
      return true;
    }
  } catch {
    /* lost the race / vanished — fall through to "locked" */
  }
  return false;
}

// ── Status ──────────────────────────────────────────────────────────────────

export interface MemoryStatus {
  storeReady: boolean;
  sources: number;
  chunks: number;
  jobs: number;
  embedDim: number;
  expectedEmbeddingModel: string;
  expectedEmbeddingDim: number;
  embeddingCompatible: boolean;
  embeddingModels: Array<{ model: string | null; dim: number | null; chunks: number }>;
  byVisibility: Record<string, number>;
  jobsByStatus: Record<string, number>;
  lastIndexedAt: string | null;
  lastIndex: { sourcePath: string; reason: string; status: string; finishedAt: string | null } | null;
  today: { date: string; curatedPresent: boolean; capturePresent: boolean; captureIndexed: boolean };
}

export interface MemoryStatusOptions {
  store: MemoryStore;
  rootDir: string;
  now?: Date;
}

function fileExists(p: string): boolean {
  try {
    return fs.statSync(p).size > 0;
  } catch {
    return false;
  }
}

/** Report counts, the most recent index job, and today's capture state. */
export async function memoryStatus(opts: MemoryStatusOptions): Promise<MemoryStatus> {
  const { store } = opts;
  const now = opts.now ?? new Date();
  const today = dateStr(now);

  const totals = await store.client.query<{ sources: number; chunks: number }>(
    "SELECT (SELECT count(*) FROM memory_sources)::int AS sources, " +
      "(SELECT count(*) FROM memory_chunks)::int AS chunks",
  );
  const jobs = await store.client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM index_jobs",
  );

  const visRows = await store.client.query<{ visibility: string; n: number }>(
    "SELECT visibility, count(*)::int AS n FROM memory_sources GROUP BY visibility",
  );
  const byVisibility: Record<string, number> = {};
  for (const r of visRows.rows) byVisibility[r.visibility] = Number(r.n);

  const statusRows = await store.client.query<{ status: string; n: number }>(
    "SELECT status, count(*)::int AS n FROM index_jobs GROUP BY status",
  );
  const jobsByStatus: Record<string, number> = {};
  for (const r of statusRows.rows) jobsByStatus[r.status] = Number(r.n);

  const modelRows = await store.client.query<{
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
  const embeddingModels = modelRows.rows.map((r) => ({
    model: r.embedding_model ?? null,
    dim: r.embedding_dim == null ? null : Number(r.embedding_dim),
    chunks: Number(r.n),
  }));
  const expectedModel = "bge-m3";
  const expectedDim = store.embedDim;
  const embeddingCompatible = embeddingModels.every(
    (m) => m.model === expectedModel && m.dim === expectedDim,
  );

  const lastJob = await store.client.query<{
    source_path: string;
    reason: string;
    status: string;
    finished_at: string | null;
  }>(
    "SELECT source_path, reason, status, finished_at::text AS finished_at FROM index_jobs " +
      "ORDER BY COALESCE(finished_at, started_at, enqueued_at) DESC LIMIT 1",
  );
  const lastIndexed = await store.client.query<{ finished_at: string | null }>(
    "SELECT max(finished_at)::text AS finished_at FROM index_jobs " +
      "WHERE status IN ('succeeded', 'skipped')",
  );

  const captureRel = `context/memory/${today}.aos.md`;
  const indexed = await store.client.query<{ n: number }>(
    "SELECT count(*)::int AS n FROM memory_sources WHERE source_path = $1",
    [captureRel],
  );

  return {
    storeReady: true,
    sources: Number(totals.rows[0].sources),
    chunks: Number(totals.rows[0].chunks),
    jobs: Number(jobs.rows[0]?.n ?? 0),
    embedDim: store.embedDim,
    expectedEmbeddingModel: expectedModel,
    expectedEmbeddingDim: expectedDim,
    embeddingCompatible,
    embeddingModels,
    byVisibility,
    jobsByStatus,
    lastIndexedAt: lastIndexed.rows[0]?.finished_at ?? null,
    lastIndex: lastJob.rows[0]
      ? {
          sourcePath: lastJob.rows[0].source_path,
          reason: lastJob.rows[0].reason,
          status: lastJob.rows[0].status,
          finishedAt: lastJob.rows[0].finished_at,
        }
      : null,
    today: {
      date: today,
      curatedPresent: fileExists(path.join(opts.rootDir, "context", "memory", `${today}.md`)),
      capturePresent: fileExists(path.join(opts.rootDir, captureRel)),
      captureIndexed: Number(indexed.rows[0].n) > 0,
    },
  };
}

/** Visibilities surfaced in status output, in canonical order. */
export const STATUS_VISIBILITIES: readonly Visibility[] = ["system", "team", "client", "private"];
