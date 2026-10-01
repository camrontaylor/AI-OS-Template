#!/usr/bin/env node

const { spawn, spawnSync } = require("child_process");
const path = require("path");

const eventName = process.argv[2];
const validEvents = new Set(["UserPromptSubmit", "Stop", "Notification"]);

if (!validEvents.has(eventName)) {
  console.error(
    `AI-OS hook error: invalid hook name "${eventName}". Expected one of ${[
      ...validEvents,
    ].join(", ")}`
  );
  process.exit(1);
}

function resolvePython() {
  const versionProbe = "import sys; raise SystemExit(0 if sys.version_info[0] == 3 else 1)";
  const candidates =
    process.platform === "win32"
      ? [
          { command: "py", args: ["-3"] },
          { command: "python", args: [] },
          { command: "python3", args: [] },
        ]
      : [
          { command: "python3", args: [] },
          { command: "python", args: [] },
        ];

  for (const candidate of candidates) {
    const probe = spawnSync(candidate.command, [...candidate.args, "-c", versionProbe], {
      stdio: "ignore",
      windowsHide: true,
    });
    if (probe.status === 0) {
      return candidate;
    }
  }

  return null;
}

function readStdin() {
  return new Promise((resolve, reject) => {
    let input = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      input += chunk;
    });
    process.stdin.on("end", () => resolve(input));
    process.stdin.on("error", reject);

    if (process.stdin.isTTY) {
      resolve("");
    }
  });
}

async function main() {
  const python = resolvePython();
  if (!python) {
    console.error(
      "AI-OS hook error: Python 3 is required for ccnotify.py (tried py -3, python, python3)."
    );
    process.exit(1);
  }

  const scriptPath = path.resolve(__dirname, "../hooks_info/ccnotify.py");
  const input = await readStdin();

  const child = spawn(
    python.command,
    [...python.args, scriptPath, eventName],
    {
      stdio: ["pipe", "inherit", "inherit"],
      windowsHide: true,
    }
  );

  child.on("error", (error) => {
    console.error(`AI-OS hook error: ${error.message}`);
    process.exit(1);
  });

  child.stdin.end(input);
  child.on("exit", (code) => {
    process.exit(code ?? 1);
  });
}

main().catch((error) => {
  console.error(`AI-OS hook error: ${error.message}`);
  process.exit(1);
});
