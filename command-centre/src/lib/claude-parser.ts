import type { LogEntry, Todo } from "@/types/task";
import {
  ASK_USER_QUESTION_TOOL_NAME,
  extractQuestionSpecsFromText,
  isUnansweredAskUserQuestionResult,
  questionSpecsFromAskUserQuestionInput,
  stripQuestionSpecsFromText,
  type QuestionSpec,
} from "@/types/question-spec";

export interface ProgressData {
  costUsd?: number;
  tokensUsed?: number;
  activityLabel?: string;
}

export interface CompleteData {
  costUsd: number;
  tokensUsed: number;
  durationMs: number;
  sessionId?: string;
}

export interface WorkflowLaunchData {
  toolUseId: string;
  taskId: string;
  runId: string;
  transcriptDir: string;
  scriptPath?: string;
  workflowName?: string;
  summary?: string;
}

export interface WorkflowTerminalData {
  toolUseId: string;
  taskId: string;
  runId: string;
  status: "completed" | "failed" | "stopped";
  summary?: string;
  result?: string;
  outputFile?: string;
}

export interface ClaudeParserCallbacks {
  onProgress: (data: ProgressData) => void;
  onComplete: (data: CompleteData) => void;
  onError: (error: string) => void;
  onLogEntry?: (entry: LogEntry) => void;
  onQuestion?: (questionText: string) => void;
  onStructuredQuestion?: (specs: QuestionSpec[]) => void;
  /** A built-in AskUserQuestion call, converted to modal questions. */
  onToolQuestion?: (specs: QuestionSpec[]) => void;
  /** The CLI reported that nobody answered an AskUserQuestion call. `surfaced` is true when onToolQuestion already showed it. */
  onUnansweredToolQuestion?: (surfaced: boolean) => void;
  onTodos?: (todos: Todo[]) => void;
  onSession?: (sessionId: string) => void;
  onWorkflowLaunch?: (data: WorkflowLaunchData) => void;
  onWorkflowTerminal?: (data: WorkflowTerminalData) => void;
  shouldProcessResultAfterCompletion?: () => boolean;
}

/**
 * Parses Claude CLI streaming JSON output (--output-format stream-json).
 * Each line is a newline-delimited JSON object with a `type` field.
 */
export class ClaudeOutputParser {
  private callbacks: ClaudeParserCallbacks;
  private completed = false;
  private emittedToolUseIds = new Set<string>();
  private emittedToolResultIds = new Set<string>();
  private subagentToolUseIds = new Set<string>();
  private backgroundTaskToolUseIds = new Map<string, string>();
  private workflowToolUseIds = new Set<string>();
  private askUserQuestionToolUseIds = new Set<string>();
  private surfacedAskUserQuestionToolUseIds = new Set<string>();
  private workflowToolUseIdsByTaskId = new Map<string, string>();
  private workflowRunsByToolUseId = new Map<string, WorkflowLaunchData>();
  private emittedWorkflowLaunchKeys = new Set<string>();
  private emittedWorkflowTerminalToolUseIds = new Set<string>();

  constructor(callbacks: ClaudeParserCallbacks) {
    this.callbacks = callbacks;
  }

  /**
   * Feed a single line of Claude CLI JSON output.
   * Handles: assistant (text chunks), result (completion), error.
   */
  feedLine(line: string): void {
    const trimmed = line.trim();
    if (!trimmed) return;

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(trimmed);
    } catch {
      console.warn("[claude-parser] Malformed JSON line, skipping:", trimmed.slice(0, 120));
      return;
    }

    const type = parsed.type as string | undefined;
    if (!type) return;

    switch (type) {
      case "system": {
        this.handleSystem(parsed);
        break;
      }
      case "assistant": {
        this.handleAssistant(parsed);
        break;
      }
      case "user": {
        this.handleUser(parsed);
        break;
      }
      case "tool_use": {
        this.handleToolUse(parsed);
        break;
      }
      case "tool_result": {
        this.handleToolResult(parsed);
        break;
      }
      case "result": {
        this.handleResult(parsed);
        break;
      }
      case "error": {
        this.handleError(parsed);
        break;
      }
    }
  }

  private handleSystem(parsed: Record<string, unknown>): void {
    const sessionId = extractSessionId(parsed);
    if (sessionId) {
      this.callbacks.onSession?.(sessionId);
    }

    if (parsed.subtype === "task_started") {
      this.rememberBackgroundTask(parsed);
    } else if (parsed.subtype === "task_notification") {
      this.handleSystemTaskNotification(parsed);
    }
  }

  private handleAssistant(parsed: Record<string, unknown>): void {
    // Extract text content from assistant message
    // Format: { type: "assistant", message: { content: [{ type: "text", text: "..." }] } }
    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) return;

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return;

    // Find text blocks (skip tool blocks)
    const textBlocks = content.filter((block) => block.type === "text" && typeof block.text === "string");
    const toolUseBlocks = content.filter((block) => block.type === "tool_use");
    const toolResultBlocks = content.filter((block) => block.type === "tool_result");

    if (textBlocks.length > 0) {
      const lastText = textBlocks[textBlocks.length - 1].text as string;
      const structured = detectStructuredQuestions(lastText);
      const visibleLastText = structured
        ? stripStructuredQuestionBlock(lastText, structured.matchedText)
        : lastText;
      const activityLabel = extractActivityLabel(visibleLastText);

      if (activityLabel) {
        this.callbacks.onProgress({ activityLabel });
      }

      // Emit log entry for text content
      const fullText = textBlocks.map((b) => b.text as string).join("");
      const structuredFromFullText = structured ?? detectStructuredQuestions(fullText);
      const visibleText = structuredFromFullText
        ? stripStructuredQuestionBlock(fullText, structuredFromFullText.matchedText)
        : fullText;

      if (visibleText.trim()) {
        this.callbacks.onLogEntry?.({
          id: crypto.randomUUID(),
          type: "text",
          timestamp: new Date().toISOString(),
          content: visibleText,
          ...withParentToolUseId(parsed),
        });
      }

      if (structuredFromFullText && structuredFromFullText.specs.length > 0) {
        this.callbacks.onStructuredQuestion?.(structuredFromFullText.specs);
      } else {
        // Fallback: prose question detection
        const questionText = detectQuestion(visibleText);
        if (questionText) {
          // Check if this is a permission/approval prompt — synthesize interactive options
          const permissionSpec = detectPermissionPrompt(visibleText, questionText);
          if (permissionSpec && this.callbacks.onStructuredQuestion) {
            this.callbacks.onStructuredQuestion(permissionSpec);
          } else {
            this.callbacks.onQuestion?.(questionText);
          }
        }
      }
    }

    for (const block of toolUseBlocks) {
      this.handleToolUse(block, parsed);
    }

    for (const block of toolResultBlocks) {
      this.handleToolResult(block, parsed);
    }

    this.handleSubagentAssistantCompletion(parsed, textBlocks);
  }

  private handleUser(parsed: Record<string, unknown>): void {
    const message = parsed.message as Record<string, unknown> | undefined;
    const content = message?.content ?? parsed.content;

    if (typeof content === "string") {
      this.handleTaskNotification(content, parsed);
      return;
    }

    if (!Array.isArray(content)) return;

    for (const block of content) {
      if (!block || typeof block !== "object") continue;
      const record = block as Record<string, unknown>;
      if (record.type !== "tool_result") continue;
      if (isAsyncLaunchToolResult(record, parsed)) {
        this.rememberAsyncLaunch(record, parsed);
        continue;
      }
      this.handleToolResult(record, parsed);
    }
  }

  private handleToolUse(parsed: Record<string, unknown>, container?: Record<string, unknown>): void {
    const name = (parsed.name as string) || "unknown_tool";
    const input = parsed.input ?? {};
    const toolUseId = extractToolUseId(parsed);
    if (toolUseId) {
      if (this.emittedToolUseIds.has(toolUseId)) {
        return;
      }
      this.emittedToolUseIds.add(toolUseId);
      if (isSubagentToolName(name)) {
        this.subagentToolUseIds.add(toolUseId);
      } else if (isWorkflowToolName(name)) {
        this.workflowToolUseIds.add(toolUseId);
      }
    }

    this.callbacks.onLogEntry?.({
      id: crypto.randomUUID(),
      type: "tool_use",
      timestamp: new Date().toISOString(),
      content: name,
      toolName: name,
      toolArgs: JSON.stringify(input),
      ...(toolUseId ? { toolUseId } : {}),
      ...withParentToolUseId(container ?? parsed),
      isCollapsed: true,
    });

    // Emit a human-readable activity label based on the tool being invoked
    const activityLabel = buildToolActivityLabel(name, input as Record<string, unknown>);
    if (activityLabel) {
      this.callbacks.onProgress({ activityLabel });
    }

    // The headless CLI can't answer AskUserQuestion, so show its questions
    // through the same modal path as an ask-user-questions block.
    if (name === ASK_USER_QUESTION_TOOL_NAME) {
      if (toolUseId) this.askUserQuestionToolUseIds.add(toolUseId);
      const specs = questionSpecsFromAskUserQuestionInput(input);
      if (specs.length > 0) {
        if (toolUseId) this.surfacedAskUserQuestionToolUseIds.add(toolUseId);
        this.callbacks.onToolQuestion?.(specs);
      }
    }

    // Surface TodoWrite calls as a typed todos snapshot. Claude rewrites the
    // full list each time it updates state, so the latest call wins.
    if (name === "TodoWrite" && this.callbacks.onTodos) {
      const todos = parseTodosFromInput(input);
      if (todos) this.callbacks.onTodos(todos);
    }
  }

  private handleToolResult(parsed: Record<string, unknown>, container?: Record<string, unknown>): void {
    const resultText = extractToolResultText(parsed);

    const toolUseId = extractToolResultUseId(parsed);
    if (toolUseId) {
      if (this.emittedToolResultIds.has(toolUseId)) {
        return;
      }
      this.emittedToolResultIds.add(toolUseId);
    }

    if (toolUseId && this.workflowToolUseIds.has(toolUseId)) {
      const launch = parseWorkflowLaunchText(toolUseId, resultText);
      if (launch) this.rememberWorkflowLaunch(launch);
    }

    const parentToolUseId = extractParentToolUseId(parsed) ?? (container ? extractParentToolUseId(container) : undefined);

    // Nothing in the Command Centre answers AskUserQuestion, so any result
    // for one is the CLI giving up; the text check covers calls we missed.
    const answersAskUserQuestion = toolUseId ? this.askUserQuestionToolUseIds.has(toolUseId) : false;
    if (answersAskUserQuestion || isUnansweredAskUserQuestionResult(resultText)) {
      const surfaced = toolUseId ? this.surfacedAskUserQuestionToolUseIds.has(toolUseId) : false;
      this.callbacks.onUnansweredToolQuestion?.(surfaced);
    }

    this.callbacks.onLogEntry?.({
      id: crypto.randomUUID(),
      type: "tool_result",
      timestamp: new Date().toISOString(),
      content: resultText || "(no output)",
      toolResult: resultText || undefined,
      ...(toolUseId ? { toolUseId } : {}),
      ...(parentToolUseId ? { parentToolUseId } : {}),
    });
  }

  private handleTaskNotification(content: string, parsed: Record<string, unknown>): void {
    if (!isTaskNotificationMessage(content, parsed)) return;

    const notification = parseTaskNotification(content);
    if (!notification || !isTerminalTaskNotificationStatus(notification.status)) return;

    if (this.emitWorkflowTerminal({
      toolUseId: notification.toolUseId,
      taskId: notification.taskId,
      status: notification.status,
      summary: notification.summary,
      result: notification.result,
      outputFile: notification.outputFile,
    })) {
      return;
    }

    this.emitSubagentCompletion(notification.toolUseId, {
      status: notification.status,
      summary: notification.summary,
      result: notification.result,
      usage: notification.usage,
      parentToolUseId: extractParentToolUseId(parsed),
      source: "legacy_task_notification",
    });
  }

  private rememberAsyncLaunch(
    block: Record<string, unknown>,
    container: Record<string, unknown>,
  ): void {
    const toolUseId = extractToolResultUseId(block);
    const toolUseResult = container.toolUseResult as Record<string, unknown> | undefined;
    if (!toolUseId || !toolUseResult) return;

    const taskType = firstNonEmptyString(toolUseResult.taskType, toolUseResult.task_type);
    if (taskType === "local_workflow") {
      const taskId = firstNonEmptyString(toolUseResult.taskId, toolUseResult.task_id);
      const runId = firstNonEmptyString(toolUseResult.runId, toolUseResult.run_id);
      const transcriptDir = firstNonEmptyString(toolUseResult.transcriptDir, toolUseResult.transcript_dir);
      if (!taskId || !runId || !transcriptDir) return;

      const launch: WorkflowLaunchData = {
        toolUseId,
        taskId,
        runId,
        transcriptDir,
        ...optionalStringField("scriptPath", toolUseResult.scriptPath, toolUseResult.script_path),
        ...optionalStringField("workflowName", toolUseResult.workflowName, toolUseResult.workflow_name),
        ...optionalStringField("summary", toolUseResult.summary),
      };
      this.rememberWorkflowLaunch(launch);
      return;
    }

    if (!this.subagentToolUseIds.has(toolUseId)) return;

    const taskId = firstNonEmptyString(toolUseResult?.agentId, toolUseResult?.task_id);
    if (taskId) {
      this.backgroundTaskToolUseIds.set(taskId, toolUseId);
    }
  }

  private rememberWorkflowLaunch(launch: WorkflowLaunchData): void {
    this.workflowToolUseIds.add(launch.toolUseId);
    this.workflowToolUseIdsByTaskId.set(launch.taskId, launch.toolUseId);
    this.workflowRunsByToolUseId.set(launch.toolUseId, launch);

    const launchKeys = [`run:${launch.runId}`, `tool:${launch.toolUseId}`];
    if (launchKeys.some((key) => this.emittedWorkflowLaunchKeys.has(key))) return;
    for (const key of launchKeys) this.emittedWorkflowLaunchKeys.add(key);
    this.callbacks.onWorkflowLaunch?.(launch);
  }

  private rememberBackgroundTask(parsed: Record<string, unknown>): void {
    const taskId = firstNonEmptyString(parsed.task_id);
    const toolUseId = firstNonEmptyString(parsed.tool_use_id);
    if (!taskId || !toolUseId) return;

    if (parsed.task_type === "local_workflow") {
      this.workflowToolUseIds.add(toolUseId);
      this.workflowToolUseIdsByTaskId.set(taskId, toolUseId);
      return;
    }
    if (parsed.task_type !== "local_agent") return;

    this.backgroundTaskToolUseIds.set(taskId, toolUseId);
    this.subagentToolUseIds.add(toolUseId);
  }

  private handleSystemTaskNotification(parsed: Record<string, unknown>): void {
    const status = typeof parsed.status === "string" ? parsed.status.toLowerCase() : "";
    if (!isCurrentTaskNotificationTerminalStatus(status)) return;

    const taskId = firstNonEmptyString(parsed.task_id);
    const directToolUseId = firstNonEmptyString(parsed.tool_use_id);
    const workflowToolUseId = directToolUseId && this.workflowToolUseIds.has(directToolUseId)
      ? directToolUseId
      : taskId
        ? this.workflowToolUseIdsByTaskId.get(taskId)
        : undefined;
    if (workflowToolUseId && this.emitWorkflowTerminal({
      toolUseId: workflowToolUseId,
      taskId,
      status,
      summary: firstNonEmptyString(parsed.summary),
      result: firstNonEmptyString(parsed.result),
      outputFile: firstNonEmptyString(parsed.output_file),
    })) {
      return;
    }

    const toolUseId = directToolUseId ?? (taskId ? this.backgroundTaskToolUseIds.get(taskId) : undefined);
    if (!toolUseId || !this.subagentToolUseIds.has(toolUseId)) return;

    const usageRecord = parsed.usage as Record<string, unknown> | undefined;
    const usage = normalizeCurrentTaskNotificationUsage(usageRecord);
    const summary = firstNonEmptyString(parsed.summary);
    const outputFile = firstNonEmptyString(parsed.output_file);

    this.emitSubagentCompletion(toolUseId, {
      status,
      summary,
      result: summary ?? outputFile,
      usage,
      source: "task_notification",
    });
  }

  private emitWorkflowTerminal(data: {
    toolUseId: string;
    taskId?: string;
    status: string;
    summary?: string;
    result?: string;
    outputFile?: string;
  }): boolean {
    if (!this.workflowToolUseIds.has(data.toolUseId)) return false;

    const launch = this.workflowRunsByToolUseId.get(data.toolUseId);
    const taskId = data.taskId ?? launch?.taskId;
    const status = normalizeWorkflowTerminalStatus(data.status);
    if (!launch || !taskId || !status) return false;

    if (this.emittedWorkflowTerminalToolUseIds.has(data.toolUseId)) {
      return true;
    }
    this.emittedWorkflowTerminalToolUseIds.add(data.toolUseId);
    this.callbacks.onWorkflowTerminal?.({
      toolUseId: data.toolUseId,
      taskId,
      runId: launch.runId,
      status,
      ...(data.summary ? { summary: data.summary } : {}),
      ...(data.result ? { result: data.result } : {}),
      ...(data.outputFile ? { outputFile: data.outputFile } : {}),
    });
    return true;
  }

  private handleSubagentAssistantCompletion(
    parsed: Record<string, unknown>,
    textBlocks: Array<Record<string, unknown>>,
  ): void {
    const parentToolUseId = extractParentToolUseId(parsed);
    if (
      !parentToolUseId ||
      !this.subagentToolUseIds.has(parentToolUseId) ||
      extractStopReason(parsed) !== "end_turn"
    ) {
      return;
    }

    const result = textBlocks
      .map((block) => typeof block.text === "string" ? block.text : "")
      .join("")
      .trim();
    this.emitSubagentCompletion(parentToolUseId, {
      status: "completed",
      summary: "Agent finished",
      result: result || undefined,
      parentToolUseId,
      source: "assistant_end_turn",
    });
  }

  private emitSubagentCompletion(
    toolUseId: string,
    data: {
      status: string;
      summary?: string;
      result?: string;
      usage?: TaskNotification["usage"];
      parentToolUseId?: string;
      source: string;
    },
  ): void {
    if (this.emittedToolResultIds.has(toolUseId)) return;
    this.emittedToolResultIds.add(toolUseId);

    const toolArgs: Record<string, unknown> = {
      status: data.status,
      source: data.source,
    };
    if (data.summary) toolArgs.summary = data.summary;
    if (data.usage) toolArgs.usage = data.usage;

    const fallback = `Agent ${data.status}`;
    this.callbacks.onLogEntry?.({
      id: crypto.randomUUID(),
      type: "tool_result",
      timestamp: new Date().toISOString(),
      content: data.summary || fallback,
      toolName: "AgentNotification",
      toolArgs: JSON.stringify(toolArgs),
      toolResult: data.result || data.summary || fallback,
      toolUseId,
      ...(data.parentToolUseId ? { parentToolUseId: data.parentToolUseId } : {}),
    });
  }

  private handleResult(parsed: Record<string, unknown>): void {
    if (this.completed && !this.callbacks.shouldProcessResultAfterCompletion?.()) return;
    this.completed = true;

    if (parsed.is_error === true || parsed.subtype === "error") {
      this.callbacks.onError(formatClaudeResultError(parsed));
      return;
    }

    const costUsd = typeof parsed.cost_usd === "number" ? parsed.cost_usd : 0;
    const durationMs = typeof parsed.duration_ms === "number" ? parsed.duration_ms : 0;

    // Token count: check total_tokens first, then sum input_tokens + output_tokens
    let tokensUsed = 0;
    const usage = parsed.usage as Record<string, unknown> | undefined;
    if (usage && typeof usage.total_tokens === "number") {
      tokensUsed = usage.total_tokens;
    } else if (usage && typeof usage.input_tokens === "number") {
      tokensUsed = usage.input_tokens + (typeof usage.output_tokens === "number" ? usage.output_tokens : 0);
    } else if (typeof parsed.total_tokens === "number") {
      tokensUsed = parsed.total_tokens;
    } else if (typeof parsed.input_tokens === "number") {
      tokensUsed = parsed.input_tokens + (typeof parsed.output_tokens === "number" ? parsed.output_tokens : 0);
    }

    const sessionId = extractSessionId(parsed);

    // When num_turns=0 (skill ran as a local command with no API turns), the
    // result text lives in the "result" field instead of an assistant message.
    // Emit it as a log entry so the UI shows the skill output.
    const numTurns = typeof parsed.num_turns === "number" ? parsed.num_turns : null;
    if (numTurns === 0 && typeof parsed.result === "string" && parsed.result.trim()) {
      this.callbacks.onLogEntry?.({
        id: crypto.randomUUID(),
        type: "text",
        timestamp: new Date().toISOString(),
        content: parsed.result,
      });
    }

    this.callbacks.onComplete({ costUsd, tokensUsed, durationMs, sessionId });
  }

  private handleError(parsed: Record<string, unknown>): void {
    if (this.completed) return;
    this.completed = true;

    const errorMsg =
      typeof parsed.error === "string"
        ? parsed.error
        : typeof parsed.message === "string"
          ? parsed.message
          : "Unknown Claude CLI error";

    this.callbacks.onError(errorMsg);
  }

  /** Whether a result or error has already been processed. */
  get isCompleted(): boolean {
    return this.completed;
  }
}

function extractSessionId(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.session_id === "string") {
    return parsed.session_id;
  }
  if (typeof parsed.sessionId === "string") {
    return parsed.sessionId;
  }
  const message = parsed.message as Record<string, unknown> | undefined;
  if (message && typeof message.session_id === "string") {
    return message.session_id;
  }
  return undefined;
}

function extractToolUseId(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.id === "string") {
    return parsed.id;
  }
  if (typeof parsed.tool_use_id === "string") {
    return parsed.tool_use_id;
  }
  if (typeof parsed.toolUseId === "string") {
    return parsed.toolUseId;
  }
  return undefined;
}

function extractParentToolUseId(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.parent_tool_use_id === "string") {
    return parsed.parent_tool_use_id;
  }
  if (typeof parsed.parentToolUseId === "string") {
    return parsed.parentToolUseId;
  }
  const message = parsed.message as Record<string, unknown> | undefined;
  if (message && typeof message.parent_tool_use_id === "string") {
    return message.parent_tool_use_id;
  }
  return undefined;
}

function extractStopReason(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.stop_reason === "string") {
    return parsed.stop_reason;
  }
  const message = parsed.message as Record<string, unknown> | undefined;
  return typeof message?.stop_reason === "string" ? message.stop_reason : undefined;
}

function firstNonEmptyString(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return undefined;
}

function optionalStringField<Key extends string>(
  key: Key,
  ...values: unknown[]
): Partial<Record<Key, string>> {
  const value = firstNonEmptyString(...values);
  return value ? { [key]: value } as Record<Key, string> : {};
}

function isSubagentToolName(name: string): boolean {
  const normalized = name.toLowerCase();
  return normalized === "agent" || normalized === "task";
}

function isWorkflowToolName(name: string): boolean {
  return name.toLowerCase() === "workflow";
}

function withToolUseId(parsed: Record<string, unknown>): { toolUseId?: string } {
  const toolUseId = extractToolUseId(parsed);
  return toolUseId ? { toolUseId } : {};
}

function extractToolResultUseId(parsed: Record<string, unknown>): string | undefined {
  if (typeof parsed.tool_use_id === "string") {
    return parsed.tool_use_id;
  }
  if (typeof parsed.toolUseId === "string") {
    return parsed.toolUseId;
  }
  return undefined;
}

function extractToolResultText(parsed: Record<string, unknown>): string {
  const content = parsed.content as string | Array<Record<string, unknown>> | undefined;

  if (typeof content === "string") {
    return content;
  }
  if (Array.isArray(content)) {
    return content
      .filter((b) => b.type === "text" && typeof b.text === "string")
      .map((b) => b.text as string)
      .join("");
  }
  return "";
}

function parseWorkflowLaunchText(
  toolUseId: string,
  text: string,
): WorkflowLaunchData | undefined {
  if (!/^Workflow launched in background\./im.test(text)) return undefined;

  const lineValue = (label: string): string | undefined => {
    const match = text.match(new RegExp(`^${label}:\\s*([^\\r\\n]+)`, "im"));
    return match?.[1]?.trim() || undefined;
  };
  const taskId = lineValue("Task ID")
    ?? text.match(/^Workflow launched in background\.\s*Task ID:\s*([^\s]+)/im)?.[1];
  const runId = lineValue("Run ID");
  const transcriptDir = lineValue("Transcript dir");
  if (!taskId || !runId || !transcriptDir) return undefined;

  const scriptPath = lineValue("Script file");
  const summary = lineValue("Summary");
  return {
    toolUseId,
    taskId,
    runId,
    transcriptDir,
    ...(scriptPath ? { scriptPath } : {}),
    ...(summary ? { summary } : {}),
  };
}

function isAsyncLaunchToolResult(block: Record<string, unknown>, container: Record<string, unknown>): boolean {
  const toolUseResult = container.toolUseResult as Record<string, unknown> | undefined;
  if (toolUseResult?.status === "async_launched") {
    return true;
  }

  const text = extractToolResultText(block);
  return /Async agent launched successfully/i.test(text) ||
    /The agent is working in the background/i.test(text);
}

interface TaskNotification {
  toolUseId: string;
  taskId?: string;
  status: string;
  summary?: string;
  result?: string;
  outputFile?: string;
  usage?: {
    subagentTokens?: number;
    toolUses?: number;
    durationMs?: number;
  };
}

function isTaskNotificationMessage(content: string, parsed: Record<string, unknown>): boolean {
  const origin = parsed.origin as Record<string, unknown> | undefined;
  return origin?.kind === "task-notification" || /<task-notification>[\s\S]*<\/task-notification>/i.test(content);
}

function parseTaskNotification(content: string): TaskNotification | null {
  const toolUseId = extractXmlTag(content, "tool-use-id");
  const status = extractXmlTag(content, "status");
  if (!toolUseId || !status) return null;

  const usage: TaskNotification["usage"] = {};
  const subagentTokens = parseOptionalInt(extractXmlTag(content, "subagent_tokens"));
  const toolUses = parseOptionalInt(extractXmlTag(content, "tool_uses"));
  const durationMs = parseOptionalInt(extractXmlTag(content, "duration_ms"));
  if (subagentTokens != null) usage.subagentTokens = subagentTokens;
  if (toolUses != null) usage.toolUses = toolUses;
  if (durationMs != null) usage.durationMs = durationMs;

  const summary = extractXmlTag(content, "summary") ?? undefined;
  const result = extractXmlTag(content, "result") ?? undefined;
  const taskId = extractXmlTag(content, "task-id") ?? undefined;
  const outputFile = extractXmlTag(content, "output-file") ?? undefined;

  return {
    toolUseId,
    ...(taskId ? { taskId } : {}),
    status: status.toLowerCase(),
    ...(summary ? { summary } : {}),
    ...(result ? { result } : {}),
    ...(outputFile ? { outputFile } : {}),
    ...(Object.keys(usage).length > 0 ? { usage } : {}),
  };
}

function extractXmlTag(content: string, tagName: string): string | null {
  const escapedTag = tagName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = content.match(new RegExp(`<${escapedTag}>([\\s\\S]*?)<\\/${escapedTag}>`, "i"));
  if (!match?.[1]) return null;
  return decodeXmlEntities(match[1].trim());
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseOptionalInt(value: string | null): number | undefined {
  if (!value) return undefined;
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function isTerminalTaskNotificationStatus(status: string): boolean {
  return new Set(["completed", "succeeded", "failed", "error", "stopped", "cancelled", "canceled", "timed_out", "timeout"]).has(status);
}

function isCurrentTaskNotificationTerminalStatus(status: string): boolean {
  return status === "completed" || status === "failed" || status === "stopped";
}

function normalizeWorkflowTerminalStatus(
  status: string,
): WorkflowTerminalData["status"] | undefined {
  switch (status.toLowerCase()) {
    case "completed":
    case "succeeded":
      return "completed";
    case "failed":
    case "error":
    case "timed_out":
    case "timeout":
      return "failed";
    case "stopped":
    case "cancelled":
    case "canceled":
      return "stopped";
    default:
      return undefined;
  }
}

function normalizeCurrentTaskNotificationUsage(
  usage: Record<string, unknown> | undefined,
): TaskNotification["usage"] | undefined {
  if (!usage) return undefined;

  const normalized: NonNullable<TaskNotification["usage"]> = {};
  if (typeof usage.total_tokens === "number") normalized.subagentTokens = usage.total_tokens;
  if (typeof usage.tool_uses === "number") normalized.toolUses = usage.tool_uses;
  if (typeof usage.duration_ms === "number") normalized.durationMs = usage.duration_ms;
  return Object.keys(normalized).length > 0 ? normalized : undefined;
}

function withParentToolUseId(parsed: Record<string, unknown>): { parentToolUseId?: string } {
  const parentToolUseId = extractParentToolUseId(parsed);
  return parentToolUseId ? { parentToolUseId } : {};
}

function formatClaudeResultError(parsed: Record<string, unknown>): string {
  const apiStatus =
    typeof parsed.api_error_status === "number"
      ? parsed.api_error_status
      : typeof parsed.error_status === "number"
        ? parsed.error_status
        : null;
  const statusText = apiStatus ? ` ${apiStatus}` : "";

  if (apiStatus === 401) {
    return "Claude returned 401 while running this goal. Refresh your Claude Code login, then retry the goal.";
  }

  const resultText = typeof parsed.result === "string" ? parsed.result.trim() : "";
  const messageText = typeof parsed.message === "string" ? parsed.message.trim() : "";
  const detail = resultText || messageText;

  return detail
    ? `Claude returned an error${statusText}: ${detail}`
    : `Claude returned an error${statusText} while running this goal.`;
}

/**
 * Parse the `todos` array from a TodoWrite tool_use input. Returns null if
 * the shape doesn't match what we expect.
 */
export function parseTodosFromInput(input: unknown): Todo[] | null {
  if (!input || typeof input !== "object") return null;
  const raw = (input as Record<string, unknown>).todos;
  if (!Array.isArray(raw)) return null;
  const todos: Todo[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") continue;
    const obj = item as Record<string, unknown>;
    const content = typeof obj.content === "string" ? obj.content : null;
    const status = obj.status;
    if (!content) continue;
    if (status !== "pending" && status !== "in_progress" && status !== "completed") continue;
    const activeForm = typeof obj.activeForm === "string" ? obj.activeForm : undefined;
    todos.push({ content, status, activeForm });
  }
  return todos.length > 0 ? todos : null;
}

/**
 * Detect a structured question block in Claude's output.
 *
 * Claude is instructed (via a system-prompt addendum at task spawn time) to
 * emit typed clarifying questions as a fenced code block with the language
 * tag `ask-user-questions` containing a JSON array of QuestionSpec objects.
 *
 * Example:
 * ```ask-user-questions
 * [
 *   { "id": "tone", "prompt": "What tone?", "type": "select",
 *     "options": ["Formal", "Casual"], "required": true }
 * ]
 * ```
 *
 * Returns the parsed specs if a valid block is found, null otherwise.
 */
function detectStructuredQuestions(
  text: string
): { specs: QuestionSpec[]; matchedText: string } | null {
  const extracted = extractQuestionSpecsFromText(text);
  return extracted && extracted.specs.length > 0 ? extracted : null;
}

function stripStructuredQuestionBlock(text: string, matchedText: string): string {
  return stripQuestionSpecsFromText(text, matchedText);
}

/**
 * Detect if Claude is asking the user a question.
 * Returns the question text if detected, null otherwise.
 */
function detectQuestion(text: string): string | null {
  const trimmed = text.trim();
  const lines = trimmed.split("\n").filter((l) => l.trim());
  const lastLine = lines[lines.length - 1]?.trim() || "";

  // Check last line for literal question mark
  if (lastLine.endsWith("?")) return lastLine;

  // Check last few lines for question patterns (Claude sometimes puts the
  // question a line or two before the final line)
  const lastFewLines = lines.slice(-4).map((l) => l.trim());
  for (const line of lastFewLines) {
    if (line.endsWith("?") && line.length > 10) return line;
  }

  // Check for common Claude question/action-request patterns in last few lines
  const questionPatterns = [
    /would you like me to/i,
    /shall I/i,
    /do you want me to/i,
    /please (confirm|choose|select|specify|provide)/i,
    /which (one|option|approach)/i,
    /let me know (if|when|what|which|how)/i,
    /needs? your (approval|input|confirmation|permission|review)/i,
    /you should be seeing a prompt/i,
    /waiting for (your|you to)/i,
    /paste (it |.{0,20} )here/i,
    /if you'd (rather|like to|prefer)/i,
    /alternatively,? (you can|if you)/i,
    /approve (it|the|this)/i,
    /ready when you are/i,
    /once you (approve|confirm|provide|add|set)/i,
  ];

  const searchText = lastFewLines.join(" ");
  for (const pattern of questionPatterns) {
    if (pattern.test(searchText)) {
      // Return the most relevant line
      for (const line of lastFewLines.reverse()) {
        if (pattern.test(line)) return line;
      }
      return lastFewLines[lastFewLines.length - 1] || lastLine;
    }
  }
  return null;
}

/**
 * Detect if a question is actually a permission/approval prompt and synthesize
 * interactive options so the UI renders selectable buttons instead of plain text.
 *
 * Returns QuestionSpec[] if the text matches a permission pattern, null otherwise.
 */
function detectPermissionPrompt(fullText: string, questionText: string): QuestionSpec[] | null {
  const lower = fullText.toLowerCase();

  // Permission patterns — phrases that indicate Claude is asking for approval
  // to run a command or take an action
  const permissionPatterns = [
    /once you (approve|confirm|allow|authorize)/i,
    /needs? your (approval|permission|authorization)/i,
    /approve (it|the|this)/i,
    /waiting for (your approval|permission|you to (approve|confirm|allow))/i,
    /you should be seeing a prompt/i,
    /shall I (go ahead|proceed|run|execute|continue)/i,
    /would you like me to (go ahead|proceed|run|execute|continue)/i,
    /do you want me to (go ahead|proceed|run|execute|continue)/i,
    /can I (go ahead|proceed|run|execute|continue)/i,
    /ready to (run|execute|proceed|continue)/i,
    /please (approve|confirm|allow|authorize) (the|this)/i,
  ];

  const isPermissionPrompt = permissionPatterns.some((p) => p.test(fullText));
  if (!isPermissionPrompt) return null;

  // Try to extract what command/action is being requested
  let actionDescription = "this action";
  const commandMatch = fullText.match(
    /(?:approve|run|execute|allow|confirm)\s+(?:the\s+)?[`"]([^`"]+)[`"]/i
  );
  if (commandMatch?.[1]) {
    actionDescription = commandMatch[1];
  } else {
    // Try backtick-wrapped command mentions
    const backtickMatch = fullText.match(/`([^`]{3,60})`/);
    if (backtickMatch?.[1] && /^[a-zA-Z]/.test(backtickMatch[1])) {
      actionDescription = backtickMatch[1];
    }
  }

  const truncatedAction = actionDescription.length > 60
    ? actionDescription.slice(0, 57) + "..."
    : actionDescription;

  return [
    {
      id: "permission",
      prompt: `Approve: ${truncatedAction}`,
      type: "select",
      options: [
        "Yes, go ahead",
        "Yes, and don't ask again for this task",
        "No, don't do this",
      ],
      required: true,
    },
  ];
}

/**
 * Extract a short, plain-English activity label from assistant text.
 * Strips technical noise (file paths, code, markers) and returns
 * a business-readable summary of what Claude is doing or has done.
 */
function extractActivityLabel(text: string): string | null {
  // Clean up the text
  let cleaned = text
    .replace(/```[\s\S]*?```/g, "")              // remove code blocks
    .replace(/\[SILENT\]/gi, "")                  // remove silent markers
    .replace(/`[^`]+`/g, "")                      // remove inline code
    .replace(/[#*_~]/g, "")                       // remove markdown formatting
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")      // [text](url) → text
    .replace(/(?:\/[\w.-]+){2,}/g, "")            // remove file paths like /foo/bar/baz.md
    .replace(/[\w.-]+\/[\w.-]+\/[\w.-]+/g, "")    // remove relative paths like projects/ops-cron/file.md
    .replace(/\b\w+\.(md|json|ts|tsx|js|jsx|py|sh|yaml|yml|csv|txt|log|pdf|png|svg)\b/gi, "")  // remove filenames
    .replace(/\n+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned || cleaned.length < 5) return null;

  // Filter out Claude Code session summary lines (e.g. "✳ Choreographed for 120m 12s · 654 tokens")
  // Matches: any word + "for" + duration (with or without tokens suffix)
  cleaned = cleaned
    .replace(/[^\w\s]*\s*\w+\s+for\s+\d+[hms]\s*\d*[hms\d\s·,]*(?:tokens?)?\s*/gi, "")
    .trim();

  if (!cleaned || cleaned.length < 5) return null;

  // Split into sentences and pick the last substantive one
  const sentences = cleaned.split(/[.!?]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 8)
    // Skip sentences that are mostly technical
    .filter((s) => !/^(saved|wrote|created|updated|deleted|reading|writing|running|executed)\s+(to|from|at|in)\b/i.test(s))
    .filter((s) => !/^(Report|Output|File|Log|Result) saved/i.test(s))
    // Skip session summary lines with duration pattern (with or without tokens)
    .filter((s) => !/\bfor\s+\d+[hms]/i.test(s));

  // Fallback to any sentence if all were filtered
  const fallbackSentences = cleaned.split(/[.!?]+/).map((s) => s.trim()).filter((s) => s.length > 8);
  const pool = sentences.length > 0 ? sentences : fallbackSentences;
  const label = pool.length > 0 ? pool[pool.length - 1] : cleaned;

  if (!label || label.length < 5) return null;

  return label.length > 100 ? label.slice(0, 97) + "..." : label;
}

/**
 * Build a human-readable activity label from a tool_use event.
 * E.g. Read + file_path → "Reading modal-chat.tsx"
 */
function buildToolActivityLabel(name: string, input: Record<string, unknown>): string | null {
  const str = (key: string) => (typeof input[key] === "string" ? (input[key] as string) : null);
  const basename = (path: string) => path.split("/").pop() || path;
  const hostname = (url: string) => { try { return new URL(url).hostname; } catch { return url.slice(0, 40); } };
  const truncate = (s: string, n: number) => s.length > n ? s.slice(0, n - 1) + "…" : s;

  switch (name) {
    case "Read": {
      const fp = str("file_path");
      return fp ? `Reading ${basename(fp)}` : "Reading file";
    }
    case "Grep": {
      const pat = str("pattern");
      return pat ? `Searching for '${truncate(pat, 40)}'` : "Searching codebase";
    }
    case "Glob": {
      const pat = str("pattern");
      return pat ? `Finding files matching '${truncate(pat, 35)}'` : "Finding files";
    }
    case "Bash": {
      const cmd = str("command");
      return cmd ? `Running ${truncate(cmd, 50)}` : "Running command";
    }
    case "Write": {
      const fp = str("file_path");
      return fp ? `Writing ${basename(fp)}` : "Writing file";
    }
    case "Edit": {
      const fp = str("file_path");
      return fp ? `Editing ${basename(fp)}` : "Editing file";
    }
    case "WebFetch": {
      const url = str("url");
      return url ? `Fetching ${hostname(url)}` : "Fetching URL";
    }
    case "WebSearch": {
      const q = str("query");
      return q ? `Searching web for '${truncate(q, 35)}'` : "Searching web";
    }
    case "Agent":
    case "Task":
      return "Delegating to sub-agent";
    case "Skill": {
      const s = str("skill");
      return s ? `Running skill: ${s}` : "Running skill";
    }
    case "TodoWrite":
      return "Updating task list";
    default:
      return `Using ${name}`;
  }
}
