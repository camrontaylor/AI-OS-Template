const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");

const cronRuntime = require("./cron-runtime.js");

function makeTempWorkspace() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-cron-runtime-"));
}

function cleanupTempWorkspace(workspaceDir) {
  try {
    cronRuntime.getDb(workspaceDir).close();
  } catch {
    // Best-effort cleanup for tests only.
  }
  fs.rmSync(workspaceDir, { recursive: true, force: true });
}

function createFakeClaudeCommand(workspaceDir, name, lines) {
  if (process.platform === "win32") {
    const commandPath = path.join(workspaceDir, `${name}.cmd`);
    fs.writeFileSync(commandPath, lines.join("\r\n"), "utf-8");
    return commandPath;
  }

  const commandPath = path.join(workspaceDir, `${name}.sh`);
  fs.writeFileSync(commandPath, ["#!/usr/bin/env bash", ...lines].join("\n"), "utf-8");
  fs.chmodSync(commandPath, 0o755);
  return commandPath;
}

function writeCronJob(agenticOsDir, clientId, slug, prompt) {
  const jobsDir = clientId
    ? path.join(agenticOsDir, "clients", clientId, "cron", "jobs")
    : path.join(agenticOsDir, "cron", "jobs");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.writeFileSync(
    path.join(jobsDir, `${slug}.md`),
    [
      "---",
      `name: ${slug}`,
      "time: 00:00",
      "days: daily",
      "active: true",
      "model: sonnet",
      "timeout: 30s",
      "retry: 0",
      "---",
      "",
      prompt,
      "",
    ].join("\n"),
    "utf-8"
  );
}

test("buildRecoveredCronRunUpdate preserves inferred recovery truth", () => {
  const recovery = cronRuntime.buildRecoveredCronRunUpdate("recovered_from_stuck_needs_input", {
    durationMs: 4500,
    costUsd: 2.5,
  });

  assert.equal(recovery.resultSource, "inferred");
  assert.equal(recovery.result, "failure");
  assert.equal(recovery.completionReason, "recovered_from_stuck_needs_input");
  assert.equal(recovery.durationSec, 5);
  assert.equal(recovery.costUsd, 2.5);
  assert.equal(recovery.exitCode, 1);
});

test("getManagedRuntimeStatus treats a stale lock plus live daemon pid as stale ownership", () => {
  const workspaceDir = makeTempWorkspace();

  try {
    const { lockPath } = cronRuntime.getRuntimePaths(workspaceDir);
    fs.mkdirSync(path.dirname(lockPath), { recursive: true });
    cronRuntime.writeDaemonPid(workspaceDir, process.pid);

    const staleHeartbeat = new Date(Date.now() - 10 * 60 * 1000).toISOString();
    fs.writeFileSync(
      lockPath,
      JSON.stringify(
        {
          runtime: "daemon",
          leader: true,
          identifier: "daemon-stale",
          pid: process.pid,
          startedAt: staleHeartbeat,
          heartbeatAt: staleHeartbeat,
          workspaceCount: 1,
          startCommand: "start",
          stopCommand: "stop",
        },
        null,
        2
      ),
      "utf-8"
    );

    const status = cronRuntime.getManagedRuntimeStatus(workspaceDir);

    assert.equal(status.leaderState, "stale");
    assert.equal(status.runtime, "daemon");
    assert.equal(status.leader, false);
    assert.equal(status.ownershipReason, "stale-leader-record");
    assert.equal(status.identifier, "daemon-stale");
    assert.equal(status.pid, process.pid);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("getManagedRuntimeStatus treats the local identifier as leader only when the lock matches", () => {
  const workspaceDir = makeTempWorkspace();

  try {
    cronRuntime.claimRuntimeLeadership(workspaceDir, {
      runtime: "in-process",
      identifier: "in-process-123",
      pid: process.pid,
      workspaceCount: 1,
      startedAt: new Date().toISOString(),
    });

    const status = cronRuntime.getManagedRuntimeStatus(workspaceDir, "in-process-123");

    assert.equal(status.leaderState, "active");
    assert.equal(status.runtime, "in-process");
    assert.equal(status.leader, true);
    assert.equal(status.ownershipReason, "local-leader-active");
    assert.equal(status.identifier, "in-process-123");
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("cron daemon start does not spawn a passive daemon when an in-process leader is active", () => {
  const workspaceDir = makeTempWorkspace();
  const cronDaemonPath = path.resolve(__dirname, "..", "..", "scripts", "cron-daemon.cjs");

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    cronRuntime.claimRuntimeLeadership(workspaceDir, {
      runtime: "in-process",
      identifier: "in-process-test",
      pid: process.pid,
      workspaceCount: 1,
      startedAt: new Date().toISOString(),
    });

    const result = spawnSync(process.execPath, [cronDaemonPath, "start"], {
      cwd: workspaceDir,
      env: {
        ...process.env,
        AI_OS_DIR: workspaceDir,
      },
      encoding: "utf-8",
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /runtime: in-process/);
    assert.doesNotMatch(result.stdout, /started daemon pid/);
    assert.equal(cronRuntime.readDaemonPid(workspaceDir), null);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("completeCronRunForTask updates the existing running row instead of inserting a second row", () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const startedAt = new Date().toISOString();
  const completedAt = new Date(Date.now() + 5_000).toISOString();
  const taskId = "task-complete-existing-row";

  try {
    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
        costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
        clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
      ) VALUES (?, ?, ?, 'done', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, NULL, NULL, ?, NULL, NULL, 0, NULL, NULL, ?, 'default')`
    ).run(
      taskId,
      "Complete cron row",
      "Uses the runtime helper",
      startedAt,
      startedAt,
      startedAt,
      "existing-row-job"
    );

    db.prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', 'manual', NULL, ?)`
    ).run("existing-row-job", taskId, startedAt, startedAt);

    const task = db.prepare("SELECT * FROM tasks WHERE id = ?").get(taskId);

    cronRuntime.completeCronRunForTask(workspaceDir, task, {
      result: "success",
      exitCode: 0,
      durationMs: 4200,
      costUsd: 1.25,
      completedAt,
      trigger: "manual",
    });

    const rows = db
      .prepare(
        `SELECT result, durationSec, costUsd, exitCode, trigger
         FROM cron_runs
         WHERE taskId = ?`
      )
      .all(taskId);

    assert.equal(rows.length, 1);
    assert.equal(rows[0].result, "success");
    assert.equal(rows[0].durationSec, 4);
    assert.equal(rows[0].costUsd, 1.25);
    assert.equal(rows[0].exitCode, 0);
    assert.equal(rows[0].trigger, "manual");
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("buildCronClaudeArgs keeps root cron runs on the broad bypass path", () => {
  const args = cronRuntime.buildCronClaudeArgs(
    {
      prompt: "Run the root cron job",
      model: "sonnet",
    },
    {
      clientId: null,
      workspaceDir: "C:\\ai-os",
    }
  );

  assert.deepEqual(args, [
    "-p",
    "--model",
    "sonnet",
    "--output-format",
    "stream-json",
    "--verbose",
    "--dangerously-skip-permissions",
    "--",
    "Run the root cron job",
  ]);
});

test("buildCronClaudeArgs scopes client cron runs to dontAsk and --add-dir without bypass", () => {
  const workspaceDir = "C:\\ai-os\\clients\\acme";
  const args = cronRuntime.buildCronClaudeArgs(
    {
      prompt: "Run the client cron job",
      model: "sonnet",
    },
    {
      clientId: "acme",
      workspaceDir,
    }
  );

  assert.deepEqual(args, [
    "-p",
    "--model",
    "sonnet",
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "dontAsk",
    "--add-dir",
    workspaceDir,
    "--",
    "Run the client cron job",
  ]);
  assert.equal(args.includes("--dangerously-skip-permissions"), false);
});

test("executeCronTask keeps a prose cron question as one assistant message and marks the run as needs_input", async () => {
  const workspaceDir = makeTempWorkspace();
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    writeCronJob(
      workspaceDir,
      null,
      "needs-input-job",
      "Ask one follow-up question and stop."
    );

    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude-needs-input",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal",
            "echo {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"The mock file is already there. What should I test next?\"}]}}",
            "echo {\"type\":\"result\",\"cost_usd\":0.42}",
            "exit /b 0",
            "",
          ]
        : [
            "set -e",
            "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"The mock file is already there. What should I test next?\"}]}}'",
            "printf '%s\\n' '{\"type\":\"result\",\"cost_usd\":0.42}'",
            "exit 0",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "needs-input-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "scheduled",
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const db = cronRuntime.getDb(workspaceDir);
    const taskRow = db
      .prepare("SELECT status, needsInput, completedAt, errorMessage, activityLabel FROM tasks WHERE id = ?")
      .get(queued.task.id);
    const cronRun = db
      .prepare("SELECT result, completionReason, costUsd FROM cron_runs WHERE taskId = ?")
      .get(queued.task.id);
    const logRows = db
      .prepare("SELECT type, content FROM task_logs WHERE taskId = ? ORDER BY rowid ASC")
      .all(queued.task.id);

    assert.equal(result.result, "failure");
    assert.equal(taskRow.status, "review");
    assert.equal(taskRow.needsInput, 1);
    assert.equal(taskRow.completedAt, null);
    assert.equal(taskRow.errorMessage, null);
    assert.equal(taskRow.activityLabel, "The mock file is already there. What should I test next?");
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.completionReason, "needs_input");
    assert.equal(cronRun.costUsd, 0.42);
    assert.deepEqual(logRows, [
      {
        type: "text",
        content: "The mock file is already there. What should I test next?",
      },
    ]);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("executeCronTask treats explicit blocked status text as a failed cron run", async () => {
  const workspaceDir = makeTempWorkspace();
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    writeCronJob(
      workspaceDir,
      null,
      "blocked-status-job",
      "Report a blocked state without a process error."
    );

    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude-blocked-status",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal",
            "echo {\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"I could not query Notion.\\n\\nStatus: BLOCKED - Notion connector not callable in this headless cron run.\"}]}}",
            "echo {\"type\":\"result\",\"cost_usd\":0.11}",
            "exit /b 0",
            "",
          ]
        : [
            "set -e",
            "printf '%s\\n' '{\"type\":\"assistant\",\"message\":{\"content\":[{\"type\":\"text\",\"text\":\"I could not query Notion.\\n\\nStatus: BLOCKED - Notion connector not callable in this headless cron run.\"}]}}'",
            "printf '%s\\n' '{\"type\":\"result\",\"cost_usd\":0.11}'",
            "exit 0",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "blocked-status-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "scheduled",
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const db = cronRuntime.getDb(workspaceDir);
    const taskRow = db
      .prepare("SELECT status, needsInput, errorMessage, activityLabel FROM tasks WHERE id = ?")
      .get(queued.task.id);
    const cronRun = db
      .prepare("SELECT result, completionReason, exitCode, costUsd FROM cron_runs WHERE taskId = ?")
      .get(queued.task.id);
    const statusFile = JSON.parse(
      fs.readFileSync(path.join(workspaceDir, "cron", "status", "blocked-status-job.json"), "utf-8")
    );

    assert.equal(result.result, "failure");
    assert.equal(result.exitCode, 1);
    assert.equal(taskRow.status, "review");
    assert.equal(taskRow.needsInput, 0);
    assert.equal(taskRow.errorMessage, "Status: BLOCKED");
    assert.equal(taskRow.activityLabel, "Status: BLOCKED");
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.completionReason, "explicit_blocked_status");
    assert.equal(cronRun.exitCode, 1);
    assert.equal(cronRun.costUsd, 0.11);
    assert.equal(statusFile.result, "failure");
    assert.equal(statusFile.fail_count, 1);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("scheduled retry attempts are capped at exactly twice even when retry is higher", async () => {
  const workspaceDir = makeTempWorkspace();
  const jobsDir = path.join(workspaceDir, "cron", "jobs");
  const attemptsPath = path.join(workspaceDir, "attempt-count.txt");
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.writeFileSync(
      path.join(jobsDir, "retry-cap-job.md"),
      [
        "---",
        "name: Retry Cap Job",
        "time: 00:00",
        "days: daily",
        "active: true",
        "model: sonnet",
        "timeout: 30s",
        "retry: 5",
        "---",
        "",
        "Fail on purpose so the scheduler retry cap can be measured.",
        "",
      ].join("\n"),
      "utf-8"
    );
    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal EnableDelayedExpansion",
            "set COUNT=0",
            "if exist attempt-count.txt set /p COUNT=<attempt-count.txt",
            "set /a COUNT+=1",
            "> attempt-count.txt echo !COUNT!",
            "exit /b 1",
            "",
          ]
        : [
            "set -e",
            "COUNT=0",
            "if [ -f attempt-count.txt ]; then COUNT=$(cat attempt-count.txt); fi",
            "COUNT=$((COUNT + 1))",
            "printf '%s\\n' \"$COUNT\" > attempt-count.txt",
            "exit 1",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "retry-cap-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "scheduled",
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const attempts = Number(fs.readFileSync(attemptsPath, "utf-8").trim());
    const cronRun = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT result, trigger FROM cron_runs WHERE taskId = ?")
      .get(queued.task.id);

    assert.equal(result.result, "failure");
    assert.equal(attempts, 2);
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.trigger, "scheduled");
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("shell cron timeout terminates spawned child processes", async (t) => {
  if (process.platform === "win32") {
    t.skip("POSIX process-group timeout behavior is covered on Unix-like systems");
    return;
  }

  const workspaceDir = makeTempWorkspace();
  const jobsDir = path.join(workspaceDir, "cron", "jobs");
  const scriptsDir = path.join(workspaceDir, "scripts");
  const survivedPath = path.join(workspaceDir, "child-survived.txt");
  const scheduledFor = new Date().toISOString();

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    fs.mkdirSync(jobsDir, { recursive: true });
    fs.mkdirSync(scriptsDir, { recursive: true });
    fs.writeFileSync(
      path.join(scriptsDir, "shell-timeout-parent.sh"),
      [
        "#!/usr/bin/env bash",
        "set -euo pipefail",
        "bash scripts/shell-timeout-child.sh &",
        "wait",
        "",
      ].join("\n"),
      "utf-8"
    );
    fs.writeFileSync(
      path.join(scriptsDir, "shell-timeout-child.sh"),
      [
        "#!/usr/bin/env bash",
        "sleep 2",
        "printf survived > child-survived.txt",
        "",
      ].join("\n"),
      "utf-8"
    );
    fs.chmodSync(path.join(scriptsDir, "shell-timeout-parent.sh"), 0o755);
    fs.chmodSync(path.join(scriptsDir, "shell-timeout-child.sh"), 0o755);
    fs.writeFileSync(
      path.join(jobsDir, "shell-timeout-job.md"),
      [
        "---",
        "name: Shell Timeout Job",
        "time: 00:00",
        "days: daily",
        "active: true",
        "model: sonnet",
        "timeout: 1s",
        "retry: 0",
        "runner: shell",
        "command: bash scripts/shell-timeout-parent.sh",
        "---",
        "",
      ].join("\n"),
      "utf-8"
    );

    const job = cronRuntime.getCronJob(workspaceDir, "shell-timeout-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "scheduled",
      scheduledFor,
    });

    const startedAt = Date.now();
    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const elapsedMs = Date.now() - startedAt;
    await new Promise((resolve) => setTimeout(resolve, 2300));

    assert.equal(result.result, "timeout");
    assert.equal(result.exitCode, 124);
    assert.ok(elapsedMs < 1900, `expected prompt timeout finalization, got ${elapsedMs}ms`);
    assert.equal(fs.existsSync(survivedPath), false);
  } finally {
    cleanupTempWorkspace(workspaceDir);
  }
});

test("executeCronTask claims a queued cron task once so a second dispatcher skips", async () => {
  const workspaceDir = makeTempWorkspace();
  const attemptsPath = path.join(workspaceDir, "attempt-count.txt");
  const scheduledFor = new Date().toISOString();
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");
    writeCronJob(workspaceDir, null, "single-claim-job", "Succeed once so the second runtime dispatcher must skip cleanly.");

    const wrapperPath = createFakeClaudeCommand(
      workspaceDir,
      "fake-claude-success",
      process.platform === "win32"
        ? [
            "@echo off",
            "setlocal EnableDelayedExpansion",
            "set COUNT=0",
            "if exist attempt-count.txt set /p COUNT=<attempt-count.txt",
            "set /a COUNT+=1",
            "> attempt-count.txt echo !COUNT!",
            "ping -n 2 127.0.0.1 >nul",
            "echo success",
            "exit /b 0",
            "",
          ]
        : [
            "set -e",
            "COUNT=0",
            "if [ -f attempt-count.txt ]; then COUNT=$(cat attempt-count.txt); fi",
            "COUNT=$((COUNT + 1))",
            "printf '%s\\n' \"$COUNT\" > attempt-count.txt",
            "sleep 1",
            "printf 'success\\n'",
            "exit 0",
          ]
    );

    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "single-claim-job", null);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "manual",
      dedupeByMinute: false,
      scheduledFor,
    });

    const [first, second] = await Promise.all([
      cronRuntime.executeCronTask(workspaceDir, queued.task.id),
      cronRuntime.executeCronTask(workspaceDir, queued.task.id),
    ]);

    const attempts = Number(fs.readFileSync(attemptsPath, "utf-8").trim());
    const outcomes = [first.result, second.result].sort();
    const cronRuns = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT result FROM cron_runs WHERE taskId = ?")
      .all(queued.task.id);

    assert.equal(attempts, 1);
    assert.deepEqual(outcomes, ["skipped", "success"]);
    assert.equal(cronRuns.length, 1);
    assert.equal(cronRuns[0].result, "success");
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("client cron runs fail when they touch files outside the selected workspace", async () => {
  const workspaceDir = makeTempWorkspace();
  const clientId = "acme";
  const clientDir = path.join(workspaceDir, "clients", clientId);
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;
  const scheduledFor = new Date().toISOString();

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# root workspace\n", "utf-8");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, "AGENTS.md"), "# client workspace\n", "utf-8");
    writeCronJob(workspaceDir, clientId, "client-leak-job", "Write outside the workspace.");

    const wrapperPath = createFakeClaudeCommand(workspaceDir, "client-leak-claude", process.platform === "win32"
      ? [
          "@echo off",
          "setlocal",
          "> ..\\..\\root-leak.txt echo leaked",
          "exit /b 0",
          "",
        ]
      : [
          "set -e",
          "printf 'leaked\\n' > ../../root-leak.txt",
          "exit 0",
        ]);
    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "client-leak-job", clientId);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "manual",
      dedupeByMinute: false,
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const taskRow = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT status, errorMessage FROM tasks WHERE id = ?")
      .get(queued.task.id);

    assert.equal(result.result, "failure");
    assert.equal(taskRow.status, "review");
    assert.match(taskRow.errorMessage, /outside its workspace/);
    assert.match(taskRow.errorMessage, /root-leak\.txt/);
    assert.equal(fs.existsSync(path.join(workspaceDir, "root-leak.txt")), true);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("client cron runs allow writes anywhere inside the selected client workspace", async () => {
  const workspaceDir = makeTempWorkspace();
  const clientId = "acme";
  const clientDir = path.join(workspaceDir, "clients", clientId);
  const safeOutputPath = path.join(clientDir, "projects", "safe-note.txt");
  const originalClaudeBin = process.env.AI_OS_CLAUDE_BIN;
  const scheduledFor = new Date().toISOString();

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# root workspace\n", "utf-8");
    fs.mkdirSync(clientDir, { recursive: true });
    fs.writeFileSync(path.join(clientDir, "AGENTS.md"), "# client workspace\n", "utf-8");
    writeCronJob(workspaceDir, clientId, "client-safe-job", "Write inside the workspace.");

    const wrapperPath = createFakeClaudeCommand(workspaceDir, "client-safe-claude", process.platform === "win32"
      ? [
          "@echo off",
          "setlocal",
          "if not exist projects mkdir projects",
          "> projects\\safe-note.txt echo safe",
          "exit /b 0",
          "",
        ]
      : [
          "set -e",
          "mkdir -p projects",
          "printf 'safe\\n' > projects/safe-note.txt",
          "exit 0",
        ]);
    process.env.AI_OS_CLAUDE_BIN = wrapperPath;

    const job = cronRuntime.getCronJob(workspaceDir, "client-safe-job", clientId);
    const queued = cronRuntime.enqueueCronJob(workspaceDir, job, {
      trigger: "manual",
      dedupeByMinute: false,
      scheduledFor,
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, queued.task.id);
    const taskRow = cronRuntime
      .getDb(workspaceDir)
      .prepare("SELECT status, errorMessage FROM tasks WHERE id = ?")
      .get(queued.task.id);

    assert.equal(result.result, "success");
    assert.equal(taskRow.status, "done");
    assert.equal(taskRow.errorMessage, null);
    assert.equal(fs.existsSync(safeOutputPath), true);
  } finally {
    if (originalClaudeBin === undefined) {
      delete process.env.AI_OS_CLAUDE_BIN;
    } else {
      process.env.AI_OS_CLAUDE_BIN = originalClaudeBin;
    }
    cleanupTempWorkspace(workspaceDir);
  }
});

test("resolveWindowsClaudeLaunchPlan keeps plain claude and exe paths on the direct launch path", () => {
  const bashPath = path.join(os.tmpdir(), "cron-runtime-test-bash.exe");

  try {
    fs.writeFileSync(bashPath, "", "utf-8");
    cronRuntime.setCronRuntimeTestHooks({
      findCommandOnPath(command) {
        if (command === "claude" || command === "claude.exe") {
          return "C:\\Users\\gmsal\\.local\\bin\\claude.exe";
        }
        if (command === "bash.exe" || command === "bash") {
          return bashPath;
        }
        return null;
      },
    });

    const plainPlan = cronRuntime.resolveWindowsClaudeLaunchPlan({
      claudeCommand: "claude",
      env: {},
    });
    const exePlan = cronRuntime.resolveWindowsClaudeLaunchPlan({
      claudeCommand: "C:\\Users\\gmsal\\.local\\bin\\claude.exe",
      env: {},
    });

    assert.equal(plainPlan.mode, "direct");
    assert.equal(plainPlan.env.CLAUDE_CODE_GIT_BASH_PATH, bashPath);
    assert.equal(exePlan.mode, "direct");
    assert.equal(exePlan.command, "C:\\Users\\gmsal\\.local\\bin\\claude.exe");
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    fs.rmSync(bashPath, { force: true });
  }
});

test("resolveWindowsClaudeLaunchPlan uses the wrapper path for .cmd overrides", () => {
  const bashPath = path.join(os.tmpdir(), "cron-runtime-test-wrapper-bash.exe");

  try {
    fs.writeFileSync(bashPath, "", "utf-8");
    cronRuntime.setCronRuntimeTestHooks({
      findCommandOnPath(command) {
        if (command === "bash.exe" || command === "bash") {
          return bashPath;
        }
        return null;
      },
    });

    const launchPlan = cronRuntime.resolveWindowsClaudeLaunchPlan({
      claudeCommand: "C:\\tools\\fake-claude.cmd",
      env: {},
    });

    assert.equal(launchPlan.mode, "wrapper");
    assert.equal(launchPlan.extension, ".cmd");
    assert.equal(launchPlan.env.CLAUDE_CODE_GIT_BASH_PATH, bashPath);
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    fs.rmSync(bashPath, { force: true });
  }
});

test("resolveGitBashPath preserves CLAUDE_CODE_GIT_BASH_PATH or discovers bash.exe", () => {
  const discoveredBashPath = path.join(os.tmpdir(), "cron-runtime-test-discovered-bash.exe");

  try {
    fs.writeFileSync(discoveredBashPath, "", "utf-8");
    cronRuntime.setCronRuntimeTestHooks({
      findCommandOnPath(command) {
        if (command === "bash.exe" || command === "bash") {
          return discoveredBashPath;
        }
        return null;
      },
    });

    assert.equal(
      cronRuntime.resolveGitBashPath({
        CLAUDE_CODE_GIT_BASH_PATH: "C:\\Custom\\Git\\bin\\bash.exe",
      }),
      "C:\\Custom\\Git\\bin\\bash.exe"
    );
    assert.equal(cronRuntime.resolveGitBashPath({}), discoveredBashPath);
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    fs.rmSync(discoveredBashPath, { force: true });
  }
});

test("shouldSendCronNotification respects on_finish, on_failure, and silent", () => {
  const matrix = [
    ["on_finish", "success", true],
    ["on_finish", "failure", true],
    ["on_finish", "timeout", true],
    ["on_failure", "success", false],
    ["on_failure", "failure", true],
    ["on_failure", "timeout", true],
    ["silent", "success", false],
    ["silent", "failure", false],
    ["silent", "timeout", false],
  ];

  for (const [notifySetting, result, expected] of matrix) {
    assert.equal(
      cronRuntime.shouldSendCronNotification(notifySetting, result),
      expected,
      `${notifySetting} should ${expected ? "" : "not "}send for ${result}`
    );
  }
});

test("executeCronTask finalizes missing cron definitions through the shared failure path", async () => {
  const workspaceDir = makeTempWorkspace();
  const db = cronRuntime.getDb(workspaceDir);
  const taskId = "task-missing-cron-job";
  const startedAt = new Date().toISOString();
  const notifications = [];

  try {
    fs.writeFileSync(path.join(workspaceDir, "AGENTS.md"), "# test workspace\n", "utf-8");

    db.prepare(
      `INSERT INTO tasks (
        id, title, description, status, level, parentId, columnOrder, createdAt, updatedAt,
        costUsd, tokensUsed, durationMs, activityLabel, errorMessage, startedAt, completedAt,
        clientId, needsInput, phaseNumber, gsdStep, cronJobSlug, permissionMode
      ) VALUES (?, ?, ?, 'queued', 'task', NULL, 0, ?, ?, NULL, NULL, NULL, 'Queued', NULL, ?, NULL, NULL, 0, NULL, NULL, ?, 'default')`
    ).run(
      taskId,
      "Missing cron job",
      "Should fail through the shared finalizer",
      startedAt,
      startedAt,
      startedAt,
      "missing-job"
    );

    db.prepare(
      `INSERT INTO cron_runs (jobSlug, taskId, startedAt, result, trigger, clientId, scheduledFor)
       VALUES (?, ?, ?, 'running', 'scheduled', NULL, ?)`
    ).run("missing-job", taskId, startedAt, startedAt);

    cronRuntime.setCronRuntimeTestHooks({
      platform: () => "win32",
      notificationSender(_agenticOsDir, notification) {
        notifications.push(notification);
        return Promise.resolve({ sent: true, event: notification.event });
      },
    });

    const result = await cronRuntime.executeCronTask(workspaceDir, taskId);
    const updatedTask = db.prepare("SELECT status, errorMessage FROM tasks WHERE id = ?").get(taskId);
    const cronRun = db
      .prepare(
        `SELECT result, exitCode, trigger
         FROM cron_runs
         WHERE taskId = ?`
      )
      .get(taskId);

    assert.equal(result.result, "failure");
    assert.equal(updatedTask.status, "review");
    assert.match(updatedTask.errorMessage, /Cron job definition not found/);
    assert.equal(cronRun.result, "failure");
    assert.equal(cronRun.exitCode, 1);
    assert.equal(cronRun.trigger, "scheduled");
    assert.equal(notifications.length, 1);
    assert.equal(notifications[0].event, "failure");
    assert.equal(notifications[0].context.jobName, "missing-job");
  } finally {
    cronRuntime.resetCronRuntimeTestHooks();
    cleanupTempWorkspace(workspaceDir);
  }
});
