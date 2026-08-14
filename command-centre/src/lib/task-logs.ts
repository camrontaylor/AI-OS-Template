import type Database from "better-sqlite3";
import type { Message } from "@/types/chat";
import type { LogEntry, LogEntryType } from "@/types/task";

const TEXT_LIKE_LOG_TYPES = new Set<LogEntryType>([
  "text",
  "question",
  "user_reply",
  "system",
]);

export const TASK_LOG_DUPLICATE_WINDOW_MS = 5000;

type ConversationBackedLogEntry = LogEntry & {
  source: "task_log" | "conversation";
};

export type CronRunLog = {
  id: number;
  jobSlug: string;
  taskId: string | null;
  startedAt: string;
  completedAt: string | null;
  result: "success" | "failure" | "timeout" | "running";
  clientId?: string | null;
  trigger?: "manual" | "scheduled";
  scheduledFor?: string | null;
};

type CronLogBodyItem = {
  kind: "text" | "system";
  content: string;
};

export type CronLogSegment = {
  jobName: string;
  startTimestamp: string;
  endTimestamp: string | null;
  result: "success" | "failure" | "timeout" | null;
  startMarker: string;
  endMarker: string | null;
  bodyItems: CronLogBodyItem[];
};

type TaskLogRow = {
  id: string;
  type: string;
  timestamp: string;
  content: string;
  toolName: string | null;
  toolArgs: string | null;
  toolResult: string | null;
  isCollapsed: number;
};

export type InsertTaskLogInput = {
  id?: string;
  type: LogEntryType;
  timestamp?: string;
  content: string;
  toolName?: string | null;
  toolArgs?: string | null;
  toolResult?: string | null;
  isCollapsed?: boolean;
};

export type InsertTaskLogResult =
  | { inserted: true; entry: LogEntry }
  | { inserted: false; reason: "empty" | "duplicate"; entry?: LogEntry };

const TASK_LOG_SELECT = `
  SELECT id, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed
  FROM task_logs
`;

const CRON_RUN_START_RE = /^=== \[([^\]]+)\] START: (.+?) ===$/;
const CRON_RUN_END_RE = /^=== \[([^\]]+)\] (SUCCESS|FAILURE|TIMEOUT): (.+?) \((\d+)s\) ===$/;

function getTimestampMs(timestamp: string): number {
  const parsed = Date.parse(timestamp);
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function toIsoTimestamp(timestamp?: string): string {
  return new Date(timestamp ? getTimestampMs(timestamp) : Date.now()).toISOString();
}

function timestampsMatch(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) {
    return false;
  }

  return getTimestampMs(a) === getTimestampMs(b);
}

function flushCronTextBuffer(
  bodyItems: CronLogBodyItem[],
  textBuffer: string[]
): void {
  if (textBuffer.length === 0) {
    return;
  }

  const content = textBuffer.join("\n").trim();
  textBuffer.length = 0;

  if (content.length === 0) {
    return;
  }

  bodyItems.push({ kind: "text", content });
}

function compareLogEntries(
  a: ConversationBackedLogEntry,
  b: ConversationBackedLogEntry
): number {
  const timeDiff = getTimestampMs(a.timestamp) - getTimestampMs(b.timestamp);
  if (timeDiff !== 0) {
    return timeDiff;
  }

  if (a.source !== b.source) {
    return a.source === "task_log" ? -1 : 1;
  }

  return a.id.localeCompare(b.id);
}

function mapConversationRoleToLogType(message: Message): LogEntryType {
  if (message.role === "user") {
    return "user_reply";
  }
  if (message.role === "system") {
    return "system";
  }
  if (message.role === "sub_agent" && message.metadata?.questionText) {
    return "question";
  }
  return "text";
}

function getConversationMessageContent(message: Message): string {
  if (message.role === "sub_agent" && message.metadata?.questionText) {
    return message.metadata.questionText;
  }
  return message.content;
}

function hasMatchingTaskLog(
  candidate: LogEntry,
  existingTaskLogsBySignature: Map<string, LogEntry[]>,
  options: {
    allowAnyTimestampMatch?: boolean;
  } = {}
): boolean {
  const signature = getTaskLogDuplicateSignature(candidate);
  if (!signature) {
    return false;
  }

  const matchingTaskLogs = existingTaskLogsBySignature.get(signature);
  if (!matchingTaskLogs || matchingTaskLogs.length === 0) {
    return false;
  }

  if (options.allowAnyTimestampMatch) {
    return true;
  }

  const candidateTimestampMs = getTimestampMs(candidate.timestamp);
  return matchingTaskLogs.some(
    (entry) =>
      Math.abs(getTimestampMs(entry.timestamp) - candidateTimestampMs) <=
      TASK_LOG_DUPLICATE_WINDOW_MS
  );
}

export function conversationMessageToLogEntry(message: Message): LogEntry | null {
  const type = mapConversationRoleToLogType(message);
  const content = getConversationMessageContent(message);

  return normalizeTaskLogEntry({
    id: message.id,
    type,
    timestamp: message.createdAt,
    content,
    ...(message.taskId ? { sourceTaskId: message.taskId } : {}),
  });
}

export function mergeTaskLogsWithConversation(
  taskLogs: LogEntry[],
  conversationMessages: Message[],
  options: {
    originMessageId?: string | null;
  } = {}
): LogEntry[] {
  const normalizedTaskLogs = taskLogs
    .map((entry) => normalizeTaskLogEntry(entry))
    .filter((entry): entry is LogEntry => entry !== null);

  const existingTaskLogsBySignature = new Map<string, LogEntry[]>();
  for (const entry of normalizedTaskLogs) {
    const signature = getTaskLogDuplicateSignature(entry);
    if (!signature) {
      continue;
    }

    const existing = existingTaskLogsBySignature.get(signature) ?? [];
    existing.push(entry);
    existingTaskLogsBySignature.set(signature, existing);
  }

  const syntheticConversationEntries = conversationMessages
    .map((message) => ({
      message,
      entry: conversationMessageToLogEntry(message),
    }))
    .filter(
      (item): item is { message: Message; entry: LogEntry } => item.entry !== null
    )
    .filter(({ message, entry }) => {
      const isOriginMessageDuplicate =
        message.id === options.originMessageId &&
        hasMatchingTaskLog(entry, existingTaskLogsBySignature, {
          allowAnyTimestampMatch: true,
        });

      if (isOriginMessageDuplicate) {
        return false;
      }

      const isReplyDuplicate =
        message.role === "user" &&
        Boolean(message.metadata?.replyToMessageId) &&
        hasMatchingTaskLog(entry, existingTaskLogsBySignature, {
          allowAnyTimestampMatch: true,
        });

      if (isReplyDuplicate) {
        return false;
      }

      return !hasMatchingTaskLog(entry, existingTaskLogsBySignature);
    })
    .map(({ entry }) => entry);

  const mergedEntries = [
    ...normalizedTaskLogs.map(
      (entry) => ({ ...entry, source: "task_log" as const })
    ),
    ...syntheticConversationEntries.map(
      (entry) => ({ ...entry, source: "conversation" as const })
    ),
  ]
    .sort(compareLogEntries)
    .map(({ source: _source, ...entry }) => entry);

  return compactTaskLogEntries(mergedEntries);
}

export function parseCronLogSegments(logContent: string): CronLogSegment[] {
  const segments: CronLogSegment[] = [];
  const lines = String(logContent ?? "").split(/\r?\n/);
  let currentSegment: CronLogSegment | null = null;
  const textBuffer: string[] = [];

  for (const line of lines) {
    const startMatch = line.match(CRON_RUN_START_RE);
    if (startMatch) {
      if (currentSegment) {
        flushCronTextBuffer(currentSegment.bodyItems, textBuffer);
        segments.push(currentSegment);
      }

      currentSegment = {
        jobName: startMatch[2],
        startTimestamp: startMatch[1],
        endTimestamp: null,
        result: null,
        startMarker: line,
        endMarker: null,
        bodyItems: [],
      };
      continue;
    }

    if (!currentSegment) {
      continue;
    }

    const endMatch = line.match(CRON_RUN_END_RE);
    if (endMatch) {
      flushCronTextBuffer(currentSegment.bodyItems, textBuffer);
      currentSegment.endTimestamp = endMatch[1];
      currentSegment.result = endMatch[2].toLowerCase() as CronLogSegment["result"];
      currentSegment.endMarker = line;
      segments.push(currentSegment);
      currentSegment = null;
      continue;
    }

    const trimmedLineStart = line.trimStart();
    if (trimmedLineStart.startsWith("[cron-daemon]")) {
      flushCronTextBuffer(currentSegment.bodyItems, textBuffer);
      currentSegment.bodyItems.push({ kind: "system", content: trimmedLineStart });
      continue;
    }

    textBuffer.push(line);
  }

  if (currentSegment) {
    flushCronTextBuffer(currentSegment.bodyItems, textBuffer);
    segments.push(currentSegment);
  }

  return segments;
}

export function selectCronLogSegmentForRun(
  segments: CronLogSegment[],
  currentRun: CronRunLog | null | undefined,
  jobRuns: CronRunLog[]
): CronLogSegment | null {
  if (!currentRun || segments.length === 0) {
    return null;
  }

  if (currentRun.completedAt) {
    const exactEndMatch = segments.find((segment) =>
      timestampsMatch(segment.endTimestamp, currentRun.completedAt)
    );
    if (exactEndMatch) {
      return exactEndMatch;
    }
  }

  const exactStartMatch = segments.find((segment) =>
    timestampsMatch(segment.startTimestamp, currentRun.startedAt)
  );
  if (exactStartMatch) {
    return exactStartMatch;
  }

  const sortedRuns = [...jobRuns].sort((a, b) => {
    const timeDiff = getTimestampMs(a.startedAt) - getTimestampMs(b.startedAt);
    if (timeDiff !== 0) {
      return timeDiff;
    }
    return a.id - b.id;
  });

  const runIndex = sortedRuns.findIndex((run) => run.id === currentRun.id);
  if (runIndex === -1) {
    return null;
  }

  return segments[runIndex] ?? segments[segments.length - 1] ?? null;
}

export function cronLogSegmentToEntries(
  segment: CronLogSegment,
  taskId: string
): LogEntry[] {
  const entries: LogEntry[] = [];
  const startTimestamp = toIsoTimestamp(segment.startTimestamp);
  let nextTimestampMs = getTimestampMs(startTimestamp);

  for (let index = 0; index < segment.bodyItems.length; index += 1) {
    const item = segment.bodyItems[index];
    entries.push({
      id: `${taskId}:cron:body:${segment.startTimestamp}:${index}`,
      type: item.kind === "system" ? "system" : "text",
      timestamp: new Date(nextTimestampMs).toISOString(),
      content: item.content,
      sourceTaskId: taskId,
    });
    nextTimestampMs += 1;
  }

  return compactTaskLogEntries(entries);
}

export function buildCronTaskLogEntries(
  logContent: string,
  currentRun: CronRunLog | null | undefined,
  jobRuns: CronRunLog[],
  taskId: string
): LogEntry[] {
  const segments = parseCronLogSegments(logContent);
  const selectedSegment = selectCronLogSegmentForRun(
    segments,
    currentRun,
    jobRuns
  );

  if (!selectedSegment) {
    return [];
  }

  return cronLogSegmentToEntries(selectedSegment, taskId);
}

export function isTextLikeTaskLogType(type: LogEntryType): boolean {
  return TEXT_LIKE_LOG_TYPES.has(type);
}

export function isLegacyCronFallbackLogEntry(entry: Pick<LogEntry, "id">): boolean {
  return entry.id.includes(":cron:");
}

export function isLegacyCronFallbackLogSet(entries: LogEntry[]): boolean {
  return entries.length > 0 && entries.every((entry) => isLegacyCronFallbackLogEntry(entry));
}

export function normalizeTaskLogContent(type: LogEntryType, content: string): string {
  const normalizedLineEndings = String(content ?? "").replace(/\r\n?/g, "\n");
  return isTextLikeTaskLogType(type)
    ? normalizedLineEndings.trim()
    : normalizedLineEndings;
}

export function getTaskLogDuplicateSignature(
  entry: Pick<LogEntry, "type" | "content">
): string | null {
  if (!isTextLikeTaskLogType(entry.type)) {
    return null;
  }

  const normalizedContent = normalizeTaskLogContent(entry.type, entry.content);
  return normalizedContent.length > 0 ? `${entry.type}:${normalizedContent}` : null;
}

export function normalizeTaskLogEntry(entry: LogEntry): LogEntry | null {
  const normalizedContent = normalizeTaskLogContent(entry.type, entry.content);
  if (normalizedContent.length === 0) {
    return null;
  }

  return normalizedContent === entry.content
    ? entry
    : { ...entry, content: normalizedContent };
}

export function taskLogRowToEntry(row: TaskLogRow): LogEntry | null {
  return normalizeTaskLogEntry({
    id: row.id,
    type: row.type as LogEntryType,
    timestamp: row.timestamp,
    content: row.content,
    ...(row.toolName ? { toolName: row.toolName } : {}),
    ...(row.toolArgs ? { toolArgs: row.toolArgs } : {}),
    ...(row.toolResult ? { toolResult: row.toolResult } : {}),
    ...(row.isCollapsed ? { isCollapsed: true } : {}),
  });
}

export function prepareTaskLogEntry(input: InsertTaskLogInput): LogEntry | null {
  return normalizeTaskLogEntry({
    id: input.id ?? crypto.randomUUID(),
    type: input.type,
    timestamp: toIsoTimestamp(input.timestamp),
    content: input.content,
    ...(input.toolName ? { toolName: input.toolName } : {}),
    ...(input.toolArgs ? { toolArgs: input.toolArgs } : {}),
    ...(input.toolResult ? { toolResult: input.toolResult } : {}),
    ...(input.isCollapsed ? { isCollapsed: true } : {}),
  });
}

export function compactTaskLogEntries(entries: LogEntry[]): LogEntry[] {
  const recentTextLikeEntries = new Map<string, number>();
  const compacted: LogEntry[] = [];

  for (const entry of entries) {
    const normalizedEntry = normalizeTaskLogEntry(entry);
    if (!normalizedEntry) {
      continue;
    }

    const signature = getTaskLogDuplicateSignature(normalizedEntry);
    if (signature) {
      const timestampMs = getTimestampMs(normalizedEntry.timestamp);
      const lastSeen = recentTextLikeEntries.get(signature);
      if (
        lastSeen !== undefined &&
        timestampMs - lastSeen <= TASK_LOG_DUPLICATE_WINDOW_MS
      ) {
        continue;
      }
      recentTextLikeEntries.set(signature, timestampMs);
    }

    compacted.push(normalizedEntry);
  }

  return compacted;
}

export function getPendingTaskQuestionPreview(
  entries: LogEntry[],
  needsInput: boolean,
  maxLength = 120,
): string | null {
  if (!needsInput) {
    return null;
  }

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    if (entry.type === "structured_question" && !entry.questionAnswers) {
      return truncateTaskLogPreview(
        entry.content || "Claude is asking for structured input.",
        maxLength,
      );
    }
    if (entry.type === "question" && !entry.questionAnswers) {
      return truncateTaskLogPreview(entry.content, maxLength);
    }
    if (entry.type === "text") {
      const content = entry.content.trim();
      if (!content || /^--- .* ---$/.test(content)) {
        continue;
      }
      return truncateTaskLogPreview(content, maxLength);
    }
  }

  return "Waiting for your reply";
}

function normalizeErrorPreview(content: string): string {
  return String(content ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/^error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function shouldShowTaskErrorBanner(
  entries: LogEntry[],
  errorMessage: string | null | undefined,
): boolean {
  const normalizedError = normalizeErrorPreview(errorMessage || "");
  if (!normalizedError) {
    return false;
  }

  return !entries.some((entry) => {
    if (!isTextLikeTaskLogType(entry.type)) {
      return false;
    }

    const normalizedEntry = normalizeErrorPreview(entry.content);
    if (!normalizedEntry) {
      return false;
    }

    return (
      normalizedEntry === normalizedError ||
      normalizedEntry.includes(normalizedError) ||
      normalizedError.includes(normalizedEntry)
    );
  });
}

function truncateTaskLogPreview(content: string, maxLength: number): string {
  return content.length > maxLength
    ? content.slice(0, maxLength).trimEnd()
    : content;
}

export function getTaskLogEntries(
  db: Database.Database,
  taskId: string
): LogEntry[] {
  const rows = db
    .prepare(`${TASK_LOG_SELECT} WHERE taskId = ? ORDER BY rowid ASC`)
    .all(taskId) as TaskLogRow[];

  return compactTaskLogEntries(
    rows
      .map((row) => taskLogRowToEntry(row))
      .filter((entry): entry is LogEntry => entry !== null)
  );
}

export function insertTaskLog(
  db: Database.Database,
  taskId: string,
  input: InsertTaskLogInput
): InsertTaskLogResult {
  const entry = prepareTaskLogEntry(input);
  if (!entry) {
    return { inserted: false, reason: "empty" };
  }

  const signature = getTaskLogDuplicateSignature(entry);
  if (signature) {
    const cutoffIso = new Date(
      getTimestampMs(entry.timestamp) - TASK_LOG_DUPLICATE_WINDOW_MS
    ).toISOString();

    const recentRows = db
      .prepare(
        `${TASK_LOG_SELECT}
         WHERE taskId = ? AND type = ? AND timestamp >= ?
         ORDER BY rowid ASC`
      )
      .all(taskId, entry.type, cutoffIso) as TaskLogRow[];

    for (const row of recentRows) {
      const existingEntry = taskLogRowToEntry(row);
      if (!existingEntry) {
        continue;
      }

      if (getTaskLogDuplicateSignature(existingEntry) === signature) {
        return { inserted: false, reason: "duplicate", entry: existingEntry };
      }
    }
  }

  db.prepare(
    `INSERT INTO task_logs (
      id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    entry.id,
    taskId,
    entry.type,
    entry.timestamp,
    entry.content,
    entry.toolName ?? null,
    entry.toolArgs ?? null,
    entry.toolResult ?? null,
    entry.isCollapsed ? 1 : 0
  );

  return { inserted: true, entry };
}
