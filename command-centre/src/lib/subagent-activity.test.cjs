const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const subagentActivitySourcePath = path.resolve(__dirname, "subagent-activity.ts");

function loadSubagentActivityModule() {
  const source = fs.readFileSync(subagentActivitySourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === "@/types/task") {
      return {};
    }
    return require(request);
  };

  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(subagentActivitySourcePath), subagentActivitySourcePath);
  return module.exports;
}

function agentToolUse(id, agentName, prompt, index = 0) {
  return {
    id: `log-${id}`,
    type: "tool_use",
    timestamp: `2026-07-06T12:00:0${index}.000Z`,
    content: "Agent",
    toolName: "Agent",
    toolUseId: id,
    toolArgs: JSON.stringify({
      subagent_type: agentName,
      prompt,
    }),
  };
}

function toolResult(id, index = 5) {
  return {
    id: `result-${id}`,
    type: "tool_result",
    timestamp: `2026-07-06T12:00:0${index}.000Z`,
    content: "Done",
    toolUseId: id,
    toolResult: "Done",
  };
}

function workflowAgentToolUse(runId, agentId, index, prompt = `Run workflow agent ${index}.`) {
  return {
    id: `workflow-start-${runId}-${agentId}`,
    type: "tool_use",
    timestamp: `2026-07-06T12:01:0${index}.000Z`,
    content: "Agent",
    toolName: "Agent",
    toolUseId: `workflow:${runId}:${agentId}`,
    toolArgs: JSON.stringify({
      source: "workflow",
      workflowRunId: runId,
      workflowAgentId: agentId,
      agentIndex: index,
      subagent_type: `Agent ${index}`,
      prompt,
    }),
  };
}

function workflowAgentClose(runId, agentId, index, status = "completed") {
  return {
    id: `workflow-close-${runId}-${agentId}`,
    type: "tool_result",
    timestamp: `2026-07-06T12:02:0${index}.000Z`,
    content: `Agent ${status}`,
    toolName: "AgentNotification",
    toolUseId: `workflow:${runId}:${agentId}`,
    toolResult: `Agent ${status}`,
    toolArgs: JSON.stringify({ source: "workflow", workflowRunId: runId, status }),
  };
}

function workflowAgentMetadata(runId, agentId, index, overrides = {}) {
  return {
    id: `workflow-metadata-${runId}-${agentId}`,
    type: "tool_result",
    timestamp: `2026-07-06T12:03:0${index}.000Z`,
    content: "Workflow agent metadata",
    toolName: "WorkflowAgentMetadata",
    toolUseId: `workflow:${runId}:${agentId}`,
    toolArgs: JSON.stringify({
      source: "workflow",
      workflowRunId: runId,
      workflowAgentId: agentId,
      agentName: `Official agent ${index}`,
      prompt: `Official instructions ${index}.`,
      status: "completed",
      ...overrides,
    }),
  };
}

test("buildSubagentActivityModel builds Creating and Created labels from agent starts", () => {
  const {
    buildSubagentActivityModel,
    formatCreatedAgentsLabel,
  } = loadSubagentActivityModule();
  const starts = [
    agentToolUse("toolu-1", "Ramanujan", "Check the numbers.", 1),
    agentToolUse("toolu-2", "Godel", "Check the logic.", 2),
    agentToolUse("toolu-3", "Anscombe", "Check the explanation.", 3),
  ];

  const live = buildSubagentActivityModel(starts);
  assert.equal(live.activeCount, 3);
  assert.equal(formatCreatedAgentsLabel(starts.length, live.activeCount > 0), "Creating 3 agents");
  assert.equal(live.eventsByEntryId.get("log-toolu-1").source, "direct");
  assert.equal(live.eventsByEntryId.get("log-toolu-1").groupKey, "direct");

  const closed = buildSubagentActivityModel([
    ...starts,
    toolResult("toolu-1", 4),
    toolResult("toolu-2", 5),
    toolResult("toolu-3", 6),
  ]);
  assert.equal(closed.activeCount, 0);
  assert.equal(formatCreatedAgentsLabel(starts.length, closed.activeCount > 0), "Created 3 agents");
});

test("buildSubagentActivityModel builds Closed groups from matching results", () => {
  const {
    buildSubagentActivityModel,
    formatClosedAgentsLabel,
  } = loadSubagentActivityModule();
  const entries = [
    agentToolUse("toolu-1", "Ramanujan", "Check the numbers.", 1),
    agentToolUse("toolu-2", "Godel", "Check the logic.", 2),
    toolResult("toolu-1", 3),
    toolResult("toolu-2", 4),
  ];

  const model = buildSubagentActivityModel(entries);
  const closedEvents = [...model.eventsByEntryId.values()].filter((event) => event.kind === "closed");

  assert.equal(closedEvents.length, 2);
  assert.deepEqual(closedEvents.map((event) => event.agentName), ["Ramanujan", "Godel"]);
  assert.equal(formatClosedAgentsLabel(closedEvents.length), "Closed 2 agents");
});

test("buildSubagentActivityModel builds Closed groups from task-notification results", () => {
  const {
    buildSubagentActivityModel,
    formatClosedAgentsLabel,
  } = loadSubagentActivityModule();
  const entries = [
    agentToolUse("toolu-1", "Ramanujan", "Check the numbers.", 1),
    agentToolUse("toolu-2", "Godel", "Check the logic.", 2),
    {
      ...toolResult("toolu-1", 3),
      toolName: "AgentNotification",
    },
    {
      ...toolResult("toolu-2", 4),
      toolName: "AgentNotification",
    },
  ];

  const model = buildSubagentActivityModel(entries);
  const closedEvents = [...model.eventsByEntryId.values()].filter((event) => event.kind === "closed");

  assert.equal(model.activeCount, 0);
  assert.equal(closedEvents.length, 2);
  assert.equal(formatClosedAgentsLabel(closedEvents.length), "Closed 2 agents");
});

test("Workflow agents use run-scoped lifecycle groups while Workflow stays generic", () => {
  const {
    buildSubagentActivityModel,
    isSubagentToolUse,
  } = loadSubagentActivityModule();
  const first = workflowAgentToolUse("run-a", "agent-1", 1);
  const second = workflowAgentToolUse("run-a", "agent-2", 2);
  const otherRun = workflowAgentToolUse("run-b", "agent-1", 1);

  const model = buildSubagentActivityModel([first, second, otherRun]);
  assert.equal(model.activeCount, 3);
  assert.deepEqual(
    [...model.eventsByEntryId.values()].map((event) => [event.source, event.groupKey]),
    [
      ["workflow", "workflow:run-a"],
      ["workflow", "workflow:run-a"],
      ["workflow", "workflow:run-b"],
    ],
  );
  assert.equal(isSubagentToolUse({ ...first, toolName: "Workflow" }), false);
});

test("Workflow metadata enriches created and closed events without closing the agent", () => {
  const { buildSubagentActivityModel } = loadSubagentActivityModule();
  const start = workflowAgentToolUse("run-a", "agent-1", 1, "Synthetic prompt.");
  const metadata = workflowAgentMetadata("run-a", "agent-1", 1, { status: "failed" });

  const stillOpen = buildSubagentActivityModel([start, metadata]);
  assert.equal(stillOpen.activeCount, 1);
  assert.equal(stillOpen.eventsByEntryId.has(metadata.id), false);
  assert.equal(stillOpen.eventsByEntryId.get(start.id).agentName, "Official agent 1");
  assert.equal(stillOpen.eventsByEntryId.get(start.id).instructions, "Official instructions 1.");
  assert.equal(stillOpen.eventsByEntryId.get(start.id).outcome, "failed");

  const close = workflowAgentClose("run-a", "agent-1", 1, "failed");
  const enrichedAfterClose = buildSubagentActivityModel([start, close, metadata]);
  const createdEvent = enrichedAfterClose.eventsByEntryId.get(start.id);
  const closedEvent = enrichedAfterClose.eventsByEntryId.get(close.id);
  assert.equal(enrichedAfterClose.activeCount, 0);
  assert.equal(enrichedAfterClose.eventsByEntryId.has(metadata.id), false);
  assert.equal(createdEvent.agentName, "Official agent 1");
  assert.equal(createdEvent.instructions, "Official instructions 1.");
  assert.equal(createdEvent.outcome, "failed");
  assert.equal(closedEvent.agentName, "Official agent 1");
  assert.equal(closedEvent.instructions, "Official instructions 1.");
  assert.equal(closedEvent.outcome, "failed");
});

test("lifecycle grouping requires both matching kind and source group", () => {
  const {
    buildSubagentActivityModel,
    shouldGroupSubagentActivityEvents,
  } = loadSubagentActivityModule();
  const direct = buildSubagentActivityModel([agentToolUse("direct-1", "Direct", "Direct prompt.", 1)])
    .eventsByEntryId.get("log-direct-1");
  const runA = buildSubagentActivityModel([workflowAgentToolUse("run-a", "agent-1", 1)])
    .eventsByEntryId.get("workflow-start-run-a-agent-1");
  const runASecond = buildSubagentActivityModel([workflowAgentToolUse("run-a", "agent-2", 2)])
    .eventsByEntryId.get("workflow-start-run-a-agent-2");
  const runB = buildSubagentActivityModel([workflowAgentToolUse("run-b", "agent-1", 1)])
    .eventsByEntryId.get("workflow-start-run-b-agent-1");
  const runAClosed = buildSubagentActivityModel([
    workflowAgentToolUse("run-a", "agent-3", 3),
    workflowAgentClose("run-a", "agent-3", 3),
  ]).eventsByEntryId.get("workflow-close-run-a-agent-3");

  assert.equal(shouldGroupSubagentActivityEvents(runA, runASecond), true);
  assert.equal(shouldGroupSubagentActivityEvents(runA, runB), false);
  assert.equal(shouldGroupSubagentActivityEvents(runA, direct), false);
  assert.equal(shouldGroupSubagentActivityEvents(runA, runAClosed), false);
});

test("truncateAgentInstructions keeps prompt previews short", () => {
  const { truncateAgentInstructions } = loadSubagentActivityModule();
  const preview = truncateAgentInstructions(
    "Read the whole generated report, compare it against the brief, and return only the gaps.",
    36,
  );

  assert.equal(preview.length <= 36, true);
  assert.match(preview, /\.\.\.$/);
});

test("legacy subagent logs without toolUseId close best-effort", () => {
  const {
    buildSubagentActivityModel,
    formatClosedAgentsLabel,
  } = loadSubagentActivityModule();
  const entries = [
    {
      id: "legacy-agent",
      type: "tool_use",
      timestamp: "2026-07-06T12:00:01.000Z",
      content: "Task",
      toolName: "Task",
      toolArgs: JSON.stringify({ description: "Audit docs", prompt: "Audit the docs." }),
    },
    {
      id: "legacy-result",
      type: "tool_result",
      timestamp: "2026-07-06T12:00:02.000Z",
      content: "Done",
      toolResult: "Done",
    },
  ];

  const model = buildSubagentActivityModel(entries);
  const closeEvent = model.eventsByEntryId.get("legacy-result");

  assert.equal(model.activeCount, 0);
  assert.equal(closeEvent?.kind, "closed");
  assert.equal(closeEvent?.reliableMatch, false);
  assert.equal(formatClosedAgentsLabel(1), "Closed an agent");
});
