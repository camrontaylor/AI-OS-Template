import type { LogEntry } from "@/types/task";

export type SubagentActivityKind = "created" | "closed";
export type SubagentActivitySource = "direct" | "workflow";

export interface SubagentActivityEvent {
  kind: SubagentActivityKind;
  source: SubagentActivitySource;
  groupKey: string;
  entryId: string;
  timestamp: string;
  toolUseKey: string;
  toolUseId?: string;
  agentName: string;
  instructions: string | null;
  outcome?: string;
  reliableMatch: boolean;
}

export interface SubagentActivityModel {
  eventsByEntryId: Map<string, SubagentActivityEvent>;
  activeKeys: Set<string>;
  activeCount: number;
}

const SUBAGENT_TOOL_NAMES = new Set(["agent", "task"]);
const WORKFLOW_AGENT_METADATA_TOOL_NAME = "workflowagentmetadata";
const INSTRUCTION_PREVIEW_LIMIT = 110;

function parseArgs(entry: LogEntry): Record<string, unknown> {
  if (!entry.toolArgs) return {};
  try {
    const parsed = JSON.parse(entry.toolArgs);
    return parsed && typeof parsed === "object" ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function firstString(args: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = args[key];
    if (typeof value === "string" && value.trim()) {
      return value.trim();
    }
  }
  return null;
}

export function isSubagentToolUse(entry: LogEntry): boolean {
  return entry.type === "tool_use" && SUBAGENT_TOOL_NAMES.has((entry.toolName || "").toLowerCase());
}

export function getSubagentName(entry: LogEntry): string {
  const args = parseArgs(entry);
  const explicitName = firstString(args, ["subagent_type", "agent", "agent_name", "name"]);
  if (explicitName) return explicitName;

  const description = firstString(args, ["description"]);
  if (description && description.length <= 48) return description;

  return "agent";
}

export function getSubagentInstructions(entry: LogEntry): string | null {
  const args = parseArgs(entry);
  return firstString(args, ["prompt", "instructions", "task", "description"]);
}

function getSubagentSource(args: Record<string, unknown>): SubagentActivitySource {
  return firstString(args, ["source"])?.toLowerCase() === "workflow" ? "workflow" : "direct";
}

function getWorkflowRunId(args: Record<string, unknown>): string | null {
  return firstString(args, ["workflowRunId", "workflow_run_id"]);
}

function getWorkflowAgentId(args: Record<string, unknown>): string | null {
  return firstString(args, ["workflowAgentId", "workflow_agent_id"]);
}

function getActivityGroupKey(
  source: SubagentActivitySource,
  args: Record<string, unknown>,
): string {
  if (source === "direct") return "direct";
  return `workflow:${getWorkflowRunId(args) ?? "unknown"}`;
}

function getActivityToolUseKey(
  entry: LogEntry,
  source: SubagentActivitySource,
  args: Record<string, unknown>,
): string {
  if (entry.toolUseId) return entry.toolUseId;
  if (source === "workflow") {
    const runId = getWorkflowRunId(args);
    const agentId = getWorkflowAgentId(args);
    if (runId && agentId) return `workflow:${runId}:${agentId}`;
  }
  return `legacy:${entry.id}`;
}

function getActivityOutcome(args: Record<string, unknown>): string | undefined {
  return firstString(args, ["status", "outcome"])?.toLowerCase();
}

function isWorkflowAgentMetadata(entry: LogEntry): boolean {
  return entry.type === "tool_result"
    && (entry.toolName || "").toLowerCase() === WORKFLOW_AGENT_METADATA_TOOL_NAME;
}

interface WorkflowAgentMetadata {
  agentName?: string;
  instructions?: string;
  outcome?: string;
}

function readWorkflowAgentMetadata(entry: LogEntry): WorkflowAgentMetadata {
  const args = parseArgs(entry);
  const agentName = firstString(args, ["agentName", "agent_name", "name"]);
  const instructions = firstString(args, ["prompt", "instructions"]);
  const outcome = getActivityOutcome(args);
  return {
    ...(agentName ? { agentName } : {}),
    ...(instructions ? { instructions } : {}),
    ...(outcome ? { outcome } : {}),
  };
}

function enrichSubagentEvent(
  event: SubagentActivityEvent,
  metadata: WorkflowAgentMetadata,
): void {
  if (metadata.agentName) event.agentName = metadata.agentName;
  if (metadata.instructions) event.instructions = metadata.instructions;
  if (metadata.outcome) event.outcome = metadata.outcome;
}

export function shouldGroupSubagentActivityEvents(
  current: SubagentActivityEvent,
  next: SubagentActivityEvent,
): boolean {
  return current.kind === next.kind && current.groupKey === next.groupKey;
}

export function truncateAgentInstructions(value: string | null, maxLength = INSTRUCTION_PREVIEW_LIMIT): string {
  const text = (value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  if (text.length <= maxLength) return text;
  if (maxLength <= 3) return ".".repeat(Math.max(0, maxLength));
  return `${text.slice(0, maxLength - 3).trimEnd()}...`;
}

export function formatCreatedAgentsLabel(count: number, hasActive: boolean): string {
  const verb = hasActive ? "Creating" : "Created";
  return count === 1 ? `${verb} an agent` : `${verb} ${count} agents`;
}

export function formatClosedAgentsLabel(count: number): string {
  return count === 1 ? "Closed an agent" : `Closed ${count} agents`;
}

export function buildSubagentActivityModel(entries: LogEntry[]): SubagentActivityModel {
  const eventsByEntryId = new Map<string, SubagentActivityEvent>();
  const openByKey = new Map<string, SubagentActivityEvent>();
  const eventsByKey = new Map<string, SubagentActivityEvent[]>();
  const metadataByKey = new Map<string, WorkflowAgentMetadata>();
  const legacyOpenKeys: string[] = [];
  const seenToolUseKeys = new Set<string>();

  const rememberEvent = (event: SubagentActivityEvent) => {
    const metadata = metadataByKey.get(event.toolUseKey);
    if (metadata) enrichSubagentEvent(event, metadata);
    const history = eventsByKey.get(event.toolUseKey) ?? [];
    history.push(event);
    eventsByKey.set(event.toolUseKey, history);
    eventsByEntryId.set(event.entryId, event);
  };

  for (const entry of entries) {
    if (isSubagentToolUse(entry)) {
      const args = parseArgs(entry);
      const source = getSubagentSource(args);
      const toolUseKey = getActivityToolUseKey(entry, source, args);
      if (entry.toolUseId && seenToolUseKeys.has(toolUseKey)) {
        continue;
      }
      if (entry.toolUseId) {
        seenToolUseKeys.add(toolUseKey);
      }

      const event: SubagentActivityEvent = {
        kind: "created",
        source,
        groupKey: getActivityGroupKey(source, args),
        entryId: entry.id,
        timestamp: entry.timestamp,
        toolUseKey,
        ...(entry.toolUseId ? { toolUseId: entry.toolUseId } : {}),
        agentName: getSubagentName(entry),
        instructions: getSubagentInstructions(entry),
        reliableMatch: Boolean(entry.toolUseId),
      };
      rememberEvent(event);
      openByKey.set(toolUseKey, event);
      if (!entry.toolUseId) {
        legacyOpenKeys.push(toolUseKey);
      }
      continue;
    }

    if (isWorkflowAgentMetadata(entry)) {
      const args = parseArgs(entry);
      const source = getSubagentSource(args);
      const toolUseKey = getActivityToolUseKey(entry, source, args);
      const metadata = {
        ...metadataByKey.get(toolUseKey),
        ...readWorkflowAgentMetadata(entry),
      };
      metadataByKey.set(toolUseKey, metadata);
      for (const event of eventsByKey.get(toolUseKey) ?? []) {
        enrichSubagentEvent(event, metadata);
      }
      // Metadata refines lifecycle rows. It is never itself a close event.
      continue;
    }

    if (entry.type !== "tool_result") {
      continue;
    }

    let toolUseKey: string | null = null;
    let reliableMatch = false;
    if (entry.toolUseId && openByKey.has(entry.toolUseId)) {
      toolUseKey = entry.toolUseId;
      reliableMatch = true;
    } else if (!entry.toolUseId && legacyOpenKeys.length > 0) {
      toolUseKey = legacyOpenKeys.shift() ?? null;
    }

    if (!toolUseKey) {
      continue;
    }

    const created = openByKey.get(toolUseKey);
    if (!created) {
      continue;
    }
    openByKey.delete(toolUseKey);

    const resultArgs = parseArgs(entry);
    const outcome = getActivityOutcome(resultArgs) ?? created.outcome;
    const event: SubagentActivityEvent = {
      kind: "closed",
      source: created.source,
      groupKey: created.groupKey,
      entryId: entry.id,
      timestamp: entry.timestamp,
      toolUseKey,
      ...(created.toolUseId ? { toolUseId: created.toolUseId } : {}),
      agentName: created.agentName,
      instructions: created.instructions,
      ...(outcome ? { outcome } : {}),
      reliableMatch,
    };
    rememberEvent(event);
  }

  return {
    eventsByEntryId,
    activeKeys: new Set(openByKey.keys()),
    activeCount: openByKey.size,
  };
}
