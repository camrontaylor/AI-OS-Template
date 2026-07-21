const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const taskLogsSourcePath = path.resolve(__dirname, "task-logs.ts");

function loadTaskLogsModule() {
  const source = fs.readFileSync(taskLogsSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const compiled = new Function(
    "require",
    "module",
    "exports",
    "__dirname",
    "__filename",
    outputText
  );

  compiled(require, module, module.exports, path.dirname(taskLogsSourcePath), taskLogsSourcePath);
  return module.exports;
}

const {
  mergeTaskLogsWithConversation,
  parseCronLogSegments,
  selectCronLogSegmentForRun,
  buildCronTaskLogEntries,
  getPendingTaskQuestionPreview,
  isLegacyCronFallbackLogSet,
  shouldShowTaskErrorBanner,
} = loadTaskLogsModule();

test("mergeTaskLogsWithConversation restores full thread when task logs are empty", () => {
  const messages = [
    {
      id: "msg-user",
      conversationId: "conv-1",
      taskId: null,
      role: "user",
      content: "Plan a launch checklist",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:00.000Z",
    },
    {
      id: "msg-orchestrator",
      conversationId: "conv-1",
      taskId: "task-1",
      role: "orchestrator",
      content: "Queued the work and started a task.",
      metadata: null,
      parentMessageId: "msg-user",
      createdAt: "2026-04-14T12:00:01.000Z",
    },
    {
      id: "msg-question",
      conversationId: "conv-1",
      taskId: "task-1",
      role: "sub_agent",
      content: "Need clarification",
      metadata: { questionText: "Which market should this target?" },
      parentMessageId: "msg-orchestrator",
      createdAt: "2026-04-14T12:00:02.000Z",
    },
    {
      id: "msg-system",
      conversationId: "conv-1",
      taskId: null,
      role: "system",
      content: "Conversation title updated.",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:03.000Z",
    },
  ];

  const merged = mergeTaskLogsWithConversation([], messages, {
    originMessageId: "msg-user",
  });

  assert.deepEqual(
    merged.map((entry) => ({
      id: entry.id,
      type: entry.type,
      content: entry.content,
      sourceTaskId: entry.sourceTaskId ?? null,
    })),
    [
      {
        id: "msg-user",
        type: "user_reply",
        content: "Plan a launch checklist",
        sourceTaskId: null,
      },
      {
        id: "msg-orchestrator",
        type: "text",
        content: "Queued the work and started a task.",
        sourceTaskId: "task-1",
      },
      {
        id: "msg-question",
        type: "question",
        content: "Which market should this target?",
        sourceTaskId: "task-1",
      },
      {
        id: "msg-system",
        type: "system",
        content: "Conversation title updated.",
        sourceTaskId: null,
      },
    ]
  );
});

test("mergeTaskLogsWithConversation prefers real task logs over duplicated origin and reply messages", () => {
  const taskLogs = [
    {
      id: "log-origin",
      type: "user_reply",
      timestamp: "2026-04-14T12:05:00.000Z",
      content: "Build the release notes",
    },
    {
      id: "log-reply",
      type: "user_reply",
      timestamp: "2026-04-14T12:07:30.000Z",
      content: "Include the mobile fixes too",
    },
    {
      id: "log-progress",
      type: "text",
      timestamp: "2026-04-14T12:07:31.000Z",
      content: "Updated the draft with the requested fixes.",
    },
  ];

  const messages = [
    {
      id: "msg-origin",
      conversationId: "conv-2",
      taskId: null,
      role: "user",
      content: "Build the release notes",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:00.000Z",
    },
    {
      id: "msg-reply",
      conversationId: "conv-2",
      taskId: null,
      role: "user",
      content: "Include the mobile fixes too",
      metadata: { replyToMessageId: "msg-question" },
      parentMessageId: "msg-question",
      createdAt: "2026-04-14T12:07:00.000Z",
    },
    {
      id: "msg-progress",
      conversationId: "conv-2",
      taskId: "task-2",
      role: "orchestrator",
      content: "Updated the draft with the requested fixes.",
      metadata: null,
      parentMessageId: "msg-reply",
      createdAt: "2026-04-14T12:07:31.500Z",
    },
  ];

  const merged = mergeTaskLogsWithConversation(taskLogs, messages, {
    originMessageId: "msg-origin",
  });

  assert.equal(
    merged.filter((entry) => entry.type === "user_reply" && entry.content === "Build the release notes").length,
    1
  );
  assert.equal(
    merged.filter((entry) => entry.type === "user_reply" && entry.content === "Include the mobile fixes too").length,
    1
  );
  assert.equal(
    merged.filter((entry) => entry.type === "text" && entry.content === "Updated the draft with the requested fixes.").length,
    1
  );
  assert.equal(merged[0].id, "log-origin");
  assert.equal(merged[1].id, "log-reply");
  assert.equal(merged[2].id, "log-progress");
});

test("mergeTaskLogsWithConversation maps mixed roles and returns chronological order", () => {
  const messages = [
    {
      id: "msg-3",
      conversationId: "conv-3",
      taskId: "task-3",
      role: "system",
      content: "System note",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:03.000Z",
    },
    {
      id: "msg-1",
      conversationId: "conv-3",
      taskId: null,
      role: "user",
      content: "Start the cleanup",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:01.000Z",
    },
    {
      id: "msg-4",
      conversationId: "conv-3",
      taskId: "task-3",
      role: "sub_agent",
      content: "Working note",
      metadata: null,
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:04.000Z",
    },
    {
      id: "msg-2",
      conversationId: "conv-3",
      taskId: "task-3",
      role: "sub_agent",
      content: "Original question body",
      metadata: { questionText: "Should I remove archived files too?" },
      parentMessageId: null,
      createdAt: "2026-04-14T12:00:02.000Z",
    },
  ];

  const merged = mergeTaskLogsWithConversation([], messages);

  assert.deepEqual(
    merged.map((entry) => [entry.id, entry.type, entry.content]),
    [
      ["msg-1", "user_reply", "Start the cleanup"],
      ["msg-2", "question", "Should I remove archived files too?"],
      ["msg-3", "system", "System note"],
      ["msg-4", "text", "Working note"],
    ]
  );
});

test("mergeTaskLogsWithConversation returns task logs unchanged when there is no conversation data", () => {
  const taskLogs = [
    {
      id: "log-1",
      type: "text",
      timestamp: "2026-04-14T12:10:00.000Z",
      content: "Started execution.",
    },
    {
      id: "log-2",
      type: "question",
      timestamp: "2026-04-14T12:10:05.000Z",
      content: "Need your approval to continue.",
    },
  ];

  const merged = mergeTaskLogsWithConversation(taskLogs, []);

  assert.deepEqual(merged, taskLogs);
});

test("parseCronLogSegments splits a multi-run cron log into separate runs", () => {
  const log = `
=== [2026-04-14T04:56:01.016Z] START: test22 ===
First run body
=== [2026-04-14T04:56:17.621Z] SUCCESS: test22 (17s) ===

=== [2026-04-14T04:57:37.152Z] START: test22 ===
Second run body
[cron-daemon] containment warning
=== [2026-04-14T04:57:51.611Z] FAILURE: test22 (14s) ===
`.trim();

  const segments = parseCronLogSegments(log);

  assert.equal(segments.length, 2);
  assert.equal(segments[0].startTimestamp, "2026-04-14T04:56:01.016Z");
  assert.equal(segments[0].endTimestamp, "2026-04-14T04:56:17.621Z");
  assert.equal(segments[0].result, "success");
  assert.deepEqual(segments[0].bodyItems, [
    { kind: "text", content: "First run body" },
  ]);

  assert.equal(segments[1].startTimestamp, "2026-04-14T04:57:37.152Z");
  assert.equal(segments[1].endTimestamp, "2026-04-14T04:57:51.611Z");
  assert.equal(segments[1].result, "failure");
  assert.deepEqual(segments[1].bodyItems, [
    { kind: "text", content: "Second run body" },
    { kind: "system", content: "[cron-daemon] containment warning" },
  ]);
});

test("selectCronLogSegmentForRun prefers exact completion timestamp and isolates the selected run", () => {
  const log = `
=== [2026-04-14T04:56:01.016Z] START: test22 ===
First run body
=== [2026-04-14T04:56:17.621Z] SUCCESS: test22 (17s) ===

=== [2026-04-14T04:57:37.152Z] START: test22 ===
Second run body
=== [2026-04-14T04:57:51.611Z] SUCCESS: test22 (14s) ===

=== [2026-04-14T05:14:17.464Z] START: test22 ===
Third run body
=== [2026-04-14T05:14:28.918Z] FAILURE: test22 (11s) ===
`.trim();

  const segments = parseCronLogSegments(log);
  const jobRuns = [
    {
      id: 17,
      jobSlug: "test22",
      taskId: "task-a",
      startedAt: "2026-04-14T04:56:01.006Z",
      completedAt: "2026-04-14T04:56:17.621Z",
      result: "success",
      clientId: "acme-inc",
      trigger: "manual",
      scheduledFor: "2026-04-14T04:56:00.000Z",
    },
    {
      id: 18,
      jobSlug: "test22",
      taskId: "task-b",
      startedAt: "2026-04-14T04:57:37.146Z",
      completedAt: "2026-04-14T04:57:51.611Z",
      result: "success",
      clientId: "acme-inc",
      trigger: "manual",
      scheduledFor: "2026-04-14T04:57:00.000Z",
    },
    {
      id: 21,
      jobSlug: "test22",
      taskId: "task-c",
      startedAt: "2026-04-14T05:14:17.031Z",
      completedAt: "2026-04-14T05:14:28.918Z",
      result: "failure",
      clientId: "acme-inc",
      trigger: "scheduled",
      scheduledFor: "2026-04-14T05:14:00.000Z",
    },
  ];

  const selected = selectCronLogSegmentForRun(segments, jobRuns[1], jobRuns);

  assert.ok(selected);
  assert.equal(selected.startTimestamp, "2026-04-14T04:57:37.152Z");
  assert.equal(selected.endTimestamp, "2026-04-14T04:57:51.611Z");
});

test("selectCronLogSegmentForRun falls back to run order when exact completion timestamp is missing", () => {
  const log = `
=== [2026-04-14T04:56:01.016Z] START: test22 ===
First run body
=== [2026-04-14T04:56:17.621Z] SUCCESS: test22 (17s) ===

=== [2026-04-14T04:57:37.152Z] START: test22 ===
Second run body
=== [2026-04-14T04:57:51.611Z] SUCCESS: test22 (14s) ===
`.trim();

  const segments = parseCronLogSegments(log);
  const jobRuns = [
    {
      id: 17,
      jobSlug: "test22",
      taskId: "task-a",
      startedAt: "2026-04-14T04:56:01.006Z",
      completedAt: "2026-04-14T04:56:18.999Z",
      result: "success",
      clientId: "acme-inc",
      trigger: "manual",
      scheduledFor: "2026-04-14T04:56:00.000Z",
    },
    {
      id: 18,
      jobSlug: "test22",
      taskId: "task-b",
      startedAt: "2026-04-14T04:57:37.146Z",
      completedAt: "2026-04-14T04:57:52.999Z",
      result: "success",
      clientId: "acme-inc",
      trigger: "manual",
      scheduledFor: "2026-04-14T04:57:00.000Z",
    },
  ];

  const selected = selectCronLogSegmentForRun(segments, jobRuns[1], jobRuns);

  assert.ok(selected);
  assert.equal(selected.startTimestamp, "2026-04-14T04:57:37.152Z");
});

test("buildCronTaskLogEntries maps one cron run to feed-friendly entries only", () => {
  const log = `
=== [2026-04-14T04:56:01.016Z] START: test22 ===
First run body
=== [2026-04-14T04:56:17.621Z] SUCCESS: test22 (17s) ===

=== [2026-04-14T05:14:17.464Z] START: test22 ===
Created \`projects/test-mock.md\` with mock content for testing.
  [cron-daemon] Client cron job touched files outside its workspace: command-centre\\src\\lib\\task-logs.ts
=== [2026-04-14T05:14:28.918Z] FAILURE: test22 (11s) ===
`.trim();

  const currentRun = {
    id: 21,
    jobSlug: "test22",
    taskId: "task-c",
    startedAt: "2026-04-14T05:14:17.031Z",
    completedAt: "2026-04-14T05:14:28.918Z",
    result: "failure",
    clientId: "acme-inc",
    trigger: "scheduled",
    scheduledFor: "2026-04-14T05:14:00.000Z",
  };

  const entries = buildCronTaskLogEntries(log, currentRun, [currentRun], "task-c");

  assert.deepEqual(
    entries.map((entry) => [entry.type, entry.content]),
    [
      ["text", "Created `projects/test-mock.md` with mock content for testing."],
      ["system", "[cron-daemon] Client cron job touched files outside its workspace: command-centre\\src\\lib\\task-logs.ts"],
    ]
  );
});

test("buildCronTaskLogEntries returns empty when the cron log is missing or no run matches", () => {
  const currentRun = {
    id: 21,
    jobSlug: "test22",
    taskId: "task-c",
    startedAt: "2026-04-14T05:14:17.031Z",
    completedAt: "2026-04-14T05:14:28.918Z",
    result: "failure",
    clientId: "acme-inc",
    trigger: "scheduled",
    scheduledFor: "2026-04-14T05:14:00.000Z",
  };

  assert.deepEqual(buildCronTaskLogEntries("", currentRun, [currentRun], "task-c"), []);
  assert.deepEqual(
    buildCronTaskLogEntries(
      "=== [2026-04-14T04:56:01.016Z] START: test22 ===",
      null,
      [currentRun],
      "task-c"
    ),
    []
  );
});

test("getPendingTaskQuestionPreview prefers structured questions and otherwise uses the latest assistant text", () => {
  const structuredPreview = getPendingTaskQuestionPreview(
    [
      {
        id: "text-1",
        type: "text",
        timestamp: "2026-04-14T12:00:00.000Z",
        content: "I need a bit more context before I continue.",
      },
      {
        id: "sq-1",
        type: "structured_question",
        timestamp: "2026-04-14T12:00:01.000Z",
        content: "1. Which client is this for?",
        questionSpec: JSON.stringify([
          { id: "client", prompt: "Which client is this for?", type: "text", required: true },
        ]),
      },
    ],
    true
  );

  assert.equal(structuredPreview, "1. Which client is this for?");

  const prosePreview = getPendingTaskQuestionPreview(
    [
      {
        id: "text-2",
        type: "text",
        timestamp: "2026-04-14T12:05:00.000Z",
        content: "The mock file is already there. What should I test next?",
      },
    ],
    true
  );

  assert.equal(prosePreview, "The mock file is already there. What should I test next?");
});

test("isLegacyCronFallbackLogSet only matches synthetic cron fallback entries", () => {
  assert.equal(
    isLegacyCronFallbackLogSet([
      {
        id: "task-1:cron:body:2026-04-14T12:00:00.000Z:0",
        type: "text",
        timestamp: "2026-04-14T12:00:00.000Z",
        content: "Fallback entry",
      },
    ]),
    true
  );

  assert.equal(
    isLegacyCronFallbackLogSet([
      {
        id: "real-log-id",
        type: "text",
        timestamp: "2026-04-14T12:00:00.000Z",
        content: "Persisted entry",
      },
    ]),
    false
  );
});

test("shouldShowTaskErrorBanner hides the banner when the same error is already visible in logs", () => {
  const duplicateError = "Error: When using --print, --output-format=stream-json requires --verbose";

  assert.equal(
    shouldShowTaskErrorBanner(
      [
        {
          id: "log-1",
          type: "text",
          timestamp: "2026-04-14T12:00:00.000Z",
          content: duplicateError,
        },
      ],
      duplicateError
    ),
    false
  );

  assert.equal(
    shouldShowTaskErrorBanner(
      [
        {
          id: "log-2",
          type: "system",
          timestamp: "2026-04-14T12:00:00.000Z",
          content: `Claude CLI exited with code 1: ${duplicateError}`,
        },
      ],
      duplicateError
    ),
    false
  );

  assert.equal(
    shouldShowTaskErrorBanner(
      [
        {
          id: "log-3",
          type: "text",
          timestamp: "2026-04-14T12:00:00.000Z",
          content: "A different message",
        },
      ],
      duplicateError
    ),
    true
  );
});
