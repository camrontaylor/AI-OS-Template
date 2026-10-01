#!/usr/bin/env node
"use strict";

const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const BACKUP_REMOTE_NAME = "team-os-backup";
const DEFAULT_BRANCH = "main";
const DEFAULT_USER_NAME = "Team OS Backup";
const DEFAULT_USER_EMAIL = "team-os-backup@example.invalid";
const BACKUP_GITIGNORE_BLOCK = `# Team OS GitHub backup excludes
.env
.env.*
!.env.example
.mcp.json
.AI-OS/
.command-centre/
.memsearch/
.next/
.tmp/
.backup/
backups/
build/
coverage/
dist/
node_modules/
context/transcripts/
**/context/transcripts/
`;

function env(name, source = process.env) {
  return (source[name] || "").trim();
}

function envFirst(names, source = process.env) {
  for (const name of names) {
    const value = env(name, source);
    if (value) return value;
  }
  return "";
}

function redact(value, secrets = []) {
  let out = String(value || "");
  for (const secret of secrets) {
    if (!secret) continue;
    out = out.split(secret).join("<redacted>");
  }
  return out.replace(/(https?:\/\/)[^/@\s]+@/g, "$1<redacted>@");
}

function remoteWithoutCredentials(remote) {
  if (!/^https?:\/\//i.test(remote)) return remote;
  try {
    const url = new URL(remote);
    url.username = "";
    url.password = "";
    return url.toString();
  } catch {
    return remote.replace(/^(https?:\/\/)[^/@]+@/i, "$1");
  }
}

function run(args, cwd, options = {}) {
  const secrets = options.secrets || [];
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf-8",
    stdio: options.capture ? "pipe" : "inherit",
  });
  if (result.status !== 0) {
    const details = options.capture
      ? redact(`${result.stdout || ""}${result.stderr || ""}`.trim(), secrets)
      : "";
    throw new Error(
      `git ${redact(args.join(" "), secrets)} failed${details ? `: ${details}` : ""}`,
    );
  }
  return (result.stdout || "").trim();
}

function workspaceRoot(source = process.env, cwd = process.cwd()) {
  const configured = env("AI_OS_DIR", source);
  return configured ? path.resolve(configured) : path.resolve(cwd, "..");
}

function resolveConfig(source = process.env, cwd = process.cwd()) {
  const remote = envFirst(
    [
      "TEAM_OS_GITHUB_BACKUP_REMOTE",
      "TEAM_OS_WORKSPACE_BACKUP_REMOTE",
      "TEAM_OS_GIT_BACKUP_REMOTE",
    ],
    source,
  );
  return {
    root: workspaceRoot(source, cwd),
    remote,
    remoteForConfig: remoteWithoutCredentials(remote),
    token: envFirst(
      [
        "TEAM_OS_GITHUB_BACKUP_TOKEN",
        "TEAM_OS_WORKSPACE_BACKUP_TOKEN",
        "TEAM_OS_GIT_BACKUP_TOKEN",
        "GITHUB_TOKEN",
        "GH_TOKEN",
      ],
      source,
    ),
    branch:
      envFirst(["TEAM_OS_GITHUB_BACKUP_BRANCH", "TEAM_OS_WORKSPACE_BACKUP_BRANCH"], source) ||
      DEFAULT_BRANCH,
    userName:
      envFirst(["TEAM_OS_GITHUB_BACKUP_USER_NAME", "TEAM_OS_WORKSPACE_BACKUP_USER_NAME"], source) ||
      DEFAULT_USER_NAME,
    userEmail:
      envFirst(["TEAM_OS_GITHUB_BACKUP_USER_EMAIL", "TEAM_OS_WORKSPACE_BACKUP_USER_EMAIL"], source) ||
      DEFAULT_USER_EMAIL,
  };
}

function ensureGitRepository(root, branch) {
  if (!fs.existsSync(path.join(root, ".git"))) {
    run(["init"], root);
    run(["symbolic-ref", "HEAD", `refs/heads/${branch}`], root);
  }
}

function ensureBackupExcludes(root) {
  const gitignorePath = path.join(root, ".gitignore");
  if (!fs.existsSync(gitignorePath)) {
    fs.writeFileSync(gitignorePath, `${BACKUP_GITIGNORE_BLOCK}\n`, "utf-8");
  }

  const infoDir = path.join(root, ".git", "info");
  fs.mkdirSync(infoDir, { recursive: true });
  const excludePath = path.join(infoDir, "exclude");
  const current = fs.existsSync(excludePath)
    ? fs.readFileSync(excludePath, "utf-8")
    : "";
  if (!current.includes("# Team OS GitHub backup excludes")) {
    const prefix = current.trimEnd() ? `${current.trimEnd()}\n\n` : "";
    fs.writeFileSync(excludePath, `${prefix}${BACKUP_GITIGNORE_BLOCK}\n`, "utf-8");
  }
}

function setBackupRemote(root, remote) {
  const remotes = run(["remote"], root, { capture: true }).split(/\r?\n/).filter(Boolean);
  if (remotes.includes(BACKUP_REMOTE_NAME)) {
    run(["remote", "set-url", BACKUP_REMOTE_NAME, remote], root);
  } else {
    run(["remote", "add", BACKUP_REMOTE_NAME, remote], root);
  }
}

function commitIfNeeded(root) {
  run(["add", "-A"], root);
  const status = run(["status", "--porcelain"], root, { capture: true });
  if (!status) {
    console.log("No workspace changes to back up.");
    return false;
  }
  run(["commit", "-m", `Team OS workspace backup ${new Date().toISOString()}`], root);
  return true;
}

function pushBackup(root, branch, token) {
  if (!token) {
    run(["push", BACKUP_REMOTE_NAME, `HEAD:${branch}`], root);
    return;
  }

  const basic = Buffer.from(`x-access-token:${token}`, "utf-8").toString("base64");
  const result = spawnSync(
    "git",
    [
      "-c",
      `http.extraHeader=AUTHORIZATION: basic ${basic}`,
      "push",
      BACKUP_REMOTE_NAME,
      `HEAD:${branch}`,
    ],
    {
      cwd: root,
      encoding: "utf-8",
      stdio: "pipe",
    },
  );
  if (result.status !== 0) {
    const details = redact(`${result.stdout || ""}${result.stderr || ""}`.trim(), [token, basic]);
    throw new Error(`git push ${BACKUP_REMOTE_NAME} HEAD:${branch} failed${details ? `: ${details}` : ""}`);
  }
}

function main(source = process.env, cwd = process.cwd()) {
  const config = resolveConfig(source, cwd);

  if (!config.remote) {
    console.error("Set TEAM_OS_GITHUB_BACKUP_REMOTE to a private GitHub remote before running this command.");
    process.exit(1);
  }
  if (!fs.existsSync(config.root) || !fs.statSync(config.root).isDirectory()) {
    console.error(`Workspace directory not found: ${config.root}`);
    process.exit(1);
  }

  ensureGitRepository(config.root, config.branch);
  ensureBackupExcludes(config.root);

  run(["config", "user.name", config.userName], config.root);
  run(["config", "user.email", config.userEmail], config.root);
  setBackupRemote(config.root, config.remoteForConfig);

  commitIfNeeded(config.root);
  pushBackup(config.root, config.branch, config.token);
  console.log(`Workspace backup pushed to ${config.branch}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}

module.exports = {
  BACKUP_REMOTE_NAME,
  BACKUP_GITIGNORE_BLOCK,
  commitIfNeeded,
  ensureBackupExcludes,
  ensureGitRepository,
  main,
  pushBackup,
  redact,
  remoteWithoutCredentials,
  resolveConfig,
  setBackupRemote,
};
