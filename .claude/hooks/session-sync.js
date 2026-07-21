#!/usr/bin/env node
// SessionStart hook — creates or resumes a board task in the command centre
// Fire-and-forget: spawns background process so it doesn't block session startup

const fs = require("fs");
const path = require("path");
const os = require("os");
const { spawn, execSync } = require("child_process");

// Read stdin for session_id and cwd
let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  let data;
  try {
    data = JSON.parse(input);
  } catch {
    return;
  }

  const sessionId = data.session_id;
  const cwd = data.cwd || process.cwd();
  if (!sessionId) return;

  // Derive projectSlug from cwd (handles both / and \ separators)
  let projectSlug = null;
  const normalizedCwd = cwd.replace(/\\/g, "/");
  const briefsMatch = normalizedCwd.match(/\/projects\/briefs\/([^/]+)/);
  if (briefsMatch) {
    projectSlug = briefsMatch[1];
  }

  // Walk up from cwd to find the AI-OS root (contains .command-centre/ or shared instruction files)
  function findAgenticOsRoot(startDir) {
    let dir = startDir;
    for (let i = 0; i < 10; i++) {
      // Check for .command-centre/port (strongest signal)
      if (fs.existsSync(path.join(dir, ".command-centre", "port"))) return dir;
      // Check for AGENTS.md or CLAUDE.md plus .claude/ at this level (AI-OS root marker)
      if (
        (
          fs.existsSync(path.join(dir, "AGENTS.md")) ||
          fs.existsSync(path.join(dir, "CLAUDE.md"))
        ) &&
        fs.existsSync(path.join(dir, ".claude"))
      ) return dir;
      const parent = path.dirname(dir);
      if (parent === dir) break; // reached filesystem root
      dir = parent;
    }
    return null;
  }

  // Discover command centre port
  function discoverPort() {
    if (process.env.COMMAND_CENTRE_PORT) return process.env.COMMAND_CENTRE_PORT;

    const root = findAgenticOsRoot(cwd);
    if (root) {
      const portFile = path.join(root, ".command-centre", "port");
      try {
        return fs.readFileSync(portFile, "utf8").trim();
      } catch {}
    }

    return "3000";
  }

  const port = discoverPort();

  // Get Claude's actual PID: hooks run as shell → node, so process.ppid is the
  // shell. We query that shell's parent to get the Claude CLI process.
  function getClaudePid() {
    try {
      const shellPid = process.ppid;
      if (process.platform === "win32") {
        const out = execSync(
          `powershell -NoProfile -NonInteractive -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${shellPid}' -ErrorAction SilentlyContinue).ParentProcessId"`,
          { timeout: 1500, windowsHide: true }
        ).toString().trim();
        const pid = parseInt(out, 10);
        return isNaN(pid) ? null : pid;
      } else {
        const out = execSync(`ps -o ppid= -p ${shellPid}`, { timeout: 1500 })
          .toString().trim();
        const pid = parseInt(out, 10);
        return isNaN(pid) ? null : pid;
      }
    } catch {
      return null;
    }
  }
  const claudePid = getClaudePid();

  // Spawn background process to make the HTTP request
  const child = spawn(
    process.execPath,
    [
      "-e",
      `
    const http = require("http");
    const fs = require("fs");
    const path = require("path");
    const os = require("os");

    const payload = JSON.stringify({
      sessionId: ${JSON.stringify(sessionId)},
      cwd: ${JSON.stringify(cwd)},
      projectSlug: ${JSON.stringify(projectSlug)},
      claudePid: ${claudePid || "null"},
    });

    const req = http.request(
      {
        hostname: "localhost",
        port: ${JSON.stringify(port)},
        path: "/api/tasks/sync-session",
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(payload),
        },
        timeout: 5000,
      },
      (res) => {
        let body = "";
        res.on("data", (chunk) => (body += chunk));
        res.on("end", () => {
          try {
            const result = JSON.parse(body);
            if (result.taskId) {
              const tmpFile = path.join(os.tmpdir(), "cc-session-" + ${JSON.stringify(sessionId)} + ".json");
              fs.writeFileSync(tmpFile, JSON.stringify({
                taskId: result.taskId,
                port: ${JSON.stringify(port)},
                syncMode: result.syncMode || (result.isNew ? "hook-owned" : "managed"),
                claudePid: ${claudePid || "null"},
              }));
            }
          } catch {}
        });
      }
    );
    req.on("error", () => {});
    req.on("timeout", () => req.destroy());
    req.write(payload);
    req.end();
  `,
    ],
    {
      stdio: "ignore",
      windowsHide: true,
      detached: true,
    }
  );

  child.unref();
});
