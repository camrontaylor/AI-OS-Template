import type { LogEntry, Todo } from "@/types/task";
import {
  extractQuestionSpecsFromText,
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

export interface ClaudeParserCallbacks {
  onProgress: (data: ProgressData) => void;
  onComplete: (data: CompleteData) => void;
  onError: (error: string) => void;
  onLogEntry?: (entry: LogEntry) => void;
  onQuestion?: (questionText: string) => void;
  onStructuredQuestion?: (specs: QuestionSpec[]) => void;
  onTodos?: (todos: Todo[]) => void;
}

/**
 * Parses Claude CLI streaming JSON output (--output-format stream-json).
 * Each line is a newline-delimited JSON object with a `type` field.
 */
export class ClaudeOutputParser {
  private callbacks: ClaudeParserCallbacks;
  private completed = false;

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
      case "assistant": {
        this.handleAssistant(parsed);
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

  private handleAssistant(parsed: Record<string, unknown>): void {
    // Extract text content from assistant message
    // Format: { type: "assistant", message: { content: [{ type: "text", text: "..." }] } }
    const message = parsed.message as Record<string, unknown> | undefined;
    if (!message) return;

    const content = message.content as Array<Record<string, unknown>> | undefined;
    if (!Array.isArray(content)) return;

    // Find text blocks (skip tool_use blocks)
    const textBlocks = content.filter((block) => block.type === "text" && typeof block.text === "string");
    if (textBlocks.length === 0) return;

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

  private handleToolUse(parsed: Record<string, unknown>): void {
    const name = (parsed.name as string) || "unknown_tool";
    const input = parsed.input ?? {};

    this.callbacks.onLogEntry?.({
      id: crypto.randomUUID(),
      type: "tool_use",
      timestamp: new Date().toISOString(),
      content: name,
      toolName: name,
      toolArgs: JSON.stringify(input),
      isCollapsed: true,
    });

    // Emit a human-readable activity label based on the tool being invoked
    const activityLabel = buildToolActivityLabel(name, input as Record<string, unknown>);
    if (activityLabel) {
      this.callbacks.onProgress({ activityLabel });
    }

    // Surface TodoWrite calls as a typed todos snapshot. Claude rewrites the
    // full list each time it updates state, so the latest call wins.
    if (name === "TodoWrite" && this.callbacks.onTodos) {
      const todos = parseTodosFromInput(input);
      if (todos) this.callbacks.onTodos(todos);
    }
  }

  private handleToolResult(parsed: Record<string, unknown>): void {
    const content = parsed.content as string | Array<Record<string, unknown>> | undefined;
    let resultText = "";

    if (typeof content === "string") {
      resultText = content;
    } else if (Array.isArray(content)) {
      resultText = content
        .filter((b) => b.type === "text" && typeof b.text === "string")
        .map((b) => b.text as string)
        .join("");
    }

    this.callbacks.onLogEntry?.({
      id: crypto.randomUUID(),
      type: "tool_result",
      timestamp: new Date().toISOString(),
      content: resultText || "(no output)",
      toolResult: resultText || undefined,
    });
  }

  private handleResult(parsed: Record<string, unknown>): void {
    if (this.completed) return;
    this.completed = true;

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

    const sessionId = typeof parsed.session_id === "string" ? parsed.session_id : undefined;

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
