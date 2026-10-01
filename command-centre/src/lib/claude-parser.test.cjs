const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const ts = require("typescript");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const parserSourcePath = path.resolve(__dirname, "claude-parser.ts");
const questionSpec = loadTsModule(path.resolve(__dirname, "..", "types", "question-spec.ts"));

function loadParserModule() {
  const source = fs.readFileSync(parserSourcePath, "utf-8");
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
      esModuleInterop: true,
    },
  });

  const module = { exports: {} };
  const localRequire = (request) => {
    if (request === "@/types/question-spec") {
      return {
        ...questionSpec,
        extractQuestionSpecsFromText: () => null,
        stripQuestionSpecsFromText: (text) => text,
      };
    }
    if (request === "@/types/task") {
      return {};
    }
    return require(request);
  };

  const compiled = new Function("require", "module", "exports", "__dirname", "__filename", outputText);
  compiled(localRequire, module, module.exports, path.dirname(parserSourcePath), parserSourcePath);
  return module.exports;
}

test("ClaudeOutputParser treats is_error result lines as errors", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const completions = [];
  const errors = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: (data) => completions.push(data),
    onError: (message) => errors.push(message),
  });

  parser.feedLine(JSON.stringify({
    type: "result",
    subtype: "success",
    is_error: true,
    api_error_status: 401,
    duration_ms: 3039,
    duration_api_ms: 0,
    num_turns: 0,
  }));

  assert.equal(parser.isCompleted, true);
  assert.equal(completions.length, 0);
  assert.equal(errors.length, 1);
  assert.match(errors[0], /Claude returned 401/i);
  assert.match(errors[0], /Refresh your Claude Code login/i);
});

test("ClaudeOutputParser reports session id from system messages", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const sessions = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onSession: (sessionId) => sessions.push(sessionId),
  });

  parser.feedLine(JSON.stringify({
    type: "system",
    subtype: "init",
    session_id: "session-from-system",
  }));

  assert.deepEqual(sessions, ["session-from-system"]);
  assert.equal(parser.isCompleted, false);
});

test("ClaudeOutputParser captures Agent tool use IDs and parent IDs", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_agent_1",
    parent_tool_use_id: "parent_toolu_1",
    name: "Agent",
    input: {
      subagent_type: "Ramanujan",
      prompt: "Check the numbers and report back.",
    },
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "tool_use");
  assert.equal(entries[0].toolName, "Agent");
  assert.equal(entries[0].toolUseId, "toolu_agent_1");
  assert.equal(entries[0].parentToolUseId, "parent_toolu_1");
});

test("ClaudeOutputParser captures legacy Task tool use IDs from assistant blocks", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "parent_toolu_2",
    message: {
      content: [
        {
          type: "tool_use",
          id: "toolu_task_1",
          name: "Task",
          input: {
            description: "Audit the generated docs",
            prompt: "Read the docs and report inconsistencies.",
          },
        },
      ],
    },
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "tool_use");
  assert.equal(entries[0].toolName, "Task");
  assert.equal(entries[0].toolUseId, "toolu_task_1");
  assert.equal(entries[0].parentToolUseId, "parent_toolu_2");
});

test("ClaudeOutputParser captures tool result IDs and parent IDs", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_result",
    id: "message_block_id",
    tool_use_id: "toolu_agent_1",
    parent_tool_use_id: "parent_toolu_1",
    content: [{ type: "text", text: "Agent finished." }],
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "tool_result");
  assert.equal(entries[0].toolUseId, "toolu_agent_1");
  assert.equal(entries[0].parentToolUseId, "parent_toolu_1");
  assert.equal(entries[0].toolResult, "Agent finished.");
});

test("ClaudeOutputParser captures nested assistant tool results and inherited parent IDs", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "parent_toolu_nested",
    message: {
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_nested_agent",
          content: [{ type: "text", text: "Nested agent finished." }],
        },
      ],
    },
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "tool_result");
  assert.equal(entries[0].toolUseId, "toolu_nested_agent");
  assert.equal(entries[0].parentToolUseId, "parent_toolu_nested");
  assert.equal(entries[0].toolResult, "Nested agent finished.");
});

test("ClaudeOutputParser closes a subagent on its parent-scoped end_turn", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_agent_end_turn",
    name: "Agent",
    input: { subagent_type: "Ramanujan", prompt: "Check the numbers." },
  }));
  parser.feedLine(JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "toolu_agent_end_turn",
    message: {
      stop_reason: "end_turn",
      content: [{ type: "text", text: "The numbers are correct." }],
    },
  }));

  const closes = entries.filter((entry) => entry.type === "tool_result");
  assert.equal(closes.length, 1);
  assert.equal(closes[0].toolUseId, "toolu_agent_end_turn");
  assert.equal(closes[0].toolName, "AgentNotification");
  assert.equal(closes[0].toolResult, "The numbers are correct.");
  assert.equal(JSON.parse(closes[0].toolArgs).source, "assistant_end_turn");
});

test("ClaudeOutputParser keeps a subagent open on an intermediate tool_use stop", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_agent_still_working",
    name: "Agent",
    input: { subagent_type: "Godel", prompt: "Inspect the code." },
  }));
  parser.feedLine(JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "toolu_agent_still_working",
    message: {
      stop_reason: "tool_use",
      content: [{
        type: "tool_use",
        id: "toolu_nested_read",
        name: "Read",
        input: { file_path: "README.md" },
      }],
    },
  }));

  assert.equal(entries.filter((entry) => entry.type === "tool_result").length, 0);
});

test("ClaudeOutputParser closes three agents from current task notifications", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });
  const agents = [
    ["toolu_current_1", "task-current-1", "completed"],
    ["toolu_current_2", "task-current-2", "failed"],
    ["toolu_current_3", "task-current-3", "stopped"],
  ];

  for (const [toolUseId, taskId] of agents) {
    parser.feedLine(JSON.stringify({
      type: "tool_use",
      id: toolUseId,
      name: "Agent",
      input: { description: taskId, prompt: `Run ${taskId}.` },
    }));
    parser.feedLine(JSON.stringify({
      type: "system",
      subtype: "task_started",
      task_id: taskId,
      tool_use_id: toolUseId,
      task_type: "local_agent",
    }));
  }

  for (const [, taskId, status] of [...agents].reverse()) {
    parser.feedLine(JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      status,
      output_file: `C:/tmp/${taskId}.txt`,
      summary: `${taskId} ${status}`,
      usage: { total_tokens: 21, tool_uses: 2, duration_ms: 8620 },
    }));
  }

  const closes = entries.filter((entry) => entry.type === "tool_result");
  assert.deepEqual(closes.map((entry) => entry.toolUseId), [
    "toolu_current_3",
    "toolu_current_2",
    "toolu_current_1",
  ]);
  assert.deepEqual(
    closes.map((entry) => JSON.parse(entry.toolArgs).status),
    ["stopped", "failed", "completed"],
  );
  assert.deepEqual(JSON.parse(closes[0].toolArgs).usage, {
    subagentTokens: 21,
    toolUses: 2,
    durationMs: 8620,
  });
});

test("ClaudeOutputParser persists only one close across completion event formats", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_completion_once",
    name: "Task",
    input: { description: "Audit", prompt: "Audit the files." },
  }));
  parser.feedLine(JSON.stringify({
    type: "assistant",
    parent_tool_use_id: "toolu_completion_once",
    message: { stop_reason: "end_turn", content: [{ type: "text", text: "Audit done." }] },
  }));
  parser.feedLine(JSON.stringify({
    type: "system",
    subtype: "task_notification",
    task_id: "task-completion-once",
    tool_use_id: "toolu_completion_once",
    status: "completed",
    output_file: "C:/tmp/audit.txt",
    summary: "Audit finished",
  }));
  parser.feedLine(JSON.stringify({
    type: "tool_result",
    tool_use_id: "toolu_completion_once",
    content: [{ type: "text", text: "Audit finished." }],
  }));

  assert.equal(entries.filter((entry) => entry.type === "tool_result").length, 1);
});

test("ClaudeOutputParser captures task-notification user messages as agent close results", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "user",
    origin: { kind: "task-notification" },
    message: {
      role: "user",
      content: [
        "<task-notification>",
        "<task-id>internal-agent-id</task-id>",
        "<tool-use-id>toolu_agent_notify</tool-use-id>",
        "<status>completed</status>",
        "<summary>Agent \"Mock task\" finished</summary>",
        "<result>Final subagent result.</result>",
        "<usage><subagent_tokens>21</subagent_tokens><tool_uses>1</tool_uses><duration_ms>8620</duration_ms></usage>",
        "</task-notification>",
      ].join("\n"),
    },
  }));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].type, "tool_result");
  assert.equal(entries[0].toolName, "AgentNotification");
  assert.equal(entries[0].toolUseId, "toolu_agent_notify");
  assert.equal(entries[0].content, "Agent \"Mock task\" finished");
  assert.equal(entries[0].toolResult, "Final subagent result.");
  const args = JSON.parse(entries[0].toolArgs);
  assert.equal(args.status, "completed");
  assert.equal(args.summary, "Agent \"Mock task\" finished");
  assert.deepEqual(args.usage, {
    subagentTokens: 21,
    toolUses: 1,
    durationMs: 8620,
  });
});

test("ClaudeOutputParser ignores async agent launch acknowledgements", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });

  parser.feedLine(JSON.stringify({
    type: "user",
    toolUseResult: {
      isAsync: true,
      status: "async_launched",
      agentId: "internal-agent-id",
    },
    message: {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: "toolu_agent_launch",
          content: [
            {
              type: "text",
              text: "Async agent launched successfully. The agent is working in the background.",
            },
          ],
        },
      ],
    },
  }));

  assert.equal(entries.length, 0);
});

test("ClaudeOutputParser emits one structured Workflow launch", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
    onWorkflowLaunch: (data) => launches.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        id: "toolu_workflow_launch",
        name: "Workflow",
        input: { description: "Run three checks" },
      }],
    },
  }));
  const launchAcknowledgement = {
    type: "user",
    toolUseResult: {
      status: "async_launched",
      taskId: "workflow-task-1",
      taskType: "local_workflow",
      workflowName: "three-checks",
      runId: "wf_three-checks",
      summary: "Run three checks",
      transcriptDir: "C:\\Users\\tester\\.claude\\projects\\repo\\session\\subagents\\workflows\\wf_three-checks",
      scriptPath: "C:\\Users\\tester\\.claude\\projects\\repo\\session\\workflows\\scripts\\three-checks.js",
    },
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_launch",
        content: "Workflow launched in background.",
      }],
    },
  };
  parser.feedLine(JSON.stringify(launchAcknowledgement));
  parser.feedLine(JSON.stringify(launchAcknowledgement));
  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_workflow_launch_resumed",
    name: "Workflow",
    input: { resumeFromRunId: "wf_three-checks" },
  }));
  parser.feedLine(JSON.stringify({
    ...launchAcknowledgement,
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_launch_resumed",
        content: "Workflow resumed in background.",
      }],
    },
  }));

  assert.deepEqual(launches, [{
    toolUseId: "toolu_workflow_launch",
    taskId: "workflow-task-1",
    runId: "wf_three-checks",
    transcriptDir: "C:\\Users\\tester\\.claude\\projects\\repo\\session\\subagents\\workflows\\wf_three-checks",
    scriptPath: "C:\\Users\\tester\\.claude\\projects\\repo\\session\\workflows\\scripts\\three-checks.js",
    workflowName: "three-checks",
    summary: "Run three checks",
  }]);
  assert.equal(entries.filter((entry) => entry.type === "tool_use").length, 2);
  assert.equal(entries.filter((entry) => entry.type === "tool_result").length, 0);
});

test("ClaudeOutputParser accepts snake_case Workflow launch metadata", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowLaunch: (data) => launches.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_workflow_snake",
    name: "Workflow",
    input: {},
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    toolUseResult: {
      status: "async_launched",
      task_id: "workflow-task-snake",
      task_type: "local_workflow",
      run_id: "wf_snake",
      transcript_dir: "C:\\safe\\session\\subagents\\workflows\\wf_snake",
      script_path: "C:\\safe\\session\\workflows\\scripts\\snake.js",
      workflow_name: "snake-workflow",
    },
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_snake",
        content: "Workflow launched in background.",
      }],
    },
  }));

  assert.equal(launches.length, 1);
  assert.equal(launches[0].taskId, "workflow-task-snake");
  assert.equal(launches[0].runId, "wf_snake");
  assert.equal(launches[0].workflowName, "snake-workflow");
});

test("ClaudeOutputParser recognizes Workflow launch metadata from streamed result text", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowLaunch: (data) => launches.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_workflow_text",
    name: "Workflow",
    input: {},
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_text",
        content: [
          {
            type: "text",
            text: [
              "Workflow launched in background. Task ID: workflow-task-text",
              "Summary: Run three streamed checks",
              "Transcript dir: C:\\Users\\tester\\.claude\\projects\\repo\\session\\subagents\\workflows\\wf_text",
              "Script file: C:\\Users\\tester\\.claude\\projects\\repo\\session\\workflows\\scripts\\text.js",
              "Run ID: wf_text",
              "You will be notified when it completes.",
            ].join("\n"),
          },
        ],
      }],
    },
  }));

  assert.deepEqual(launches, [{
    toolUseId: "toolu_workflow_text",
    taskId: "workflow-task-text",
    runId: "wf_text",
    transcriptDir: "C:\\Users\\tester\\.claude\\projects\\repo\\session\\subagents\\workflows\\wf_text",
    scriptPath: "C:\\Users\\tester\\.claude\\projects\\repo\\session\\workflows\\scripts\\text.js",
    summary: "Run three streamed checks",
  }]);
});

test("ClaudeOutputParser ignores Workflow launch text missing required fields", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowLaunch: (data) => launches.push(data),
  });
  const incompleteResults = [
    [
      "Workflow launched in background.",
      "Run ID: wf_missing_task",
      "Transcript dir: C:\\safe\\wf_missing_task",
    ],
    [
      "Workflow launched in background. Task ID: workflow-task-missing-run",
      "Transcript dir: C:\\safe\\wf_missing_run",
    ],
    [
      "Workflow launched in background. Task ID: workflow-task-missing-transcript",
      "Run ID: wf_missing_transcript",
    ],
  ];

  incompleteResults.forEach((lines, index) => {
    const toolUseId = `toolu_workflow_missing_${index}`;
    parser.feedLine(JSON.stringify({
      type: "tool_use",
      id: toolUseId,
      name: "Workflow",
      input: {},
    }));
    parser.feedLine(JSON.stringify({
      type: "user",
      message: {
        content: [{
          type: "tool_result",
          tool_use_id: toolUseId,
          content: lines.join("\n"),
        }],
      },
    }));
  });

  assert.deepEqual(launches, []);
});

test("ClaudeOutputParser ignores matching Workflow launch text from an unrelated tool", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowLaunch: (data) => launches.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_bash_matching_workflow_text",
    name: "Bash",
    input: {},
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_bash_matching_workflow_text",
        content: [
          "Workflow launched in background. Task ID: workflow-task-false-positive",
          "Run ID: wf_false_positive",
          "Transcript dir: C:\\safe\\wf_false_positive",
        ].join("\n"),
      }],
    },
  }));

  assert.deepEqual(launches, []);
});

test("ClaudeOutputParser emits one Workflow launch for repeated text acknowledgements", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowLaunch: (data) => launches.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_workflow_repeated_text",
    name: "Workflow",
    input: {},
  }));
  const acknowledgement = {
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_repeated_text",
        content: [
          "Workflow launched in background. Task ID: workflow-task-repeated-text",
          "Run ID: wf_repeated_text",
          "Transcript dir: C:\\safe\\wf_repeated_text",
        ].join("\n"),
      }],
    },
  };

  parser.feedLine(JSON.stringify(acknowledgement));
  parser.feedLine(JSON.stringify(acknowledgement));

  assert.equal(launches.length, 1);
  assert.equal(launches[0].runId, "wf_repeated_text");
});

test("ClaudeOutputParser deduplicates structured and text Workflow launches for the same run", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const launches = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowLaunch: (data) => launches.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_workflow_structured_and_text",
    name: "Workflow",
    input: {},
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    toolUseResult: {
      status: "async_launched",
      taskId: "workflow-task-structured-and-text",
      taskType: "local_workflow",
      runId: "wf_structured_and_text",
      transcriptDir: "C:\\safe\\wf_structured_and_text",
      summary: "Structured launch metadata",
    },
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_structured_and_text",
        content: "Workflow launched in background.",
      }],
    },
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_structured_and_text",
        content: [
          "Workflow launched in background. Task ID: workflow-task-structured-and-text",
          "Run ID: wf_structured_and_text",
          "Transcript dir: C:\\safe\\wf_structured_and_text",
        ].join("\n"),
      }],
    },
  }));

  assert.deepEqual(launches, [{
    toolUseId: "toolu_workflow_structured_and_text",
    taskId: "workflow-task-structured-and-text",
    runId: "wf_structured_and_text",
    transcriptDir: "C:\\safe\\wf_structured_and_text",
    summary: "Structured launch metadata",
  }]);
});

test("ClaudeOutputParser routes legacy Workflow terminal XML without closing a subagent", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const terminals = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
    onWorkflowTerminal: (data) => terminals.push(data),
  });

  parser.feedLine(JSON.stringify({
    type: "tool_use",
    id: "toolu_workflow_legacy_terminal",
    name: "Workflow",
    input: {},
  }));
  parser.feedLine(JSON.stringify({
    type: "user",
    toolUseResult: {
      status: "async_launched",
      taskId: "workflow-task-legacy",
      taskType: "local_workflow",
      runId: "wf_legacy",
      transcriptDir: "C:\\safe\\session\\subagents\\workflows\\wf_legacy",
    },
    message: {
      content: [{
        type: "tool_result",
        tool_use_id: "toolu_workflow_legacy_terminal",
        content: "Workflow launched in background.",
      }],
    },
  }));
  const notification = {
    type: "user",
    origin: { kind: "task-notification" },
    message: {
      content: [
        "<task-notification>",
        "<task-id>workflow-task-legacy</task-id>",
        "<tool-use-id>toolu_workflow_legacy_terminal</tool-use-id>",
        "<output-file>C:\\tmp\\workflow.output</output-file>",
        "<status>completed</status>",
        "<summary>Workflow completed</summary>",
        "<result>{\"ok\":true}</result>",
        "</task-notification>",
      ].join("\n"),
    },
  };
  parser.feedLine(JSON.stringify(notification));
  parser.feedLine(JSON.stringify(notification));

  assert.deepEqual(terminals, [{
    toolUseId: "toolu_workflow_legacy_terminal",
    taskId: "workflow-task-legacy",
    runId: "wf_legacy",
    status: "completed",
    summary: "Workflow completed",
    result: "{\"ok\":true}",
    outputFile: "C:\\tmp\\workflow.output",
  }]);
  assert.equal(entries.filter((entry) => entry.type === "tool_result").length, 0);
});

test("ClaudeOutputParser routes current Workflow terminal statuses", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const terminals = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onWorkflowTerminal: (data) => terminals.push(data),
  });
  const statuses = ["completed", "failed", "stopped"];

  for (const status of statuses) {
    const toolUseId = `toolu_workflow_${status}`;
    const taskId = `workflow-task-${status}`;
    const runId = `wf_${status}`;
    parser.feedLine(JSON.stringify({
      type: "tool_use",
      id: toolUseId,
      name: "Workflow",
      input: {},
    }));
    parser.feedLine(JSON.stringify({
      type: "user",
      toolUseResult: {
        status: "async_launched",
        taskId,
        taskType: "local_workflow",
        runId,
        transcriptDir: `C:\\safe\\session\\subagents\\workflows\\${runId}`,
      },
      message: {
        content: [{ type: "tool_result", tool_use_id: toolUseId, content: "Launched." }],
      },
    }));
    parser.feedLine(JSON.stringify({
      type: "system",
      subtype: "task_notification",
      task_id: taskId,
      status,
      output_file: `C:\\tmp\\${taskId}.output`,
      summary: `${taskId} ${status}`,
    }));
  }

  assert.deepEqual(terminals.map((event) => ({
    toolUseId: event.toolUseId,
    taskId: event.taskId,
    runId: event.runId,
    status: event.status,
  })), statuses.map((status) => ({
    toolUseId: `toolu_workflow_${status}`,
    taskId: `workflow-task-${status}`,
    runId: `wf_${status}`,
    status,
  })));
});

test("ClaudeOutputParser avoids duplicate task-notification close logs", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });
  const notification = {
    type: "user",
    origin: { kind: "task-notification" },
    message: {
      role: "user",
      content: "<task-notification><tool-use-id>toolu_repeat_notify</tool-use-id><status>completed</status><summary>Done</summary><result>Done</result></task-notification>",
    },
  };

  parser.feedLine(JSON.stringify(notification));
  parser.feedLine(JSON.stringify(notification));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].toolUseId, "toolu_repeat_notify");
});

test("ClaudeOutputParser avoids duplicate tool-result logs for repeated stream IDs", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });
  const result = {
    type: "tool_result",
    tool_use_id: "toolu_result_repeat",
    content: [{ type: "text", text: "Done." }],
  };

  parser.feedLine(JSON.stringify(result));
  parser.feedLine(JSON.stringify(result));

  assert.equal(entries.length, 1);
  assert.equal(entries[0].toolUseId, "toolu_result_repeat");
});

test("ClaudeOutputParser avoids duplicate tool-use logs for repeated stream IDs", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const entries = [];
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => entries.push(entry),
  });
  const toolUse = {
    type: "tool_use",
    id: "toolu_repeat",
    name: "Agent",
    input: { subagent_type: "Godel", prompt: "Check logic." },
  };

  parser.feedLine(JSON.stringify(toolUse));
  parser.feedLine(JSON.stringify(toolUse));

  assert.equal(entries.filter((entry) => entry.type === "tool_use").length, 1);
  assert.equal(entries[0].toolUseId, "toolu_repeat");
});

test("ClaudeOutputParser only allows later results when explicitly deferred", () => {
  const { ClaudeOutputParser } = loadParserModule();
  const completions = [];
  let deferred = true;
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: (data) => {
      completions.push(data);
      deferred = false;
    },
    onError: () => {},
    shouldProcessResultAfterCompletion: () => deferred,
  });

  parser.feedLine(JSON.stringify({
    type: "result",
    subtype: "success",
    cost_usd: 0.1,
    duration_ms: 100,
    total_tokens: 10,
  }));
  deferred = true;
  parser.feedLine(JSON.stringify({
    type: "result",
    subtype: "success",
    cost_usd: 0.2,
    duration_ms: 200,
    total_tokens: 20,
  }));
  parser.feedLine(JSON.stringify({
    type: "result",
    subtype: "success",
    cost_usd: 0.3,
    duration_ms: 300,
    total_tokens: 30,
  }));

  assert.equal(completions.length, 2);
  assert.deepEqual(
    completions.map((completion) => completion.costUsd),
    [0.1, 0.2],
  );
});

const ASK_USER_QUESTION_INPUT = {
  questions: [
    {
      question: "How should I format the output?",
      header: "Format",
      options: [
        { label: "Summary", description: "Brief overview" },
        { label: "Detailed", description: "Full explanation" },
      ],
      multiSelect: false,
    },
    {
      question: "Which sections should I include?",
      header: "Sections",
      options: [
        { label: "Introduction", description: "Opening context" },
        { label: "Conclusion", description: "Final summary" },
      ],
      multiSelect: true,
    },
  ],
};

const ASK_USER_QUESTION_SPECS = [
  {
    id: "q1",
    prompt: "How should I format the output?",
    type: "select",
    required: true,
    options: ["Summary", "Detailed"],
  },
  {
    id: "q2",
    prompt: "Which sections should I include?",
    type: "multiselect",
    required: true,
    options: ["Introduction", "Conclusion"],
  },
];

function createQuestionRecorder() {
  const calls = { logEntries: [], toolQuestions: [], unanswered: [] };
  const { ClaudeOutputParser } = loadParserModule();
  const parser = new ClaudeOutputParser({
    onProgress: () => {},
    onComplete: () => {},
    onError: () => {},
    onLogEntry: (entry) => calls.logEntries.push(entry),
    onToolQuestion: (specs) => calls.toolQuestions.push(specs),
    onUnansweredToolQuestion: (surfaced) => calls.unanswered.push(surfaced),
  });
  return { parser, calls };
}

function feedToolResult(parser, toolUseId, text) {
  parser.feedLine(JSON.stringify({
    type: "user",
    message: {
      content: [{ type: "tool_result", tool_use_id: toolUseId, content: text }],
    },
  }));
}

test("questionSpecsFromAskUserQuestionInput maps built-in questions to modal specs", () => {
  assert.deepEqual(
    questionSpec.questionSpecsFromAskUserQuestionInput(ASK_USER_QUESTION_INPUT),
    ASK_USER_QUESTION_SPECS,
  );
  assert.deepEqual(
    questionSpec.questionSpecsFromAskUserQuestionInput({
      questions: [{ question: "Anything else?", header: "Notes", options: [] }],
    }),
    [{ id: "q1", prompt: "Anything else?", type: "text", required: true }],
  );
  assert.deepEqual(questionSpec.questionSpecsFromAskUserQuestionInput({}), []);
  assert.deepEqual(questionSpec.questionSpecsFromAskUserQuestionInput(null), []);
});

test("isUnansweredAskUserQuestionResult matches the headless no-answer result only", () => {
  assert.equal(questionSpec.isUnansweredAskUserQuestionResult("The user did not answer the questions."), true);
  assert.equal(questionSpec.isUnansweredAskUserQuestionResult("File written successfully"), false);
  assert.equal(
    questionSpec.isUnansweredAskUserQuestionResult('const notice = "The user did not answer the questions.";'),
    false,
  );
  assert.equal(questionSpec.isUnansweredAskUserQuestionResult(undefined), false);
});

test("ClaudeOutputParser surfaces a built-in AskUserQuestion call as modal questions", () => {
  const { parser, calls } = createQuestionRecorder();

  parser.feedLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{
        type: "tool_use",
        id: "toolu-ask-1",
        name: "AskUserQuestion",
        input: ASK_USER_QUESTION_INPUT,
      }],
    },
  }));

  assert.deepEqual(calls.toolQuestions, [ASK_USER_QUESTION_SPECS]);
  assert.equal(calls.logEntries.some((entry) => entry.type === "tool_use" && entry.toolName === "AskUserQuestion"), true);

  feedToolResult(parser, "toolu-ask-1", "The user did not answer the questions.");
  assert.deepEqual(calls.unanswered, [true]);
});

test("ClaudeOutputParser flags an unanswered AskUserQuestion whose input could not be surfaced", () => {
  const { parser, calls } = createQuestionRecorder();

  parser.feedLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "toolu-ask-2", name: "AskUserQuestion", input: { questions: "bad" } }],
    },
  }));
  assert.deepEqual(calls.toolQuestions, []);

  feedToolResult(parser, "toolu-ask-2", "The user did not answer the questions.");
  assert.deepEqual(calls.unanswered, [false]);
});

test("ClaudeOutputParser flags the no-answer result even when the tool call was not seen", () => {
  const { parser, calls } = createQuestionRecorder();

  feedToolResult(parser, "toolu-unknown", "The user did not answer the questions.");
  assert.deepEqual(calls.unanswered, [false]);
});

test("ClaudeOutputParser does not flag ordinary tool results", () => {
  const { parser, calls } = createQuestionRecorder();

  parser.feedLine(JSON.stringify({
    type: "assistant",
    message: {
      content: [{ type: "tool_use", id: "toolu-read-1", name: "Read", input: { file_path: "README.md" } }],
    },
  }));
  feedToolResult(parser, "toolu-read-1", "# README");

  assert.deepEqual(calls.toolQuestions, []);
  assert.deepEqual(calls.unanswered, []);
});
