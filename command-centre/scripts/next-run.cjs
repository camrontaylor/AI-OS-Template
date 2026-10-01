const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { findWorkspaceRoot, hasWorkspaceMarker, workspaceMarkers } = require("./workspace-root.cjs");

const appRoot = path.resolve(__dirname, "..");
const workspaceRoot = findWorkspaceRoot(appRoot);
const nextCliPath = path.join(appRoot, "node_modules", "next", "dist", "bin", "next");
const supportedCommands = new Set(["dev", "build", "start"]);
const bundlerFlags = new Set(["--webpack"]);
const turbopackFlags = new Set(["--turbopack", "--turbo"]);

function fail(message) {
  console.error(`[next-run] ${message}`);
  process.exit(1);
}

function assertFileExists(filePath, description) {
  if (!fs.existsSync(filePath)) {
    fail(`${description} not found at ${filePath}`);
  }
}

function hasFlag(args, flags) {
  return args.some((arg) => flags.has(arg));
}

const command = process.argv[2];
const forwardedArgs = process.argv.slice(3);

if (!supportedCommands.has(command)) {
  fail(`Expected one of: ${[...supportedCommands].join(", ")}`);
}

if (hasFlag(forwardedArgs, bundlerFlags)) {
  fail("Webpack is not supported for Command Centre. Use the default Turbopack workflow.");
}

if (!hasWorkspaceMarker(workspaceRoot)) {
  fail(
    `AI-OS workspace marker not found at ${workspaceRoot}. Expected one of: ${workspaceMarkers.join(", ")}`
  );
}
assertFileExists(nextCliPath, "App-local Next CLI");

const commandArgs = [nextCliPath, command];
if ((command === "dev" || command === "build") && !hasFlag(forwardedArgs, turbopackFlags)) {
  commandArgs.push("--turbopack");
}
commandArgs.push(...forwardedArgs);

process.chdir(appRoot);

const child = spawn(process.execPath, commandArgs, {
  cwd: appRoot,
  env: {
    ...process.env,
    AI_OS_DIR: process.env.AI_OS_DIR || workspaceRoot,
  },
  stdio: "inherit",
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }

  process.exit(code ?? 0);
});

child.on("error", (error) => {
  fail(error.message);
});
