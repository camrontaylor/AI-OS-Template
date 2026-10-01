const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const SCRIPTS = path.resolve(__dirname, "../../../scripts");
const identity = require(path.join(SCRIPTS, "local-memory-identity.cjs"));
const memoryImport = require(path.join(SCRIPTS, "memory-import-sessions.cjs"));
const memorySearch = require(path.join(SCRIPTS, "memory-search.cjs"));
const memoryWatch = require(path.join(SCRIPTS, "memory-watch.cjs"));
const WATCH_SCRIPT = path.join(SCRIPTS, "memory-watch.cjs");
const WATCH_HOOK = path.resolve(__dirname, "../../../../.claude/hooks/memory-watch-start.js");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-memory-cli-scope-"));
}

test("--auto-local starts the local watcher with the stable private owner", () => {
  const root = tempDir();
  try {
    const privateScope = memoryWatch.buildScope(
      memoryWatch.parseArgs(["--auto-local"]),
      { backendKind: "pglite", rootDir: root },
    );
    assert.deepEqual(privateScope, {
      teamId: null,
      clientId: null,
      userId: identity.ensureLocalUserId(root),
      visibility: "private",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("manual local watcher preserves explicit system scope", () => {
  const root = tempDir();
  try {
    const systemScope = memoryWatch.buildScope(
      { visibility: "system", team: "team-1", client: "ignored", user: "ignored" },
      { backendKind: "pglite", rootDir: root },
    );
    assert.deepEqual(systemScope, {
      teamId: "team-1",
      clientId: null,
      userId: null,
      visibility: "system",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("hosted watcher refuses to guess visibility", () => {
  assert.throws(
    () =>
      memoryWatch.buildScope(
        {},
        { backendKind: "postgres", rootDir: "/unused" },
      ),
    /requires an explicit --visibility/,
  );
});

test("--auto-local is parsed and the SessionStart hook always passes it", () => {
  assert.equal(memoryWatch.parseArgs(["--auto-local"]).autoLocal, true);
  assert.match(
    fs.readFileSync(WATCH_HOOK, "utf8"),
    /spawn\(process\.execPath, \[script, "--auto-local"\]/,
  );
});

test("--auto-local exits cleanly on hosted Postgres without local side effects", () => {
  const root = tempDir();
  try {
    const result = spawnSync(process.execPath, [WATCH_SCRIPT, "--auto-local", "--verbose"], {
      encoding: "utf8",
      env: {
        ...process.env,
        AI_OS_DIR: root,
        MEMORY_STORE_BACKEND: "postgres",
        MEMORY_DATABASE_URL: "postgresql://unused:unused@127.0.0.1:1/unused",
        DATABASE_URL: "",
        MEMORY_EMBEDDER: "hash",
      },
    });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /local-only/);
    assert.match(result.stdout, /AIOS-436/);
    assert.equal(fs.existsSync(path.join(root, ".command-centre", "memory")), false);
    assert.equal(fs.existsSync(path.join(root, ".command-centre", "memory.watch.lock")), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local private search include loads the stable local owner", () => {
  const root = tempDir();
  try {
    const searchScope = memorySearch.buildSearchScope(
      { include: "system,private" },
      { rootDir: root },
    );
    assert.deepEqual(searchScope, {
      teamId: null,
      clientId: null,
      userId: identity.ensureLocalUserId(root),
      include: ["system", "private"],
    });
    assert.equal(fs.existsSync(identity.localUserConfigPath(root)), true);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("an explicit search user overrides local identity without creating one", () => {
  const root = tempDir();
  try {
    const searchScope = memorySearch.buildSearchScope(
      { include: "private", user: "explicit-user" },
      { rootDir: root },
    );
    assert.equal(searchScope.userId, "explicit-user");
    assert.deepEqual(searchScope.include, ["private"]);
    assert.equal(fs.existsSync(identity.localUserConfigPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("system-only local search does not create an identity", () => {
  const root = tempDir();
  try {
    const searchScope = memorySearch.buildSearchScope(
      { include: "system" },
      { rootDir: root },
    );
    assert.equal(searchScope.userId, null);
    assert.deepEqual(searchScope.include, ["system"]);
    assert.equal(fs.existsSync(identity.localUserConfigPath(root)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("local session import defaults private without writing identity during dry-run", () => {
  const root = tempDir();
  try {
    const preview = memoryImport.buildScope(
      {},
      { backendKind: "pglite", rootDir: root, readOnly: true },
    );
    assert.equal(preview.visibility, "private");
    assert.equal(preview.userId, "local-dry-run");
    assert.equal(fs.existsSync(identity.localUserConfigPath(root)), false);

    const actual = memoryImport.buildScope(
      {},
      { backendKind: "pglite", rootDir: root },
    );
    assert.equal(actual.visibility, "private");
    assert.equal(actual.userId, identity.ensureLocalUserId(root));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("bare non-interactive session import keeps scope resolution read-only", () => {
  assert.equal(memoryImport.shouldUseReadOnlyScope({}, false), true);
  assert.equal(memoryImport.shouldUseReadOnlyScope({}, true), false);
  assert.equal(
    memoryImport.shouldUseReadOnlyScope({ from: "current", sessions: 30 }, false),
    false,
  );
  assert.equal(memoryImport.shouldUseReadOnlyScope({ dryRun: true }, true), true);
});

test("hosted session import requires visibility and normalizes explicit scope", () => {
  assert.throws(
    () =>
      memoryImport.buildScope(
        {},
        { backendKind: "postgres", rootDir: "/unused" },
      ),
    /requires an explicit --visibility/,
  );
  assert.deepEqual(
    memoryImport.buildScope(
      { visibility: "team", team: "team-1", client: "ignored", user: "ignored" },
      { backendKind: "postgres", rootDir: "/unused" },
    ),
    {
      teamId: "team-1",
      clientId: null,
      userId: null,
      visibility: "team",
    },
  );
});

test("hosted session import treats every non-private scope as shared", () => {
  for (const visibility of ["system", "team", "client"]) {
    assert.equal(
      memoryImport.isSharedHostedScope("postgres", { visibility }),
      true,
      `${visibility} must require --allow-shared`,
    );
  }
  assert.equal(
    memoryImport.isSharedHostedScope("postgres", { visibility: "private" }),
    false,
  );
  assert.equal(
    memoryImport.isSharedHostedScope("pglite", { visibility: "client" }),
    false,
  );
});
