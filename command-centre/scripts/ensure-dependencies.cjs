#!/usr/bin/env node

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const DEFAULT_APP_ROOT = path.resolve(__dirname, "..");

function defaultRunNpm(args, options = {}) {
  const isWindows = process.platform === "win32";
  const npmCommand = isWindows ? process.env.ComSpec || "cmd.exe" : "npm";
  const npmArgs = isWindows ? ["/d", "/s", "/c", "npm", ...args] : args;
  return spawnSync(npmCommand, npmArgs, {
    cwd: options.appRoot || DEFAULT_APP_ROOT,
    env: options.env || process.env,
    encoding: options.stdio === "pipe" ? "utf8" : undefined,
    stdio: options.stdio || "inherit",
  });
}

function dependencyState(options = {}) {
  const appRoot = options.appRoot || DEFAULT_APP_ROOT;
  const runNpm = options.runNpm || defaultRunNpm;
  const packageJsonPath = path.join(appRoot, "package.json");
  const packageLockPath = path.join(appRoot, "package-lock.json");
  const nodeModulesPath = path.join(appRoot, "node_modules");
  const installedLockPath = path.join(nodeModulesPath, ".package-lock.json");

  if (!fs.existsSync(packageJsonPath)) {
    return { fatal: `package.json was not found at ${packageJsonPath}` };
  }
  if (!fs.existsSync(packageLockPath)) {
    return { fatal: `package-lock.json was not found at ${packageLockPath}` };
  }
  if (!fs.existsSync(nodeModulesPath)) {
    return { needsSync: true, reason: "node_modules is missing" };
  }
  if (!fs.existsSync(installedLockPath)) {
    return { needsSync: true, reason: "the installed dependency lock is missing" };
  }

  const packageLockMtime = fs.statSync(packageLockPath).mtimeMs;
  const installedLockMtime = fs.statSync(installedLockPath).mtimeMs;
  if (packageLockMtime > installedLockMtime) {
    return { needsSync: true, reason: "package-lock.json is newer than node_modules" };
  }

  const npmLs = runNpm(["ls", "--depth=0", "--json"], {
    appRoot,
    env: options.env,
    stdio: "pipe",
  });
  if (npmLs.error || npmLs.status !== 0) {
    return { needsSync: true, reason: "npm reports missing or invalid dependencies" };
  }

  return { needsSync: false };
}

function ensureDependencies(options = {}) {
  const appRoot = options.appRoot || DEFAULT_APP_ROOT;
  const runNpm = options.runNpm || defaultRunNpm;
  const log = options.log || console.log;
  const logError = options.logError || console.error;
  const state = dependencyState({ appRoot, runNpm, env: options.env });

  if (state.fatal) {
    logError(`[command-centre-deps] ${state.fatal}`);
    return 1;
  }
  if (!state.needsSync) {
    return 0;
  }

  log(`[command-centre-deps] ${state.reason}. Running npm ci...`);
  const npmCi = runNpm(["ci", "--no-audit", "--no-fund"], {
    appRoot,
    env: options.env,
    stdio: "inherit",
  });
  if (npmCi.error) {
    logError(`[command-centre-deps] Could not start npm ci: ${npmCi.error.message}`);
    return 1;
  }
  if (npmCi.status !== 0) {
    logError(`[command-centre-deps] npm ci failed with exit code ${npmCi.status ?? "unknown"}.`);
    return 1;
  }

  log("[command-centre-deps] Command Centre dependencies are ready.");
  return 0;
}

if (require.main === module) {
  process.exitCode = ensureDependencies();
}

module.exports = {
  defaultRunNpm,
  dependencyState,
  ensureDependencies,
};
