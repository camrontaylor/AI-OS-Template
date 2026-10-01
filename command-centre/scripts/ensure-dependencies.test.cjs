const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { ensureDependencies } = require("./ensure-dependencies.cjs");

function createApp() {
  const appRoot = fs.mkdtempSync(path.join(os.tmpdir(), "command-centre-deps-"));
  fs.writeFileSync(path.join(appRoot, "package.json"), "{}\n");
  fs.writeFileSync(path.join(appRoot, "package-lock.json"), "{}\n");
  return appRoot;
}

function createInstalledLock(appRoot, installedTime, packageTime) {
  const nodeModules = path.join(appRoot, "node_modules");
  const installedLock = path.join(nodeModules, ".package-lock.json");
  const packageLock = path.join(appRoot, "package-lock.json");
  fs.mkdirSync(nodeModules, { recursive: true });
  fs.writeFileSync(installedLock, "{}\n");
  fs.utimesSync(installedLock, installedTime, installedTime);
  fs.utimesSync(packageLock, packageTime, packageTime);
}

function runEnsure(appRoot, responses) {
  const calls = [];
  const runNpm = (args, options) => {
    calls.push({ args, options });
    return responses.shift() || { status: 0 };
  };
  const result = ensureDependencies({
    appRoot,
    runNpm,
    log: () => {},
    logError: () => {},
  });
  return { calls, result };
}

test("runs npm ci for a first install without node_modules", (t) => {
  const appRoot = createApp();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));

  const { calls, result } = runEnsure(appRoot, [{ status: 0 }]);

  assert.equal(result, 0);
  assert.deepEqual(calls.map((call) => call.args), [["ci", "--no-audit", "--no-fund"]]);
});

test("runs npm ci when package-lock.json is newer than the installed lock", (t) => {
  const appRoot = createApp();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  createInstalledLock(appRoot, new Date("2026-01-01"), new Date("2026-01-02"));

  const { calls, result } = runEnsure(appRoot, [{ status: 0 }]);

  assert.equal(result, 0);
  assert.deepEqual(calls.map((call) => call.args), [["ci", "--no-audit", "--no-fund"]]);
});

test("runs npm ci when npm ls finds missing dependencies", (t) => {
  const appRoot = createApp();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  createInstalledLock(appRoot, new Date("2026-01-02"), new Date("2026-01-01"));

  const { calls, result } = runEnsure(appRoot, [{ status: 1 }, { status: 0 }]);

  assert.equal(result, 0);
  assert.deepEqual(calls.map((call) => call.args), [
    ["ls", "--depth=0", "--json"],
    ["ci", "--no-audit", "--no-fund"],
  ]);
});

test("does not run npm ci when the installed dependencies are current", (t) => {
  const appRoot = createApp();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));
  createInstalledLock(appRoot, new Date("2026-01-02"), new Date("2026-01-01"));

  const { calls, result } = runEnsure(appRoot, [{ status: 0 }]);

  assert.equal(result, 0);
  assert.deepEqual(calls.map((call) => call.args), [["ls", "--depth=0", "--json"]]);
});

test("returns an error when npm ci fails", (t) => {
  const appRoot = createApp();
  t.after(() => fs.rmSync(appRoot, { recursive: true, force: true }));

  const { calls, result } = runEnsure(appRoot, [{ status: 7 }]);

  assert.equal(result, 1);
  assert.deepEqual(calls.map((call) => call.args), [["ci", "--no-audit", "--no-fund"]]);
});
