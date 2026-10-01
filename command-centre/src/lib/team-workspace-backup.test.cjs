const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const test = require("node:test");
const { pathToFileURL } = require("node:url");

const backup = require("../../scripts/team-workspace-backup.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-workspace-backup-"));
}

function rmDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

function git(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf-8", stdio: "pipe" });
  assert.equal(result.status, 0, `${result.stderr || result.stdout}`);
  return (result.stdout || "").trim();
}

const gitAvailable = spawnSync("git", ["--version"], { stdio: "ignore" }).status === 0;

test("GitHub backup env vars take precedence over legacy aliases", () => {
  const cfg = backup.resolveConfig({
    AI_OS_DIR: "/workspace",
    TEAM_OS_GITHUB_BACKUP_REMOTE: "https://github.com/example/new.git",
    TEAM_OS_WORKSPACE_BACKUP_REMOTE: "https://github.com/example/old.git",
    TEAM_OS_GITHUB_BACKUP_TOKEN: "new-token",
    TEAM_OS_WORKSPACE_BACKUP_TOKEN: "old-token",
    TEAM_OS_GITHUB_BACKUP_BRANCH: "github-branch",
    TEAM_OS_WORKSPACE_BACKUP_BRANCH: "legacy-branch",
    TEAM_OS_GITHUB_BACKUP_USER_NAME: "GitHub Backup",
    TEAM_OS_WORKSPACE_BACKUP_USER_NAME: "Legacy Backup",
    TEAM_OS_GITHUB_BACKUP_USER_EMAIL: "github@example.invalid",
    TEAM_OS_WORKSPACE_BACKUP_USER_EMAIL: "legacy@example.invalid",
  });

  assert.equal(cfg.root, path.resolve("/workspace"));
  assert.equal(cfg.remote, "https://github.com/example/new.git");
  assert.equal(cfg.token, "new-token");
  assert.equal(cfg.branch, "github-branch");
  assert.equal(cfg.userName, "GitHub Backup");
  assert.equal(cfg.userEmail, "github@example.invalid");
});

test("workspace backup env aliases remain supported", () => {
  const cfg = backup.resolveConfig({
    AI_OS_DIR: "/workspace",
    TEAM_OS_WORKSPACE_BACKUP_REMOTE: "https://github.com/example/legacy.git",
    TEAM_OS_WORKSPACE_BACKUP_TOKEN: "legacy-token",
    TEAM_OS_WORKSPACE_BACKUP_BRANCH: "legacy-branch",
  });

  assert.equal(cfg.remote, "https://github.com/example/legacy.git");
  assert.equal(cfg.token, "legacy-token");
  assert.equal(cfg.branch, "legacy-branch");
});

test("workspace backup excludes private files and does not store token in Git config", { skip: gitAvailable ? false : "git not found" }, () => {
  const root = tempDir();
  const bare = tempDir();
  try {
    git(["init", "--bare", bare], root);
    fs.writeFileSync(path.join(root, "README.md"), "# Workspace\n", "utf-8");
    fs.writeFileSync(path.join(root, ".env"), "SECRET=1\n", "utf-8");
    fs.writeFileSync(path.join(root, ".mcp.json"), "{}\n", "utf-8");
    fs.mkdirSync(path.join(root, ".command-centre"), { recursive: true });
    fs.writeFileSync(path.join(root, ".command-centre", "data.db"), "db", "utf-8");
    fs.mkdirSync(path.join(root, "backups"), { recursive: true });
    fs.writeFileSync(path.join(root, "backups", "dump.tar.gz"), "backup", "utf-8");
    fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
    fs.writeFileSync(path.join(root, "node_modules", "pkg", "index.js"), "module", "utf-8");
    fs.mkdirSync(path.join(root, "context", "memory"), { recursive: true });
    fs.writeFileSync(path.join(root, "context", "memory", "2026-07-03.aos.md"), "tracked memory", "utf-8");
    fs.mkdirSync(path.join(root, "context", "transcripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "context", "transcripts", "raw.jsonl"), "raw", "utf-8");

    const remote = pathToFileURL(bare).href;
    backup.main({
      AI_OS_DIR: root,
      TEAM_OS_GITHUB_BACKUP_REMOTE: remote,
      TEAM_OS_GITHUB_BACKUP_TOKEN: "ghs_SECRET_TOKEN",
      TEAM_OS_GITHUB_BACKUP_BRANCH: "main",
    }, root);

    assert.equal(git(["config", "--get", "remote.team-os-backup.url"], root), remote);
    assert.doesNotMatch(fs.readFileSync(path.join(root, ".git", "config"), "utf-8"), /ghs_SECRET_TOKEN/);

    const files = git(["--git-dir", bare, "ls-tree", "-r", "--name-only", "main"], root)
      .split(/\r?\n/)
      .filter(Boolean);
    assert.ok(files.includes(".gitignore"));
    assert.ok(files.includes("README.md"));
    assert.ok(files.includes("context/memory/2026-07-03.aos.md"));
    assert.ok(!files.includes(".env"));
    assert.ok(!files.includes(".mcp.json"));
    assert.ok(!files.some((file) => file.startsWith(".command-centre/")));
    assert.ok(!files.some((file) => file.startsWith("backups/")));
    assert.ok(!files.some((file) => file.startsWith("node_modules/")));
    assert.ok(!files.some((file) => file.startsWith("context/transcripts/")));
  } finally {
    rmDir(root);
    rmDir(bare);
  }
});
