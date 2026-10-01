const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const sourcePath = path.resolve(__dirname, "workflow-agent-journal.ts");
const { WorkflowAgentJournalBridge } = loadTsModule(sourcePath);

function journalLine(value) {
  return `${JSON.stringify(value)}\n`;
}

async function waitFor(predicate, message, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 15));
  }
  assert.fail(message);
}

async function makeLayout(t, options = {}) {
  const root = await fs.promises.mkdtemp(path.join(os.tmpdir(), "workflow-agent-journal-"));
  const claudeConfigDir = path.join(root, ".claude");
  const projectKey = options.projectKey ?? "C--workspace";
  const sessionId = options.sessionId ?? "session-1";
  const runId = options.runId ?? "wf_run-1";
  const workflowsDir = path.join(
    claudeConfigDir,
    "projects",
    projectKey,
    sessionId,
    "subagents",
    "workflows",
  );
  const sessionDir = path.resolve(workflowsDir, "..", "..");
  const transcriptDir = path.join(workflowsDir, runId);
  await fs.promises.mkdir(
    options.createTranscriptDir === false ? workflowsDir : transcriptDir,
    { recursive: true },
  );
  t.after(async () => {
    await fs.promises.rm(root, { recursive: true, force: true });
  });
  return {
    root,
    claudeConfigDir,
    projectKey,
    sessionId,
    runId,
    workflowsDir,
    sessionDir,
    transcriptDir,
    journalPath: path.join(transcriptDir, "journal.jsonl"),
    snapshotPath: path.join(sessionDir, "workflows", `${runId}.json`),
  };
}

function launchFor(layout, overrides = {}) {
  return {
    hostTaskId: "host-task-1",
    sessionId: layout.sessionId,
    toolUseId: "tool-workflow-1",
    taskId: "workflow-task-1",
    runId: layout.runId,
    transcriptDir: layout.transcriptDir,
    scriptPath: path.join(layout.transcriptDir, "script.js"),
    workflowName: "Research workflow",
    summary: "Launch metadata",
    ...overrides,
  };
}

function makeBridge(t, layout, options = {}) {
  const bridge = new WorkflowAgentJournalBridge({
    claudeConfigDir: layout.claudeConfigDir,
    pollIntervalMs: 20,
    ...options,
  });
  t.after(() => bridge.dispose());
  return bridge;
}

test("replays a complete journal from byte zero with stable per-run agent metadata", async (t) => {
  const layout = await makeLayout(t);
  const starts = [];
  const completions = [];
  const longResult = `finished ${"x".repeat(400)}`;
  const longPrompt = `Investigate this carefully ${"p".repeat(200)}`;
  await fs.promises.writeFile(
    path.join(layout.transcriptDir, "agent-agent-a.jsonl"),
    journalLine({ type: "user", message: { role: "user", content: longPrompt } }),
  );
  await fs.promises.writeFile(layout.journalPath, [
    journalLine({ type: "started", key: "v2:first", agentId: "agent-a" }),
    journalLine({ type: "started", key: "v2:second", agentId: "agent-b" }),
    journalLine({ type: "result", key: "v2:second", agentId: "agent-b", result: longResult }),
    journalLine({ type: "result", key: "v2:first", agentId: "agent-a", result: "done" }),
  ].join(""));

  const bridge = makeBridge(t, layout, {
    maxSummaryLength: 80,
    maxPromptLength: 90,
    onAgentStarted: (event) => starts.push(event),
    onAgentCompleted: (event) => completions.push(event),
  });
  const snapshot = await bridge.observeLaunch(launchFor(layout));

  assert.deepEqual(starts.map((event) => ({
    id: event.agentId,
    index: event.agentIndex,
    label: event.agentLabel,
    toolUseId: event.toolUseId,
  })), [
    {
      id: "agent-a",
      index: 1,
      label: "Agent 1",
      toolUseId: `${"workflow"}:${layout.runId}:agent-a`,
    },
    {
      id: "agent-b",
      index: 2,
      label: "Agent 2",
      toolUseId: `${"workflow"}:${layout.runId}:agent-b`,
    },
  ]);
  assert.equal(completions.length, 2);
  assert.equal(starts[0].prompt.length, 90);
  assert.match(starts[0].prompt, /…$/);
  assert.equal(starts[1].prompt, undefined);
  assert.equal(completions[0].source, "journal");
  assert.equal(completions[0].summary.length, 80);
  assert.match(completions[0].summary, /…$/);
  assert.equal(snapshot.startedCount, 2);
  assert.equal(snapshot.completedCount, 2);
  assert.equal(snapshot.outstandingCount, 0);
  assert.equal(snapshot.workflowTaskId, "workflow-task-1");
  assert.equal(snapshot.parentToolUseId, "tool-workflow-1");
  assert.equal(snapshot.workflowName, "Research workflow");
  assert.equal(snapshot.agents[0].prompt, starts[0].prompt);
});

test("polls and watches a run created after observation, buffering partial lines", async (t) => {
  const layout = await makeLayout(t, { createTranscriptDir: false });
  const starts = [];
  const completions = [];
  const bridge = makeBridge(t, layout, {
    onAgentStarted: (event) => starts.push(event),
    onAgentCompleted: (event) => completions.push(event),
  });

  const initial = await bridge.observeLaunch(launchFor(layout));
  assert.equal(initial.startedCount, 0);

  await fs.promises.mkdir(layout.transcriptDir);
  await fs.promises.writeFile(
    layout.journalPath,
    '{"type":"started","key":"v2:late","agentId":"agent-late"',
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(starts.length, 0, "an incomplete JSONL row must stay buffered");

  await fs.promises.appendFile(layout.journalPath, '}\nnot json\n{"type":"heartbeat"}\n');
  await waitFor(() => starts.length === 1, "late start was not observed");

  await fs.promises.appendFile(
    layout.journalPath,
    journalLine({ type: "result", key: "v2:late", agentId: "agent-late", result: "ok" }),
  );
  await waitFor(() => completions.length === 1, "late completion was not observed");
  assert.equal(completions[0].agentIndex, 1);
});

test("ignores duplicate rows and synthesizes a start for an out-of-order result", async (t) => {
  const layout = await makeLayout(t);
  const starts = [];
  const completions = [];
  const result = { type: "result", key: "v2:out-of-order", agentId: "agent-o", result: "ready" };
  await fs.promises.writeFile(layout.journalPath, [
    journalLine(result),
    journalLine(result),
    journalLine({ type: "started", key: "v2:out-of-order", agentId: "agent-o" }),
    journalLine({ type: "started", key: "v2:out-of-order", agentId: "agent-o" }),
  ].join(""));

  const bridge = makeBridge(t, layout, {
    onAgentStarted: (event) => starts.push(event),
    onAgentCompleted: (event) => completions.push(event),
  });
  const first = await bridge.observeLaunch(launchFor(layout));
  const second = await bridge.observeLaunch(launchFor(layout));

  assert.equal(starts.length, 1);
  assert.equal(starts[0].synthesized, true);
  assert.equal(completions.length, 1);
  assert.equal(first.completedCount, 1);
  assert.equal(second.completedCount, 1);
});

test("recovers from journal truncation without replaying already emitted starts", async (t) => {
  const layout = await makeLayout(t);
  const starts = [];
  const completions = [];
  await fs.promises.writeFile(layout.journalPath, [
    journalLine({ type: "started", key: "v2:truncate", agentId: "agent-t" }),
    journalLine({ type: "ignored", padding: "z".repeat(500) }),
  ].join(""));

  const bridge = makeBridge(t, layout, {
    onAgentStarted: (event) => starts.push(event),
    onAgentCompleted: (event) => completions.push(event),
  });
  await bridge.observeLaunch(launchFor(layout));
  assert.equal(starts.length, 1);

  await fs.promises.writeFile(
    layout.journalPath,
    journalLine({ type: "result", key: "v2:truncate", agentId: "agent-t", result: "after truncate" }),
  );
  await waitFor(() => completions.length === 1, "truncated journal result was not observed");
  assert.equal(starts.length, 1);
  assert.equal(completions[0].summary, "after truncate");
});

test("rejects transcript directories outside the current Claude session and run", async (t) => {
  const layout = await makeLayout(t);
  const bridge = makeBridge(t, layout);
  const outside = path.join(layout.root, "outside", layout.runId);
  await fs.promises.mkdir(outside, { recursive: true });

  await assert.rejects(
    bridge.observeLaunch(launchFor(layout, { transcriptDir: outside })),
    /outside the Claude projects directory/,
  );
  await assert.rejects(
    bridge.observeLaunch(launchFor(layout, { sessionId: "another-session" })),
    /does not match the current session and run/,
  );
  await assert.rejects(
    bridge.observeLaunch(launchFor(layout, { runId: "another-run" })),
    /does not match the current session and run/,
  );
  await assert.rejects(
    bridge.observeLaunch(launchFor(layout, {
      transcriptDir: path.join(layout.transcriptDir, "nested"),
    })),
    /does not match the current session and run/,
  );
});

test("rejects an existing transcript symlink that resolves outside Claude projects", async (t) => {
  const layout = await makeLayout(t, { createTranscriptDir: false });
  const outside = path.join(layout.root, "outside-run");
  await fs.promises.mkdir(outside);
  try {
    await fs.promises.symlink(outside, layout.transcriptDir, "junction");
  } catch (error) {
    if (["EPERM", "EACCES", "UNKNOWN"].includes(error.code)) {
      t.skip("This environment does not permit directory symlinks");
      return;
    }
    throw error;
  }

  const bridge = makeBridge(t, layout);
  await assert.rejects(
    bridge.observeLaunch(launchFor(layout)),
    /resolves outside the Claude projects directory/,
  );
});

test("terminal finalization closes outstanding agents once and bounds metadata", async (t) => {
  const layout = await makeLayout(t);
  const completions = [];
  const terminals = [];
  await fs.promises.writeFile(layout.journalPath, [
    journalLine({ type: "started", key: "v2:a", agentId: "agent-a" }),
    journalLine({ type: "started", key: "v2:b", agentId: "agent-b" }),
    journalLine({ type: "result", key: "v2:a", agentId: "agent-a", result: "done" }),
  ].join(""));

  const bridge = makeBridge(t, layout, {
    maxSummaryLength: 60,
    onAgentCompleted: (event) => completions.push(event),
    onRunTerminal: (snapshot) => terminals.push(snapshot),
  });
  await bridge.observeLaunch(launchFor(layout));
  const terminalInput = {
    hostTaskId: "host-task-1",
    runId: layout.runId,
    status: "failed",
    summary: `failure ${"s".repeat(200)}`,
    result: `raw ${"r".repeat(200)}`,
    outputFile: "result.json",
  };
  const [snapshot, duplicate] = await Promise.all([
    bridge.finalizeTerminal(terminalInput),
    bridge.finalizeTerminal({ ...terminalInput, status: "stopped" }),
  ]);

  assert.equal(completions.length, 2);
  assert.deepEqual(completions.map((event) => event.outcome), ["completed", "failed"]);
  assert.equal(completions[1].source, "terminal");
  assert.equal(snapshot.outstandingCount, 0);
  assert.equal(snapshot.terminal.status, "failed");
  assert.equal(snapshot.terminal.summary.length, 60);
  assert.equal(snapshot.terminal.resultSummary.length, 60);
  assert.equal(snapshot.terminal.outputFile, "result.json");
  assert.equal(duplicate.terminal.status, "failed");
  assert.equal(terminals.length, 1);
});

test("finalization enriches agents from the authoritative parent snapshot", async (t) => {
  const layout = await makeLayout(t);
  const starts = [];
  await fs.promises.writeFile(layout.journalPath, [
    journalLine({ type: "started", key: "v2:a", agentId: "agent-a" }),
    journalLine({ type: "result", key: "v2:a", agentId: "agent-a", result: "journal result" }),
  ].join(""));
  await fs.promises.writeFile(
    path.join(layout.transcriptDir, "agent-agent-a.jsonl"),
    journalLine({
      type: "user",
      message: { role: "user", content: [{ type: "text", text: `Full prompt ${"p".repeat(150)}` }] },
    }),
  );
  await fs.promises.writeFile(
    path.join(layout.transcriptDir, "agent-agent-b.jsonl"),
    journalLine({ type: "user", message: { role: "user", content: "Second prompt" } }),
  );
  await fs.promises.mkdir(path.dirname(layout.snapshotPath), { recursive: true });
  await fs.promises.writeFile(layout.snapshotPath, JSON.stringify({
    runId: layout.runId,
    status: "completed",
    workflowProgress: [
      { type: "workflow_phase", index: 0, title: "Ignored" },
      {
        type: "workflow_agent",
        agentId: "agent-a",
        label: "Execute: Official researcher",
        state: "error",
        promptPreview: `Prompt preview ${"q".repeat(100)}`,
        startedAt: 1_700_000_000_000,
        queuedAt: 1_699_999_999_000,
        lastProgressAt: 1_700_000_002_000,
        durationMs: 2_000,
        resultPreview: `Authoritative failure ${"r".repeat(100)}`,
        model: "claude-test",
        phaseTitle: "Research",
        tokens: 123,
        toolCalls: 4,
      },
      {
        type: "workflow_agent",
        agentId: "agent-b",
        label: "Task: Official reviewer",
        state: "done",
        promptPreview: "Second prompt preview",
        durationMs: 3_000,
        resultPreview: "Authoritative success",
      },
    ],
  }));

  const bridge = makeBridge(t, layout, {
    maxSummaryLength: 70,
    maxPromptLength: 80,
    onAgentStarted: (event) => starts.push(event),
  });
  await bridge.observeLaunch(launchFor(layout));
  const snapshot = await bridge.finalizeTerminal({
    hostTaskId: "host-task-1",
    runId: layout.runId,
    status: "completed",
  });

  assert.equal(starts.length, 2, "snapshot-only agents should synthesize a start");
  assert.deepEqual(snapshot.agents.map((agent) => agent.agentIndex), [1, 2]);
  const [researcher, reviewer] = snapshot.agents;
  assert.equal(researcher.officialLabel, "Official researcher");
  assert.equal(researcher.agentLabel, "Official researcher");
  assert.equal(researcher.prompt.length, 80);
  assert.equal(researcher.promptPreview.length, 70);
  assert.equal(researcher.workflowState, "error");
  assert.equal(researcher.workflowOutcome, "failed");
  assert.equal(researcher.status, "failed", "authoritative outcome overrides journal completion");
  assert.equal(researcher.startedAtMs, 1_700_000_000_000);
  assert.equal(researcher.queuedAtMs, 1_699_999_999_000);
  assert.equal(researcher.lastProgressAtMs, 1_700_000_002_000);
  assert.equal(researcher.durationMs, 2_000);
  assert.equal(researcher.resultPreview.length, 70);
  assert.equal(researcher.model, "claude-test");
  assert.equal(researcher.phaseTitle, "Research");
  assert.equal(researcher.tokens, 123);
  assert.equal(researcher.toolCalls, 4);
  assert.equal(reviewer.officialLabel, "Official reviewer");
  assert.equal(reviewer.prompt, "Second prompt");
  assert.equal(reviewer.workflowOutcome, "completed");
  assert.equal(reviewer.status, "completed");
  assert.equal(reviewer.durationMs, 3_000);
});

test("missing, malformed, and mismatched final snapshots are ignored", async (t) => {
  const layout = await makeLayout(t);
  await fs.promises.writeFile(
    layout.journalPath,
    journalLine({ type: "started", key: "v2:a", agentId: "agent-a" }),
  );
  const bridge = makeBridge(t, layout);
  await bridge.observeLaunch(launchFor(layout));

  await fs.promises.mkdir(path.dirname(layout.snapshotPath), { recursive: true });
  await fs.promises.writeFile(layout.snapshotPath, "{not valid json");
  const malformed = await bridge.finalizeTerminal({
    hostTaskId: "host-task-1",
    runId: layout.runId,
    status: "completed",
  });
  assert.equal(malformed.agents[0].officialLabel, undefined);
  assert.equal(malformed.agents[0].status, "completed");

  const mismatchedLayout = await makeLayout(t, { runId: "wf_mismatch" });
  await fs.promises.writeFile(mismatchedLayout.journalPath, "");
  await fs.promises.mkdir(path.dirname(mismatchedLayout.snapshotPath), { recursive: true });
  await fs.promises.writeFile(mismatchedLayout.snapshotPath, JSON.stringify({
    runId: "another-run",
    workflowProgress: [{
      type: "workflow_agent",
      agentId: "unexpected-agent",
      label: "Task: Must be ignored",
    }],
  }));
  const mismatchBridge = makeBridge(t, mismatchedLayout);
  await mismatchBridge.observeLaunch(launchFor(mismatchedLayout, { hostTaskId: "mismatch-task" }));
  const mismatched = await mismatchBridge.finalizeTerminal({
    hostTaskId: "mismatch-task",
    runId: mismatchedLayout.runId,
    status: "completed",
  });
  assert.equal(mismatched.startedCount, 0);
});

test("stopTask stops every active run while a no-agent run finalizes cleanly", async (t) => {
  const first = await makeLayout(t, { runId: "wf_first" });
  const secondTranscriptDir = path.join(first.workflowsDir, "wf_second");
  await fs.promises.mkdir(secondTranscriptDir);
  await fs.promises.writeFile(
    first.journalPath,
    journalLine({ type: "started", key: "v2:first", agentId: "agent-first" }),
  );
  await fs.promises.writeFile(
    path.join(secondTranscriptDir, "journal.jsonl"),
    journalLine({ type: "started", key: "v2:second", agentId: "agent-second" }),
  );

  const completions = [];
  const bridge = makeBridge(t, first, {
    onAgentCompleted: (event) => completions.push(event),
  });
  await bridge.observeLaunch(launchFor(first));
  await bridge.observeLaunch(launchFor(first, {
    runId: "wf_second",
    transcriptDir: secondTranscriptDir,
    toolUseId: "tool-workflow-2",
    taskId: "workflow-task-2",
  }));

  const stopped = await bridge.stopTask("host-task-1", "User stopped the task");
  assert.equal(stopped.length, 2);
  assert.ok(stopped.every((snapshot) => snapshot.terminal.status === "stopped"));
  assert.ok(completions.every((event) => event.outcome === "stopped"));

  const emptyLayout = await makeLayout(t, { runId: "wf_empty" });
  await fs.promises.writeFile(emptyLayout.journalPath, "");
  const emptyBridge = makeBridge(t, emptyLayout);
  await emptyBridge.observeLaunch(launchFor(emptyLayout, { hostTaskId: "empty-task" }));
  const emptySnapshot = await emptyBridge.finalizeTerminal({
    hostTaskId: "empty-task",
    runId: emptyLayout.runId,
    status: "completed",
  });
  assert.equal(emptySnapshot.startedCount, 0);
  assert.equal(emptySnapshot.completedCount, 0);
  assert.equal(emptySnapshot.outstandingCount, 0);
});

test("dispose stops observation without fabricating terminal callbacks", async (t) => {
  const layout = await makeLayout(t);
  const starts = [];
  const terminals = [];
  await fs.promises.writeFile(layout.journalPath, "");
  const bridge = new WorkflowAgentJournalBridge({
    claudeConfigDir: layout.claudeConfigDir,
    pollIntervalMs: 20,
    onAgentStarted: (event) => starts.push(event),
    onRunTerminal: (snapshot) => terminals.push(snapshot),
  });
  await bridge.observeLaunch(launchFor(layout));
  bridge.dispose();

  await fs.promises.appendFile(
    layout.journalPath,
    journalLine({ type: "started", key: "v2:ignored", agentId: "agent-ignored" }),
  );
  await new Promise((resolve) => setTimeout(resolve, 80));
  assert.equal(starts.length, 0);
  assert.equal(terminals.length, 0);
  await assert.rejects(bridge.observeLaunch(launchFor(layout)), /has been disposed/);
});
