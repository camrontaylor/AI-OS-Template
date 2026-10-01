#!/usr/bin/env node
/**
 * User-facing Team OS CLI.
 *
 * This command talks to the hosted Team API over HTTP and stores its token in
 * the user's home config folder, not in the repo. Bootstrap/admin commands
 * (`team:create`, `team:invite`, etc.) can still use the database directly.
 */

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

const {
  clearConfig,
  configPath,
  isExpired,
  markTeamConnected,
  markTeamSignedOut,
  markTeamUnavailable,
  normalizeApiUrl,
  readConfig,
  readConfigOptional,
  readStatusCache,
  writeConfig,
} = require("./lib/team-config.cjs");
const { fileQuery, loginRequest, queryString, teamRequest } = require("./lib/team-api.cjs");
const { loadMemoryModules } = require("./load-memory-modules.cjs");
const { prepareMemoryApiIngestBody } = require("./lib/memory-api-payload.cjs");
const {
  drainMemoryOutbox,
  memoryOutboxStatus,
  queueMemoryOutboxItem,
  shouldRetryError,
} = require("./lib/memory-sync-outbox.cjs");
const {
  confirm,
  createPromptInterrupt,
  intro,
  isInteractive,
  isPromptAvailable,
  isPromptBack,
  isPromptCancel,
  isPromptExit,
  multiSelect,
  note,
  outro,
  promptFor,
  select,
  setPromptInterrupt,
  withSpinner,
} = require("./lib/team-prompts.cjs");
const { printConflicts } = require("./lib/team-conflicts.cjs");
const { formatDashboardLines, formatWhoamiLines } = require("./lib/team-status.cjs");
const {
  BACK,
  EXIT,
  banner,
  buildMainMenuOptions,
  buildSectionOptions,
  clay,
  danger,
  muted,
  statusPanel,
  summarizeBatch,
} = require("./lib/team-terminal-ui.cjs");

const COMMAND_CENTRE_ROOT = path.resolve(__dirname, "..");
const DEFAULT_WORKSPACE_ROOT = path.resolve(COMMAND_CENTRE_ROOT, "..");

const USAGE = `team - Team OS terminal context

Usage:
  node scripts/team.cjs
  node scripts/team.cjs login [--api-url <url>] [--email <email>] [--password <password>] [--team <slug|id>]
  node scripts/team.cjs login-dev --api-url <url> --token <dev-token>
  node scripts/team.cjs status
  node scripts/team.cjs dashboard
  node scripts/team.cjs whoami
  node scripts/team.cjs clients
  node scripts/team.cjs members
  node scripts/team.cjs member invite --email <email> [--role <member|admin>]
  node scripts/team.cjs member invite-link --user <email|user-id>
  node scripts/team.cjs member reset-link --user <email|user-id>
  node scripts/team.cjs member role --user <email|user-id> --role <owner|admin|member>
  node scripts/team.cjs member remove --user <email|user-id> [--yes]
  node scripts/team.cjs client create --name <name> [--slug <slug>]
  node scripts/team.cjs client grant --client <slug|id> --user <email|user-id> [--access <read|write>]
  node scripts/team.cjs client revoke --client <slug|id> --user <email|user-id>
  node scripts/team.cjs secret list [--client <slug>]
  node scripts/team.cjs secret create --name <name> --env-key <KEY> --value <value> [--scope <team|client>] [--client <slug>]
  node scripts/team.cjs secret update --name <name> --env-key <KEY> --value <value> [--scope <team|client>] [--client <slug>]
  node scripts/team.cjs secret grant --secret <id> --user <email|user-id>
  node scripts/team.cjs secret revoke --secret <id> --user <email|user-id>
  node scripts/team.cjs secret archive --secret <id> [--yes]
  node scripts/team.cjs secret sync [--client <slug>] [--overwrite]
  node scripts/team.cjs skill list [--query <text>]
  node scripts/team.cjs skill grant --skill <slug> --user <email|user-id> [--permission <skill.use|skill.read|skill.edit|skill.admin>]
  node scripts/team.cjs skill revoke --skill <slug> --user <email|user-id> [--permission <skill.use|skill.read|skill.edit|skill.admin>]
  node scripts/team.cjs skill sync <pull|push|adopt|prune> --skill <slug> [--overwrite|--yes]
  node scripts/team.cjs brand-context status
  node scripts/team.cjs brand-context pull [--overwrite]
  node scripts/team.cjs brand-context push [--path <brand_context/file.md>] [--overwrite]
  node scripts/team.cjs mcp status
  node scripts/team.cjs mcp backup [--overwrite]
  node scripts/team.cjs mcp restore [--overwrite]
  node scripts/team.cjs memory status
  node scripts/team.cjs memory import --file <file> --visibility <team|client> [--client <slug>] [--source-path <path>] [--title <title>]
  node scripts/team.cjs memory imports [--status <queued|indexing|indexed|failed|skipped>] [--limit <n>]
  node scripts/team.cjs memory retry --id <import-id> [--no-force]
  node scripts/team.cjs memory sync [--failed] [--limit <n>]
  node scripts/team.cjs sync manifest [--client <slug>]
  node scripts/team.cjs sync pull --client <slug> --dest <folder>
  node scripts/team.cjs sync push --client <slug> --src <folder>
  node scripts/team.cjs logout

No arguments in an interactive terminal opens the guided Team OS menu.
Normal login stores a user-scoped Team API token outside this repo at:
  ${configPath()}`;

const MAX_SYNC_FILE_BYTES = 1024 * 1024;
const LARGE_SYNC_FILE_BYTES = 25 * 1024 * 1024;
const TEXT_FILE_EXTENSIONS = [
  ".cjs",
  ".conf",
  ".csv",
  ".env.example",
  ".gitignore",
  ".js",
  ".json",
  ".jsonl",
  ".local.md",
  ".md",
  ".mjs",
  ".toml",
  ".ts",
  ".txt",
  ".yaml",
  ".yml",
];
const TEXT_FILE_NAMES = new Set(["AGENTS.md", "CLAUDE.md", "README.md", "SKILL.md", "SKILL.local.md"]);
const EXCLUDED_DIR_NAMES = new Set([
  ".command-centre",
  ".git",
  ".memsearch",
  ".next",
  "backups",
  "coverage",
  "dist",
  "node_modules",
]);
const EXCLUDED_FILE_NAMES = new Set([".env", ".env.local", ".mcp.json"]);
const SYNC_STATE_PATH = path.join(".AI-OS", "team-sync-state.json");
const SKILL_SYNC_METADATA = path.join(".command-centre", "team-skill-sync.json");

const SKILL_EXCLUDED_DIR_NAMES = new Set([
  ".cache",
  ".git",
  ".mypy_cache",
  ".next",
  ".pytest_cache",
  ".ruff_cache",
  ".venv",
  "__pycache__",
  "build",
  "coverage",
  "dist",
  "env",
  "node_modules",
  "venv",
]);
const SKILL_EXCLUDED_FILE_NAMES = new Set([".DS_Store", "Thumbs.db"]);
const SKILL_EXCLUDED_FILE_EXTENSIONS = new Set([".log", ".pyc", ".pyo", ".tmp"]);

function workspaceRoot() {
  return process.env.AI_OS_ROOT
    ? path.resolve(process.env.AI_OS_ROOT)
    : DEFAULT_WORKSPACE_ROOT;
}

function parseArgs(argv) {
  const flags = { positionals: [] };
  const keyFor = (arg) => {
    const normalized = arg.replace(/^--/, "");
    return normalized.replace(/-([a-z])/g, (_, char) => char.toUpperCase());
  };
  const booleanFlags = new Set(["failed", "force", "help", "json", "noForce", "noOverwrite", "overwrite", "quiet", "yes"]);
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      flags.help = true;
      continue;
    }
    if (arg.startsWith("--")) {
      const key = keyFor(arg);
      if (booleanFlags.has(key)) {
        flags[key] = true;
        continue;
      }
      const value = argv[i + 1];
      if (value == null || value.startsWith("--")) {
        throw new Error(`Missing value for ${arg}`);
      }
      flags[key] = value;
      i += 1;
      continue;
    }
    flags.positionals.push(arg);
  }
  flags.command = flags.positionals[0];
  flags.subcommand = flags.positionals[1];
  flags.action = flags.positionals[2];
  flags.extra = flags.positionals.slice(3);
  if (flags.command === "help") flags.help = true;
  return flags;
}

function shouldOpenMenu(flags, input = process.stdin) {
  return !flags.command && !flags.help && input.isTTY === true;
}

function requireFlag(flags, key, message) {
  const value = flags[key];
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(message);
  }
  return value.trim();
}

function cliError(message, options = {}) {
  const error = new Error(message);
  if (options.showUsage === false) error.showUsage = false;
  return error;
}

async function promptFlag(flags, key, label, options = {}) {
  if (typeof flags[key] === "string" && flags[key].trim() !== "") return flags[key].trim();
  const value = await promptFor(label, options);
  if (!value && options.required !== false) throw new Error(`${label.replace(/:\s*$/, "")} is required`);
  return value;
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function idFromRecord(value) {
  return value && typeof value === "object" && typeof value.id === "string"
    ? value.id.trim()
    : "";
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function asRecord(value) {
  return value && typeof value === "object" ? value : {};
}

function maybeMarkRequestFailure(config, error) {
  if (!config) return;
  if (!error?.status || error.status === 401 || error.status >= 500) {
    markTeamUnavailable(config, error);
  }
}

async function request(pathName, options = {}) {
  const config = readConfig();
  try {
    return await teamRequest(config, pathName, options);
  } catch (error) {
    maybeMarkRequestFailure(config, error);
    throw error;
  }
}

let memoryModulesCache = null;

function memoryModules() {
  if (!memoryModulesCache) memoryModulesCache = loadMemoryModules({ withCapture: false });
  return memoryModulesCache;
}

async function openLocalMemoryOutboxStore() {
  const { store } = memoryModules();
  const dataDir = path.join(workspaceRoot(), ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true });
  return store.openMemoryStore({ dataDir, embedDim: 1024 });
}

function savedTeamOutboxContext() {
  const config = readConfig();
  const teamId = process.env.AI_OS_WORK_MODE === "solo"
    ? null
    : process.env.AI_OS_TEAM_ID || config.selectedTeamId || idFromRecord(config.team);
  const userId = idFromRecord(config.user);
  if (!teamId || !userId) {
    throw new Error("Offline memory sync needs a recent Team OS login with saved team and user ids. Run `npm run team -- login` again.");
  }
  return { config, teamId, userId, membership: config.membership || null };
}

function printList(rows, emptyMessage) {
  if (rows.length === 0) {
    console.log(emptyMessage);
    return;
  }
  for (const row of rows) console.log(row);
}

function clientQuery(flags) {
  return flags.client ? `?client=${encodeURIComponent(flags.client)}` : "";
}

function safeJoin(root, relativePath) {
  const parts = String(relativePath).replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..") || parts.length === 0) {
    throw new Error(`Unsafe path from server: ${relativePath}`);
  }
  const full = path.resolve(root, ...parts);
  const rootResolved = path.resolve(root);
  const rootWithSep = rootResolved.endsWith(path.sep) ? rootResolved : `${rootResolved}${path.sep}`;
  if (full !== rootResolved && !full.startsWith(rootWithSep)) {
    throw new Error(`Unsafe path from server: ${relativePath}`);
  }
  return full;
}

function isSyncableTextFile(relativePath) {
  const parts = String(relativePath).replace(/\\/g, "/").split("/").filter(Boolean);
  if (parts.some((part) => EXCLUDED_DIR_NAMES.has(part))) return false;
  if (parts[0] === "clients" && parts[2] === "context" && parts[3] === "transcripts") {
    return false;
  }
  const name = parts[parts.length - 1] || "";
  if (EXCLUDED_FILE_NAMES.has(name) || name.startsWith(".env.")) return false;
  if (TEXT_FILE_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  return TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

function isLikelyTextBuffer(relativePath, content) {
  const name = path.posix.basename(relativePath);
  if (TEXT_FILE_NAMES.has(name) || name === ".mcp.json" || TEXT_FILE_EXTENSIONS.some((ext) => name.toLowerCase().endsWith(ext))) {
    return true;
  }
  if (content.includes(0)) return false;
  const sample = content.subarray(0, Math.min(content.length, 4096));
  let control = 0;
  for (const byte of sample) {
    if (byte < 32 && byte !== 9 && byte !== 10 && byte !== 13) control += 1;
  }
  return sample.length === 0 || control / sample.length < 0.02;
}

function payloadForBuffer(relativePath, content) {
  return isLikelyTextBuffer(relativePath, content)
    ? { content: content.toString("utf-8") }
    : { contentBase64: content.toString("base64") };
}

function bufferFromRemote(remote) {
  if (remote.encoding === "base64" || remote.contentBase64) {
    return Buffer.from(remote.contentBase64 ?? "", "base64");
  }
  return Buffer.from(remote.content ?? "", "utf-8");
}

function localSyncBase(src, clientSlug) {
  const abs = path.resolve(src);
  const nested = path.join(abs, "clients", clientSlug);
  if (fs.existsSync(nested) && fs.statSync(nested).isDirectory()) {
    return { base: nested, serverPrefix: `clients/${clientSlug}`, stateRoot: abs };
  }
  if (path.basename(abs) === clientSlug && fs.existsSync(abs) && fs.statSync(abs).isDirectory()) {
    const parent = path.dirname(abs);
    const stateRoot = path.basename(parent) === "clients" ? path.dirname(parent) : parent;
    return { base: abs, serverPrefix: `clients/${clientSlug}`, stateRoot };
  }
  throw cliError(
    [
      `--src is not a valid Team OS client sync folder for "${clientSlug}".`,
      "",
      "Pass one of:",
      `  1. A workspace folder that contains clients/${clientSlug}`,
      `     Example: npm run team -- sync push --client ${clientSlug} --src ./team-os-local`,
      "  2. The client folder itself",
      `     Example: npm run team -- sync push --client ${clientSlug} --src ./team-os-local/clients/${clientSlug}`,
      "",
      "Tip: run sync pull first to create the expected folder and sync state.",
    ].join("\n"),
    { showUsage: false },
  );
}

function syncStateFile(root) {
  return path.join(path.resolve(root), SYNC_STATE_PATH);
}

function readSyncState(root) {
  const file = syncStateFile(root);
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!parsed || typeof parsed !== "object" || typeof parsed.files !== "object") {
      throw new Error("invalid sync state");
    }
    return parsed;
  } catch {
    return { version: 1, files: {} };
  }
}

function writeSyncState(root, state) {
  const file = syncStateFile(root);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`, "utf-8");
}

function listLocalSyncFiles(base, serverPrefix) {
  const files = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name)) walk(path.join(dir, entry.name));
        continue;
      }
      if (!entry.isFile()) continue;
      const full = path.join(dir, entry.name);
      const localRel = path.relative(base, full).replace(/\\/g, "/");
      const serverPath = `${serverPrefix}/${localRel}`;
      if (!isSyncableTextFile(serverPath)) continue;
      const stat = fs.statSync(full);
      if (stat.size > MAX_SYNC_FILE_BYTES) continue;
      files.push({ full, serverPath });
    }
  }
  walk(base);
  files.sort((a, b) => a.serverPath.localeCompare(b.serverPath));
  return files;
}

async function loginWithDevToken(flags) {
  const apiUrlInput = flags.apiUrl || await promptFor("Team OS server URL: ");
  const tokenInput = flags.token || await promptFor("Team OS access token: ");
  const apiUrl = normalizeApiUrl(apiUrlInput);
  const token = String(tokenInput ?? "").trim();
  if (!token) throw new Error("--token is required");
  const config = { apiUrl, token, tokenType: "dev-token" };
  const whoami = await teamRequest(config, "/v1/team/whoami");
  const savedConfig = {
    ...config,
    user: whoami.user ?? null,
    team: whoami.team ?? null,
    membership: whoami.membership ?? null,
    serverId: whoami.server?.id ?? null,
    selectedTeamId: whoami.team?.id ?? null,
    teams: whoami.team?.id ? [{
      id: whoami.team.id,
      slug: whoami.team.slug ?? null,
      name: whoami.team.name ?? null,
      membership: whoami.membership ?? null,
    }] : [],
  };
  writeConfig(savedConfig);
  markTeamConnected(savedConfig, whoami);
  console.log("Dev-only shared token saved. Use email/password login for normal Team OS users.");
  console.log(`Signed in as ${whoami.user?.email || whoami.user?.id}`);
  console.log(`Team: ${whoami.team?.name || whoami.team?.slug || whoami.team?.id}`);
}

async function login(flags) {
  if (flags.token) return loginWithDevToken(flags);
  const apiUrlInput = flags.apiUrl || await promptFor("Team OS server URL: ");
  const emailInput = flags.email || await promptFor("Email: ");
  const passwordInput = flags.password || await promptFor("Password: ", { password: true, trim: false });
  const apiUrl = normalizeApiUrl(apiUrlInput);
  const email = String(emailInput ?? "").trim();
  const password = String(passwordInput ?? "").trim();
  if (!email) throw new Error("--email is required");
  if (!password) throw new Error("--password is required");
  const body = await loginRequest(apiUrl, {
    email,
    password,
    team: flags.team || null,
    authSource: "cli-device-token",
  });
  const savedConfig = {
    apiUrl,
    token: body.token,
    tokenType: "team-api-session",
    authSource: body.authSource || "cli-device-token",
    expiresAt: body.expiresAt || null,
    user: body.user ?? null,
    team: body.team ?? null,
    membership: body.membership ?? null,
    serverId: body.server?.id ?? null,
    selectedTeamId: body.defaultTeamId || body.team?.id || null,
    teams: [],
  };
  const memberships = await teamRequest(savedConfig, "/v1/auth/teams", { teamId: null });
  savedConfig.serverId = memberships.server?.id ?? savedConfig.serverId;
  savedConfig.teams = Array.isArray(memberships.teams) ? memberships.teams : [];
  if (!savedConfig.selectedTeamId) savedConfig.selectedTeamId = memberships.defaultTeamId || null;
  writeConfig(savedConfig);
  markTeamConnected(savedConfig, body);
  console.log(`Signed in as ${body.user?.email || body.user?.id}`);
  console.log(`Team: ${body.team?.name || body.team?.slug || body.team?.id}`);
}

async function whoami() {
  const config = readConfig();
  const body = await teamRequest(config, "/v1/team/whoami").catch((error) => {
    maybeMarkRequestFailure(config, error);
    throw error;
  });
  markTeamConnected(config, body);
  console.log(formatWhoamiLines(body).join("\n"));
}

async function clients() {
  const body = await request("/v1/team/clients");
  const rows = asArray(body.clients);
  printList(
    rows.map((client) => `${client.slug}\t${client.access}\t${client.name || client.slug}`),
    "No clients are available for this account.",
  );
}

async function dashboard() {
  const config = readConfig();
  const who = await teamRequest(config, "/v1/team/whoami").catch((error) => {
    maybeMarkRequestFailure(config, error);
    throw error;
  });
  markTeamConnected(config, who);
  const [clientResult, memoryResult, adminResult, secretsResult, skillsResult] = await Promise.allSettled([
    teamRequest(config, "/v1/team/clients"),
    teamRequest(config, "/v1/memory/status"),
    teamRequest(config, "/v1/team/admin"),
    teamRequest(config, "/v1/team/secrets"),
    teamRequest(config, "/v1/team/skills"),
  ]);
  const clientsBody = clientResult.status === "fulfilled" ? clientResult.value : {};
  const memoryBody = memoryResult.status === "fulfilled" ? memoryResult.value : null;
  const adminBody = adminResult.status === "fulfilled" ? adminResult.value : null;
  const secretsBody = secretsResult.status === "fulfilled" ? secretsResult.value : null;
  const skillsBody = skillsResult.status === "fulfilled" ? skillsResult.value : null;

  console.log(formatDashboardLines({
    whoami: who,
    clients: clientsBody,
    memory: memoryBody,
    admin: adminBody,
    secrets: secretsBody,
    skills: skillsBody,
  }).join("\n"));
}

function printAdminState(state) {
  const team = asRecord(state.team);
  console.log(`Team: ${team.name || team.slug || team.id || "Team OS"}`);
  console.log(`Members: ${asArray(state.members).length}`);
  console.log(`Clients: ${asArray(state.clients).length}`);
  console.log(`Client grants: ${asArray(state.clientGrants).length}`);
  console.log(`Skill grants: ${asArray(state.skillGrants).length}`);
  console.log(`Server skills: ${asArray(state.serverSkills).length}`);
  if (state.invite?.url) {
    console.log(`Invite link for ${state.invite.email}: ${state.invite.url}`);
    console.log(`Expires: ${state.invite.expiresAt}`);
  }
  if (state.reset?.url) {
    console.log(`Password reset link for ${state.reset.email}: ${state.reset.url}`);
    console.log(`Expires: ${state.reset.expiresAt}`);
  }
}

async function adminState() {
  printAdminState(await request("/v1/team/admin"));
}

function memberLabel(member) {
  return member.email || member.userId || member.id || "(unknown)";
}

function printMembers(state) {
  const rows = asArray(state.members).map((member) => {
    const clientsText = asArray(member.clients).map((client) => `${client.slug}:${client.access}`).join(",");
    return `${memberLabel(member)}\t${member.role || "member"}\t${member.status || "unknown"}\t${clientsText}`;
  });
  printList(rows, "No team members found.");
}

async function membersCommand(flags) {
  if (!flags.subcommand || flags.subcommand === "list") {
    printMembers(await request("/v1/team/admin"));
    return;
  }
  return memberCommand({ ...flags, command: "member", subcommand: flags.subcommand });
}

async function postAdmin(action) {
  const result = await request("/v1/team/admin", { method: "POST", body: action });
  printAdminState(result);
  return result;
}

async function memberCommand(flags) {
  const sub = flags.subcommand || "list";
  if (sub === "list") {
    printMembers(await request("/v1/team/admin"));
    return;
  }
  if (sub === "invite") {
    return postAdmin({
      action: "invite-member",
      email: await promptFlag(flags, "email", "Email: "),
      role: flags.role || "member",
    });
  }
  if (sub === "invite-link") {
    return postAdmin({
      action: "create-invite-link",
      user: await promptFlag(flags, "user", "User email or id: "),
    });
  }
  if (sub === "reset-link") {
    return postAdmin({
      action: "create-password-reset-link",
      user: await promptFlag(flags, "user", "User email or id: "),
    });
  }
  if (sub === "role") {
    return postAdmin({
      action: "set-member-role",
      user: await promptFlag(flags, "user", "User email or id: "),
      role: await promptFlag(flags, "role", "Role: "),
    });
  }
  if (sub === "remove") {
    const user = await promptFlag(flags, "user", "User email or id: ");
    if (!flags.yes && process.stdin.isTTY && !(await confirm(`Remove ${user} from the team?`))) return;
    return postAdmin({ action: "remove-member", user });
  }
  throw new Error("Unknown member command. Use: list, invite, invite-link, reset-link, role, or remove");
}

async function clientCommand(flags) {
  const sub = flags.subcommand || "list";
  if (sub === "list") return clients();
  if (sub === "admin-list") {
    const state = await request("/v1/team/admin");
    printList(
      asArray(state.clients).map((client) => `${client.slug}\t${client.status || "active"}\t${client.name || client.slug}`),
      "No clients found.",
    );
    return;
  }
  if (sub === "create") {
    return postAdmin({
      action: "create-client",
      name: await promptFlag(flags, "name", "Client name: "),
      ...(flags.slug ? { slug: flags.slug } : {}),
    });
  }
  if (sub === "grant") {
    return postAdmin({
      action: "grant-client",
      client: await promptFlag(flags, "client", "Client slug or id: "),
      user: await promptFlag(flags, "user", "User email or id: "),
      access: flags.access || "read",
    });
  }
  if (sub === "revoke") {
    return postAdmin({
      action: "revoke-client",
      client: await promptFlag(flags, "client", "Client slug or id: "),
      user: await promptFlag(flags, "user", "User email or id: "),
    });
  }
  if (sub === "pull") return syncPull({ ...flags, subcommand: "pull", dest: flags.dest || workspaceRoot() });
  if (sub === "push") return syncPush({ ...flags, subcommand: "push", src: flags.src || workspaceRoot() });
  throw new Error("Unknown client command. Use: list, create, grant, revoke, pull, or push");
}

function manualImportScope(flags) {
  const visibility = requireFlag(flags, "visibility", "--visibility is required");
  if (!["team", "client"].includes(visibility)) {
    throw new Error("--visibility must be team or client");
  }
  if (visibility === "client") {
    return {
      teamId: "server-resolved",
      clientId: requireFlag(flags, "client", "--client is required for client visibility"),
      userId: null,
      visibility,
    };
  }
  return {
    teamId: "server-resolved",
    clientId: null,
    userId: null,
    visibility,
  };
}

function defaultManualSourcePath(filePath) {
  return `manual/${path.basename(filePath).replace(/\\/g, "/")}`;
}

async function memoryStatus() {
  const body = await request("/v1/memory/status");
  console.log(`Store ready: ${body.storeReady === false ? "no" : "yes"}`);
  console.log(`Scope: ${body.scope?.mode || "team"}`);
  console.log(`Sources: ${body.sources || 0}`);
  console.log(`Chunks: ${body.chunks || 0}`);
  console.log(`Jobs: ${body.jobs || 0}`);
  console.log(`Manual imports: ${body.manualImports || 0}`);
  if (body.lastIndexedAt) console.log(`Last indexed: ${body.lastIndexedAt}`);
  if (body.lastJob?.status) {
    console.log(`Last job: ${body.lastJob.status} ${body.lastJob.sourcePath || ""}`.trim());
  }
  try {
    const ctx = savedTeamOutboxContext();
    const memStore = await openLocalMemoryOutboxStore();
    try {
      const outbox = await memoryOutboxStatus(memStore, ctx);
      if (outbox.queued || outbox.failed || outbox.syncing) {
        console.log(`Offline sync: ${outbox.queued} waiting, ${outbox.syncing} syncing, ${outbox.failed} failed`);
      } else {
        console.log("Offline sync: ready");
      }
    } finally {
      await memStore.close();
    }
  } catch {
    // Status should still be useful if the local outbox cannot be opened.
  }
}

async function memoryImport(flags) {
  const file = path.resolve(requireFlag(flags, "file", "--file is required"));
  const content = fs.readFileSync(file, "utf-8");
  const sourcePath = flags.sourcePath
    ? String(flags.sourcePath).replace(/\\/g, "/").replace(/^\/+/, "")
    : defaultManualSourcePath(file);
  const scope = manualImportScope(flags);
  const prepared = await prepareMemoryApiIngestBody({ content, sourcePath });
  const requestBody = {
    scope,
    sourcePath,
    sourceType: "other",
    title: flags.title || path.basename(file),
    content,
    ...prepared,
    force: flags.force === true,
  };
  await memorySync({ quiet: true }).catch(() => {});
  let body;
  try {
    body = await request("/v1/memory/imports", {
      method: "POST",
      body: requestBody,
    });
  } catch (error) {
    if (!shouldRetryError(error)) throw error;
    const ctx = savedTeamOutboxContext();
    const memStore = await openLocalMemoryOutboxStore();
    try {
      await queueMemoryOutboxItem({
        memStore,
        savedTeamContext: ctx,
        item: {
          operation: "manual_import",
          scope,
          actorUserId: ctx.userId,
          sourcePath,
          contentSha256: prepared.contentSha256,
          requestBody,
          metadata: {
            file,
            title: requestBody.title,
          },
        },
      });
    } finally {
      await memStore.close();
    }
    console.log(`Import queued locally for later sync: ${sourcePath}`);
    return;
  }
  const importRow = body.import || {};
  console.log(`Import ${importRow.status || "submitted"}: ${sourcePath}`);
  if (importRow.id) console.log(`ID: ${importRow.id}`);
  if (body.sourceId) console.log(`Source: ${body.sourceId}`);
  if (body.chunksInserted != null) console.log(`Chunks inserted: ${body.chunksInserted}`);
}

async function memorySync(flags) {
  const ctx = savedTeamOutboxContext();
  const memStore = await openLocalMemoryOutboxStore();
  try {
    const result = await drainMemoryOutbox({
      memStore,
      savedTeamContext: ctx,
      request: teamRequest,
      limit: Number.isFinite(Number(flags.limit)) ? Math.max(1, Math.floor(Number(flags.limit))) : 25,
      includeFailed: flags.failed === true,
    });
    if (!flags.quiet) {
      console.log(`Offline sync: ${result.synced} synced, ${result.retrying} waiting to retry, ${result.failed} failed`);
    }
    return result;
  } finally {
    await memStore.close();
  }
}

async function memoryImports(flags) {
  const body = await request(`/v1/memory/imports${queryString({ status: flags.status, limit: flags.limit })}`);
  const rows = asArray(body.imports);
  printList(
    rows.map((row) => {
      const error = row.errorMessage ? `\t${row.errorMessage}` : "";
      return `${row.status}\t${row.attempts}\t${row.id}\t${row.sourcePath}${error}`;
    }),
    "No manual imports found.",
  );
}

async function memoryRetry(flags) {
  const body = await request("/v1/memory/imports/retry", {
    method: "POST",
    body: {
      importId: requireFlag(flags, "id", "--id is required"),
      force: flags.noForce ? false : true,
    },
  });
  const importRow = body.import || {};
  console.log(`Retry ${importRow.status || "submitted"}: ${importRow.sourcePath || flags.id}`);
  if (body.chunksInserted != null) console.log(`Chunks inserted: ${body.chunksInserted}`);
}

async function memory(flags) {
  if (flags.subcommand === "status") return memoryStatus();
  if (flags.subcommand === "import") return memoryImport(flags);
  if (flags.subcommand === "imports" || flags.subcommand === "list") return memoryImports(flags);
  if (flags.subcommand === "retry") return memoryRetry(flags);
  if (flags.subcommand === "sync") return memorySync(flags);
  throw new Error("Unknown memory command. Use: memory status, memory import, memory imports, memory retry, or memory sync");
}

function printSecrets(body) {
  const rows = asArray(body.secrets).map((secret) => {
    const scope = secret.scope === "client" ? `client:${secret.clientSlug || secret.clientId || ""}` : "team";
    const grants = asArray(secret.grants).filter((grant) => grant.status === "active").length;
    return `${secret.id}\t${secret.envKey}\t${scope}\t${secret.status || "active"}\t${grants} grants\t${secret.name || secret.envKey}`;
  });
  printList(rows, "No shared secrets available.");
}

async function secretsList(flags) {
  printSecrets(await request(`/v1/team/secrets${clientQuery(flags)}`));
}

async function postSecret(action) {
  const result = await request("/v1/team/secrets", { method: "POST", body: action });
  printSecrets(result);
  return result;
}

const TEAMOS_SECRETS_BEGIN = "# BEGIN TEAMOS MANAGED SECRETS";
const TEAMOS_SECRETS_END = "# END TEAMOS MANAGED SECRETS";

function normalizeNewline(value) {
  return String(value).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
}

function withoutManagedBlock(content) {
  const normalized = normalizeNewline(content);
  const begin = normalized.indexOf(TEAMOS_SECRETS_BEGIN);
  if (begin === -1) return normalized;
  const end = normalized.indexOf(TEAMOS_SECRETS_END, begin);
  if (end === -1) return `${normalized.slice(0, begin).trimEnd()}\n`;
  const after = end + TEAMOS_SECRETS_END.length;
  return `${normalized.slice(0, begin).trimEnd()}\n${normalized.slice(after).replace(/^\n+/, "")}`.trimEnd() + "\n";
}

function envKeysOutsideManagedBlock(content) {
  const keys = new Set();
  for (const line of withoutManagedBlock(content).split("\n")) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (match) keys.add(match[1].toUpperCase());
  }
  return keys;
}

function removeUserOwnedKeys(content, keys) {
  return withoutManagedBlock(content)
    .split("\n")
    .filter((line) => {
      const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=/);
      return !match || !keys.has(match[1].toUpperCase());
    })
    .join("\n")
    .trimEnd() + "\n";
}

function serializeEnvValue(value) {
  return /^[A-Za-z0-9_@%+=:,./-]*$/.test(value) ? value : JSON.stringify(value);
}

function managedBlock(secrets) {
  if (secrets.length === 0) return "";
  const sorted = [...secrets].sort((a, b) => a.envKey.localeCompare(b.envKey));
  return [
    TEAMOS_SECRETS_BEGIN,
    "# Synced from TeamOS. Edit these in Team Settings, not here.",
    ...sorted.map((secret) => `${secret.envKey}=${serializeEnvValue(secret.value)}`),
    TEAMOS_SECRETS_END,
  ].join("\n");
}

function withManagedBlock(content, secrets, overwriteKeys) {
  const base = overwriteKeys.size > 0 ? removeUserOwnedKeys(content, overwriteKeys) : withoutManagedBlock(content);
  const block = managedBlock(secrets);
  if (!block) return base.trimEnd() ? `${base.trimEnd()}\n` : "";
  return base.trimEnd() ? `${base.trimEnd()}\n\n${block}\n` : `${block}\n`;
}

function syncSecretsToManagedEnv(root, payload, options = {}) {
  const targets = [{
    filePath: path.join(root, ".env"),
    label: "Team",
    secrets: asArray(payload.team?.secrets),
  }];
  for (const client of asArray(payload.clients)) {
    targets.push({
      filePath: path.join(root, "clients", client.slug, ".env"),
      label: client.name || client.slug,
      secrets: asArray(client.secrets),
    });
  }

  const conflicts = [];
  const snapshots = new Map();
  for (const target of targets) {
    const content = fs.existsSync(target.filePath) ? fs.readFileSync(target.filePath, "utf-8") : "";
    snapshots.set(target.filePath, content);
    const userKeys = envKeysOutsideManagedBlock(content);
    const conflictKeys = target.secrets.map((secret) => secret.envKey.toUpperCase()).filter((key) => userKeys.has(key));
    if (conflictKeys.length > 0) conflicts.push({ filePath: target.filePath, label: target.label, keys: conflictKeys });
  }
  if (conflicts.length > 0 && !options.overwriteConflicts) {
    return { filesChanged: 0, files: [], conflicts };
  }

  let filesChanged = 0;
  const files = [];
  for (const target of targets) {
    const content = snapshots.get(target.filePath) || "";
    const overwriteKeys = new Set(options.overwriteConflicts ? target.secrets.map((secret) => secret.envKey.toUpperCase()) : []);
    const nextContent = withManagedBlock(content, target.secrets, overwriteKeys);
    const changed = normalizeNewline(content) !== nextContent;
    if (changed) {
      fs.mkdirSync(path.dirname(target.filePath), { recursive: true });
      fs.writeFileSync(target.filePath, nextContent, { mode: 0o600 });
      filesChanged += 1;
    }
    files.push({ filePath: target.filePath, label: target.label, keys: target.secrets.map((secret) => secret.envKey), changed });
  }
  fs.mkdirSync(path.join(root, ".command-centre"), { recursive: true });
  fs.writeFileSync(
    path.join(root, ".command-centre", "team-secrets-sync.json"),
    `${JSON.stringify({
      version: 1,
      files: Object.fromEntries(files.filter((file) => file.keys.length > 0).map((file) => [file.filePath, {
        label: file.label,
        keys: file.keys,
        syncedAt: new Date().toISOString(),
      }])),
    }, null, 2)}\n`,
    { mode: 0o600 },
  );
  return { filesChanged, files, conflicts: [] };
}

async function secretsSync(flags) {
  const payload = await request("/v1/team/secrets/sync", {
    method: "POST",
    body: flags.client ? { client: flags.client } : {},
  });
  let result = syncSecretsToManagedEnv(workspaceRoot(), payload, { overwriteConflicts: flags.overwrite === true });
  if (result.conflicts.length > 0) {
    console.log("Local .env has user-owned values for synced keys.");
    for (const conflict of result.conflicts) {
      console.log(`  ${conflict.label}: ${conflict.keys.join(", ")} (${conflict.filePath})`);
    }
    if (process.stdin.isTTY && await confirm("Overwrite those local values?")) {
      result = syncSecretsToManagedEnv(workspaceRoot(), payload, { overwriteConflicts: true });
    } else {
      throw new Error("Secret sync stopped because local values would be overwritten.");
    }
  }
  console.log(`Synced secrets into ${result.filesChanged} env file${result.filesChanged === 1 ? "" : "s"}.`);
  for (const file of result.files) {
    console.log(`${file.changed ? "changed" : "unchanged"}\t${file.label}\t${file.keys.join(", ")}\t${file.filePath}`);
  }
}

async function secretCommand(flags) {
  const sub = flags.subcommand || "list";
  if (sub === "list") return secretsList(flags);
  if (sub === "create" || sub === "update") {
    return postSecret({
      action: sub === "create" ? "create-secret" : "update-secret",
      name: await promptFlag(flags, "name", "Secret name: "),
      envKey: await promptFlag(flags, "envKey", "Environment key: "),
      value: await promptFlag(flags, "value", "Secret value: ", { trim: false, password: true }),
      scope: flags.scope || "team",
      ...(flags.client ? { client: flags.client } : {}),
    });
  }
  if (sub === "grant") {
    return postSecret({
      action: "grant-secret",
      secret: await promptFlag(flags, "secret", "Secret id: "),
      user: await promptFlag(flags, "user", "User email or id: "),
    });
  }
  if (sub === "revoke") {
    return postSecret({
      action: "revoke-secret",
      secret: await promptFlag(flags, "secret", "Secret id: "),
      user: await promptFlag(flags, "user", "User email or id: "),
    });
  }
  if (sub === "archive") {
    const secret = await promptFlag(flags, "secret", "Secret id: ");
    if (!flags.yes && process.stdin.isTTY && !(await confirm(`Archive secret ${secret}?`))) return;
    return postSecret({ action: "archive-secret", secret });
  }
  if (sub === "sync") return secretsSync(flags);
  throw new Error("Unknown secret command. Use: list, create, update, grant, revoke, archive, or sync");
}

function printSkills(skills) {
  printList(
    skills.map((skill) => {
      const permission = skill.userPermission || (skill.writable ? "writable" : "read");
      return `${skill.slug}\t${permission}\t${skill.files ?? 0} files\t${skill.name || skill.slug}`;
    }),
    "No server skills available.",
  );
}

async function skillList(flags) {
  const body = await request("/v1/team/skills");
  let skills = asArray(body.skills);
  const query = typeof flags.query === "string" ? flags.query.trim().toLowerCase() : "";
  if (query) {
    skills = skills.filter((skill) => {
      return [skill.slug, skill.name, skill.description].some((value) => String(value || "").toLowerCase().includes(query));
    });
  }
  printSkills(skills);
}

function skillSlugFromFlags(flags) {
  return flags.skill || flags.name || flags.extra?.[0] || flags.action;
}

async function skillGrant(flags, revoke = false) {
  return postAdmin({
    action: revoke ? "revoke-skill" : "grant-skill",
    skillName: await promptFlag({ ...flags, skillName: skillSlugFromFlags(flags) }, "skillName", "Skill slug: "),
    user: await promptFlag(flags, "user", "User email or id: "),
    permission: flags.permission || "skill.use",
  });
}

function skillMetadataPath() {
  return path.join(workspaceRoot(), SKILL_SYNC_METADATA);
}

function readSkillMetadata() {
  try {
    const parsed = JSON.parse(fs.readFileSync(skillMetadataPath(), "utf-8"));
    if (parsed?.version === 1 && parsed.skills && typeof parsed.skills === "object") return parsed;
  } catch {
    /* first sync */
  }
  return { version: 1, skills: {} };
}

function writeSkillMetadata(metadata) {
  const file = skillMetadataPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(metadata, null, 2)}\n`, "utf-8");
}

function skillRoot(skill) {
  return path.join(workspaceRoot(), ".claude", "skills", skill);
}

function isExcludedSkillSyncPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => SKILL_EXCLUDED_DIR_NAMES.has(part))) return true;
  const name = path.posix.basename(normalized);
  if (name === "SKILL.local.md" || name.endsWith(".local.md")) return true;
  if (SKILL_EXCLUDED_FILE_NAMES.has(name)) return true;
  const lower = name.toLowerCase();
  for (const ext of SKILL_EXCLUDED_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) return true;
  }
  return false;
}

function isSyncableSharedSkillPath(relativePath) {
  const normalized = relativePath.replace(/\\/g, "/");
  return normalized.startsWith(".claude/skills/") && !isExcludedSkillSyncPath(normalized);
}

function listLocalSkillFiles(skill) {
  const root = skillRoot(skill);
  const files = [];
  let unsupportedFiles = 0;
  if (!fs.existsSync(root)) return { files, unsupportedFiles };
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(workspaceRoot(), fullPath).replace(/\\/g, "/");
      if (isExcludedSkillSyncPath(rel)) continue;
      if (entry.isDirectory()) {
        walk(fullPath);
        continue;
      }
      if (!entry.isFile()) {
        unsupportedFiles += 1;
        continue;
      }
      const stat = fs.statSync(fullPath);
      if (stat.size > LARGE_SYNC_FILE_BYTES) {
        unsupportedFiles += 1;
        continue;
      }
      const content = fs.readFileSync(fullPath);
      files.push({
        path: rel,
        fullPath,
        content,
        sha256: sha256(content),
        size: stat.size,
      });
    }
  }
  walk(root);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return { files, unsupportedFiles };
}

async function fetchSkillManifest(skill) {
  const body = await request(`/v1/team/skills/manifest${queryString({ skill })}`);
  return {
    skill: body.skill || skill,
    files: asArray(body.files).filter((file) => isSyncableSharedSkillPath(file.path || "")),
    unsupportedFiles: body.unsupportedFiles || 0,
  };
}

async function fetchSkillFileBuffer(file) {
  const remote = await request(`/v1/team/skills/file${fileQuery(file.path)}`);
  return { file, content: bufferFromRemote(remote) };
}

function saveSkillMetadata(skill, files) {
  const metadata = readSkillMetadata();
  metadata.skills[skill] = {
    managed: true,
    files: Object.fromEntries(files.map((file) => [file.path, {
      sha256: file.sha256 || sha256(file.content || ""),
      normalizedSha256: file.normalizedSha256,
      size: file.size,
      updatedAt: file.updatedAt,
      encoding: file.encoding,
    }])),
    syncedAt: new Date().toISOString(),
  };
  writeSkillMetadata(metadata);
}

async function skillPull(flags) {
  const skill = requireFlag({ skill: skillSlugFromFlags(flags) }, "skill", "--skill is required");
  const manifest = await fetchSkillManifest(skill);
  const remoteFiles = await Promise.all(manifest.files.map(fetchSkillFileBuffer));
  const local = listLocalSkillFiles(skill);
  const remoteMap = new Map(remoteFiles.map((remote) => [remote.file.path, remote]));
  const conflicts = [];
  for (const remote of remoteFiles) {
    const localPath = safeJoin(workspaceRoot(), remote.file.path);
    if (!fs.existsSync(localPath)) continue;
    const content = fs.readFileSync(localPath);
    if (sha256(content) !== sha256(remote.content)) {
      conflicts.push({ path: remote.file.path, operation: "write-local", localSha256: sha256(content), remoteSha256: sha256(remote.content) });
    }
  }
  for (const localFile of local.files) {
    if (!remoteMap.has(localFile.path)) {
      conflicts.push({ path: localFile.path, operation: "delete-local", localSha256: localFile.sha256 });
    }
  }
  if (conflicts.length > 0 && !flags.overwrite) {
    printConflicts(conflicts);
    if (!process.stdin.isTTY || !(await confirm("Overwrite local skill files?"))) {
      throw new Error("Skill pull stopped because local files differ.");
    }
  }
  let filesChanged = 0;
  for (const remote of remoteFiles) {
    const fullPath = safeJoin(workspaceRoot(), remote.file.path);
    const currentHash = fs.existsSync(fullPath) ? sha256(fs.readFileSync(fullPath)) : null;
    const nextHash = sha256(remote.content);
    if (currentHash !== nextHash) filesChanged += 1;
    fs.mkdirSync(path.dirname(fullPath), { recursive: true });
    fs.writeFileSync(fullPath, remote.content);
  }
  if (flags.overwrite) {
    for (const localFile of local.files) {
      if (!remoteMap.has(localFile.path)) fs.rmSync(localFile.fullPath, { force: true });
    }
  }
  saveSkillMetadata(skill, remoteFiles.map((remote) => ({
    path: remote.file.path,
    sha256: remote.file.sha256 || sha256(remote.content),
    normalizedSha256: remote.file.normalizedSha256,
    size: remote.file.size || remote.content.length,
    updatedAt: remote.file.updatedAt,
    encoding: remote.file.encoding,
  })));
  console.log(`Pulled ${remoteFiles.length} skill file${remoteFiles.length === 1 ? "" : "s"} for ${skill}.`);
  console.log(`Changed locally: ${filesChanged}`);
}

async function skillPush(flags) {
  const skill = requireFlag({ skill: skillSlugFromFlags(flags) }, "skill", "--skill is required");
  const local = listLocalSkillFiles(skill);
  if (local.files.length === 0) throw new Error("Local skill folder is missing or has no syncable files.");
  let manifest = { files: [] };
  try {
    manifest = await fetchSkillManifest(skill);
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  const remoteByPath = new Map(asArray(manifest.files).map((file) => [file.path, file]));
  const localByPath = new Map(local.files.map((file) => [file.path, file]));
  const metadata = readSkillMetadata().skills[skill]?.files || {};
  const review = [];
  for (const localFile of local.files) {
    const remote = remoteByPath.get(localFile.path);
    if (remote?.sha256 === localFile.sha256) continue;
    review.push({ path: localFile.path, operation: "write-remote", localSha256: localFile.sha256, remoteSha256: remote?.sha256 });
  }
  for (const remote of asArray(manifest.files)) {
    if (localByPath.has(remote.path)) continue;
    if (metadata[remote.path]) review.push({ path: remote.path, operation: "delete-remote", remoteSha256: remote.sha256 });
  }
  if (review.length > 0 && !flags.overwrite) {
    printConflicts(review);
    if (!process.stdin.isTTY || !(await confirm("Push these skill changes to the server?"))) {
      throw new Error("Skill push stopped for review.");
    }
  }
  let filesPushed = 0;
  for (const localFile of local.files) {
    const remote = remoteByPath.get(localFile.path);
    if (remote?.sha256 === localFile.sha256) continue;
    await request(`/v1/team/skills/file${fileQuery(localFile.path)}`, {
      method: "PUT",
      body: { ...payloadForBuffer(localFile.path, localFile.content), ...(remote?.sha256 ? { expectedSha256: remote.sha256 } : {}) },
    });
    filesPushed += 1;
  }
  let filesDeleted = 0;
  for (const remote of asArray(manifest.files)) {
    if (localByPath.has(remote.path)) continue;
    if (!metadata[remote.path]) continue;
    await request(`/v1/team/skills/file${fileQuery(remote.path, { expectedSha256: remote.sha256 })}`, { method: "DELETE" });
    filesDeleted += 1;
  }
  saveSkillMetadata(skill, local.files.map((file) => ({ path: file.path, sha256: file.sha256, size: file.size })));
  console.log(`Pushed ${filesPushed} file${filesPushed === 1 ? "" : "s"} for ${skill}.`);
  if (filesDeleted) console.log(`Deleted ${filesDeleted} remote file${filesDeleted === 1 ? "" : "s"}.`);
}

async function skillAdopt(flags) {
  const skill = requireFlag({ skill: skillSlugFromFlags(flags) }, "skill", "--skill is required");
  const manifest = await fetchSkillManifest(skill);
  const local = listLocalSkillFiles(skill);
  const localByPath = new Map(local.files.map((file) => [file.path, file]));
  if (local.files.length === 0) throw new Error("Local skill folder is missing or has no syncable files.");
  const remoteFiles = await Promise.all(manifest.files.map(fetchSkillFileBuffer));
  const mismatches = [];
  for (const remote of remoteFiles) {
    const localFile = localByPath.get(remote.file.path);
    if (!localFile || sha256(localFile.content) !== sha256(remote.content)) mismatches.push(remote.file.path);
  }
  if (mismatches.length > 0 || local.files.length !== remoteFiles.length) {
    throw cliError("Local skill does not match the server version. Run skill sync pull --overwrite first.", { showUsage: false });
  }
  saveSkillMetadata(skill, remoteFiles.map((remote) => ({
    path: remote.file.path,
    sha256: remote.file.sha256 || sha256(remote.content),
    size: remote.file.size || remote.content.length,
    updatedAt: remote.file.updatedAt,
    encoding: remote.file.encoding,
  })));
  console.log(`Adopted local skill ${skill} into Team OS sync metadata.`);
}

async function skillPrune(flags) {
  const skill = requireFlag({ skill: skillSlugFromFlags(flags) }, "skill", "--skill is required");
  const metadata = readSkillMetadata();
  if (!metadata.skills[skill]?.managed) {
    console.log(`Skill ${skill} is not managed by Team OS sync metadata.`);
    return;
  }
  if (!flags.yes && process.stdin.isTTY && !(await confirm(`Remove local managed skill ${skill}?`))) return;
  fs.rmSync(skillRoot(skill), { recursive: true, force: true });
  delete metadata.skills[skill];
  writeSkillMetadata(metadata);
  console.log(`Pruned local skill ${skill}.`);
}

async function skillSync(flags) {
  const action = flags.action || "pull";
  if (action === "pull") return skillPull(flags);
  if (action === "push") return skillPush(flags);
  if (action === "adopt") return skillAdopt(flags);
  if (action === "prune") return skillPrune(flags);
  throw new Error("Unknown skill sync action. Use: pull, push, adopt, or prune");
}

async function skillCommand(flags) {
  const sub = flags.subcommand || "list";
  if (sub === "list" || sub === "search") return skillList(flags);
  if (sub === "grant") return skillGrant(flags, false);
  if (sub === "revoke") return skillGrant(flags, true);
  if (sub === "sync") return skillSync(flags);
  if (["pull", "push", "adopt", "prune"].includes(sub)) {
    return skillSync({ ...flags, subcommand: "sync", action: sub, extra: flags.action ? [flags.action, ...flags.extra] : flags.extra });
  }
  throw new Error("Unknown skill command. Use: list, grant, revoke, or sync");
}

function listLocalBrandFiles(onlyPath) {
  const root = workspaceRoot();
  const brandRoot = path.join(root, "brand_context");
  const files = [];
  if (!fs.existsSync(brandRoot)) return files;
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      const rel = path.relative(root, fullPath).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIR_NAMES.has(entry.name)) walk(fullPath);
        continue;
      }
      if (!entry.isFile() || !isSyncableTextFile(rel)) continue;
      if (onlyPath && rel !== onlyPath) continue;
      const stat = fs.statSync(fullPath);
      if (stat.size > MAX_SYNC_FILE_BYTES) continue;
      const content = fs.readFileSync(fullPath, "utf-8");
      files.push({ path: rel, fullPath, content, sha256: sha256(content), size: stat.size });
    }
  }
  walk(brandRoot);
  files.sort((a, b) => a.path.localeCompare(b.path));
  return files;
}

function normalizeBrandPathInput(value) {
  const trimmed = String(value || "").trim();
  if (!trimmed || path.isAbsolute(trimmed)) throw new Error("file path is invalid");
  const normalized = trimmed.replace(/\\/g, "/").replace(/\/+/g, "/").replace(/^\/+/, "");
  const parts = normalized.split("/").filter(Boolean);
  if (parts.some((part) => part === "." || part === "..") || !normalized.startsWith("brand_context/")) {
    throw new Error("file path is outside brand_context");
  }
  return parts.join("/");
}

async function brandContextStatus() {
  const manifest = await request("/v1/team/brand-context/manifest");
  const local = listLocalBrandFiles();
  console.log(`Server files: ${asArray(manifest.files).length}`);
  console.log(`Local files: ${local.length}`);
  console.log(`Writable: ${manifest.writable === true ? "yes" : "no"}`);
}

async function brandContextPull(flags) {
  const manifest = await request("/v1/team/brand-context/manifest");
  const remoteFiles = [];
  const conflicts = [];
  for (const file of asArray(manifest.files)) {
    const remote = await request(`/v1/team/brand-context/file${fileQuery(file.path)}`);
    const fullPath = safeJoin(workspaceRoot(), file.path);
    remoteFiles.push({ ...file, content: remote.content || "", fullPath, sha256: remote.sha256 || sha256(remote.content || "") });
    if (fs.existsSync(fullPath)) {
      const localHash = sha256(fs.readFileSync(fullPath));
      const remoteHash = sha256(remote.content || "");
      if (localHash !== remoteHash) conflicts.push({ path: file.path, operation: "write-local", localSha256: localHash, remoteSha256: remoteHash });
    }
  }
  if (conflicts.length > 0 && !flags.overwrite) {
    printConflicts(conflicts);
    if (!process.stdin.isTTY || !(await confirm("Overwrite local brand context files?"))) {
      throw new Error("Brand context pull stopped because local files differ.");
    }
  }
  for (const file of remoteFiles) {
    fs.mkdirSync(path.dirname(file.fullPath), { recursive: true });
    fs.writeFileSync(file.fullPath, file.content, "utf-8");
  }
  console.log(`Pulled ${remoteFiles.length} brand context file${remoteFiles.length === 1 ? "" : "s"}.`);
}

async function brandContextPush(flags) {
  const manifest = await request("/v1/team/brand-context/manifest");
  if (manifest.writable !== true) throw new Error("Owner or Admin access is required to push brand context.");
  const onlyPath = flags.path ? normalizeBrandPathInput(flags.path) : null;
  const localFiles = listLocalBrandFiles(onlyPath);
  if (onlyPath && localFiles.length === 0) throw new Error("Selected file does not exist locally or is not syncable.");
  const remoteByPath = new Map(asArray(manifest.files).map((file) => [file.path, file]));
  const review = [];
  for (const local of localFiles) {
    const remote = remoteByPath.get(local.path);
    if (remote?.sha256 === local.sha256) continue;
    review.push({ path: local.path, operation: "write-remote", localSha256: local.sha256, remoteSha256: remote?.sha256 });
  }
  if (review.length > 0 && !flags.overwrite) {
    printConflicts(review);
    if (!process.stdin.isTTY || !(await confirm("Push these brand context files to the server?"))) {
      throw new Error("Brand context push stopped for review.");
    }
  }
  let filesPushed = 0;
  for (const local of localFiles) {
    const remote = remoteByPath.get(local.path);
    if (remote?.sha256 === local.sha256) continue;
    await request(`/v1/team/brand-context/file${fileQuery(local.path)}`, {
      method: "PUT",
      body: { content: local.content, ...(remote?.sha256 ? { expectedSha256: remote.sha256 } : {}) },
    });
    filesPushed += 1;
  }
  console.log(`Pushed ${filesPushed} brand context file${filesPushed === 1 ? "" : "s"}.`);
}

async function brandContextCommand(flags) {
  const sub = flags.subcommand || "status";
  if (sub === "status" || sub === "list") return brandContextStatus(flags);
  if (sub === "pull") return brandContextPull(flags);
  if (sub === "push") return brandContextPush(flags);
  throw new Error("Unknown brand-context command. Use: status, pull, or push");
}

function mcpPath() {
  return path.join(workspaceRoot(), ".mcp.json");
}

async function fetchRemoteMcp() {
  const body = await request(`/v1/user/config-file${queryString({ path: ".mcp.json" })}`);
  return body.file || null;
}

async function mcpStatus() {
  const localExists = fs.existsSync(mcpPath());
  const remote = await fetchRemoteMcp();
  console.log(`Local .mcp.json: ${localExists ? "present" : "missing"}`);
  console.log(`Remote backup: ${remote ? "present" : "missing"}`);
  if (remote?.updatedAt) console.log(`Remote updated: ${remote.updatedAt}`);
}

async function mcpBackup(flags) {
  const file = mcpPath();
  if (!fs.existsSync(file)) throw cliError("Local .mcp.json does not exist.", { showUsage: false });
  const content = fs.readFileSync(file, "utf-8");
  JSON.parse(content);
  const remote = await fetchRemoteMcp();
  if (remote && !flags.overwrite && process.stdin.isTTY && !(await confirm("Overwrite remote .mcp.json backup?"))) return;
  const result = await request("/v1/user/config-file", {
    method: "PUT",
    body: {
      path: ".mcp.json",
      content,
      ...(remote?.sha256 ? { expectedSha256: remote.sha256 } : {}),
    },
  });
  console.log(`Backed up .mcp.json to Team OS. ${result.file?.sha256 || ""}`.trim());
}

async function mcpRestore(flags) {
  const remote = await fetchRemoteMcp();
  if (!remote) throw cliError("No remote .mcp.json backup is available.", { showUsage: false });
  const file = mcpPath();
  if (fs.existsSync(file) && !flags.overwrite && process.stdin.isTTY && !(await confirm("Overwrite local .mcp.json?"))) return;
  fs.writeFileSync(file, remote.content, "utf-8");
  console.log("Restored .mcp.json from Team OS.");
}

async function mcpCommand(flags) {
  const sub = flags.subcommand || "status";
  if (sub === "status") return mcpStatus();
  if (sub === "backup" || sub === "push") return mcpBackup(flags);
  if (sub === "restore" || sub === "pull") return mcpRestore(flags);
  throw new Error("Unknown mcp command. Use: status, backup, or restore");
}

async function syncManifest(flags) {
  const body = await request(`/v1/workspace/manifest${clientQuery(flags)}`);
  const files = asArray(body.files);
  printList(
    files.map((file) => `${file.path}\t${file.size}\t${file.writable ? "write" : "read"}`),
    "No granted workspace files are available.",
  );
}

async function syncPull(flags) {
  const clientSlug = requireFlag(flags, "client", "--client is required");
  const dest = path.resolve(requireFlag(flags, "dest", "--dest is required"));
  const config = readConfig();
  const body = await teamRequest(config, `/v1/workspace/manifest${clientQuery(flags)}`).catch((error) => {
    maybeMarkRequestFailure(config, error);
    throw error;
  });
  const files = asArray(body.files);
  const state = readSyncState(dest);
  let written = 0;
  for (const file of files) {
    if (file.client !== clientSlug || typeof file.path !== "string") continue;
    const remote = await teamRequest(config, `/v1/workspace/file${fileQuery(file.path)}`);
    const localPath = safeJoin(dest, file.path);
    fs.mkdirSync(path.dirname(localPath), { recursive: true });
    fs.writeFileSync(localPath, String(remote.content ?? ""), "utf-8");
    state.files[file.path] = {
      sha256: remote.sha256,
      updatedAt: remote.updatedAt,
      pulledAt: new Date().toISOString(),
    };
    written += 1;
  }
  writeSyncState(dest, state);
  console.log(`Pulled ${written} file${written === 1 ? "" : "s"} into ${dest}`);
}

async function syncPush(flags) {
  const clientSlug = requireFlag(flags, "client", "--client is required");
  const src = requireFlag(flags, "src", "--src is required");
  const config = readConfig();
  const { base, serverPrefix, stateRoot } = localSyncBase(src, clientSlug);
  const state = readSyncState(stateRoot);
  const remoteManifest = await teamRequest(config, `/v1/workspace/manifest${clientQuery(flags)}`).catch((error) => {
    maybeMarkRequestFailure(config, error);
    throw error;
  });
  const remoteByPath = new Map(
    asArray(remoteManifest.files)
      .filter((file) => typeof file.path === "string")
      .map((file) => [file.path, file]),
  );
  const files = listLocalSyncFiles(base, serverPrefix);
  let pushed = 0;
  for (const file of files) {
    const content = fs.readFileSync(file.full, "utf-8");
    const remote = remoteByPath.get(file.serverPath);
    const previous = state.files[file.serverPath];
    if (remote && (!previous || typeof previous.sha256 !== "string")) {
      throw cliError(
        `No base version for ${file.serverPath}. Run sync pull before pushing existing files.`,
        { showUsage: false },
      );
    }
    const requestBody = { content };
    if (remote) requestBody.expectedSha256 = previous.sha256;
    const result = await teamRequest(config, `/v1/workspace/file${fileQuery(file.serverPath)}`, {
      method: "PUT",
      body: requestBody,
    });
    state.files[file.serverPath] = {
      sha256: result.sha256,
      updatedAt: result.updatedAt,
      pushedAt: new Date().toISOString(),
    };
    pushed += 1;
  }
  writeSyncState(stateRoot, state);
  console.log(`Pushed ${pushed} file${pushed === 1 ? "" : "s"} from ${base}`);
}

async function sync(flags) {
  if (flags.subcommand === "manifest") return syncManifest(flags);
  if (flags.subcommand === "pull") return syncPull(flags);
  if (flags.subcommand === "push") return syncPush(flags);
  if (flags.subcommand === "brand" || flags.subcommand === "brand-context") {
    return brandContextCommand({ ...flags, command: "brand-context", subcommand: flags.action, action: flags.extra?.[0] });
  }
  if (flags.subcommand === "skill") {
    return skillSync({ ...flags, command: "skill", subcommand: "sync", action: flags.action, extra: flags.extra });
  }
  if (flags.subcommand === "mcp") {
    return mcpCommand({ ...flags, command: "mcp", subcommand: flags.action });
  }
  if (flags.subcommand === "secrets" || flags.subcommand === "secret") {
    return secretsSync(flags);
  }
  throw new Error("Unknown sync command. Use: sync manifest, sync pull, sync push, sync brand, sync skill, sync mcp, or sync secrets");
}

async function contextCommand(flags) {
  if (flags.subcommand === "brand" || flags.subcommand === "brand-context") {
    return brandContextCommand({ ...flags, command: "brand-context", subcommand: flags.action, action: flags.extra?.[0] });
  }
  if (flags.subcommand === "mcp") {
    return mcpCommand({ ...flags, command: "mcp", subcommand: flags.action });
  }
  if (flags.subcommand === "client") {
    if (flags.action === "pull") return syncPull({ ...flags, subcommand: "pull", dest: flags.dest || workspaceRoot() });
    if (flags.action === "push") return syncPush({ ...flags, subcommand: "push", src: flags.src || workspaceRoot() });
  }
  throw new Error("Unknown context command. Use: context brand pull|push, context client pull|push, or context mcp backup|restore");
}

async function logout() {
  try {
    const config = readConfig();
    await teamRequest(config, "/v1/auth/logout", { method: "POST", teamId: null }).catch(() => {});
  } catch {
    /* no saved or reachable server context */
  }
  clearConfig();
  markTeamSignedOut();
  console.log("Signed out.");
}

function pendingMemoryJobs(memoryBody) {
  return Object.entries(asRecord(memoryBody?.jobsByStatus))
    .filter(([key]) => ["queued", "indexing", "running"].includes(key))
    .reduce((total, [, value]) => total + Number(value || 0), 0);
}

function fallbackMenuStatus(config, cache, error) {
  if (!config) {
    return {
      status: "signed_out",
      signedIn: false,
      hasLogin: false,
      counts: {},
    };
  }
  const cached = asRecord(cache);
  return {
    status: "unavailable",
    signedIn: false,
    hasLogin: true,
    apiUrl: config.apiUrl || cached.apiUrl || null,
    savedAt: config.savedAt || cached.savedAt || null,
    expiresAt: config.expiresAt || cached.expiresAt || null,
    checkedAt: cached.checkedAt || null,
    user: cached.user || config.user || null,
    team: cached.team || config.team || null,
    membership: cached.membership || config.membership || null,
    error: error instanceof Error ? error.message : String(error || cached.error || "Team API unavailable"),
    counts: {},
  };
}

async function fetchMenuStatus(options = {}) {
  const config = readConfigOptional();
  const cache = readStatusCache();
  if (!config) return fallbackMenuStatus(null, cache, null);
  if (isExpired(config)) {
    const message = "Saved Team OS login expired. Sign in again.";
    markTeamUnavailable(config, message);
    return fallbackMenuStatus(config, readStatusCache() || cache, message);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs || 1800);
  try {
    const requestOptions = { signal: controller.signal };
    const [whoResult, clientResult, memoryResult, adminResult, secretsResult, skillsResult] = await Promise.allSettled([
      teamRequest(config, "/v1/team/whoami", requestOptions),
      teamRequest(config, "/v1/team/clients", requestOptions),
      teamRequest(config, "/v1/memory/status", requestOptions),
      teamRequest(config, "/v1/team/admin", requestOptions),
      teamRequest(config, "/v1/team/secrets", requestOptions),
      teamRequest(config, "/v1/team/skills", requestOptions),
    ]);
    if (whoResult.status !== "fulfilled") {
      maybeMarkRequestFailure(config, whoResult.reason);
      return fallbackMenuStatus(config, readStatusCache() || cache, whoResult.reason);
    }

    const who = whoResult.value;
    markTeamConnected(config, who);
    const clientsBody = clientResult.status === "fulfilled" ? clientResult.value : {};
    const memoryBody = memoryResult.status === "fulfilled" ? memoryResult.value : {};
    const adminBody = adminResult.status === "fulfilled" ? adminResult.value : {};
    const secretsBody = secretsResult.status === "fulfilled" ? secretsResult.value : {};
    const skillsBody = skillsResult.status === "fulfilled" ? skillsResult.value : {};
    return {
      status: "connected",
      signedIn: true,
      hasLogin: true,
      apiUrl: config.apiUrl,
      savedAt: config.savedAt || null,
      expiresAt: config.expiresAt || null,
      checkedAt: new Date().toISOString(),
      user: who.user || config.user || null,
      team: who.team || config.team || null,
      membership: who.membership || config.membership || null,
      counts: {
        clients: asArray(clientsBody.clients).length,
        members: asArray(adminBody.members).length || null,
        skills: asArray(skillsBody.skills).length,
        secrets: asArray(secretsBody.secrets).length,
        memorySources: memoryBody.sources ?? null,
        memoryChunks: memoryBody.chunks ?? null,
        memoryPending: memoryBody.jobsByStatus ? pendingMemoryJobs(memoryBody) : null,
      },
    };
  } catch (error) {
    maybeMarkRequestFailure(config, error);
    return fallbackMenuStatus(config, readStatusCache() || cache, error);
  } finally {
    clearTimeout(timer);
  }
}

function memberValue(member) {
  return member.email || member.userId || member.id || "";
}

function memberOptions(state) {
  return asArray(state.members)
    .map((member) => ({
      value: memberValue(member),
      label: member.email || member.userId || member.id || "(unknown)",
      detail: `${member.role || "member"} | ${member.status || "unknown"}`,
    }))
    .filter((member) => member.value);
}

function clientOptionsFromAdmin(state) {
  return asArray(state.clients)
    .map((client) => ({
      value: client.slug || client.id || "",
      label: client.name || client.slug || client.id || "(unknown)",
      detail: client.slug || client.status || "",
    }))
    .filter((client) => client.value);
}

function clientOptionsFromList(body) {
  return asArray(body.clients)
    .map((client) => ({
      value: client.slug || client.id || "",
      label: client.name || client.slug || client.id || "(unknown)",
      detail: client.access || client.slug || "",
    }))
    .filter((client) => client.value);
}

function secretOptions(body) {
  return asArray(body.secrets)
    .map((secret) => ({
      value: secret.id || "",
      label: secret.envKey || secret.name || secret.id || "(unknown)",
      detail: secret.scope === "client" ? `client:${secret.clientSlug || secret.clientId || ""}` : "team",
    }))
    .filter((secret) => secret.value);
}

function skillOptions(body) {
  return asArray(body.skills)
    .map((skill) => ({
      value: skill.slug || skill.name || "",
      label: skill.name || skill.slug || "(unknown)",
      detail: skill.slug || "",
    }))
    .filter((skill) => skill.value);
}

async function pickOne(message, options) {
  if (options.length === 0) return null;
  const picked = await select(message, options, { hint: "Esc cancel, Ctrl+C exit" });
  if (!picked) return null;
  return picked.value;
}

async function runBatch(label, values, fn) {
  const results = [];
  for (const value of values) {
    try {
      await fn(value);
      results.push({ ok: true, label: String(value?.label || value?.user || value?.skillName || value) });
    } catch (error) {
      results.push({
        ok: false,
        label: String(value?.label || value?.user || value?.skillName || value),
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  const summary = summarizeBatch(label, results);
  await note(summary.text, summary.failed ? "Completed with errors" : "Completed");
  return summary;
}

async function postAdminSilent(action) {
  return request("/v1/team/admin", { method: "POST", body: action });
}

async function postSecretSilent(action) {
  return request("/v1/team/secrets", { method: "POST", body: action });
}

async function menuMemberBatch(action) {
  const state = await request("/v1/team/admin");
  const members = await multiSelect("Choose team members", memberOptions(state));
  if (!members || members.length === 0) return;
  if (action === "role") {
    const role = await pickOne("Choose the new role", [
      { label: "Member", value: "member" },
      { label: "Admin", value: "admin" },
      { label: "Owner", value: "owner" },
    ]);
    if (!role) return;
    return runBatch("Role changes", members, (user) => postAdminSilent({ action: "set-member-role", user, role }));
  }
  if (action === "remove") {
    if (!(await confirm(`Remove ${members.length} selected member${members.length === 1 ? "" : "s"}?`))) return;
    return runBatch("Member removal", members, (user) => postAdminSilent({ action: "remove-member", user }));
  }
  if (action === "invite-link") {
    return runBatch("Invite links", members, async (user) => {
      const result = await postAdminSilent({ action: "create-invite-link", user });
      if (result.invite?.url) console.log(`${user}: ${result.invite.url}`);
    });
  }
  if (action === "reset-link") {
    return runBatch("Reset links", members, async (user) => {
      const result = await postAdminSilent({ action: "create-password-reset-link", user });
      if (result.reset?.url) console.log(`${user}: ${result.reset.url}`);
    });
  }
}

async function menuClientGrant(action) {
  const state = await request("/v1/team/admin");
  const client = await pickOne("Choose a client", clientOptionsFromAdmin(state));
  if (!client) return;
  const users = await multiSelect("Choose team members", memberOptions(state));
  if (!users || users.length === 0) return;
  let access = "read";
  if (action === "grant") {
    access = await pickOne("Choose access", [
      { label: "Read", value: "read" },
      { label: "Write", value: "write" },
    ]);
    if (!access) return;
  }
  return runBatch(
    action === "grant" ? "Client grants" : "Client revokes",
    users,
    (user) => postAdminSilent({
      action: action === "grant" ? "grant-client" : "revoke-client",
      client,
      user,
      ...(action === "grant" ? { access } : {}),
    }),
  );
}

async function menuClientSync(action) {
  const body = await request("/v1/team/clients");
  const client = await pickOne("Choose a client", clientOptionsFromList(body));
  if (!client) return;
  if (action === "pull") return clientCommand({ subcommand: "pull", client, dest: workspaceRoot() });
  return clientCommand({ subcommand: "push", client, src: workspaceRoot() });
}

async function menuSecretBatch(action) {
  const [secrets, admin] = await Promise.all([
    request("/v1/team/secrets"),
    request("/v1/team/admin"),
  ]);
  const selectedSecrets = await multiSelect("Choose secrets", secretOptions(secrets));
  if (!selectedSecrets || selectedSecrets.length === 0) return;
  if (action === "archive") {
    if (!(await confirm(`Archive ${selectedSecrets.length} selected secret${selectedSecrets.length === 1 ? "" : "s"}?`))) return;
    return runBatch("Secret archive", selectedSecrets, (secret) => postSecretSilent({ action: "archive-secret", secret }));
  }
  const users = await multiSelect("Choose team members", memberOptions(admin));
  if (!users || users.length === 0) return;
  const pairs = selectedSecrets.flatMap((secret) => users.map((user) => ({
    secret,
    user,
    label: `${secret} -> ${user}`,
  })));
  return runBatch(
    action === "grant" ? "Secret grants" : "Secret revokes",
    pairs,
    ({ secret, user }) => postSecretSilent({
      action: action === "grant" ? "grant-secret" : "revoke-secret",
      secret,
      user,
    }),
  );
}

async function menuSkillGrant(action) {
  const [skills, admin] = await Promise.all([
    request("/v1/team/skills"),
    request("/v1/team/admin"),
  ]);
  const selectedSkills = await multiSelect("Choose skills", skillOptions(skills));
  if (!selectedSkills || selectedSkills.length === 0) return;
  const users = await multiSelect("Choose team members", memberOptions(admin));
  if (!users || users.length === 0) return;
  let permission = "skill.use";
  if (action === "grant") {
    permission = await pickOne("Choose permission", [
      { label: "Use", value: "skill.use" },
      { label: "Read", value: "skill.read" },
      { label: "Edit", value: "skill.edit" },
      { label: "Admin", value: "skill.admin" },
    ]);
    if (!permission) return;
  }
  const pairs = selectedSkills.flatMap((skillName) => users.map((user) => ({
    skillName,
    user,
    label: `${skillName} -> ${user}`,
  })));
  return runBatch(
    action === "grant" ? "Skill grants" : "Skill revokes",
    pairs,
    ({ skillName, user }) => postAdminSilent({
      action: action === "grant" ? "grant-skill" : "revoke-skill",
      skillName,
      user,
      permission,
    }),
  );
}

async function menuSkillSync(action) {
  const body = await request("/v1/team/skills");
  const skills = await multiSelect(`Choose skills to ${action}`, skillOptions(body));
  if (!skills || skills.length === 0) return;
  const flags = {};
  if (action === "prune") {
    if (!(await confirm(`Prune ${skills.length} selected local skill${skills.length === 1 ? "" : "s"}?`))) return;
    flags.yes = true;
  }
  return runBatch(`Skill ${action}`, skills, (skill) => skillSync({ action, skill, ...flags }));
}

async function menuBrandPush() {
  const localFiles = listLocalBrandFiles();
  const picks = await multiSelect(
    "Choose brand context files to push",
    localFiles.map((file) => ({ value: file.path, label: file.path, detail: `${file.size} bytes` })),
  );
  if (!picks || picks.length === 0) return;
  return runBatch("Brand context push", picks, (filePath) => brandContextPush({ path: filePath }));
}

async function menuMemoryRetry() {
  const body = await request("/v1/memory/imports?status=failed");
  const picks = await multiSelect(
    "Choose failed imports to retry",
    asArray(body.imports)
      .map((row) => ({
        value: row.id,
        label: row.sourcePath || row.id,
        detail: row.errorMessage || `attempts ${row.attempts || 0}`,
      }))
      .filter((row) => row.value),
  );
  if (!picks || picks.length === 0) return;
  return runBatch("Memory retries", picks, (id) => memoryRetry({ id }));
}

async function runMenuAction(section, action) {
  if (action === "refresh") return;
  if (action === "status-information") return;
  if (section === "Connection") {
    if (action === "login") return login({});
    if (action === "login-dev") return loginWithDevToken({});
    if (action === "whoami") return whoami();
    if (action === "logout") return logout();
  }
  if (section === "Dashboard") return dashboard();
  if (section === "Members") {
    if (action === "list") return memberCommand({ subcommand: "list" });
    if (action === "invite") return memberCommand({ subcommand: "invite" });
    if (["invite-link", "reset-link", "role", "remove"].includes(action)) return menuMemberBatch(action);
  }
  if (section === "Clients") {
    if (action === "list") return clientCommand({ subcommand: "list" });
    if (action === "create") return clientCommand({ subcommand: "create" });
    if (action === "grant" || action === "revoke") return menuClientGrant(action);
    if (action === "pull" || action === "push") return menuClientSync(action);
  }
  if (section === "Secrets") {
    if (action === "list") return secretCommand({ subcommand: "list" });
    if (action === "create") return secretCommand({ subcommand: "create" });
    if (action === "update") return secretCommand({ subcommand: "update" });
    if (["grant", "revoke", "archive"].includes(action)) return menuSecretBatch(action);
    if (action === "sync") return secretCommand({ subcommand: "sync" });
  }
  if (section === "Skills") {
    if (action === "list") return skillCommand({ subcommand: "list" });
    if (action === "search") return skillCommand({ subcommand: "list", query: await promptFor("Search: ") });
    if (action === "grant" || action === "revoke") return menuSkillGrant(action);
    if (["pull", "push", "adopt", "prune"].includes(action)) return menuSkillSync(action);
  }
  if (section === "Context & Sync") {
    if (action === "brand-status") return brandContextStatus();
    if (action === "brand-pull") return brandContextPull({});
    if (action === "brand-push") return menuBrandPush();
    if (action === "mcp-status") return mcpStatus();
    if (action === "mcp-backup") return mcpBackup({});
    if (action === "mcp-restore") return mcpRestore({});
    if (action === "client-pull") return menuClientSync("pull");
    if (action === "client-push") return menuClientSync("push");
  }
  if (section === "Memory") {
    if (action === "status") return memoryStatus();
    if (action === "imports") return memoryImports({});
    if (action === "retry") return menuMemoryRetry();
    if (action === "import") {
      return memoryImport({
        file: await promptFor("File path: "),
        visibility: await promptFor("Visibility (team/client): "),
        client: await promptFor("Client slug, if client visibility: ", { required: false }),
      });
    }
  }
}

async function openMenu(options = {}) {
  const prompts = {
    intro,
    isInteractive,
    isPromptAvailable,
    note,
    outro,
    promptFor,
    select,
    withSpinner,
    ...(options.prompts || {}),
  };
  const loadStatus = options.fetchMenuStatus || fetchMenuStatus;
  const runAction = options.runMenuAction || runMenuAction;
  const interrupt = options.interrupt || createPromptInterrupt({ forceExit: options.forceExit !== false });
  const restorePromptInterrupt = setPromptInterrupt(interrupt);
  const exitMenu = async () => {
    interrupt.restoreTerminal();
    await prompts.outro(muted("Closed Team OS."));
    return 0;
  };

  try {
    if (!prompts.isPromptAvailable()) {
      console.log(USAGE);
      console.error("\nThis menu needs an interactive terminal. Use PowerShell or Windows Terminal.");
      return 1;
    }
    interrupt.start();
    console.clear();
    console.log(banner());
    await prompts.intro(clay(" Team OS "));
    let status = await prompts.withSpinner("Checking Team OS status", () => loadStatus());
    let panel = statusPanel(status);
    await prompts.note(panel.body, panel.title);

    while (true) {
      let section;
      try {
        section = await prompts.select("Main Menu", buildMainMenuOptions(status), { hint: "Esc exit, Ctrl+C exit" });
      } catch (error) {
        if (isPromptBack(error) || isPromptExit(error)) return exitMenu();
        throw error;
      }
      if (!section || section.value === EXIT) {
        return exitMenu();
      }

      while (true) {
        let action;
        try {
          action = await prompts.select(section.label, buildSectionOptions(section.value, status), {
            hint: "Esc back, Ctrl+C exit",
          });
        } catch (error) {
          if (isPromptBack(error)) break;
          if (isPromptExit(error)) return exitMenu();
          throw error;
        }
        if (!action || action.value === BACK) break;
        let shouldPause = true;
        try {
          if (action.value === "status-information") {
            status = await prompts.withSpinner("Checking Team OS status", () => loadStatus());
            panel = statusPanel(status);
            await prompts.note(panel.body, panel.title);
          } else {
            await runAction(section.value, action.value);
            status = await loadStatus();
          }
        } catch (error) {
          if (isPromptBack(error)) {
            shouldPause = false;
          } else if (isPromptExit(error)) {
            return exitMenu();
          } else {
            await prompts.note(danger(error instanceof Error ? error.message : String(error)), "Team OS error");
          }
        }
        if (shouldPause) {
          try {
            await prompts.promptFor("Press Enter to continue", {
              required: false,
              hint: "Enter continue, Ctrl+C exit",
            });
          } catch (error) {
            if (isPromptBack(error)) continue;
            if (isPromptExit(error)) return exitMenu();
            throw error;
          }
        }
      }
    }
  } finally {
    interrupt.stop();
    restorePromptInterrupt();
  }
}

async function dispatch(flags) {
  if (shouldOpenMenu(flags)) return openMenu();
  if (!flags.command || flags.help) {
    console.log(USAGE);
    return 0;
  }
  if (flags.command === "menu") {
    if (!process.stdin.isTTY) {
      console.log(USAGE);
      return 0;
    }
    return openMenu();
  }
  if (flags.command === "login") return login(flags);
  if (flags.command === "login-dev") return loginWithDevToken(flags);
  if (flags.command === "status" || flags.command === "dashboard") return dashboard();
  if (flags.command === "admin") return adminState();
  if (flags.command === "whoami") return whoami();
  if (flags.command === "clients") return clients();
  if (flags.command === "client") return clientCommand(flags);
  if (flags.command === "members") return membersCommand(flags);
  if (flags.command === "member") return memberCommand(flags);
  if (flags.command === "secret" || flags.command === "secrets") return secretCommand(flags);
  if (flags.command === "skill" || flags.command === "skills") return skillCommand(flags);
  if (flags.command === "brand-context" || flags.command === "brand") return brandContextCommand(flags);
  if (flags.command === "mcp") return mcpCommand(flags);
  if (flags.command === "context") return contextCommand(flags);
  if (flags.command === "memory") return memory(flags);
  if (flags.command === "sync") return sync(flags);
  if (flags.command === "logout") return logout();
  throw new Error(`Unknown command: ${flags.command}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const result = await dispatch(flags);
  if (typeof result === "number") process.exitCode = result;
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    if (isPromptCancel(error)) {
      console.error(error.message || "Cancelled.");
      process.exitCode = 1;
      return;
    }
    console.error(`team: ${error instanceof Error ? error.message : error}`);
    if (!(error instanceof Error) || error.showUsage !== false) {
      console.error(`\n${USAGE}`);
    }
    process.exitCode = 1;
  });
}

module.exports = {
  dispatch,
  fetchMenuStatus,
  openMenu,
  parseArgs,
  shouldOpenMenu,
};
