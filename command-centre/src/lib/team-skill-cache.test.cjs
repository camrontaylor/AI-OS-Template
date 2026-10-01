const assert = require("node:assert/strict");
const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function hash(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function fixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-team-skills-"));
  const profile = {
    version: 1,
    mode: "team",
    profileKey: "a".repeat(64),
    dataDir: path.join(root, "profile"),
    stateDir: path.join(root, "profile", "state"),
    tempDir: path.join(root, "profile", "tmp"),
    dbPath: path.join(root, "profile", "data.db"),
  };
  const remote = new Map();
  let granted = ["mkt-copywriting"];
  const module = loadTsModule(path.resolve(__dirname, "team-skill-cache.ts"), {
    stubs: {
      "./config": { getConfig: () => ({ aiOsDir: root }) },
      "./local-profile": {
        getTeamContextFilePath: () => path.join(root, "team-context.json"),
        resolveLocalProfileDescriptor: () => profile,
      },
      "./team-api-context": {
        fetchTeamSkills: async () => granted.map((slug) => ({ slug, userPermission: "skill.use" })),
        fetchTeamSkillManifest: async (skill) => ({
          skill,
          unsupportedFiles: 0,
          files: [...remote.entries()].filter(([file]) => file.startsWith(`.claude/skills/${skill}/`)).map(([file, content]) => ({
            path: file,
            sha256: hash(content),
            size: Buffer.byteLength(content),
            encoding: "utf-8",
          })),
        }),
        fetchTeamSkillFile: async (file) => ({ path: file, content: remote.get(file), encoding: "utf-8" }),
      },
    },
  });
  return { root, profile, remote, module, setGranted: (skills) => { granted = skills; } };
}

test("Team caches are isolated by protected team identifiers", () => {
  const { module, profile } = fixture();
  const first = module.resolveTeamSkillCachePaths("team-one", profile);
  const second = module.resolveTeamSkillCachePaths("team-two", profile);
  assert.notEqual(first.root, second.root);
  assert.match(first.teamKey, /^[a-f0-9]{64}$/);
  assert.equal(first.root.includes("team-one"), false);
  assert.ok(first.root.startsWith(profile.dataDir));
});

test("local runtime fingerprint changes when a skill override changes", () => {
  const { root, module } = fixture();
  const skill = path.join(root, ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(skill, { recursive: true });
  fs.writeFileSync(path.join(skill, "SKILL.md"), "# Base\n");
  const before = module.resolveLocalSkillRuntime(null);
  fs.writeFileSync(path.join(skill, "SKILL.local.md"), "## Rules\n- changed\n");
  const after = module.resolveLocalSkillRuntime(null);
  assert.notEqual(before.fingerprint, after.fingerprint);
});

test("Team plugin applies installation and client SKILL.local overrides without sharing client variants", () => {
  const { root, module } = fixture();
  const paths = module.resolveTeamSkillCachePaths("team-one");
  const source = path.join(paths.sourceRoot, ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), "# Team base\n");
  const local = path.join(root, ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "SKILL.local.md"), "## Rules\n- root rule\n");
  const client = path.join(root, "clients", "client-a", ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(client, { recursive: true });
  fs.writeFileSync(path.join(client, "SKILL.local.md"), "## Rules\n- client rule\n");

  const rootRuntime = module.resolveTeamSkillRuntime("team-one", null);
  const clientRuntime = module.resolveTeamSkillRuntime("team-one", "client-a");
  assert.notEqual(rootRuntime.pluginDir, clientRuntime.pluginDir);
  assert.match(fs.readFileSync(path.join(rootRuntime.pluginDir, "skills", "mkt-copywriting", "SKILL.md"), "utf8"), /root rule/);
  const clientSkill = fs.readFileSync(path.join(clientRuntime.pluginDir, "skills", "mkt-copywriting", "SKILL.md"), "utf8");
  assert.match(clientSkill, /client rule/);
  assert.doesNotMatch(clientSkill, /root rule/);
});

test("server-only changes update automatically, conflicts are preserved, and revocation removes only the Team copy", async () => {
  const { root, remote, module, setGranted } = fixture();
  const remotePath = ".claude/skills/mkt-copywriting/SKILL.md";
  remote.set(remotePath, "# Team v1\n");
  const localRoot = path.join(root, ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(localRoot, { recursive: true });
  fs.writeFileSync(path.join(localRoot, "SKILL.md"), "# Installation local\n");

  await module.refreshAuthorizedTeamSkillCache("team-one");
  const paths = module.resolveTeamSkillCachePaths("team-one");
  const cached = path.join(paths.sourceRoot, ...remotePath.split("/"));
  assert.equal(fs.readFileSync(cached, "utf8"), "# Team v1\n");

  remote.set(remotePath, "# Team v2\n");
  await module.refreshAuthorizedTeamSkillCache("team-one");
  assert.equal(fs.readFileSync(cached, "utf8"), "# Team v2\n");

  fs.writeFileSync(cached, "# local cache edit\n");
  remote.set(remotePath, "# Team v3\n");
  const conflict = await module.refreshAuthorizedTeamSkillCache("team-one");
  assert.equal(conflict.conflicts.length, 1);
  assert.equal(fs.readFileSync(cached, "utf8"), "# local cache edit\n");

  setGranted([]);
  await module.refreshAuthorizedTeamSkillCache("team-one");
  assert.equal(fs.existsSync(cached), false);
  assert.equal(fs.readFileSync(path.join(localRoot, "SKILL.md"), "utf8"), "# Installation local\n");
});

test("command aliases select Team by default on collision and honor explicit origins", () => {
  const { module } = fixture();
  const runtime = {
    pluginDir: "plugin",
    promptFile: null,
    fingerprint: "x",
    teamSkills: ["mkt-copywriting"],
    localSkills: ["mkt-copywriting"],
    clientSkills: [],
  };
  assert.equal(module.routeSkillCommandAliases("Use /mkt-copywriting", runtime), "Use /team:mkt-copywriting");
  assert.equal(module.routeSkillCommandAliases("Use /local:mkt-copywriting", runtime), "Use /mkt-copywriting");
  assert.equal(module.routeSkillCommandAliases("Use /team:mkt-copywriting", runtime), "Use /team:mkt-copywriting");
});

test("plugin-incompatible Team skills are signaled and do not replace the local version", () => {
  const { root, module } = fixture();
  const paths = module.resolveTeamSkillCachePaths("team-one");
  const source = path.join(paths.sourceRoot, ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(source, { recursive: true });
  fs.writeFileSync(path.join(source, "SKILL.md"), "Run .claude/skills/mkt-copywriting/scripts/run.js\n");
  const local = path.join(root, ".claude", "skills", "mkt-copywriting");
  fs.mkdirSync(local, { recursive: true });
  fs.writeFileSync(path.join(local, "SKILL.md"), "# Local\n");
  const runtime = module.resolveTeamSkillRuntime("team-one", null);
  assert.deepEqual(runtime.incompatibleTeamSkills, ["mkt-copywriting"]);
  assert.deepEqual(runtime.teamSkills, []);
  assert.equal(module.routeSkillCommandAliases("Use /mkt-copywriting", runtime), "Use /mkt-copywriting");
});
