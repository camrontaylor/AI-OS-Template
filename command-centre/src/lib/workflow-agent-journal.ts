import fs, { type FSWatcher } from "node:fs";
import os from "node:os";
import path from "node:path";

export type WorkflowJournalOutcome = "completed" | "failed" | "stopped";

export interface WorkflowJournalLaunchData {
  /** Command Centre task that owns the Workflow invocation. */
  hostTaskId: string;
  /** Claude session that owns the Workflow transcript directory. */
  sessionId: string;
  /** Parent Workflow tool_use ID. */
  toolUseId: string;
  /** Workflow engine task ID from WorkflowLaunchData. */
  taskId: string;
  runId: string;
  transcriptDir: string;
  scriptPath?: string;
  workflowName?: string;
  summary?: string;
}

export interface WorkflowJournalTerminalData {
  hostTaskId: string;
  runId: string;
  status: WorkflowJournalOutcome;
  summary?: string;
  result?: string;
  outputFile?: string;
}

export interface WorkflowJournalAgentStartedEvent {
  hostTaskId: string;
  workflowTaskId: string;
  sessionId: string;
  runId: string;
  parentToolUseId: string;
  transcriptDir: string;
  agentId: string;
  journalKey: string;
  agentIndex: number;
  agentLabel: string;
  toolUseId: string;
  observedAt: string;
  synthesized: boolean;
  prompt?: string;
}

export interface WorkflowJournalAgentCompletedEvent
  extends WorkflowJournalAgentStartedEvent {
  outcome: WorkflowJournalOutcome;
  summary?: string;
  source: "journal" | "terminal";
  completedAt: string;
}

export interface WorkflowJournalAgentSnapshot {
  agentId: string;
  journalKey: string;
  agentIndex: number;
  agentLabel: string;
  toolUseId: string;
  status: "running" | WorkflowJournalOutcome;
  startedAt: string;
  completedAt?: string;
  summary?: string;
  synthesized: boolean;
  prompt?: string;
  promptPreview?: string;
  officialLabel?: string;
  workflowState?: string;
  workflowOutcome?: WorkflowJournalOutcome;
  startedAtMs?: number;
  queuedAtMs?: number;
  lastProgressAtMs?: number;
  durationMs?: number;
  resultPreview?: string;
  model?: string;
  phaseTitle?: string;
  tokens?: number;
  toolCalls?: number;
}

export interface WorkflowJournalTerminalSnapshot {
  status: WorkflowJournalOutcome;
  finalizedAt: string;
  summary?: string;
  resultSummary?: string;
  outputFile?: string;
}

export interface WorkflowJournalRunSnapshot {
  hostTaskId: string;
  workflowTaskId: string;
  sessionId: string;
  runId: string;
  parentToolUseId: string;
  transcriptDir: string;
  journalPath: string;
  scriptPath?: string;
  workflowName?: string;
  launchSummary?: string;
  agents: WorkflowJournalAgentSnapshot[];
  startedCount: number;
  completedCount: number;
  outstandingCount: number;
  terminal?: WorkflowJournalTerminalSnapshot;
}

export interface WorkflowAgentJournalCallbacks {
  onAgentStarted?: (event: WorkflowJournalAgentStartedEvent) => void;
  onAgentCompleted?: (event: WorkflowJournalAgentCompletedEvent) => void;
  onRunTerminal?: (snapshot: WorkflowJournalRunSnapshot) => void;
}

export interface WorkflowAgentJournalBridgeOptions
  extends WorkflowAgentJournalCallbacks {
  claudeConfigDir?: string;
  pollIntervalMs?: number;
  maxSummaryLength?: number;
  maxPromptLength?: number;
  now?: () => Date;
}

interface AgentState {
  agentId: string;
  journalKey: string;
  agentIndex: number;
  agentLabel: string;
  toolUseId: string;
  startedAt: string;
  synthesized: boolean;
  outcome?: WorkflowJournalOutcome;
  completedAt?: string;
  summary?: string;
  prompt?: string;
  promptPreview?: string;
  officialLabel?: string;
  workflowState?: string;
  workflowOutcome?: WorkflowJournalOutcome;
  startedAtMs?: number;
  queuedAtMs?: number;
  lastProgressAtMs?: number;
  durationMs?: number;
  resultPreview?: string;
  model?: string;
  phaseTitle?: string;
  tokens?: number;
  toolCalls?: number;
}

interface RunState {
  launch: WorkflowJournalLaunchData;
  transcriptDir: string;
  journalPath: string;
  offset: number;
  pending: Buffer;
  fileIdentity?: string;
  lastMtimeMs?: number;
  seenJournalEvents: Set<string>;
  agents: Map<string, AgentState>;
  nextAgentIndex: number;
  terminal?: WorkflowJournalTerminalSnapshot;
  watcher?: FSWatcher;
  watchedPath?: string;
  poller?: NodeJS.Timeout;
  readPromise?: Promise<void>;
  finalizePromise?: Promise<WorkflowJournalRunSnapshot>;
  readRequested: boolean;
  flushPartialRequested: boolean;
}

interface ParsedJournalEvent {
  type: "started" | "result";
  key: string;
  agentId: string;
  result?: string;
}

const DEFAULT_POLL_INTERVAL_MS = 250;
const DEFAULT_MAX_SUMMARY_LENGTH = 500;
const DEFAULT_MAX_PROMPT_LENGTH = 1_000;
const MAX_INITIAL_TRANSCRIPT_BYTES = 256 * 1024;

function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relative = path.relative(parentPath, candidatePath);
  return relative === "" || (
    relative !== ".."
    && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative)
  );
}

function isSafePathSegment(value: string): boolean {
  return Boolean(value)
    && value !== "."
    && value !== ".."
    && !value.includes("/")
    && !value.includes("\\");
}

function firstString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function finiteNumber(value: unknown): number | undefined {
  const numberValue = typeof value === "number"
    ? value
    : typeof value === "string" && value.trim()
      ? Number(value)
      : Number.NaN;
  return Number.isFinite(numberValue) && numberValue >= 0 ? numberValue : undefined;
}

function normalizeWorkflowOutcome(value: unknown): WorkflowJournalOutcome | undefined {
  const normalized = firstString(value)?.toLowerCase();
  switch (normalized) {
    case "completed":
    case "complete":
    case "succeeded":
    case "success":
    case "done":
      return "completed";
    case "failed":
    case "failure":
    case "error":
    case "timed_out":
    case "timeout":
      return "failed";
    case "stopped":
    case "cancelled":
    case "canceled":
    case "aborted":
      return "stopped";
    default:
      return undefined;
  }
}

function stripWorkflowLabelPrefix(value: unknown): string | undefined {
  const label = firstString(value);
  if (!label) return undefined;
  return firstString(label.replace(/^\s*(?:Execute|Task)\s*:\s*/i, ""));
}

function parseJournalLine(line: string): ParsedJournalEvent | undefined {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(line) as Record<string, unknown>;
  } catch {
    return undefined;
  }

  const type = firstString(parsed.type);
  const key = firstString(parsed.key);
  const agentId = firstString(parsed.agentId);
  if ((type !== "started" && type !== "result") || !key || !agentId) {
    return undefined;
  }

  return {
    type,
    key,
    agentId,
    ...(typeof parsed.result === "string" ? { result: parsed.result } : {}),
  };
}

function runStateKey(hostTaskId: string, runId: string): string {
  return `${hostTaskId}\u0000${runId}`;
}

export class WorkflowAgentJournalBridge {
  private readonly claudeConfigDir: string;
  private readonly pollIntervalMs: number;
  private readonly maxSummaryLength: number;
  private readonly maxPromptLength: number;
  private readonly now: () => Date;
  private readonly callbacks: WorkflowAgentJournalCallbacks;
  private readonly runs = new Map<string, RunState>();
  private disposed = false;

  constructor(options: WorkflowAgentJournalBridgeOptions = {}) {
    this.claudeConfigDir = path.resolve(
      options.claudeConfigDir
        ?? process.env.CLAUDE_CONFIG_DIR
        ?? path.join(os.homedir(), ".claude"),
    );
    this.pollIntervalMs = Math.max(10, options.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS);
    this.maxSummaryLength = Math.max(32, options.maxSummaryLength ?? DEFAULT_MAX_SUMMARY_LENGTH);
    this.maxPromptLength = Math.max(64, options.maxPromptLength ?? DEFAULT_MAX_PROMPT_LENGTH);
    this.now = options.now ?? (() => new Date());
    this.callbacks = {
      onAgentStarted: options.onAgentStarted,
      onAgentCompleted: options.onAgentCompleted,
      onRunTerminal: options.onRunTerminal,
    };
  }

  async observeLaunch(
    launch: WorkflowJournalLaunchData,
  ): Promise<WorkflowJournalRunSnapshot> {
    if (this.disposed) {
      throw new Error("WorkflowAgentJournalBridge has been disposed");
    }

    const transcriptDir = await this.validateTranscriptDir(launch);
    const key = runStateKey(launch.hostTaskId, launch.runId);
    const existing = this.runs.get(key);
    if (existing) {
      if (existing.transcriptDir !== transcriptDir) {
        throw new Error(`Workflow run ${launch.runId} is already observed from another directory`);
      }
      await this.requestRefresh(existing);
      return this.snapshot(existing);
    }

    const state: RunState = {
      launch: { ...launch, transcriptDir },
      transcriptDir,
      journalPath: path.join(transcriptDir, "journal.jsonl"),
      offset: 0,
      pending: Buffer.alloc(0),
      seenJournalEvents: new Set<string>(),
      agents: new Map<string, AgentState>(),
      nextAgentIndex: 1,
      readRequested: false,
      flushPartialRequested: false,
    };
    this.runs.set(key, state);

    this.ensureWatcher(state);
    state.poller = setInterval(() => {
      this.ensureWatcher(state);
      void this.requestRefresh(state);
    }, this.pollIntervalMs);
    state.poller.unref?.();

    await this.requestRefresh(state);
    return this.snapshot(state);
  }

  async finalizeTerminal(
    terminal: WorkflowJournalTerminalData,
  ): Promise<WorkflowJournalRunSnapshot | undefined> {
    const state = this.runs.get(runStateKey(terminal.hostTaskId, terminal.runId));
    if (!state) return undefined;
    if (state.terminal) return this.snapshot(state);
    if (state.finalizePromise) return state.finalizePromise;

    state.finalizePromise = (async () => {
      await this.requestRefresh(state, true);
      await this.enrichFromFinalSnapshot(state);

      const completedAt = this.nowIso();
      const closeSummary = this.boundSummary(terminal.summary ?? terminal.result);
      for (const agent of this.orderedAgents(state)) {
        if (!agent.outcome) {
          this.completeAgent(
            state,
            agent,
            agent.workflowOutcome ?? terminal.status,
            agent.resultPreview ?? closeSummary,
            "terminal",
            completedAt,
          );
        } else if (agent.workflowOutcome) {
          // The parent snapshot is authoritative if it disagrees with an
          // earlier journal result.
          agent.outcome = agent.workflowOutcome;
          if (agent.resultPreview) agent.summary = agent.resultPreview;
        }
      }

      const terminalSummary = this.boundSummary(terminal.summary);
      const resultSummary = this.boundSummary(terminal.result);
      const outputFile = firstString(terminal.outputFile);
      state.terminal = {
        status: terminal.status,
        finalizedAt: completedAt,
        ...(terminalSummary ? { summary: terminalSummary } : {}),
        ...(resultSummary ? { resultSummary } : {}),
        ...(outputFile ? { outputFile } : {}),
      };
      this.stopResources(state);

      const snapshot = this.snapshot(state);
      this.safeCallback(this.callbacks.onRunTerminal, snapshot);
      return snapshot;
    })();
    return state.finalizePromise;
  }

  async stopRun(
    hostTaskId: string,
    runId: string,
    summary = "Workflow run stopped",
  ): Promise<WorkflowJournalRunSnapshot | undefined> {
    return this.finalizeTerminal({ hostTaskId, runId, status: "stopped", summary });
  }

  async stopTask(
    hostTaskId: string,
    summary = "Task stopped",
  ): Promise<WorkflowJournalRunSnapshot[]> {
    const states = [...this.runs.values()].filter(
      (state) => state.launch.hostTaskId === hostTaskId && !state.terminal,
    );
    const snapshots = await Promise.all(states.map((state) => this.stopRun(
      hostTaskId,
      state.launch.runId,
      summary,
    )));
    return snapshots.filter((snapshot): snapshot is WorkflowJournalRunSnapshot => Boolean(snapshot));
  }

  getSnapshot(hostTaskId: string, runId: string): WorkflowJournalRunSnapshot | undefined {
    const state = this.runs.get(runStateKey(hostTaskId, runId));
    return state ? this.snapshot(state) : undefined;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    for (const state of this.runs.values()) {
      this.stopResources(state);
    }
    this.runs.clear();
  }

  private async validateTranscriptDir(launch: WorkflowJournalLaunchData): Promise<string> {
    if (!launch.hostTaskId || !launch.toolUseId || !launch.taskId) {
      throw new Error("Workflow launch is missing required task or tool metadata");
    }
    if (!isSafePathSegment(launch.sessionId) || !isSafePathSegment(launch.runId)) {
      throw new Error("Workflow launch contains an unsafe session or run ID");
    }

    const transcriptDir = path.resolve(launch.transcriptDir);
    const projectsRoot = path.join(this.claudeConfigDir, "projects");
    if (!isPathInside(projectsRoot, transcriptDir)) {
      throw new Error("Workflow transcript directory is outside the Claude projects directory");
    }

    const segments = path.relative(projectsRoot, transcriptDir).split(path.sep);
    const hasExpectedShape = segments.length === 5
      && Boolean(segments[0])
      && segments[1] === launch.sessionId
      && segments[2] === "subagents"
      && segments[3] === "workflows"
      && segments[4] === launch.runId;
    if (!hasExpectedShape) {
      throw new Error("Workflow transcript directory does not match the current session and run");
    }

    try {
      const realProjectsRoot = await fs.promises.realpath(projectsRoot);
      let existingAncestor = transcriptDir;
      let realExistingAncestor: string | undefined;
      while (isPathInside(projectsRoot, existingAncestor)) {
        try {
          realExistingAncestor = await fs.promises.realpath(existingAncestor);
          break;
        } catch (error) {
          if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
          if (existingAncestor === projectsRoot) break;
          existingAncestor = path.dirname(existingAncestor);
        }
      }
      if (realExistingAncestor && !isPathInside(realProjectsRoot, realExistingAncestor)) {
        throw new Error("Workflow transcript directory resolves outside the Claude projects directory");
      }
      if (existingAncestor === transcriptDir) {
        const stat = await fs.promises.stat(transcriptDir);
        if (!stat.isDirectory()) {
          throw new Error("Workflow transcript path is not a directory");
        }
      }
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") throw error;
    }

    return transcriptDir;
  }

  private ensureWatcher(state: RunState): void {
    if (state.terminal || this.disposed) return;

    const watchPath = this.findExistingWatchPath(state);
    if (!watchPath || state.watchedPath === watchPath) return;

    state.watcher?.close();
    state.watcher = undefined;
    state.watchedPath = undefined;
    try {
      const watcher = fs.watch(watchPath, () => {
        this.ensureWatcher(state);
        void this.requestRefresh(state);
      });
      watcher.on("error", () => {
        if (state.watcher === watcher) {
          state.watcher = undefined;
          state.watchedPath = undefined;
        }
      });
      state.watcher = watcher;
      state.watchedPath = watchPath;
    } catch {
      // Polling remains active when fs.watch is unavailable or races a rename.
    }
  }

  private findExistingWatchPath(state: RunState): string | undefined {
    const projectsRoot = path.join(this.claudeConfigDir, "projects");
    let candidate = state.transcriptDir;
    while (isPathInside(projectsRoot, candidate)) {
      try {
        if (fs.statSync(candidate).isDirectory()) return candidate;
      } catch {
        // Walk upward until an existing directory can be watched.
      }
      if (candidate === projectsRoot) break;
      candidate = path.dirname(candidate);
    }
    return undefined;
  }

  private async requestRefresh(state: RunState, flushPartial = false): Promise<void> {
    if (state.terminal || this.disposed) return;

    state.readRequested = true;
    state.flushPartialRequested ||= flushPartial;
    if (state.readPromise) return state.readPromise;

    state.readPromise = (async () => {
      while (state.readRequested && !state.terminal && !this.disposed) {
        state.readRequested = false;
        const shouldFlushPartial = state.flushPartialRequested;
        state.flushPartialRequested = false;
        await this.readJournal(state, shouldFlushPartial);
      }
    })().finally(() => {
      state.readPromise = undefined;
    });
    return state.readPromise;
  }

  private async readJournal(state: RunState, flushPartial: boolean): Promise<void> {
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(state.journalPath, "r");
      const stat = await handle.stat();
      const identity = `${stat.dev}:${stat.ino}`;
      const sameSizeReplacement = state.lastMtimeMs !== undefined
        && stat.size === state.offset
        && stat.mtimeMs !== state.lastMtimeMs;
      if (
        (state.fileIdentity !== undefined && state.fileIdentity !== identity)
        || stat.size < state.offset
        || sameSizeReplacement
      ) {
        state.offset = 0;
        state.pending = Buffer.alloc(0);
      }
      state.fileIdentity = identity;

      const unreadLength = Math.max(0, stat.size - state.offset);
      if (unreadLength > 0) {
        const chunk = Buffer.alloc(unreadLength);
        const { bytesRead } = await handle.read(chunk, 0, unreadLength, state.offset);
        if (bytesRead > 0) {
          state.offset += bytesRead;
          await this.consumeBytes(state, chunk.subarray(0, bytesRead));
        }
      }
      state.lastMtimeMs = stat.mtimeMs;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code !== "ENOENT") {
        console.warn(`[workflow-agent-journal] Could not read ${state.journalPath}:`, error);
      }
    } finally {
      await handle?.close();
      this.ensureWatcher(state);
    }

    if (flushPartial && state.pending.length > 0) {
      const finalLine = state.pending.toString("utf8").replace(/\r$/, "").trim();
      state.pending = Buffer.alloc(0);
      if (finalLine) await this.processJournalLine(state, finalLine);
    }
  }

  private async consumeBytes(state: RunState, chunk: Buffer): Promise<void> {
    const data = state.pending.length > 0 ? Buffer.concat([state.pending, chunk]) : chunk;
    const lines: string[] = [];
    let lineStart = 0;
    for (let index = 0; index < data.length; index += 1) {
      if (data[index] !== 0x0a) continue;
      const line = data.subarray(lineStart, index).toString("utf8").replace(/\r$/, "").trim();
      if (line) lines.push(line);
      lineStart = index + 1;
    }
    state.pending = data.subarray(lineStart);
    for (const line of lines) {
      await this.processJournalLine(state, line);
    }
  }

  private async processJournalLine(state: RunState, line: string): Promise<void> {
    const event = parseJournalLine(line);
    if (!event) return;

    const signature = `${event.type}:${event.key}:${event.agentId}`;
    if (state.seenJournalEvents.has(signature)) return;
    state.seenJournalEvents.add(signature);

    if (event.type === "started") {
      await this.ensureAgent(state, event, false);
      return;
    }

    const agent = await this.ensureAgent(state, event, true);
    if (!agent.outcome) {
      this.completeAgent(
        state,
        agent,
        "completed",
        this.boundSummary(event.result),
        "journal",
        this.nowIso(),
      );
    }
  }

  private async ensureAgent(
    state: RunState,
    event: ParsedJournalEvent,
    synthesized: boolean,
  ): Promise<AgentState> {
    const existing = state.agents.get(event.agentId);
    if (existing) return existing;

    const agentIndex = state.nextAgentIndex;
    state.nextAgentIndex += 1;
    const prompt = await this.readInitialPrompt(state, event.agentId);
    const agent: AgentState = {
      agentId: event.agentId,
      journalKey: event.key,
      agentIndex,
      agentLabel: `Agent ${agentIndex}`,
      toolUseId: `workflow:${state.launch.runId}:${event.agentId}`,
      startedAt: this.nowIso(),
      synthesized,
      ...(prompt ? { prompt } : {}),
    };
    state.agents.set(agent.agentId, agent);
    this.safeCallback(this.callbacks.onAgentStarted, this.startedEvent(state, agent));
    return agent;
  }

  private completeAgent(
    state: RunState,
    agent: AgentState,
    outcome: WorkflowJournalOutcome,
    summary: string | undefined,
    source: "journal" | "terminal",
    completedAt: string,
  ): void {
    if (agent.outcome) return;
    agent.outcome = outcome;
    agent.completedAt = completedAt;
    agent.summary = summary;
    this.safeCallback(this.callbacks.onAgentCompleted, {
      ...this.startedEvent(state, agent),
      outcome,
      ...(summary ? { summary } : {}),
      source,
      completedAt,
    });
  }

  private startedEvent(
    state: RunState,
    agent: AgentState,
  ): WorkflowJournalAgentStartedEvent {
    return {
      hostTaskId: state.launch.hostTaskId,
      workflowTaskId: state.launch.taskId,
      sessionId: state.launch.sessionId,
      runId: state.launch.runId,
      parentToolUseId: state.launch.toolUseId,
      transcriptDir: state.transcriptDir,
      agentId: agent.agentId,
      journalKey: agent.journalKey,
      agentIndex: agent.agentIndex,
      agentLabel: agent.agentLabel,
      toolUseId: agent.toolUseId,
      observedAt: agent.startedAt,
      synthesized: agent.synthesized,
      ...(agent.prompt ? { prompt: agent.prompt } : {}),
    };
  }

  private async readInitialPrompt(
    state: RunState,
    agentId: string,
  ): Promise<string | undefined> {
    if (!isSafePathSegment(agentId)) return undefined;
    const transcriptPath = path.join(state.transcriptDir, `agent-${agentId}.jsonl`);
    let handle: fs.promises.FileHandle | undefined;
    try {
      handle = await fs.promises.open(transcriptPath, "r");
      const stat = await handle.stat();
      const byteCount = Math.min(stat.size, MAX_INITIAL_TRANSCRIPT_BYTES);
      if (byteCount <= 0) return undefined;

      const buffer = Buffer.alloc(byteCount);
      const { bytesRead } = await handle.read(buffer, 0, byteCount, 0);
      const lines = buffer.subarray(0, bytesRead).toString("utf8").split(/\r?\n/);
      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        let entry: Record<string, unknown> | undefined;
        try {
          entry = asRecord(JSON.parse(trimmed));
        } catch {
          continue;
        }
        const prompt = this.extractPromptFromTranscriptEntry(entry);
        if (prompt) return prompt;
      }
    } catch {
      // Agent transcripts are optional and may not exist yet when start lands.
    } finally {
      await handle?.close();
    }
    return undefined;
  }

  private extractPromptFromTranscriptEntry(
    entry: Record<string, unknown> | undefined,
  ): string | undefined {
    if (!entry) return undefined;
    const message = asRecord(entry.message);
    if (firstString(message?.role)?.toLowerCase() !== "user") {
      return undefined;
    }

    const content = message?.content;
    if (typeof content === "string") return this.boundPrompt(content);
    if (!Array.isArray(content)) return undefined;

    const parts: string[] = [];
    for (const item of content) {
      if (typeof item === "string") {
        parts.push(item);
        continue;
      }
      const block = asRecord(item);
      if (block?.type === "text" && typeof block.text === "string") {
        parts.push(block.text);
      }
    }
    return this.boundPrompt(parts.join("\n"));
  }

  private async enrichFromFinalSnapshot(state: RunState): Promise<void> {
    const sessionDir = path.resolve(state.transcriptDir, "..", "..", "..");
    const snapshotPath = path.join(sessionDir, "workflows", `${state.launch.runId}.json`);
    let snapshot: Record<string, unknown> | undefined;
    try {
      snapshot = asRecord(JSON.parse(await fs.promises.readFile(snapshotPath, "utf8")));
    } catch {
      // The authoritative snapshot is optional. Journal state remains usable.
      return;
    }
    if (!snapshot) return;
    const snapshotRunId = firstString(snapshot.runId);
    if (snapshotRunId && snapshotRunId !== state.launch.runId) return;

    const progressRows = snapshot.workflowProgress;
    if (!Array.isArray(progressRows)) return;
    for (const value of progressRows) {
      const row = asRecord(value);
      if (firstString(row?.type) !== "workflow_agent") continue;
      const agentId = firstString(row?.agentId);
      if (!agentId || !isSafePathSegment(agentId)) continue;

      const agent = await this.ensureAgent(state, {
        type: "started",
        key: firstString(row?.key) ?? `snapshot:${agentId}`,
        agentId,
      }, true);
      if (!agent.prompt) {
        agent.prompt = await this.readInitialPrompt(state, agentId)
          ?? this.boundPrompt(row?.prompt);
      }

      const officialLabel = this.boundLabel(stripWorkflowLabelPrefix(row?.label));
      if (officialLabel) {
        agent.officialLabel = officialLabel;
        agent.agentLabel = officialLabel;
      }
      agent.promptPreview = this.boundSummary(row?.promptPreview);
      agent.workflowState = this.boundLabel(firstString(row?.state));
      agent.workflowOutcome = normalizeWorkflowOutcome(
        row?.outcome ?? row?.status ?? row?.state,
      );
      agent.startedAtMs = finiteNumber(row?.startedAt);
      agent.queuedAtMs = finiteNumber(row?.queuedAt);
      agent.lastProgressAtMs = finiteNumber(row?.lastProgressAt);
      agent.durationMs = finiteNumber(row?.durationMs);
      agent.resultPreview = this.boundSummary(row?.resultPreview);
      agent.model = this.boundLabel(firstString(row?.model));
      agent.phaseTitle = this.boundLabel(firstString(row?.phaseTitle));
      agent.tokens = finiteNumber(row?.tokens);
      agent.toolCalls = finiteNumber(row?.toolCalls);
      if (agent.resultPreview) agent.summary = agent.resultPreview;
    }
  }

  private snapshot(state: RunState): WorkflowJournalRunSnapshot {
    const agents = this.orderedAgents(state).map((agent): WorkflowJournalAgentSnapshot => ({
      agentId: agent.agentId,
      journalKey: agent.journalKey,
      agentIndex: agent.agentIndex,
      agentLabel: agent.agentLabel,
      toolUseId: agent.toolUseId,
      status: agent.outcome ?? "running",
      startedAt: agent.startedAt,
      ...(agent.completedAt ? { completedAt: agent.completedAt } : {}),
      ...(agent.summary ? { summary: agent.summary } : {}),
      synthesized: agent.synthesized,
      ...(agent.prompt ? { prompt: agent.prompt } : {}),
      ...(agent.promptPreview ? { promptPreview: agent.promptPreview } : {}),
      ...(agent.officialLabel ? { officialLabel: agent.officialLabel } : {}),
      ...(agent.workflowState ? { workflowState: agent.workflowState } : {}),
      ...(agent.workflowOutcome ? { workflowOutcome: agent.workflowOutcome } : {}),
      ...(agent.startedAtMs !== undefined ? { startedAtMs: agent.startedAtMs } : {}),
      ...(agent.queuedAtMs !== undefined ? { queuedAtMs: agent.queuedAtMs } : {}),
      ...(agent.lastProgressAtMs !== undefined ? { lastProgressAtMs: agent.lastProgressAtMs } : {}),
      ...(agent.durationMs !== undefined ? { durationMs: agent.durationMs } : {}),
      ...(agent.resultPreview ? { resultPreview: agent.resultPreview } : {}),
      ...(agent.model ? { model: agent.model } : {}),
      ...(agent.phaseTitle ? { phaseTitle: agent.phaseTitle } : {}),
      ...(agent.tokens !== undefined ? { tokens: agent.tokens } : {}),
      ...(agent.toolCalls !== undefined ? { toolCalls: agent.toolCalls } : {}),
    }));
    const completedCount = agents.filter((agent) => agent.status !== "running").length;

    return {
      hostTaskId: state.launch.hostTaskId,
      workflowTaskId: state.launch.taskId,
      sessionId: state.launch.sessionId,
      runId: state.launch.runId,
      parentToolUseId: state.launch.toolUseId,
      transcriptDir: state.transcriptDir,
      journalPath: state.journalPath,
      ...(state.launch.scriptPath ? { scriptPath: state.launch.scriptPath } : {}),
      ...(state.launch.workflowName ? { workflowName: state.launch.workflowName } : {}),
      ...(this.boundSummary(state.launch.summary) ? { launchSummary: this.boundSummary(state.launch.summary) } : {}),
      agents,
      startedCount: agents.length,
      completedCount,
      outstandingCount: agents.length - completedCount,
      ...(state.terminal ? { terminal: { ...state.terminal } } : {}),
    };
  }

  private orderedAgents(state: RunState): AgentState[] {
    return [...state.agents.values()].sort((left, right) => left.agentIndex - right.agentIndex);
  }

  private boundSummary(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    if (normalized.length <= this.maxSummaryLength) return normalized;
    return `${normalized.slice(0, Math.max(0, this.maxSummaryLength - 1)).trimEnd()}…`;
  }

  private boundPrompt(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    if (normalized.length <= this.maxPromptLength) return normalized;
    return `${normalized.slice(0, Math.max(0, this.maxPromptLength - 1)).trimEnd()}…`;
  }

  private boundLabel(value: unknown): string | undefined {
    if (typeof value !== "string") return undefined;
    const normalized = value.replace(/\s+/g, " ").trim();
    if (!normalized) return undefined;
    const maxLength = Math.min(200, this.maxSummaryLength);
    if (normalized.length <= maxLength) return normalized;
    return `${normalized.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
  }

  private nowIso(): string {
    return this.now().toISOString();
  }

  private safeCallback<T>(callback: ((value: T) => void) | undefined, value: T): void {
    if (!callback) return;
    try {
      callback(value);
    } catch (error) {
      console.warn("[workflow-agent-journal] Callback failed:", error);
    }
  }

  private stopResources(state: RunState): void {
    if (state.poller) {
      clearInterval(state.poller);
      state.poller = undefined;
    }
    state.watcher?.close();
    state.watcher = undefined;
    state.watchedPath = undefined;
  }
}
