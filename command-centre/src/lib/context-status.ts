import fs from "fs";
import os from "os";
import path from "path";

const DEFAULT_CONTEXT_WINDOW = 200_000;
const BRIDGE_STALE_MS = 60_000;
const TAIL_BYTES = 1024 * 1024;

export type ContextStatusSource = "exact" | "estimated";

export type ContextStatus =
  | {
      status: "available";
      source: ContextStatusSource;
      percentUsed: number;
      percentRemaining: number;
      tokensUsed: number | null;
      totalTokens: number | null;
      remainingTokens: number | null;
      updatedAt: string | null;
    }
  | {
      status: "unavailable";
      reason: "no_session" | "no_data";
    };

export interface ContextStatusOptions {
  nowMs?: number;
  tempDir?: string;
  homeDir?: string;
}

interface UsageNumbers {
  input_tokens?: number;
  cache_creation_input_tokens?: number;
  cache_read_input_tokens?: number;
  output_tokens?: number;
  context_window?: number;
  contextWindow?: number;
  context_window_tokens?: number;
}

function isSafeSessionId(sessionId: string): boolean {
  return /^[A-Za-z0-9._-]+$/.test(sessionId);
}

function clampPercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}

function normalizePercent(value: number | null): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  return clampPercent(value <= 1 ? value * 100 : value);
}

function numericValue(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

function findNumber(value: unknown, keys: string[]): number | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  for (const key of keys) {
    const direct = numericValue(record[key]);
    if (direct != null) return direct;
  }
  for (const child of Object.values(record)) {
    if (child && typeof child === "object") {
      const nested = findNumber(child, keys);
      if (nested != null) return nested;
    }
  }
  return null;
}

function isoFromMs(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  return new Date(ms).toISOString();
}

function validIso(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

function buildAvailableStatus(input: {
  source: ContextStatusSource;
  percentUsed: number | null;
  tokensUsed?: number | null;
  totalTokens?: number | null;
  remainingTokens?: number | null;
  updatedAt?: string | null;
}): ContextStatus {
  let percentUsed = input.percentUsed;
  let tokensUsed = input.tokensUsed ?? null;
  let totalTokens = input.totalTokens ?? null;
  let remainingTokens = input.remainingTokens ?? null;

  if (percentUsed == null && tokensUsed != null && totalTokens != null && totalTokens > 0) {
    percentUsed = (tokensUsed / totalTokens) * 100;
  }
  if (percentUsed == null && tokensUsed != null && remainingTokens != null) {
    totalTokens = tokensUsed + remainingTokens;
    percentUsed = totalTokens > 0 ? (tokensUsed / totalTokens) * 100 : null;
  }
  if (tokensUsed == null && percentUsed != null && totalTokens != null) {
    tokensUsed = Math.round(totalTokens * (percentUsed / 100));
  }
  if (remainingTokens == null && tokensUsed != null && totalTokens != null) {
    remainingTokens = Math.max(0, totalTokens - tokensUsed);
  }

  const normalized = normalizePercent(percentUsed);
  if (normalized == null) return { status: "unavailable", reason: "no_data" };

  return {
    status: "available",
    source: input.source,
    percentUsed: Math.round(normalized),
    percentRemaining: Math.round(clampPercent(100 - normalized)),
    tokensUsed,
    totalTokens,
    remainingTokens,
    updatedAt: input.updatedAt ?? null,
  };
}

function readFreshBridge(sessionId: string, options: ContextStatusOptions): ContextStatus | null {
  const tempDir = options.tempDir ?? os.tmpdir();
  const bridgePath = path.join(tempDir, `claude-ctx-${sessionId}.json`);
  if (!fs.existsSync(bridgePath)) return null;

  const stat = fs.statSync(bridgePath);
  const nowMs = options.nowMs ?? Date.now();
  if (nowMs - stat.mtimeMs > BRIDGE_STALE_MS) return null;

  const parsed = JSON.parse(fs.readFileSync(bridgePath, "utf-8"));
  const percentUsed = normalizePercent(findNumber(parsed, [
    "percentUsed",
    "percent_used",
    "usagePercent",
    "usage_percent",
    "contextPercent",
    "context_percent",
    "usedPercent",
    "used_percent",
    "used_pct",
    "percent",
  ]));
  const percentRemaining = normalizePercent(findNumber(parsed, [
    "percentRemaining",
    "percent_remaining",
    "remainingPercent",
    "remaining_percent",
    "remaining_percentage",
  ]));
  const tokensUsed = findNumber(parsed, [
    "tokensUsed",
    "tokens_used",
    "usedTokens",
    "used_tokens",
    "contextUsed",
    "context_used",
  ]);
  const remainingTokens = findNumber(parsed, [
    "remainingTokens",
    "remaining_tokens",
    "tokensRemaining",
    "tokens_remaining",
    "contextRemaining",
    "context_remaining",
  ]);
  const totalTokens = findNumber(parsed, [
    "totalTokens",
    "total_tokens",
    "contextWindow",
    "context_window",
    "contextWindowTokens",
    "context_window_tokens",
    "maxTokens",
    "max_tokens",
  ]);
  const updatedAt = validIso((parsed as Record<string, unknown>).updatedAt)
    ?? validIso((parsed as Record<string, unknown>).updated_at)
    ?? isoFromMs(stat.mtimeMs);

  return buildAvailableStatus({
    source: "exact",
    percentUsed: percentUsed ?? (percentRemaining == null ? null : 100 - percentRemaining),
    tokensUsed,
    totalTokens,
    remainingTokens,
    updatedAt,
  });
}

function findTranscriptPath(sessionId: string, options: ContextStatusOptions): string | null {
  const projectsDir = path.join(options.homeDir ?? os.homedir(), ".claude", "projects");
  if (!fs.existsSync(projectsDir)) return null;

  let latest: { filePath: string; mtimeMs: number } | null = null;
  for (const entry of fs.readdirSync(projectsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(projectsDir, entry.name, `${sessionId}.jsonl`);
    if (!fs.existsSync(candidate)) continue;
    const stat = fs.statSync(candidate);
    if (!latest || stat.mtimeMs > latest.mtimeMs) {
      latest = { filePath: candidate, mtimeMs: stat.mtimeMs };
    }
  }
  return latest?.filePath ?? null;
}

function readTail(filePath: string): string {
  const stat = fs.statSync(filePath);
  const start = Math.max(0, stat.size - TAIL_BYTES);
  const length = stat.size - start;
  const handle = fs.openSync(filePath, "r");
  try {
    const buffer = Buffer.alloc(length);
    fs.readSync(handle, buffer, 0, length, start);
    return buffer.toString("utf-8");
  } finally {
    fs.closeSync(handle);
  }
}

function getAssistantUsage(entry: unknown): { usage: UsageNumbers; timestamp: string | null } | null {
  if (!entry || typeof entry !== "object") return null;
  const record = entry as Record<string, unknown>;
  const message = record.message && typeof record.message === "object"
    ? record.message as Record<string, unknown>
    : null;
  const isAssistant =
    record.type === "assistant" ||
    message?.role === "assistant";
  if (!isAssistant) return null;

  const usage = (message?.usage ?? record.usage) as UsageNumbers | undefined;
  if (!usage || typeof usage !== "object") return null;
  return {
    usage,
    timestamp: validIso(record.timestamp),
  };
}

function readTranscriptEstimate(sessionId: string, options: ContextStatusOptions): ContextStatus | null {
  const transcriptPath = findTranscriptPath(sessionId, options);
  if (!transcriptPath) return null;

  const tail = readTail(transcriptPath);
  const lines = tail.split(/\r?\n/).filter((line) => line.trim().length > 0);
  for (let i = lines.length - 1; i >= 0; i--) {
    try {
      const assistantUsage = getAssistantUsage(JSON.parse(lines[i]));
      if (!assistantUsage) continue;
      const usage = assistantUsage.usage;
      const tokensUsed =
        (usage.input_tokens ?? 0) +
        (usage.cache_creation_input_tokens ?? 0) +
        (usage.cache_read_input_tokens ?? 0) +
        (usage.output_tokens ?? 0);
      if (tokensUsed <= 0) continue;

      const totalTokens =
        usage.context_window ??
        usage.contextWindow ??
        usage.context_window_tokens ??
        DEFAULT_CONTEXT_WINDOW;

      return buildAvailableStatus({
        source: "estimated",
        percentUsed: (tokensUsed / totalTokens) * 100,
        tokensUsed,
        totalTokens,
        remainingTokens: Math.max(0, totalTokens - tokensUsed),
        updatedAt: assistantUsage.timestamp ?? isoFromMs(fs.statSync(transcriptPath).mtimeMs),
      });
    } catch {
      // Ignore malformed transcript lines.
    }
  }

  return null;
}

export function getContextStatusForSession(
  sessionId: string | null | undefined,
  options: ContextStatusOptions = {},
): ContextStatus {
  if (!sessionId) return { status: "unavailable", reason: "no_session" };
  if (!isSafeSessionId(sessionId)) return { status: "unavailable", reason: "no_data" };

  try {
    const bridgeStatus = readFreshBridge(sessionId, options);
    if (bridgeStatus?.status === "available") return bridgeStatus;

    const transcriptStatus = readTranscriptEstimate(sessionId, options);
    if (transcriptStatus?.status === "available") return transcriptStatus;
  } catch {
    return { status: "unavailable", reason: "no_data" };
  }

  return { status: "unavailable", reason: "no_data" };
}
