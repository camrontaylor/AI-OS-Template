import type { ChildProcess } from "child_process";
import { createInterface } from "readline";
import fs from "fs";
import os from "os";
import path from "path";
import crypto from "crypto";
import { getDb } from "./db";
import { getConfig, getClientAiOsDir } from "./config";
import { completeCronRunForTask } from "./cron-service";
import { emitTaskEvent, emitChatEvent } from "./event-bus";
import { ClaudeOutputParser } from "./claude-parser";
import { fileWatcher } from "./file-watcher";
import { buildSiblingContextBlock } from "./gather-context";
import { killChildProcessTree, spawnManagedTaskProcess } from "./subprocess";
import { getActivePermissionMode, getExecutionPermissionMode } from "./permission-mode";
import type { Task, LogEntry } from "@/types/task";
import type { QuestionSpec } from "@/types/question-spec";

/**
 * Injected into every initial task prompt so Claude knows to emit
 * typed clarifying questions as a fenced block instead of asking in
 * prose. The prose-detection path still catches cases where Claude
 * ignores this instruction.
 */
const STRUCTURED_QUESTION_ADDENDUM = `\n\n---\nWhen you need clarification from the user, do NOT ask in prose. Instead emit a fenced code block with the language tag \`ask-user-questions\` containing a JSON array of typed question objects. Each object has: id (short string), prompt (the question), type ("text" | "multiline" | "select" | "multiselect"), required (boolean), and options (array of strings, only for select/multiselect). Prefer select/multiselect when the set of reasonable answers is small. Example:\n\n\`\`\`ask-user-questions\n[\n  { "id": "audience", "prompt": "Who is the primary audience?", "type": "text", "required": true },\n  { "id": "tone", "prompt": "What tone should this take?", "type": "select", "options": ["Formal", "Casual", "Playful"], "required": true }\n]\n\`\`\`\n\nEmit the block and stop — the system will surface it to the user, collect answers, and resume you with their replies.\n---\n`;
const PERMISSION_BRIDGE_SERVER = "permissions";
const PERMISSION_BRIDGE_TOOL_NAME = "approval_prompt";
const PERMISSION_BRIDGE_TOOL_ID = `mcp__${PERMISSION_BRIDGE_SERVER}__${PERMISSION_BRIDGE_TOOL_NAME}`;
const PERMISSION_BRIDGE_RELATIVE_PATH = path.join(
  "command-centre",
  "scripts",
  "permission-prompt-mcp.cjs",
);

/**
 * Manages Claude CLI child processes for task execution.
 * Supports multi-turn conversations via --continue for follow-up replies.
 * Singleton -- one instance per server process.
 */
interface SessionEntry {
  proc: ChildProcess;
  /** Set when a question was detected during this turn — prevents handleComplete from finalising */
  pendingQuestion: boolean;
  /** Accumulated cost across multiple turns */
  totalCostUsd: number;
  totalTokensUsed: number;
  totalDurationMs: number;
  /** True when this turn was resumed from "review" status (for logging only — tasks always go through review) */
  resumedFromReview: boolean;
}

class ProcessManager {
  private sessions = new Map<string, SessionEntry>();
  private lastProgressEmit = new Map<string, number>();
  /** Track which tasks are waiting for user reply (process exited, awaiting --continue) */
  private waitingForReply = new Set<string>();
  /** Track tasks that have claimed execution before a live Claude session exists */
  private startingTasks = new Set<string>();

  constructor() {
    const cleanup = () => this.cleanup();
    process.on("exit", cleanup);
    process.on("SIGTERM", cleanup);
    process.on("SIGINT", cleanup);
  }

  /** Check if this task has an active in-memory session (managed by processManager) */
  hasActiveSession(taskId: string): boolean {
    return (
      this.sessions.has(taskId) ||
      this.waitingForReply.has(taskId) ||
      this.startingTasks.has(taskId)
    );
  }

  private resolvePermissionPromptScriptPath(agenticOsDir: string): string {
    const absolutePath = path.join(agenticOsDir, PERMISSION_BRIDGE_RELATIVE_PATH);
    if (!fs.existsSync(absolutePath)) {
      throw new Error(`Permission bridge script is missing at ${absolutePath}`);
    }
    return absolutePath;
  }

  private reportPermissionBridgeFailure(taskId: string, summary: string, detail?: string): void {
    const timestamp = new Date().toISOString();
    this.addLogEntry(taskId, {
      id: crypto.randomUUID(),
      type: "system",
      timestamp,
      content: detail ? `${summary} ${detail}` : summary,
    });
    this.handleTaskError(taskId, summary);
  }

  private classifyPermissionBridgeFailure(stderr: string): {
    summary: string;
    detail?: string;
  } | null {
    const normalizedStderr = stderr.trim();
    if (!normalizedStderr) {
      return null;
    }

    if (
      /permission-prompt-tool/i.test(normalizedStderr) &&
      /not found/i.test(normalizedStderr) &&
      (new RegExp(PERMISSION_BRIDGE_TOOL_ID, "i").test(normalizedStderr) ||
        new RegExp(PERMISSION_BRIDGE_TOOL_NAME, "i").test(normalizedStderr))
    ) {
      return {
        summary: "Ask mode permission bridge failed: Claude could not find the approval prompt tool.",
        detail: `Expected ${PERMISSION_BRIDGE_TOOL_ID} from the temporary ${PERMISSION_BRIDGE_SERVER} MCP server. This usually means the server stayed pending and never finished connecting.`,
      };
    }

    if (
      /(mcp|permission)/i.test(normalizedStderr) &&
      /(failed|error|unexpectedly|exited|spawn|startup|connect|handshake|stdio)/i.test(normalizedStderr)
    ) {
      return {
        summary: "Ask mode permission bridge failed: the temporary MCP server could not start.",
        detail: normalizedStderr.slice(0, 300),
      };
    }

    return null;
  }

  /**
   * Execute a task by spawning a Claude CLI session.
   */
  async executeTask(taskId: string): Promise<void> {
    console.log(`[process-manager] executeTask called for ${taskId}`);

    if (this.hasActiveSession(taskId)) {
      console.warn(`[process-manager] Task ${taskId} is already running, skipping`);
      return;
    }

    this.startingTasks.add(taskId);

    try {
      const db = getDb();
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;

      if (!task) {
        console.error(`[process-manager] Task ${taskId} not found in database`);
        return;
      }

      const now = new Date().toISOString();

      const claimed = db.prepare(
        "UPDATE tasks SET status = ?, startedAt = COALESCE(startedAt, ?), updatedAt = ?, activityLabel = ?, errorMessage = NULL, needsInput = 0 WHERE id = ? AND status = 'queued'"
      ).run("running", now, now, "Starting Claude session...", taskId);

      if (!claimed.changes) {
        console.warn(`[process-manager] Task ${taskId} is no longer queued, skipping duplicate start`);
        return;
      }

      // If this is a parent task that already has children (subtasks were created
      // at goal-entry time by scope-goal), don't execute the parent itself.
      // Just set it to "running" and let the auto-queue system manage children.
      if (!task.parentId && (task.level === "project" || task.level === "task")) {
        const childCount = db.prepare(
          "SELECT COUNT(*) as count FROM tasks WHERE parentId = ?"
        ).get(taskId) as { count: number };

        if (childCount.count > 0) {
          const backlogChildren = db.prepare(
            "SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog' ORDER BY columnOrder ASC"
          ).all(taskId) as Task[];

          // Queue the first child(ren)
          if (backlogChildren.length > 0) {
            const hasDeps = backlogChildren.some(c => {
              const match = c.description?.match(/\[depends_on:\s*([\d,\s]+)\]\s*$/);
              return match ? match[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)).length > 0 : false;
            });

            if (hasDeps) {
              // Queue all independent children (no dependencies)
              for (const child of backlogChildren) {
                const depMatch = child.description?.match(/\[depends_on:\s*([\d,\s]+)\]\s*$/);
                const deps = depMatch ? depMatch[1].split(",").map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) : [];
                if (deps.length === 0) {
                  db.prepare("UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?").run(now, child.id);
                  const updatedChild = db.prepare("SELECT * FROM tasks WHERE id = ?").get(child.id) as Task;
                  emitTaskEvent({ type: "task:status", task: { ...updatedChild, needsInput: Boolean(updatedChild.needsInput) }, timestamp: now });
                }
              }
            } else {
              // Sequential: queue first child only
              const first = backlogChildren[0];
              db.prepare("UPDATE tasks SET status = 'queued', updatedAt = ? WHERE id = ?").run(now, first.id);
              const updatedFirst = db.prepare("SELECT * FROM tasks WHERE id = ?").get(first.id) as Task;
              emitTaskEvent({ type: "task:status", task: { ...updatedFirst, needsInput: Boolean(updatedFirst.needsInput) }, timestamp: now });
            }
          }

          // Set parent to "running" as a container
          db.prepare(
            "UPDATE tasks SET status = 'running', startedAt = ?, updatedAt = ?, activityLabel = ? WHERE id = ?"
          ).run(now, now, `0/${childCount.count} subtasks done — first task queued`, taskId);
          const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
          emitTaskEvent({ type: "task:status", task: { ...updatedParent, needsInput: Boolean(updatedParent.needsInput) }, timestamp: now });

          console.log(`[process-manager] Task ${taskId} has ${childCount.count} children — running as container, not executing`);
          return;
        }
      }

      // Clear stale log entries from previous runs
      db.prepare("DELETE FROM task_logs WHERE taskId = ?").run(taskId);
      // Clear stale output files from previous runs
      db.prepare("DELETE FROM task_outputs WHERE taskId = ?").run(taskId);

      // Log the user's original goal as the first chat entry.
      // Use the task description (the full goal text) or fall back to the title.
      // This ensures the chat shows what the user typed, not the system prompt.
      const userGoalText = task.description || task.title;
      this.addLogEntry(taskId, {
        id: crypto.randomUUID(),
        type: "user_reply",
        timestamp: now,
        content: userGoalText,
        permissionMode: task.permissionMode || undefined,
      });

      const updatedTask = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedTask), timestamp: now });

      // Start file watcher scoped to this task's project
      try {
        await fileWatcher.startWatching(taskId, task.projectSlug, task.clientId);
      } catch (err) {
        console.error(`[process-manager] fileWatcher.startWatching failed:`, err);
      }

      // Capture baseline snapshot for diff-aware Files tab
      try {
        const fsSnap = require("fs") as typeof import("fs");
        const pathSnap = require("path") as typeof import("path");
        const { captureSnapshot } = require("./file-diff") as typeof import("./file-diff");
        const snapConfig = getConfig();
        const snapCwd = task.clientId ? getClientAiOsDir(task.clientId) : snapConfig.agenticOsDir;
        if (task.projectSlug) {
          const projDir = pathSnap.join(snapCwd, "projects", "briefs", task.projectSlug);
          if (fsSnap.existsSync(projDir)) {
            const snapshot = captureSnapshot(projDir);
            db.prepare("UPDATE tasks SET startSnapshot = ? WHERE id = ?").run(JSON.stringify(snapshot), taskId);
          }
        }
      } catch (err) {
        console.error(`[process-manager] snapshot capture failed:`, err);
      }

      // Build the initial prompt
      const config = getConfig();
      const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.agenticOsDir;

      if (task.clientId) {
        const fs = await import("fs");
        if (!fs.existsSync(cwd)) {
          this.handleTaskError(taskId, `Client directory not found: clients/${task.clientId}`);
          return;
        }
      }

      // Detect available context sources in the working directory
      const fs = require("fs") as typeof import("fs");
      const pathMod = require("path") as typeof import("path");
      const contextSources: { type: string; label: string; path?: string }[] = [];

      // Check for shared instruction files in the working directory
      const agentsMdPath = pathMod.join(cwd, "AGENTS.md");
      if (fs.existsSync(agentsMdPath)) {
        contextSources.push({ type: "system", label: "AGENTS.md", path: "AGENTS.md" });
      }

      // Check for CLAUDE.md (loaded by Claude CLI and used as the compatibility wrapper)
      const claudeMdPath = pathMod.join(cwd, "CLAUDE.md");
      if (fs.existsSync(claudeMdPath)) {
        contextSources.push({ type: "system", label: "CLAUDE.md", path: "CLAUDE.md" });
      }

      // Check for SOUL.md and USER.md
      for (const contextFile of ["SOUL.md", "USER.md", "learnings.md"]) {
        const filePath = pathMod.join(cwd, "context", contextFile);
        if (fs.existsSync(filePath)) {
          contextSources.push({ type: "system", label: contextFile, path: `context/${contextFile}` });
        }
      }

      // Check for brand context files
      const brandDir = pathMod.join(cwd, "brand_context");
      if (fs.existsSync(brandDir)) {
        try {
          const brandFiles = fs.readdirSync(brandDir).filter((f: string) => f.endsWith(".md"));
          for (const bf of brandFiles) {
            const fullPath = pathMod.join(brandDir, bf);
            const stat = fs.statSync(fullPath);
            if (stat.size > 0) {
              contextSources.push({ type: "brand", label: bf, path: `brand_context/${bf}` });
            }
          }
        } catch { /* ignore */ }
      }

      // Build prompt — detect special task types first
      let prompt = "";
      const isSlashCommand = task.description?.match(/^Run \/[\w:.-]+/);
      const taskRow = db.prepare("SELECT gsdStep, phaseNumber FROM tasks WHERE id = ?").get(taskId) as { gsdStep: string | null; phaseNumber: number | null } | undefined;
      const gsdStep = taskRow?.gsdStep;
      const gsdPhaseNumber = taskRow?.phaseNumber;
      const isTopLevelParent = !task.parentId;


      if (isSlashCommand) {
        // Slash command task — pass the description as-is (e.g. "Run /onboarding", "Run /gsd-plan-phase 6")
        prompt = task.description!;
      } else if (gsdStep) {
        // Target the explicit phase number the user clicked so each GSD step
        // button ends up running the right command (e.g. /gsd-plan-phase 3)
        // instead of the ambiguous "current phase".
        const phaseArg = gsdPhaseNumber != null ? ` ${gsdPhaseNumber}` : "";
        const gsdPrompts: Record<string, string> = {
          discuss: `Run /gsd-discuss-phase${phaseArg}. Ask the user interactive questions — do NOT use --auto. Wait for their replies.`,
          plan: `Run /gsd-plan-phase${phaseArg}.`,
          execute: `Run /gsd-execute-phase${phaseArg}.`,
          verify: `Run /gsd-verify-work${phaseArg}.`,
        };
        prompt = gsdPrompts[gsdStep] || task.title;
      } else if (task.level === "project" && isTopLevelParent) {
        // Project scoping — interactive conversation with brand context
        prompt = this.buildProjectScopingPrompt(task, cwd);
      } else if (task.level === "gsd" && isTopLevelParent) {
        // GSD project — run /gsd-new-project which handles interviews, research, and roadmap creation
        prompt = `Run /gsd-new-project "${task.title}"${task.description ? `\n\nContext from user: ${task.description}` : ""}`;
      } else {
        if (task.projectSlug) {
          const briefPath = pathMod.join(cwd, "projects", "briefs", task.projectSlug, "brief.md");
          try {
            if (fs.existsSync(briefPath)) {
              const briefContent = fs.readFileSync(briefPath, "utf-8");
              prompt += `[Project Context: ${task.projectSlug}]\n${briefContent}\n\n---\n\n`;
              contextSources.push({ type: "project", label: `brief.md (${task.projectSlug})`, path: `projects/briefs/${task.projectSlug}/brief.md` });
            }
          } catch { /* proceed without context */ }
        }
        // Sibling context — only for GSD/phase subtasks so they know what
        // siblings have done. Ad-hoc pane chats (no gsdStep, no phaseNumber)
        // are independent conversations and should not see sibling context.
        if (gsdStep || gsdPhaseNumber != null) {
          try {
            const siblingBlock = buildSiblingContextBlock(task);
            if (siblingBlock) {
              prompt += `${siblingBlock}\n\n---\n\n`;
              contextSources.push({ type: "system", label: "Sibling task context" });
            }
          } catch (err) {
            console.error("[process-manager] buildSiblingContextBlock failed:", err);
          }
        }
        prompt += task.description ? `Task: ${task.title}\n\n${task.description}` : task.title;

        // Plan mode is read-only. Claude should prepare the exact brief content
        // and ask for approval before any project files are changed.
        if (task.permissionMode === "plan" && task.projectSlug) {
          prompt += `\n\n---\n\n[Plan Mode] You are running in read-only plan mode.\n1. Do NOT edit any files yet.\n2. Research and prepare the exact markdown that should be saved to projects/briefs/${task.projectSlug}/brief.md.\n3. Present a short planning summary in normal prose.\n4. Then emit a fenced code block tagged \`approved-brief\` containing ONLY the markdown that should be saved to brief.md. If you need code examples inside that block, use \`~~~\` fences or indented code blocks instead of nested triple backticks when possible.\n5. Then emit a fenced \`ask-user-questions\` block with exactly one select question using this shape:\n\`\`\`ask-user-questions\n[\n  {\n    "id": "plan_action",\n    "prompt": "The plan is ready. What should I do next?",\n    "type": "select",\n    "options": ["Approve and start", "Ask for changes", "Cancel"],\n    "required": true,\n    "intent": "plan_approval",\n    "metadata": { "briefFile": "projects/briefs/${task.projectSlug}/brief.md" }\n  }\n]\n\`\`\`\n6. After emitting those blocks, stop and wait. Do not execute anything until the user approves.\n---`;
        }
      }

      // Inject session activity summary for wrap-up and session-aware tasks.
      // Skip when resuming a parent session — that session already has today's
      // context in its own memory and doesn't need a cross-task summary.
      const needsSessionContext = this.isSessionContextTask(task);
      console.log(`[process-manager] Session context check for "${task.title}" (desc: "${task.description?.slice(0, 50)}"): ${needsSessionContext}`);
      if (needsSessionContext) {
        const sessionSummary = this.buildSessionSummary(cwd, taskId);
        console.log(`[process-manager] Session summary length: ${sessionSummary.length} chars`);
        prompt = `IMPORTANT: The following session activity summary contains the complete record of what was done today across ALL tasks in the Command Centre. Use this as your primary source of truth for the session wrap-up — do NOT rely solely on git status or your own conversation history, as you are running in a fresh context window without visibility into other task conversations.\n\n${sessionSummary}\nNow proceed with the task:\n\n${prompt}`;
        contextSources.push({ type: "system", label: "Session Activity Summary" });
      }

      // Inject the session snapshot via --append-system-prompt so it lands in
      // the system prompt, not the user turn. Prepending to -p broke Claude CLI
      // because the snapshot starts with "--- SESSION SNAPSHOT ---" and the CLI
      // interprets leading "---" as an unknown option flag.
      const snapshot = this.readSessionSnapshot(cwd);
      let snapshotContent = "";
      if (snapshot.content) {
        snapshotContent = snapshot.content;
        for (const label of snapshot.loaded) {
          contextSources.push({ type: "system", label });
        }
      }

      // Persist context sources to DB and log what was loaded
      if (contextSources.length > 0) {
        db.prepare("UPDATE tasks SET contextSources = ? WHERE id = ?")
          .run(JSON.stringify(contextSources), taskId);

        // Add a visible log entry showing what context was injected
        const contextLabels = contextSources.map((s) => s.label).join(", ");
        this.addLogEntry(taskId, {
          id: crypto.randomUUID(),
          type: "system",
          timestamp: new Date().toISOString(),
          content: `Context loaded: ${contextLabels}`,
        });
      }

      // Expand @tag references in the prompt against context/prompt-tags.md
      try {
        const { expandPromptTags } = require("./prompt-tags") as typeof import("./prompt-tags");
        prompt = expandPromptTags(prompt, task.clientId);
      } catch (err) {
        console.error(`[process-manager] prompt tag expansion failed:`, err);
      }

      // Append the structured-question addendum so Claude emits typed
      // clarifying questions as fenced blocks instead of prose.
      prompt = prompt + STRUCTURED_QUESTION_ADDENDUM;

      // Spawn the turn. When resuming a parent-owned session, flag
      // Every task starts fresh — no parent session continuation.
      this.spawnClaudeTurn(taskId, prompt, cwd, false, false, snapshotContent);
    } finally {
      this.startingTasks.delete(taskId);
    }
  }

  /**
   * Reply to a task that's waiting for user input.
   * Spawns a new Claude process with --continue to continue the conversation.
   *
   * Handles two states:
   * 1. Process already exited → task is in waitingForReply set
   * 2. Process still running but question detected → session.pendingQuestion is true
   *    (race condition: UI shows reply input before process exits)
   */
  async replyToTask(taskId: string, message: string): Promise<boolean> {
    const session = this.sessions.get(taskId);
    const isWaiting = this.waitingForReply.has(taskId);
    const isPendingQuestion = session?.pendingQuestion === true;

    console.log(`[process-manager] replyToTask(${taskId.slice(0, 8)}): isWaiting=${isWaiting}, hasSession=${!!session}, pendingQuestion=${isPendingQuestion}, sessionCount=${this.sessions.size}, waitingCount=${this.waitingForReply.size}`);
    console.log(`[process-manager] replyToTask sessions:`, [...this.sessions.keys()].map(k => k.slice(0, 8)));
    console.log(`[process-manager] replyToTask waitingForReply:`, [...this.waitingForReply].map(k => k.slice(0, 8)));

    // Also check if the DB says needsInput — if so, trust the DB over in-memory state
    // (handles HMR or other edge cases where in-memory state was lost)
    if (!isWaiting && !isPendingQuestion) {
      const db = getDb();
      const dbTask = db.prepare("SELECT needsInput FROM tasks WHERE id = ?").get(taskId) as { needsInput: number } | undefined;
      const dbNeedsInput = dbTask?.needsInput === 1;
      console.log(`[process-manager] In-memory state empty — DB needsInput=${dbNeedsInput}`);

      if (!dbNeedsInput) {
        console.warn(`[process-manager] Task ${taskId} is not waiting for a reply (both in-memory and DB)`);
        return false;
      }

      // DB says needsInput but in-memory state is gone — proceed anyway
      console.log(`[process-manager] DB says needsInput=true, proceeding with reply despite empty in-memory state`);
    }

    // If the process is still running (user replied before process exited),
    // kill it — we'll spawn a new --continue process
    if (session) {
      console.log(`[process-manager] Killing running process tree for ${taskId} before reply`);
      killChildProcessTree(session.proc);
      this.sessions.delete(taskId);
    }

    // The reply route already persisted the log entry and updated the DB.
    // Just kill any running process and spawn the resume turn.
    this.waitingForReply.delete(taskId);

    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
    if (!task) return false;

    const config = getConfig();
    const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.agenticOsDir;

    // Track whether this reply came from a review/done state (for logging only)
    const wasInReview = task.status === "review" || task.status === "done";
    this.spawnClaudeTurn(taskId, message, cwd, true, wasInReview);

    return true;
  }

  /**
   * Cancel a running or waiting task.
   */
  async cancelTask(taskId: string): Promise<void> {
    await this.killSession(taskId);

    const db = getDb();
    const now = new Date().toISOString();
    db.prepare(
      "UPDATE tasks SET status = ?, updatedAt = ?, activityLabel = ?, costUsd = NULL, tokensUsed = NULL, durationMs = NULL, errorMessage = NULL, startedAt = NULL, completedAt = NULL, needsInput = 0 WHERE id = ?"
    ).run("review", now, "Cancelled — re-queue or delete", taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
  }

  /**
   * Kill the process and clean up session state without touching the DB or
   * emitting SSE events. Used by the PATCH handler when the caller manages
   * the final DB state (e.g. marking done).
   */
  async killSession(taskId: string): Promise<void> {
    const session = this.sessions.get(taskId);
    if (session) {
      killChildProcessTree(session.proc);
      const killTimer = setTimeout(() => {
        killChildProcessTree(session.proc, "SIGKILL");
      }, 5000);
      session.proc.on("close", () => clearTimeout(killTimer));
      this.sessions.delete(taskId);
    }

    this.waitingForReply.delete(taskId);
    this.lastProgressEmit.delete(taskId);

    await fileWatcher.stopWatching(taskId);
  }

  // ── Prompt builders for interactive scoping ─────────────────────

  /**
   * Read brand_context/ and context/ files from the working directory.
   * Returns a formatted string block to prepend to prompts.
   */
  private readBrandContext(cwd: string): string {
    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const sections: string[] = [];

    // Brand context files
    const brandDir = pathMod.join(cwd, "brand_context");
    if (fs.existsSync(brandDir)) {
      const brandFiles = ["voice-profile.md", "positioning.md", "icp.md", "samples.md", "assets.md"];
      for (const file of brandFiles) {
        const filePath = pathMod.join(brandDir, file);
        try {
          if (fs.existsSync(filePath)) {
            const content = fs.readFileSync(filePath, "utf-8").trim();
            if (content.length > 0) {
              sections.push(`[${file}]\n${content}`);
            }
          }
        } catch { /* skip */ }
      }
      // Also pick up any other .md files in brand_context/
      try {
        const allFiles = fs.readdirSync(brandDir).filter((f: string) => f.endsWith(".md"));
        for (const f of allFiles) {
          if (brandFiles.includes(f)) continue; // already handled
          const filePath = pathMod.join(brandDir, f);
          const stat = fs.statSync(filePath);
          if (stat.size > 0) {
            const content = fs.readFileSync(filePath, "utf-8").trim();
            sections.push(`[${f}]\n${content}`);
          }
        }
      } catch { /* skip */ }
    }

    // USER.md for preferences
    const userMdPath = pathMod.join(cwd, "context", "USER.md");
    try {
      if (fs.existsSync(userMdPath)) {
        const content = fs.readFileSync(userMdPath, "utf-8").trim();
        if (content.length > 0) {
          sections.push(`[USER.md]\n${content}`);
        }
      }
    } catch { /* skip */ }

    if (sections.length === 0) return "";
    return `\n\n--- BRAND & USER CONTEXT ---\n${sections.join("\n\n")}\n--- END CONTEXT ---\n`;
  }

  /**
   * Read the session snapshot — agent identity, user preferences, working
   * memory, and today's daily log. Prepended to every task prompt so the
   * command-centre's spawned -p sessions have the same baseline context as
   * a fresh Claude Code CLI session would have via .claude/hooks/load-memory-snapshot.js.
   *
   * Loads (when present):
   *   - context/SOUL.md            (agent identity)
   *   - context/USER.md            (user profile)
   *   - context/MEMORY.md          (curated working scratchpad — frozen snapshot)
   *   - context/memory/{today}.md  (today's daily log, with yesterday as fallback)
   *
   * Does NOT load context/learnings.md — that file is lazy-loaded per skill
   * by design (see AGENTS.md "Memory System").
   */
  private readSessionSnapshot(cwd: string): { content: string; loaded: string[] } {
    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const sections: string[] = [];
    const loaded: string[] = [];

    const tryLoad = (relPath: string, label: string): void => {
      const abs = pathMod.join(cwd, relPath);
      try {
        if (!fs.existsSync(abs)) return;
        const content = fs.readFileSync(abs, "utf-8").trim();
        if (content.length === 0) return;
        sections.push(`[${label}]\n${content}`);
        loaded.push(label);
      } catch { /* skip */ }
    };

    tryLoad("context/SOUL.md", "SOUL.md");
    tryLoad("context/USER.md", "USER.md");
    tryLoad("context/MEMORY.md", "MEMORY.md");

    const dateStr = (d: Date): string => {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2, "0");
      const dd = String(d.getDate()).padStart(2, "0");
      return `${yyyy}-${mm}-${dd}`;
    };
    const today = dateStr(new Date());
    const yesterday = dateStr(new Date(Date.now() - 86400000));
    const todayLogRel = `context/memory/${today}.md`;
    const yesterdayLogRel = `context/memory/${yesterday}.md`;
    if (fs.existsSync(pathMod.join(cwd, todayLogRel))) {
      tryLoad(todayLogRel, `memory/${today}.md (today)`);
    } else {
      tryLoad(yesterdayLogRel, `memory/${yesterday}.md (yesterday — no session today yet)`);
    }

    if (sections.length === 0) return { content: "", loaded: [] };
    const content =
      `--- SESSION SNAPSHOT ---\n` +
      `The following files were auto-loaded so this task starts with the same baseline ` +
      `context that a fresh Claude Code CLI session would have. Mid-session writes to ` +
      `context/MEMORY.md persist to disk but only take effect on the next task.\n\n` +
      sections.join("\n\n") +
      `\n--- END SNAPSHOT ---`;
    return { content, loaded };
  }

  private buildProjectScopingPrompt(task: Task, cwd: string): string {
    const userContext = task.description ? `\n\nThe user's goal: ${task.description}` : "";
    const brandContext = this.readBrandContext(cwd);
    const slug = this.slugify(task.title);
    const briefPath = `projects/briefs/${slug}/brief.md`;

    return `You are scoping a Level 2 planned project. Your job is to create the project brief and deliverables immediately, then ask for adjustments.
${brandContext}
Project: "${task.title}"${userContext}

IMPORTANT INSTRUCTIONS:
1. You are running in -p mode. Each message you produce will be your COMPLETE turn. The user will reply, and you'll be resumed with --resume.

2. Your FIRST turn — do ALL of this:
   a. Use the brand context and goal above to infer what the user needs. Don't ask questions first — make your best judgement call based on what you know.
   b. Save the brief to ${briefPath} with this format:
      ---
      project: ${slug}
      status: active
      level: 2
      created: ${new Date().toISOString().split("T")[0]}
      ---

      # {Project Title}

      ## Goal
      {One clear sentence describing what this project delivers}

      ## Deliverables
      - [ ] **{Deliverable 1}** — {what it is and acceptance criteria}
      - [ ] **{Deliverable 2}** — {what it is and acceptance criteria}
      {etc — one per major deliverable, not every granular step}

      ## Acceptance Criteria
      {How the user will know the project is done — bullet points}

      ## Constraints
      {Any timeline, format, or technical constraints — or "None specified"}

   c. Output subtasks (one per deliverable from the brief):
      \`\`\`subtasks
      [
        {"title": "Deliverable name", "description": "What this deliverable involves and its acceptance criteria"}
      ]
      \`\`\`

   d. End with a summary of what you planned and ask: "Want to adjust anything before I start working through these?"

3. On SUBSEQUENT turns: The user may want to adjust deliverables, add constraints, or refine scope. Update the brief file and subtasks accordingly. If the user says it looks good, confirm and end.

4. LIVE SUBTASK MANAGEMENT: As the project conversation progresses, the subtask list on the UI is the user's source of truth for "what's left". You can mutate it during any turn:
   - To ADD a new subtask mid-project, emit another \`\`\`subtasks\`\`\` JSON block. Existing titles are preserved; only new titles get appended.
   - To MARK one or more existing subtasks as done (without rewriting the whole list), emit a \`\`\`subtasks_done\`\`\` block:
     \`\`\`subtasks_done
     ["Exact title of subtask A", "Exact title of subtask B"]
     \`\`\`
   - Match done-titles exactly as they appear in the current list (case is ignored). Use this whenever you complete a deliverable so the user can see progress.

CRITICAL: Every turn MUST end with a question mark (?). This is how the system detects that you need user input.
Keep subtasks high-level — one per major deliverable, not every granular step.`;
  }

  private slugify(text: string): string {
    return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  /**
   * Build a session activity summary for context-aware tasks (e.g. wrap-up).
   * Pulls from: today's tasks in DB, task logs, git history, and memory file.
   */
  private buildSessionSummary(cwd: string, currentTaskId: string): string {
    const db = getDb();
    const fs = require("fs") as typeof import("fs");
    const pathMod = require("path") as typeof import("path");
    const { execSync } = require("child_process") as typeof import("child_process");

    const todayStr = new Date().toISOString().slice(0, 10);
    const parts: string[] = ["[Session Activity Summary]", ""];

    // 1. Today's tasks from DB (exclude the current wrap-up task)
    const todayTasks = db.prepare(
      `SELECT id, title, status, level, costUsd, tokensUsed, durationMs, startedAt, completedAt, projectSlug
       FROM tasks
       WHERE date(createdAt) = ? AND id != ?
       ORDER BY createdAt ASC`
    ).all(todayStr, currentTaskId) as Array<{
      id: string; title: string; status: string; level: string;
      costUsd: number | null; tokensUsed: number | null; durationMs: number | null;
      startedAt: string | null; completedAt: string | null; projectSlug: string | null;
    }>;

    // Also include tasks from earlier that were active today
    const activeTodayTasks = db.prepare(
      `SELECT id, title, status, level, costUsd, tokensUsed, durationMs, startedAt, completedAt, projectSlug
       FROM tasks
       WHERE date(createdAt) < ? AND id != ?
         AND (date(startedAt) = ? OR date(completedAt) = ? OR date(updatedAt) = ?)
       ORDER BY updatedAt ASC`
    ).all(todayStr, currentTaskId, todayStr, todayStr, todayStr) as typeof todayTasks;

    const allTasks = [...activeTodayTasks, ...todayTasks];

    if (allTasks.length > 0) {
      parts.push("## Tasks Today", "");
      for (const t of allTasks) {
        const cost = t.costUsd ? ` ($${t.costUsd.toFixed(2)})` : "";
        const project = t.projectSlug ? ` [${t.projectSlug}]` : "";
        parts.push(`- **${t.title}**${project} — ${t.status}${cost}`);

        // Get skills invoked by this task
        const skillMentions = db.prepare(
          `SELECT content FROM task_logs
           WHERE taskId = ? AND type = 'text'
             AND (content LIKE '%/mkt-%' OR content LIKE '%/str-%' OR content LIKE '%/viz-%'
               OR content LIKE '%/ops-%' OR content LIKE '%/tool-%' OR content LIKE '%/meta-%'
               OR content LIKE '%Running skill%' OR content LIKE '%Invoking skill%'
               OR content LIKE '%skill:%')
           LIMIT 5`
        ).all(t.id) as Array<{ content: string }>;

        const skills = new Set<string>();
        for (const s of skillMentions) {
          const matches = s.content.match(/\/(mkt|str|viz|ops|tool|meta)-[\w-]+/g);
          if (matches) matches.forEach((m) => skills.add(m));
        }
        // Also check the task description for skill references
        if (t.title) {
          const titleMatches = t.title.match(/\/(mkt|str|viz|ops|tool|meta)-[\w-]+/g);
          if (titleMatches) titleMatches.forEach((m) => skills.add(m));
        }
        if (skills.size > 0) {
          parts.push(`  Skills: ${[...skills].join(", ")}`);
        }

        // Get condensed activity: text entries and questions
        const logs = db.prepare(
          `SELECT type, content, timestamp FROM task_logs
           WHERE taskId = ? AND type IN ('text', 'question', 'user_reply')
           ORDER BY timestamp ASC`
        ).all(t.id) as Array<{ type: string; content: string; timestamp: string }>;

        if (logs.length > 0) {
          const keyLogs = logs.filter((l) =>
            l.type === "question" || l.type === "user_reply" || l.content.length > 50
          );
          const condensed = keyLogs.slice(-6);
          for (const log of condensed) {
            const prefix = log.type === "question" ? "  Claude asked" : log.type === "user_reply" ? "  User replied" : "  Claude";
            const content = log.content.length > 200 ? log.content.slice(0, 200) + "…" : log.content;
            parts.push(`${prefix}: ${content}`);
          }
        }

        // Get output files
        const outputs = db.prepare(
          `SELECT fileName FROM task_outputs WHERE taskId = ?`
        ).all(t.id) as Array<{ fileName: string }>;
        if (outputs.length > 0) {
          parts.push(`  Outputs: ${outputs.map((o) => o.fileName).join(", ")}`);
        }
        parts.push("");
      }
    }

    // 2. Git history — commits from today
    try {
      const gitLog = execSync(
        `git log --since="today 00:00" --format="%h %s" --no-merges 2>/dev/null`,
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (gitLog) {
        parts.push("## Git Commits Today", "", gitLog, "");
      }
    } catch { /* no git or no commits */ }

    // 3. Unstaged changes summary
    try {
      const gitDiffStat = execSync(
        `git diff --stat HEAD 2>/dev/null`,
        { cwd, encoding: "utf-8", timeout: 5000 }
      ).trim();
      if (gitDiffStat) {
        parts.push("## Uncommitted Changes", "", gitDiffStat, "");
      }
    } catch { /* ignore */ }

    // 4. Today's memory file
    const memoryPath = pathMod.join(cwd, "context", "memory", `${todayStr}.md`);
    try {
      if (fs.existsSync(memoryPath)) {
        const memoryContent = fs.readFileSync(memoryPath, "utf-8").trim();
        if (memoryContent.length > 0) {
          parts.push("## Today's Memory File", "", memoryContent, "");
        }
      }
    } catch { /* ignore */ }

    parts.push("---", "");
    return parts.join("\n");
  }

  /**
   * Check if a task needs session context injected into its prompt.
   */
  private isSessionContextTask(task: Task): boolean {
    const title = (task.title || "").toLowerCase();
    const desc = (task.description || "").toLowerCase();
    return (
      title.includes("wrap") ||
      title.includes("session") ||
      desc.includes("/wrap-up") ||
      desc.includes("meta-wrap-up") ||
      desc.includes("/gsd-session-report") ||
      desc.includes("session summary") ||
      desc.includes("what did we do") ||
      desc.includes("what have we done")
    );
  }

  // ── GSD phase sync (reads .planning/ROADMAP.md) ────────────────

  private async autoSyncPhases(parentTaskId: string): Promise<void> {
    try {
      console.log(`[process-manager] Auto-syncing GSD phases for ${parentTaskId.slice(0, 8)}`);
      const res = await fetch(`http://localhost:${process.env.PORT || 3000}/api/tasks/${parentTaskId}/sync-phases`, {
        method: "POST",
      });
      if (res.ok) {
        const data = await res.json();
        console.log(`[process-manager] Synced ${data.created} phase tasks (${data.phases} phases)`);
      } else {
        console.warn(`[process-manager] Phase sync failed: ${res.status}`);
      }
    } catch (err) {
      console.error(`[process-manager] Phase sync error:`, err);
    }
  }

  // ── Auto-queue next sibling when a child completes ──────────────────

  private autoQueueNextSibling(completedChild: Task): void {
    if (!completedChild.parentId) return;

    const db = getDb();
    const now = new Date().toISOString();

    // Find the next backlog sibling (by columnOrder)
    const nextSibling = db.prepare(
      `SELECT * FROM tasks WHERE parentId = ? AND status = 'backlog' ORDER BY columnOrder ASC LIMIT 1`
    ).get(completedChild.parentId) as Task | undefined;

    if (!nextSibling) {
      // No more siblings to queue — check if all are done
      const remaining = db.prepare(
        `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status != 'done'`
      ).get(completedChild.parentId) as { count: number };

      if (remaining.count === 0) {
        // All subtasks complete — move parent to review
        db.prepare(
          "UPDATE tasks SET status = 'review', updatedAt = ?, activityLabel = NULL, needsInput = 0 WHERE id = ?"
        ).run(now, completedChild.parentId);

        const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
        emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedParent), timestamp: now });
        console.log(`[process-manager] All subtasks done — parent ${completedChild.parentId.slice(0, 8)} moved to review`);
      }
      return;
    }

    // Queue the next sibling — it will need user go-ahead to start
    db.prepare(
      "UPDATE tasks SET status = 'review', updatedAt = ?, needsInput = 1, activityLabel = ? WHERE id = ?"
    ).run(now, "Ready to start — waiting for go-ahead", nextSibling.id);

    const updatedSibling = db.prepare("SELECT * FROM tasks WHERE id = ?").get(nextSibling.id) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedSibling), timestamp: now });

    // Keep parent in "in progress" — update its activity
    const completedCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ? AND status = 'done'`
    ).get(completedChild.parentId) as { count: number };
    const totalCount = db.prepare(
      `SELECT COUNT(*) as count FROM tasks WHERE parentId = ?`
    ).get(completedChild.parentId) as { count: number };

    db.prepare(
      "UPDATE tasks SET status = 'running', updatedAt = ?, activityLabel = ? WHERE id = ?"
    ).run(now, `${completedCount.count}/${totalCount.count} tasks done — next task queued`, completedChild.parentId);

    const updatedParent = db.prepare("SELECT * FROM tasks WHERE id = ?").get(completedChild.parentId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updatedParent), timestamp: now });

    console.log(`[process-manager] Auto-queued next sibling ${nextSibling.id.slice(0, 8)} "${nextSibling.title}" — ${completedCount.count}/${totalCount.count} done`);
  }

  // ── Subtask extraction from structured output ──────────────────

  private extractAndCreateSubtasks(parentTaskId: string, parentTask: Task): void {
    const db = getDb();
    const now = new Date().toISOString();

    // Scan log entries for ```subtasks JSON block
    const logs = db.prepare(
      "SELECT content FROM task_logs WHERE taskId = ? AND type = 'text' ORDER BY rowid DESC LIMIT 10"
    ).all(parentTaskId) as Array<{ content: string }>;

    let subtaskJson: string | null = null;
    for (const log of logs) {
      const match = log.content.match(/```subtasks\s*\n([\s\S]*?)```/);
      if (match) {
        subtaskJson = match[1].trim();
        break;
      }
    }

    // Also look for a ```subtasks_done``` block listing titles Claude has
    // marked complete during this turn. This lets the model tick off work
    // as the conversation progresses, without re-emitting the whole list.
    let doneTitles: string[] = [];
    for (const log of logs) {
      const match = log.content.match(/```subtasks_done\s*\n([\s\S]*?)```/);
      if (match) {
        try {
          const parsed = JSON.parse(match[1].trim());
          if (Array.isArray(parsed)) {
            doneTitles = parsed
              .filter((v): v is string => typeof v === "string")
              .map((s) => s.trim().toLowerCase())
              .filter(Boolean);
          }
        } catch { /* ignore malformed */ }
        break;
      }
    }

    // Apply done-marks to existing children by title (case-insensitive).
    if (doneTitles.length > 0) {
      const existingChildren = db.prepare(
        "SELECT id, title, status FROM tasks WHERE parentId = ?"
      ).all(parentTaskId) as Array<{ id: string; title: string; status: string }>;
      for (const child of existingChildren) {
        if (child.status === "done") continue;
        if (doneTitles.includes(child.title.trim().toLowerCase())) {
          db.prepare(
            "UPDATE tasks SET status = 'done', completedAt = ?, updatedAt = ?, needsInput = 0 WHERE id = ?"
          ).run(now, now, child.id);
        }
      }
    }

    let subtasks: Array<{ title: string; description?: string; phaseNumber?: number; gsdStep?: string; status?: string }>;

    if (subtaskJson) {
      try {
        subtasks = JSON.parse(subtaskJson);
        if (!Array.isArray(subtasks) || subtasks.length === 0) subtasks = [];
      } catch (err) {
        console.error(`[process-manager] Failed to parse subtask JSON for ${parentTaskId.slice(0, 8)}:`, err);
        subtasks = [];
      }
    } else {
      subtasks = [];
    }

    // Fallback: parse deliverables from brief.md if no subtasks block found
    if (subtasks.length === 0 && parentTask.projectSlug) {
      const fs = require("fs") as typeof import("fs");
      const pathMod = require("path") as typeof import("path");
      const baseDir = getConfig().agenticOsDir;
      const briefPath = pathMod.join(baseDir, "projects", "briefs", parentTask.projectSlug, "brief.md");
      if (fs.existsSync(briefPath)) {
        const briefContent = fs.readFileSync(briefPath, "utf-8");
        const delMatch = briefContent.match(/## Deliverables\s*\n([\s\S]*?)(?=\n## |\n---|\s*$)/);
        if (delMatch) {
          const lines = delMatch[1].split("\n");
          for (const line of lines) {
            const item = line.match(/^-\s*\[[ x]\]\s*\**(.+?)\**\s*(?:—\s*(.*))?$/);
            if (item) {
              subtasks.push({
                title: item[1].trim(),
                description: item[2]?.trim() || null as unknown as string,
              });
            }
          }
        }
        if (subtasks.length > 0) {
          console.log(`[process-manager] Parsed ${subtasks.length} deliverables from brief.md for ${parentTaskId.slice(0, 8)}`);
        }
      }
    }

    if (subtasks.length === 0) {
      console.log(`[process-manager] No subtasks found for ${parentTaskId.slice(0, 8)}`);
      return;
    }

    // Load existing children so we can append only NEW subtasks instead of
    // blanket-skipping when any child already exists. This lets Claude add
    // higher-level subtasks as the project conversation progresses.
    const existingChildren = db.prepare(
      "SELECT id, title, status FROM tasks WHERE parentId = ?"
    ).all(parentTaskId) as Array<{ id: string; title: string; status: string }>;
    const existingTitles = new Set(
      existingChildren.map((c) => c.title.trim().toLowerCase())
    );

    // Drop garbage + dedupe within this payload. Claude occasionally parrots
    // the "[Project Context: <slug>]" prompt prefix back into the subtasks
    // block, and sometimes emits the same title twice. Both bugs surface as
    // a flood of duplicate subtasks in the feed.
    const seenTitles = new Set<string>();
    subtasks = subtasks.filter((sub) => {
      if (!sub || typeof sub.title !== "string") return false;
      const title = sub.title.trim();
      if (!title) return false;
      if (title.startsWith("[Project Context:")) return false;
      if (seenTitles.has(title)) return false;
      seenTitles.add(title);
      return true;
    });

    if (subtasks.length === 0) {
      console.log(`[process-manager] All subtasks filtered out as garbage for ${parentTaskId.slice(0, 8)}`);
      return;
    }

    // Skip ones that already exist (case-insensitive title match). Anything
    // new gets appended after the existing set. Also honour an explicit
    // status: "done" field on each subtask for live tick-offs.
    const newSubtasks = subtasks.filter((sub) => {
      const key = sub.title.trim().toLowerCase();
      if (existingTitles.has(key)) {
        // Existing subtask — update status if Claude marked it done.
        if (sub.status === "done") {
          const match = existingChildren.find(
            (c) => c.title.trim().toLowerCase() === key
          );
          if (match && match.status !== "done") {
            db.prepare(
              "UPDATE tasks SET status = 'done', completedAt = ?, updatedAt = ?, needsInput = 0 WHERE id = ?"
            ).run(now, now, match.id);
          }
        }
        return false;
      }
      return true;
    });

    if (newSubtasks.length === 0) {
      console.log(`[process-manager] No new subtasks to create for ${parentTaskId.slice(0, 8)}`);
      return;
    }

    console.log(`[process-manager] Creating ${newSubtasks.length} new subtasks for ${parentTaskId.slice(0, 8)} (${existingChildren.length} already existed)`);

    // Append new subtasks after the existing set
    const maxOrder = db.prepare(
      "SELECT COALESCE(MAX(columnOrder), 0) as maxOrder FROM tasks WHERE parentId = ?"
    ).get(parentTaskId) as { maxOrder: number };
    let order = maxOrder.maxOrder + 1;

    for (const sub of newSubtasks) {
      if (!sub.title || typeof sub.title !== "string") continue;

      const childLevel = parentTask.level === "gsd" ? "gsd" : "task";
      const childId = crypto.randomUUID();
      const child: Task = {
        id: childId,
        title: sub.title.trim(),
        description: sub.description?.trim() || null,
        status: "backlog",
        level: childLevel as Task["level"],
        parentId: parentTaskId,
        projectSlug: parentTask.projectSlug,
        columnOrder: order++,
        createdAt: now,
        updatedAt: now,
        costUsd: null,
        tokensUsed: null,
        durationMs: null,
        activityLabel: null,
        errorMessage: null,
        startedAt: null,
        completedAt: null,
        clientId: parentTask.clientId,
        needsInput: false,
        phaseNumber: sub.phaseNumber ?? null,
        gsdStep: (sub.gsdStep as Task["gsdStep"]) ?? null,
        contextSources: null,
        cronJobSlug: null,
        claudeSessionId: null,
        permissionMode: parentTask.permissionMode ?? "bypassPermissions",
        executionPermissionMode:
          parentTask.executionPermissionMode ?? parentTask.permissionMode ?? "bypassPermissions",
        model: parentTask.model ?? null,
        thinkingEffort: parentTask.thinkingEffort ?? null,
        lastReplyAt: null,
        goalGroup: null,
        tag: null,
        pinnedAt: null,
      };

      db.prepare(
        `INSERT INTO tasks (id, title, description, status, level, parentId, projectSlug, columnOrder, createdAt, updatedAt, costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt, clientId, needsInput, phaseNumber, gsdStep, permissionMode, executionPermissionMode, model, thinkingEffort)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(
        child.id, child.title, child.description, child.status, child.level,
        child.parentId, child.projectSlug, child.columnOrder, child.createdAt,
        child.updatedAt, child.costUsd, child.tokensUsed, child.durationMs,
        child.activityLabel, child.errorMessage, child.startedAt, child.completedAt,
        child.clientId, 0, child.phaseNumber, child.gsdStep,
        child.permissionMode, child.executionPermissionMode, child.model, child.thinkingEffort
      );

      emitTaskEvent({ type: "task:created", task: child, timestamp: now });
    }

    console.log(`[process-manager] Created ${subtasks.length} subtasks for parent ${parentTaskId.slice(0, 8)}`);
  }

  getActiveCount(): number {
    return this.sessions.size;
  }

  isWaitingForReply(taskId: string): boolean {
    return this.waitingForReply.has(taskId);
  }

  cleanup(): void {
    for (const [taskId, session] of this.sessions) {
      console.log(`[process-manager] Cleaning up session for task ${taskId}`);
      killChildProcessTree(session.proc);
    }
    this.sessions.clear();
    this.waitingForReply.clear();
    this.startingTasks.clear();
    this.lastProgressEmit.clear();
    fileWatcher.cleanupAll();
  }

  getLogEntries(taskId: string): LogEntry[] {
    const db = getDb();
    const rows = db.prepare(
      "SELECT id, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers, permissionMode FROM task_logs WHERE taskId = ? ORDER BY rowid ASC"
    ).all(taskId) as Array<{
      id: string; type: string; timestamp: string; content: string;
      toolName: string | null; toolArgs: string | null; toolResult: string | null;
      isCollapsed: number;
      questionSpec: string | null; questionAnswers: string | null;
      permissionMode: string | null;
    }>;

    return rows.map((row) => ({
      id: row.id,
      type: row.type as LogEntry["type"],
      timestamp: row.timestamp,
      content: row.content,
      ...(row.toolName ? { toolName: row.toolName } : {}),
      ...(row.toolArgs ? { toolArgs: row.toolArgs } : {}),
      ...(row.toolResult ? { toolResult: row.toolResult } : {}),
      ...(row.isCollapsed ? { isCollapsed: true } : {}),
      ...(row.questionSpec ? { questionSpec: row.questionSpec } : {}),
      ...(row.questionAnswers ? { questionAnswers: row.questionAnswers } : {}),
      ...(row.permissionMode ? { permissionMode: row.permissionMode } : {}),
    }));
  }

  /**
   * Public entry point to spawn a --continue turn.
   * Used by the reply route as a fallback when in-memory state is stale.
   */
  async spawnContinueTurn(taskId: string, message: string, resumedFromReview: boolean = false): Promise<void> {
    const db = getDb();
    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
    if (!task) throw new Error(`Task ${taskId} not found`);

    const config = getConfig();
    const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.agenticOsDir;

    this.waitingForReply.delete(taskId);
    this.spawnClaudeTurn(taskId, message, cwd, true, resumedFromReview);
  }

  // ── Private: spawn a single Claude CLI turn ──────────────────────

  private spawnClaudeTurn(
    taskId: string,
    prompt: string,
    cwd: string,
    isContinuation: boolean,
    resumedFromReview: boolean = false,
    snapshotContent: string = "",
  ): void {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    const config = getConfig();

    // Read the task's permission mode, model, and thinking effort from the DB
    const db = getDb();
    const taskRow = db.prepare("SELECT permissionMode, model, thinkingEffort, cronJobSlug, projectSlug FROM tasks WHERE id = ?").get(taskId) as { permissionMode: string | null; model: string | null; thinkingEffort: string | null; cronJobSlug: string | null; projectSlug: string | null } | undefined;

    // Tell GSD which project this task belongs to (priority 2 in resolvePlanningDir)
    if (taskRow?.projectSlug) {
      cleanEnv.AI_OS_ACTIVE_PROJECT = taskRow.projectSlug;
    }
    // Cron tasks always run with bypassPermissions — they execute unattended
    const permissionMode = taskRow?.cronJobSlug
      ? "bypassPermissions"
      : (taskRow?.permissionMode || "bypassPermissions");
    const model = taskRow?.model || null;
    const thinkingEffort = taskRow?.thinkingEffort || null;

    // Build args. Keep every option before "--" so prompts that start with
    // hyphens are treated as prompt text instead of CLI flags.
    const args = [
      "--output-format", "stream-json",
      "--verbose",
      "-p",
      "--permission-mode", permissionMode,
    ];

    if (model) {
      args.push("--model", model);
    }
    if (thinkingEffort && thinkingEffort !== "auto") {
      args.push("--effort", thinkingEffort);
    }

    let snapshotFilePath: string | null = null;
    if (snapshotContent) {
      snapshotFilePath = path.join(os.tmpdir(), `aios-snapshot-${taskId}-${Date.now()}.txt`);
      fs.writeFileSync(snapshotFilePath, snapshotContent, "utf-8");
      args.push("--append-system-prompt-file", snapshotFilePath);
    }

    // bypassPermissions needs the dangerously-skip flag
    if (permissionMode === "bypassPermissions") {
      args.push("--dangerously-skip-permissions");
    }

    // Pre-approve safe read-only tools (not needed in plan mode or bypass mode)
    let permissionConfigPath: string | null = null;
    let permissionSettingsPath: string | null = null;
    if (permissionMode !== "plan" && permissionMode !== "bypassPermissions") {
      try {
        const permissionPromptScriptPath = this.resolvePermissionPromptScriptPath(config.agenticOsDir);
        args.push("--allowedTools", "Read,Glob,Grep,WebSearch,WebFetch,mcp__permissions");
        permissionConfigPath = path.join(
          os.tmpdir(),
          `aios-permissions-${taskId}-${Date.now()}.json`,
        );
        permissionSettingsPath = path.join(
          os.tmpdir(),
          `aios-permissions-settings-${taskId}-${Date.now()}.json`,
        );
        const mcpConfig = {
          mcpServers: {
            permissions: {
              type: "stdio",
              command: process.execPath,
              args: [
                permissionPromptScriptPath,
                "--task-id",
                taskId,
                "--db-path",
                config.dbPath,
              ],
              env: {
                AI_OS_DIR: config.agenticOsDir,
              },
            },
          },
        };
        const permissionSettings = {
          permissions: {
            allow: [
              "Read(*)",
              "Glob(*)",
              "Grep(*)",
              "WebSearch",
              "WebFetch",
              "mcp__permissions",
            ],
          },
        };
        fs.writeFileSync(permissionConfigPath, JSON.stringify(mcpConfig), "utf-8");
        fs.writeFileSync(permissionSettingsPath, JSON.stringify(permissionSettings), "utf-8");
        args.push("--setting-sources", "user");
        args.push("--settings", permissionSettingsPath);
        args.push("--mcp-config", permissionConfigPath);
        args.push("--permission-prompt-tool", PERMISSION_BRIDGE_TOOL_ID);
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        const summary = /missing at/i.test(detail)
          ? "Ask mode permission bridge failed: the bridge script path is missing."
          : "Ask mode permission bridge failed to start.";
        this.reportPermissionBridgeFailure(taskId, summary, detail);
        return;
      }
    }

    if (isContinuation) {
      // Use --resume with the stored session ID to continue the correct conversation.
      // Falls back to --continue if no session ID is stored (shouldn't happen, but safe).
      const db = getDb();
      const row = db.prepare("SELECT claudeSessionId FROM tasks WHERE id = ?").get(taskId) as { claudeSessionId: string | null } | undefined;
      const sessionId = row?.claudeSessionId;

      if (sessionId) {
        args.push("--resume", sessionId);
        console.log(`[process-manager] Using --resume ${sessionId} for ${taskId.slice(0, 8)}`);
      } else {
        args.push("--continue");
        console.warn(`[process-manager] No claudeSessionId for ${taskId.slice(0, 8)}, falling back to --continue`);
      }
    }

    args.push("--", prompt);

    console.log(`[process-manager] Spawning${isContinuation ? " (resume)" : ""}: claude -p "${prompt.slice(0, 80)}..."`);
    console.log(`[process-manager] CWD: ${cwd}`);

    let proc: ChildProcess;
    try {
      proc = spawnManagedTaskProcess("claude", args, {
        cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: cleanEnv,
        detached: true,
      });
      // Unref so the process group doesn't keep the parent alive on exit
      // (cleanup() will kill them explicitly)
      proc.unref();
      console.log(`[process-manager] Spawn succeeded, pid=${proc.pid}`);

      // Close stdin immediately — in -p mode the prompt is in the flag.
      // For replies, we use --continue with a new process instead of stdin.
      if (proc.stdin) {
        proc.stdin.end();
      }
    } catch (err) {
      if (permissionConfigPath) {
        try {
          fs.unlinkSync(permissionConfigPath);
        } catch {
          // Ignore temp-file cleanup failure
        }
      }
      if (permissionSettingsPath) {
        try {
          fs.unlinkSync(permissionSettingsPath);
        } catch {
          // Ignore temp-file cleanup failure
        }
      }
      if (snapshotFilePath) {
        try {
          fs.unlinkSync(snapshotFilePath);
        } catch {
          // Ignore temp-file cleanup failure
        }
      }
      console.error(`[process-manager] Spawn failed:`, err);
      this.handleSpawnError(taskId, err);
      return;
    }

    // Carry forward accumulated metrics from previous turns
    const prevSession = this.sessions.get(taskId);
    const session: SessionEntry = {
      proc,
      pendingQuestion: false,
      totalCostUsd: prevSession?.totalCostUsd ?? 0,
      totalTokensUsed: prevSession?.totalTokensUsed ?? 0,
      totalDurationMs: prevSession?.totalDurationMs ?? 0,
      resumedFromReview,
    };
    this.sessions.set(taskId, session);

    const parser = new ClauseOutputParserWithTurnAwareness(taskId, session, this);
    const cleanupPermissionConfig = () => {
      if (!permissionConfigPath) return;
      try {
        fs.unlinkSync(permissionConfigPath);
      } catch {
        // Ignore temp-file cleanup failure
      }
      permissionConfigPath = null;
    };
    const cleanupPermissionSettings = () => {
      if (!permissionSettingsPath) return;
      try {
        fs.unlinkSync(permissionSettingsPath);
      } catch {
        // Ignore temp-file cleanup failure
      }
      permissionSettingsPath = null;
    };
    const cleanupSnapshotFile = () => {
      if (!snapshotFilePath) return;
      try {
        fs.unlinkSync(snapshotFilePath);
      } catch {
        // Ignore temp-file cleanup failure
      }
      snapshotFilePath = null;
    };

    proc.on("error", (err) => {
      cleanupPermissionConfig();
      cleanupPermissionSettings();
      cleanupSnapshotFile();
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        this.handleTaskError(taskId, "Claude CLI not found. Ensure 'claude' is installed and in your PATH.");
      } else {
        this.handleTaskError(taskId, `Process error: ${err.message}`);
      }
    });

    if (proc.stdout) {
      const rl = createInterface({ input: proc.stdout });
      rl.on("line", (line) => {
        console.log(`[process-manager] stdout(${taskId.slice(0, 8)}): ${line.slice(0, 120)}`);
        parser.feedLine(line);
      });
    }

    let stderrBuffer = "";
    if (proc.stderr) {
      proc.stderr.on("data", (chunk: Buffer) => {
        const text = chunk.toString();
        console.log(`[process-manager] stderr(${taskId.slice(0, 8)}): ${text.trim().slice(0, 200)}`);
        stderrBuffer += text;
      });
    }

    proc.on("close", (code) => {
      cleanupPermissionConfig();
      cleanupPermissionSettings();
      cleanupSnapshotFile();
      // Check if this process is still the current one for this task.
      // If not (e.g., replyToTask killed it and spawned a new one), ignore this close.
      const currentSession = this.sessions.get(taskId);
      if (currentSession && currentSession.proc !== proc) {
        console.log(`[process-manager] Stale close for ${taskId.slice(0, 8)} (replaced by new turn) — ignoring`);
        return;
      }

      // If the parser already fired onComplete/onError, it handled cleanup — skip
      if (parser.isCompleted) {
        if (currentSession?.proc === proc) {
          this.sessions.delete(taskId);
        }
        this.lastProgressEmit.delete(taskId);
        return;
      }

      // No current session means it was killed (e.g., by replyToTask or cancelTask)
      if (!currentSession) {
        console.log(`[process-manager] Close for ${taskId.slice(0, 8)} with no active session — ignoring`);
        this.lastProgressEmit.delete(taskId);
        return;
      }

      // Parser didn't fire — handle based on exit code
      // NOTE: Do NOT delete the session yet — handleTurnComplete/handleTaskError need it
      if (code !== 0) {
        const trimmedStderr = stderrBuffer.trim();
        const permissionBridgeFailure =
          permissionMode !== "plan" && permissionMode !== "bypassPermissions"
            ? this.classifyPermissionBridgeFailure(trimmedStderr)
            : null;

        if (permissionBridgeFailure) {
          this.reportPermissionBridgeFailure(
            taskId,
            permissionBridgeFailure.summary,
            permissionBridgeFailure.detail,
          );
          this.lastProgressEmit.delete(taskId);
          return;
        }

        const errorMsg = trimmedStderr
          ? `Claude CLI exited with code ${code}: ${trimmedStderr.slice(0, 500)}`
          : `Claude CLI exited with code ${code}`;
        this.handleTaskError(taskId, errorMsg);
      } else {
        this.handleTurnComplete(taskId, { costUsd: 0, tokensUsed: 0, durationMs: 0 });
      }

      this.lastProgressEmit.delete(taskId);
    });
  }

  // ── Internal event handlers (called by parser wrapper) ───────────

  handleProgress(
    taskId: string,
    data: { costUsd?: number; tokensUsed?: number; activityLabel?: string }
  ): void {
    const now = Date.now();
    const lastEmit = this.lastProgressEmit.get(taskId) || 0;
    if (now - lastEmit < 1000) return;
    this.lastProgressEmit.set(taskId, now);

    const db = getDb();
    const updates: string[] = ["updatedAt = ?"];
    const values: unknown[] = [new Date().toISOString()];

    if (data.costUsd !== undefined) {
      updates.push("costUsd = ?");
      values.push(data.costUsd);
    }
    if (data.tokensUsed !== undefined) {
      updates.push("tokensUsed = ?");
      values.push(data.tokensUsed);
    }
    if (data.activityLabel !== undefined) {
      updates.push("activityLabel = ?");
      values.push(data.activityLabel);
    }

    values.push(taskId);
    db.prepare(`UPDATE tasks SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:progress", task: this.normalizeTask(updated), timestamp: new Date().toISOString() });
  }

  private promoteExecutionPermissionMode(taskId: string): void {
    const db = getDb();
    const modeRow = db.prepare(
      "SELECT permissionMode, executionPermissionMode FROM tasks WHERE id = ?"
    ).get(taskId) as { permissionMode: string | null; executionPermissionMode: string | null } | undefined;

    if (!modeRow) return;

    const currentMode = getActivePermissionMode(modeRow.permissionMode, "bypassPermissions");
    if (currentMode === "plan") {
      return;
    }

    const nextMode = getExecutionPermissionMode(
      modeRow.executionPermissionMode ?? modeRow.permissionMode,
      currentMode,
    );

    if (nextMode !== currentMode) {
      db.prepare(
        "UPDATE tasks SET permissionMode = ?, executionPermissionMode = ? WHERE id = ?"
      ).run(nextMode, nextMode, taskId);
    }
  }

  /**
   * Called when a single Claude turn completes (result message received).
   * If a question was asked during this turn, the task stays in "running"
   * with needsInput — waiting for user to reply via --continue.
   * Otherwise, the task is finalised to "review".
   */
  handleTurnComplete(
    taskId: string,
    data: { costUsd: number; tokensUsed: number; durationMs: number; sessionId?: string }
  ): void {
    const session = this.sessions.get(taskId);

    // Accumulate metrics across turns
    const totalCost = (session?.totalCostUsd ?? 0) + data.costUsd;
    const totalTokens = (session?.totalTokensUsed ?? 0) + data.tokensUsed;
    const totalDuration = (session?.totalDurationMs ?? 0) + data.durationMs;

    const db = getDb();
    const now = new Date().toISOString();

    // Persist Claude CLI session ID for --resume support
    if (data.sessionId) {
      db.prepare("UPDATE tasks SET claudeSessionId = ? WHERE id = ?").run(data.sessionId, taskId);
      console.log(`[process-manager] Stored claudeSessionId=${data.sessionId} for ${taskId.slice(0, 8)}`);

      // Mirror the session ID up to this task's project/GSD parent if the
      // parent doesn't already own one. This establishes the single-session
      // model: whichever subtask runs first captures the canonical session
      // for the entire project, and every later subtask resumes it.
      const parentRow = db
        .prepare(
          "SELECT p.id as id, p.level as level, p.claudeSessionId as claudeSessionId " +
          "FROM tasks c JOIN tasks p ON c.parentId = p.id WHERE c.id = ?"
        )
        .get(taskId) as
        | { id: string; level: string; claudeSessionId: string | null }
        | undefined;
      if (
        parentRow &&
        (parentRow.level === "project" || parentRow.level === "gsd") &&
        !parentRow.claudeSessionId
      ) {
        db.prepare("UPDATE tasks SET claudeSessionId = ? WHERE id = ?")
          .run(data.sessionId, parentRow.id);
        console.log(
          `[process-manager] Mirrored claudeSessionId up to parent ${parentRow.id.slice(0, 8)} (${parentRow.level})`,
        );
      }
    }

    // Check if a question was asked during this turn.
    const db2 = getDb();
    const cronCheck = db2.prepare("SELECT cronJobSlug FROM tasks WHERE id = ?").get(taskId) as { cronJobSlug: string | null } | undefined;
    const isCronTask = !!cronCheck?.cronJobSlug;
    const questionAsked = session?.pendingQuestion ?? false;

    // Respect explicit user actions: if the user already marked this task "done"
    // via the UI while Claude was finishing, don't override it.
    const currentStatus = (db.prepare("SELECT status FROM tasks WHERE id = ?").get(taskId) as { status: string } | undefined)?.status;
    if (currentStatus === "done") {
      console.log(`[process-manager] Task ${taskId.slice(0, 8)} already marked done by user — respecting explicit status`);
      this.sessions.delete(taskId);
      this.waitingForReply.delete(taskId);
      return;
    }

    // Determine if this is a subtask (has a parent) — subtasks can auto-complete
    // since their lifecycle is managed by the parent task flow.
    const taskCheck = db.prepare("SELECT level, parentId, completedAt FROM tasks WHERE id = ?").get(taskId) as
      { level: string; parentId: string | null; completedAt: string | null } | undefined;
    const isSubtask = !!taskCheck?.parentId;

    this.promoteExecutionPermissionMode(taskId);

    console.log(`[process-manager] handleTurnComplete(${taskId.slice(0, 8)}): questionAsked=${questionAsked}, isCronTask=${isCronTask}, isSubtask=${isSubtask}, hasSession=${!!session}`);

    // For cron tasks and subtasks: use question detection to decide flow.
    // For all other tasks (user-facing): ALWAYS keep interactive.
    // The user decides when a task is done — not the system.
    if (!isCronTask && !isSubtask) {
      // Top-level interactive task: move to "review" (Your Turn) with needsInput.
      // Question detection is only used to surface the specific question text.
      const completionLabel = questionAsked
        ? undefined  // handleQuestion already set the activityLabel
        : this.buildCompletionSummary(taskId, db) || "Claude has finished this step — review and reply, or mark as done";

      if (completionLabel) {
        db.prepare("UPDATE tasks SET activityLabel = ? WHERE id = ?").run(completionLabel, taskId);
      }

      db.prepare(
        "UPDATE tasks SET status = 'review', updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1 WHERE id = ?"
      ).run(now, totalCost, totalTokens, totalDuration, taskId);

      // Kill any orphaned grandchild processes (e.g. Next.js workers spawned by Claude tools)
      if (session) {
        killChildProcessTree(session.proc);
      }

      this.waitingForReply.add(taskId);
      this.sessions.delete(taskId);

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });

      // Still auto-create subtasks for parent tasks if needed
      if (!updated.parentId) {
        if (updated.level === "gsd") {
          this.autoSyncPhases(taskId);
        } else if (updated.level === "project") {
          this.extractAndCreateSubtasks(taskId, updated);
        }
      }
      this.lastProgressEmit.delete(taskId);
      return;
    }

    if (questionAsked) {
      // Subtask or cron asked a question — keep interactive
      console.log(`[process-manager] Turn complete with pending question for ${taskId} — adding to waitingForReply`);

      if (isCronTask) {
        db.prepare(
          "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1, activityLabel = NULL WHERE id = ?"
        ).run(now, totalCost, totalTokens, totalDuration, taskId);
      } else {
        db.prepare(
          "UPDATE tasks SET updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, needsInput = 1, activityLabel = NULL WHERE id = ?"
        ).run(now, totalCost, totalTokens, totalDuration, taskId);
      }

      if (session) {
        killChildProcessTree(session.proc);
      }

      this.waitingForReply.add(taskId);
      this.sessions.delete(taskId);

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;

      if (updated.cronJobSlug) {
        this.recordCronRun(updated, totalCost, totalDuration, {
          result: "failure",
          exitCode: 1,
          completionReason: "needs_input",
        });
      }

      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });
    } else {
      // Subtask or cron completed without question — finalize.
      // Cron tasks go to "done", subtasks go to "done" (parent manages lifecycle).
      const finalStatus = "done";
      console.log(`[process-manager] Task ${taskId} completed — moving to ${finalStatus} (${isCronTask ? "cron" : "subtask"})`);

      fileWatcher.stopWatching(taskId).catch(() => {});

      // Kill any orphaned grandchild processes (e.g. Next.js workers spawned by Claude tools)
      if (session) {
        killChildProcessTree(session.proc);
      }

      const completionLabel = this.buildCompletionSummary(taskId, db);

      db.prepare(
        "UPDATE tasks SET status = ?, completedAt = ?, updatedAt = ?, costUsd = ?, tokensUsed = ?, durationMs = ?, activityLabel = ?, needsInput = 0 WHERE id = ?"
      ).run(finalStatus, now, now, totalCost, totalTokens, totalDuration, completionLabel, taskId);

      this.sessions.delete(taskId);
      this.waitingForReply.delete(taskId);

      const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;

      // Record cron run data BEFORE emitting events (so history is available when UI refreshes)
      if (updated.cronJobSlug) {
        this.recordCronRun(updated, totalCost, totalDuration);
      }

      emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });

      // Auto-create subtasks for parent tasks on completion
      if (!updated.parentId) {
        if (updated.level === "gsd") {
          // GSD: sync phases from .planning/ROADMAP.md (created by /gsd-new-project)
          this.autoSyncPhases(taskId);
        } else if (updated.level === "project") {
          // Project: extract deliverable subtasks from the conversation output
          this.extractAndCreateSubtasks(taskId, updated);
        }
      }

      // Auto-queue next sibling subtask when a child completes
      if (updated.parentId) {
        this.autoQueueNextSibling(updated);
      }
    }

    this.lastProgressEmit.delete(taskId);
  }

  /**
   * Called when question-like text is detected in Claude's output.
   * Updates the UI to show the question, but does NOT set session.pendingQuestion —
   * that's controlled by the turn-aware wrapper so only the LAST text block's
   * question state matters (intermediate questions followed by more work don't count).
   */
  /**
   * Called when a structured question block is detected in Claude's output.
   * Parallel to `handleQuestion`, but stores the typed QuestionSpec[] so the
   * UI can render the QuestionModal instead of a prose bubble.
   */
  handleStructuredQuestion(taskId: string, specs: QuestionSpec[]): void {
    console.log(
      `[process-manager] handleStructuredQuestion(${taskId.slice(0, 8)}): ${specs.length} questions`
    );

    const db = getDb();
    const now = new Date().toISOString();

    // Build a short activity label from the first question prompt
    const firstPrompt = specs[0]?.prompt ?? "Waiting for your answers";
    const label = firstPrompt.length > 100 ? firstPrompt.slice(0, 97) + "..." : firstPrompt;
    db.prepare("UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?")
      .run(now, label, taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({
      type: "task:question",
      task: this.normalizeTask(updated),
      timestamp: now,
      questionText: `${specs.length} question${specs.length === 1 ? "" : "s"}`,
    });

    this.addLogEntry(taskId, {
      id: crypto.randomUUID(),
      type: "structured_question",
      timestamp: now,
      content: specs.map((s, i) => `${i + 1}. ${s.prompt}`).join("\n"),
      questionSpec: JSON.stringify(specs),
    });

    // Bubble into the chat conversation if this task is part of one
    const summaryText = specs.map((s, i) => `${i + 1}. ${s.prompt}`).join("\n");
    this.bubbleQuestionToChat(db, taskId, summaryText, now, specs);
  }

  handleQuestion(taskId: string, questionText: string): void {
    console.log(`[process-manager] handleQuestion(${taskId.slice(0, 8)}): detected question in output`);

    const db = getDb();
    const now = new Date().toISOString();

    // Use the question text as the activity label so the card shows what's being asked
    const label = questionText.length > 100 ? questionText.slice(0, 97) + "..." : questionText;
    db.prepare("UPDATE tasks SET updatedAt = ?, activityLabel = ?, needsInput = 1 WHERE id = ?")
      .run(now, label, taskId);

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:question", task: this.normalizeTask(updated), timestamp: now, questionText });

    // Bubble into the chat conversation if this task is part of one
    this.bubbleQuestionToChat(db, taskId, questionText, now);
  }

  /**
   * Insert a sub_agent message into the chat conversation so the question
   * appears in the autonomous chat view as a bubbled question card.
   */
  private bubbleQuestionToChat(
    db: ReturnType<typeof getDb>,
    taskId: string,
    questionText: string,
    timestamp: string,
    questionSpecs?: QuestionSpec[],
  ): void {
    const task = db.prepare("SELECT conversationId, title FROM tasks WHERE id = ?").get(taskId) as
      { conversationId: string | null; title: string } | undefined;
    if (!task?.conversationId) return;

    const msgId = crypto.randomUUID();
    const metadata: Record<string, unknown> = {
      questionTaskId: taskId,
      questionText,
    };
    if (questionSpecs && questionSpecs.length > 0) {
      metadata.questionSpecs = questionSpecs;
    }

    db.prepare(
      `INSERT INTO messages (id, conversationId, taskId, role, content, metadata, parentMessageId, createdAt)
       VALUES (?, ?, ?, 'sub_agent', ?, ?, NULL, ?)`
    ).run(
      msgId,
      task.conversationId,
      taskId,
      questionText,
      JSON.stringify(metadata),
      timestamp,
    );

    emitChatEvent({
      type: "chat:message",
      conversationId: task.conversationId,
      message: {
        id: msgId,
        conversationId: task.conversationId,
        taskId,
        role: "sub_agent",
        content: questionText,
        metadata: metadata as import("@/types/chat").MessageMetadata,
        parentMessageId: null,
        createdAt: timestamp,
      },
      timestamp,
    });
  }

  handleTaskError(taskId: string, errorMessage: string): void {
    fileWatcher.stopWatching(taskId).catch(() => {});

    // Kill any orphaned grandchild processes before cleanup
    const session = this.sessions.get(taskId);
    if (session) {
      killChildProcessTree(session.proc);
    }

    const db = getDb();
    const now = new Date().toISOString();

    // Check if this is a cron task so resumed scheduled work can land in review,
    // not misleadingly mark itself done.
    const task = db.prepare("SELECT cronJobSlug FROM tasks WHERE id = ?").get(taskId) as { cronJobSlug: string | null } | undefined;
    const isCronTask = !!task?.cronJobSlug;

    if (isCronTask) {
      // Cron task continuations still need a human to step in when they fail.
      db.prepare(
        "UPDATE tasks SET status = 'review', completedAt = NULL, updatedAt = ?, errorMessage = ?, activityLabel = ?, needsInput = 1 WHERE id = ?"
      ).run(now, errorMessage, "Error — needs attention", taskId);

      this.waitingForReply.add(taskId);
      this.sessions.delete(taskId);
      this.lastProgressEmit.delete(taskId);
    } else {
      // Interactive tasks: stay in "running" with needsInput flag
      db.prepare(
        "UPDATE tasks SET updatedAt = ?, errorMessage = ?, activityLabel = ?, needsInput = 1 WHERE id = ?"
      ).run(now, errorMessage, "Error — needs attention", taskId);

      this.waitingForReply.add(taskId);
      this.sessions.delete(taskId);
      this.lastProgressEmit.delete(taskId);
    }

    const updated = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task;
    emitTaskEvent({ type: "task:status", task: this.normalizeTask(updated), timestamp: now });

    // Record failed cron run if this task was triggered by a cron job
    if (updated.cronJobSlug) {
      this.recordCronRun(updated, 0, 0);
    }
  }

  addLogEntry(taskId: string, entry: LogEntry): void {
    const db = getDb();
    db.prepare(
      "INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers, permissionMode) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)"
    ).run(
      entry.id, taskId, entry.type, entry.timestamp, entry.content,
      entry.toolName ?? null, entry.toolArgs ?? null, entry.toolResult ?? null,
      entry.isCollapsed ? 1 : 0,
      entry.questionSpec ?? null, entry.questionAnswers ?? null,
      entry.permissionMode ?? null,
    );

    // When Claude writes or edits a file, register it as a task output immediately.
    // This supplements the file-watcher (which may miss files due to timing or scope).
    if (entry.type === "tool_use" && entry.toolArgs) {
      const toolName = (entry.toolName || "").toLowerCase();
      if (toolName === "write" || toolName === "edit" || toolName === "multiedit") {
        this.registerFileOutput(taskId, entry.toolArgs);
      }
    }

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
    if (task) {
      emitTaskEvent({
        type: "task:log",
        task: this.normalizeTask(task),
        timestamp: entry.timestamp,
        logEntry: entry,
      });
    }
  }

  /**
   * Extract a file path from a Write/Edit tool_use and insert into task_outputs.
   * Skips source code extensions and deduplicates against existing records.
   */
  private registerFileOutput(taskId: string, toolArgs: string): void {
    try {
      const args = JSON.parse(toolArgs);
      const filePath: string | undefined = args.file_path ?? args.path;
      if (!filePath || typeof filePath !== "string") return;

      const fileName = path.basename(filePath);
      const extension = path.extname(filePath).replace(".", "").toLowerCase();

      // Skip source code and config files
      const skipExtensions = new Set([
        "ts", "tsx", "js", "jsx", "css", "scss", "less",
        "py", "rb", "go", "rs", "java", "c", "cpp", "h",
        "sh", "bash", "zsh", "sql",
        "lock", "map", "tsbuildinfo", "env", "gitignore", "eslintrc", "prettierrc",
      ]);
      if (!extension || skipExtensions.has(extension)) return;

      const db = getDb();

      // Deduplicate: skip if already tracked for this task
      const existing = db.prepare(
        "SELECT id FROM task_outputs WHERE taskId = ? AND filePath = ? LIMIT 1"
      ).get(taskId, filePath) as { id: string } | undefined;
      if (existing) return;

      // Get file size if the file exists on disk
      let sizeBytes: number | null = null;
      try {
        sizeBytes = fs.statSync(filePath).size;
      } catch {
        // File may not exist yet (Edit on a new path, or write hasn't flushed)
      }

      const config = getConfig();
      const relativePath = path.relative(config.agenticOsDir, filePath);
      const id = crypto.randomUUID();
      const now = new Date().toISOString();

      db.prepare(
        "INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(id, taskId, fileName, filePath, relativePath, extension, sizeBytes, now);

      // Emit event so the UI updates the FILES tab in real time
      const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId) as Task | undefined;
      if (task) {
        emitTaskEvent({ type: "task:output", task: this.normalizeTask(task), timestamp: now });
      }
    } catch {
      // Non-critical — don't break log entry processing
    }
  }

  /**
   * Build a plain-English completion summary for the user.
   * Reads the last text log entries and output files to describe
   * what happened in business terms, not technical terms.
   */
  private buildCompletionSummary(taskId: string, db: ReturnType<typeof getDb>): string {
    // 1. Check for output files
    const outputs = db.prepare(
      "SELECT fileName FROM task_outputs WHERE taskId = ? ORDER BY createdAt DESC LIMIT 5"
    ).all(taskId) as Array<{ fileName: string }>;

    // 2. Get the last few text log entries (Claude's actual output)
    const logs = db.prepare(
      `SELECT content FROM task_logs
       WHERE taskId = ? AND type = 'text' AND length(content) > 20
       ORDER BY timestamp DESC LIMIT 4`
    ).all(taskId) as Array<{ content: string }>;

    // 3. Find the best summary line from Claude's output
    //    Look for lines that describe outcomes, not technical actions
    let bestLine: string | null = null;
    for (const log of logs) {
      const cleaned = log.content
        .replace(/```[\s\S]*?```/g, "")
        .replace(/\[SILENT\]/gi, "")
        .replace(/`[^`]+`/g, "")
        .replace(/[#*_~]/g, "")
        .trim();

      if (!cleaned || cleaned.length < 10) continue;

      // Split into lines and find the best one
      const lines = cleaned.split("\n")
        .map((l) => l.trim())
        .filter((l) => l.length > 15)
        // Skip lines that are just file paths or technical actions
        .filter((l) => !/^(Saved|Wrote|Created|Updated|Reading|Writing|Running|Executed|Report saved)\s+(to|from|at|in)\s+/i.test(l))
        .filter((l) => !l.match(/^[-*]\s*(\/|projects\/|src\/)/))
        .filter((l) => !/^Working directory/i.test(l))
        .filter((l) => !/^Co-Authored-By/i.test(l));

      // Prefer lines that sound like summaries
      const summaryLine = lines.find((l) =>
        /^(no |all |found |there |nothing |everything |completed |checked |reviewed |analysed |analyzed |updated |the |your |this |here|we )/i.test(l)
      ) || lines.find((l) =>
        /\b(available|complete|ready|done|success|found|checked|reviewed|no issues|no changes|up to date)\b/i.test(l)
      ) || lines[0];

      if (summaryLine) {
        bestLine = summaryLine;
        break;
      }
    }

    // 4. Build the final label
    if (bestLine) {
      // Clean up and truncate
      let label = bestLine
        .replace(/(?:\/[\w.-]+){2,}/g, "")          // remove file paths
        .replace(/[\w.-]+\/[\w.-]+\/[\w.-]+/g, "")   // remove relative paths
        .replace(/\b\w+\.(md|json|ts|tsx|js|py|sh)\b/gi, "")
        .replace(/\s+/g, " ")
        .trim();

      // Remove leading bullets/dashes
      label = label.replace(/^[-*•]\s*/, "");

      if (label.length > 5) {
        // Capitalise first letter
        label = label.charAt(0).toUpperCase() + label.slice(1);
        return label.length > 120 ? label.slice(0, 117) + "..." : label;
      }
    }

    // 5. Fallback: describe outputs
    if (outputs.length > 0) {
      const count = outputs.length;
      return count === 1
        ? `Produced 1 file`
        : `Produced ${count} files`;
    }

    return "Completed";
  }

  /** Finalize the currently running cron row, if one exists for this task. */
  private recordCronRun(
    task: Task,
    costUsd: number,
    durationMs: number,
    overrides: {
      result?: "success" | "failure" | "timeout";
      exitCode?: number;
      completionReason?: string;
    } = {},
  ): void {
    if (!task.cronJobSlug) return;

    const db = getDb();
    const runningRow = db
      .prepare("SELECT id FROM cron_runs WHERE taskId = ? AND result = 'running' LIMIT 1")
      .get(task.id) as { id: number } | undefined;

    if (!runningRow) {
      return;
    }

    completeCronRunForTask(task, {
      costUsd,
      durationMs,
      result: overrides.result ?? (task.errorMessage ? "failure" : "success"),
      exitCode: overrides.exitCode ?? (task.errorMessage ? 1 : 0),
      completedAt: new Date().toISOString(),
      ...(overrides.completionReason ? { completionReason: overrides.completionReason } : {}),
    });
  }

  private handleSpawnError(taskId: string, err: unknown): void {
    const message = err instanceof Error ? err.message : "Unknown spawn error";
    this.handleTaskError(taskId, `Failed to start Claude CLI: ${message}`);
  }

  normalizeTask(row: Task): Task {
    return { ...row, needsInput: Boolean(row.needsInput) };
  }
}

/**
 * Thin wrapper around ClaudeOutputParser that routes callbacks
 * to the ProcessManager's methods (which are now turn-aware).
 */
/**
 * Turn-aware wrapper around ClaudeOutputParser.
 *
 * Key behaviour: only the LAST assistant text block determines whether the task
 * needs user input. If Claude asks a question in the middle of its work but then
 * continues with more output, the intermediate question does NOT block completion.
 *
 * How it works:
 * - `lastTextWasQuestion` resets to false on every new assistant text block
 * - When a question IS detected, it's set to true (and UI is updated immediately)
 * - At completion time, `session.pendingQuestion` is set from `lastTextWasQuestion`
 * - So only the very last text determines the outcome
 */
class ClauseOutputParserWithTurnAwareness {
  private parser: ClaudeOutputParser;
  /** Tracks whether the most recent assistant text block contained a question */
  private lastTextWasQuestion = false;

  constructor(
    private taskId: string,
    private session: SessionEntry,
    private pm: ProcessManager,
  ) {
    this.parser = new ClaudeOutputParser({
      onProgress: (data) => {
        // New assistant text arriving — reset question flag (will be re-set by onQuestion if this text IS a question)
        if (data.activityLabel) {
          this.lastTextWasQuestion = false;
        }
        pm.handleProgress(taskId, data);
      },
      onComplete: (data) => {
        // Commit the question state: only true if the LAST text block was a question
        session.pendingQuestion = this.lastTextWasQuestion;
        console.log(`[process-manager] Turn complete for ${taskId.slice(0, 8)}: lastTextWasQuestion=${this.lastTextWasQuestion}`);
        pm.handleTurnComplete(taskId, data);
      },
      onError: (error) => pm.handleTaskError(taskId, error),
      onLogEntry: (entry) => pm.addLogEntry(taskId, entry),
      onQuestion: (questionText) => {
        this.lastTextWasQuestion = true;
        pm.handleQuestion(taskId, questionText);
      },
      onStructuredQuestion: (specs) => {
        this.lastTextWasQuestion = true;
        pm.handleStructuredQuestion(taskId, specs);
      },
    });
  }

  feedLine(line: string): void {
    this.parser.feedLine(line);
  }

  get isCompleted(): boolean {
    return this.parser.isCompleted;
  }
}

// Singleton instance — use globalThis to survive Next.js HMR in dev mode
const globalForPM = globalThis as unknown as { __processManager?: ProcessManager };
export const processManager = globalForPM.__processManager ?? new ProcessManager();
if (process.env.NODE_ENV !== "production") {
  globalForPM.__processManager = processManager;
}
