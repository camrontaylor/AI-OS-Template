"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");
const { spawnSync } = require("node:child_process");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function createWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-local-profile-"));
  fs.writeFileSync(path.join(root, "AGENTS.md"), "# Test\n");
  const schemaDir = path.join(root, "command-centre", "src", "lib");
  fs.mkdirSync(schemaDir, { recursive: true });
  fs.copyFileSync(path.join(__dirname, "schema.sql"), path.join(schemaDir, "schema.sql"));
  const teamConfigDir = path.join(root, "team-config");
  fs.mkdirSync(teamConfigDir, { recursive: true });
  return { root, teamConfigDir };
}

function writeTeamContext(teamConfigDir, { serverId = "server-1", userId = "user-1", teamId = "team-1" } = {}) {
  fs.writeFileSync(
    path.join(teamConfigDir, "team-context.json"),
    JSON.stringify({
      version: 3,
      apiUrl: "https://team.example.test",
      token: "session-token",
      expiresAt: "2999-01-01T00:00:00.000Z",
      serverId,
      user: { id: userId, email: `${userId}@example.test` },
      selectedTeamId: teamId,
      team: { id: teamId },
    }),
  );
}

async function withWorkspace(run) {
  const workspace = createWorkspace();
  const previousRoot = process.env.AI_OS_DIR;
  const previousConfig = process.env.AI_OS_TEAM_CONFIG_DIR;
  const previousJournalMode = process.env.COMMAND_CENTRE_SQLITE_JOURNAL_MODE;
  process.env.AI_OS_DIR = workspace.root;
  process.env.AI_OS_TEAM_CONFIG_DIR = workspace.teamConfigDir;
  process.env.COMMAND_CENTRE_SQLITE_JOURNAL_MODE = "DELETE";
  try {
    return await run(workspace);
  } finally {
    if (previousRoot === undefined) delete process.env.AI_OS_DIR;
    else process.env.AI_OS_DIR = previousRoot;
    if (previousConfig === undefined) delete process.env.AI_OS_TEAM_CONFIG_DIR;
    else process.env.AI_OS_TEAM_CONFIG_DIR = previousConfig;
    if (previousJournalMode === undefined) delete process.env.COMMAND_CENTRE_SQLITE_JOURNAL_MODE;
    else process.env.COMMAND_CENTRE_SQLITE_JOURNAL_MODE = previousJournalMode;
    await new Promise((resolve) => setTimeout(resolve, 50));
    fs.rmSync(workspace.root, {
      recursive: true,
      force: true,
      maxRetries: 10,
      retryDelay: 50,
    });
  }
}

test("keeps an absent Team context in the existing Solo database", () => withWorkspace(({ root }) => {
  const profiles = loadTsModule(path.join(__dirname, "local-profile.ts"));
  const descriptor = profiles.resolveLocalProfileDescriptor();
  assert.equal(descriptor.mode, "solo");
  assert.equal(descriptor.profileKey, "solo");
  assert.equal(descriptor.dbPath, path.join(root, ".command-centre", "data.db"));
}));

test("uses a stable server/user key and ignores team selection", () => withWorkspace(({ teamConfigDir }) => {
  writeTeamContext(teamConfigDir, { teamId: "team-a" });
  const profiles = loadTsModule(path.join(__dirname, "local-profile.ts"));
  const first = profiles.resolveLocalProfileDescriptor();
  writeTeamContext(teamConfigDir, { teamId: "team-b" });
  const second = profiles.resolveLocalProfileDescriptor();
  assert.equal(first.mode, "team");
  assert.match(first.profileKey, /^[a-f0-9]{64}$/);
  assert.equal(second.profileKey, first.profileKey);
  assert.equal(second.dbPath, first.dbPath);
  assert.match(first.dbPath.replace(/\\/g, "/"), new RegExp(`/profiles/${first.profileKey}/data\\.db$`));
}));

test("locks corrupt, incomplete, and expired Team contexts instead of using Solo", () => withWorkspace(({ teamConfigDir }) => {
  const contextPath = path.join(teamConfigDir, "team-context.json");
  fs.writeFileSync(contextPath, "{broken");
  let profiles = loadTsModule(path.join(__dirname, "local-profile.ts"));
  assert.throws(() => profiles.resolveLocalProfileDescriptor(), (error) => error.reason === "corrupt_context" && error.status === 423);

  fs.writeFileSync(contextPath, JSON.stringify({ apiUrl: "https://team.test", token: "x", user: { id: "u" } }));
  profiles = loadTsModule(path.join(__dirname, "local-profile.ts"));
  assert.throws(() => profiles.resolveLocalProfileDescriptor(), (error) => error.reason === "identity_incomplete");

  writeTeamContext(teamConfigDir);
  const expired = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  expired.expiresAt = "2000-01-01T00:00:00.000Z";
  fs.writeFileSync(contextPath, JSON.stringify(expired));
  profiles = loadTsModule(path.join(__dirname, "local-profile.ts"));
  assert.throws(() => profiles.resolveLocalProfileDescriptor(), (error) => error.reason === "reauthentication_required");
}));

test("isolates Solo and sequential Team users while retaining leased handles", () => withWorkspace(() => {
  const fixture = spawnSync(
    process.execPath,
    [path.join(__dirname, "test-utils", "local-profile-isolation-fixture.cjs")],
    {
      env: { ...process.env },
      encoding: "utf8",
    },
  );
  assert.equal(fixture.status, 0, fixture.stderr || fixture.stdout);
}));

test("prefixes browser state for Team profiles and preserves Solo keys", () => {
  const previousWindow = global.window;
  try {
    global.window = { __COMMAND_CENTRE_PROFILE__: { version: 1, mode: "solo", profileKey: "solo", sessionId: "solo-session" } };
    const storage = loadTsModule(path.join(__dirname, "profile-storage.ts"), {
      stubs: { "./local-profile": {} },
    });
    assert.equal(storage.profileStorageKey("cc.chat-draft:v1:x"), "cc.chat-draft:v1:x");
    global.window.__COMMAND_CENTRE_PROFILE__ = { version: 1, mode: "team", profileKey: "abc123", sessionId: "team-session" };
    assert.equal(
      storage.profileStorageKey("cc.chat-draft:v1:x"),
      "cc.profile:v1:abc123:cc.chat-draft:v1:x",
    );
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});

test("logout purges only the departing Team profile browser state", () => {
  const previousWindow = global.window;
  const makeStorage = (entries) => {
    const values = new Map(entries);
    return {
      get length() { return values.size; },
      key: (index) => [...values.keys()][index] ?? null,
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, value),
      removeItem: (key) => values.delete(key),
      values,
    };
  };
  try {
    const localStorage = makeStorage([
      ["cc.profile:v1:profile-a:cc.chat-draft:v1:x", "draft"],
      ["cc.profile:v1:profile-b:cc.chat-draft:v1:y", "other"],
      ["solo-setting", "keep"],
    ]);
    const sessionStorage = makeStorage([["cc.profile:v1:profile-a:scoping-wizard:v1:x", "wizard"]]);
    global.window = {
      __COMMAND_CENTRE_PROFILE__: { version: 1, mode: "team", profileKey: "profile-a", sessionId: "session-a" },
      localStorage,
      sessionStorage,
    };
    const storage = loadTsModule(path.join(__dirname, "profile-storage.ts"), { stubs: { "./local-profile": {} } });
    storage.purgeBrowserProfileStorage();
    assert.equal(localStorage.values.has("cc.profile:v1:profile-a:cc.chat-draft:v1:x"), false);
    assert.equal(sessionStorage.values.size, 0);
    assert.equal(localStorage.values.get("cc.profile:v1:profile-b:cc.chat-draft:v1:y"), "other");
    assert.equal(localStorage.values.get("solo-setting"), "keep");
  } finally {
    if (previousWindow === undefined) delete global.window;
    else global.window = previousWindow;
  }
});
