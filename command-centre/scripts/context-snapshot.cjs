#!/usr/bin/env node
/**
 * context-snapshot — creates or resumes a profile/session-scoped Team OS
 * runtime context overlay for direct Claude sessions.
 *
 * Managed Command Centre agents prepare their overlay before spawn and skip
 * this script. Team mode is fail-closed: no global or Solo context fallback.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { loadTsModule } = require("../src/lib/test-utils/load-ts-module.cjs");

const overlayModule = loadTsModule(
  path.join(__dirname, "../src/lib/runtime-context-overlay.ts"),
);

function parseArgs(argv) {
  const out = {
    cwd: process.cwd(),
    format: "text",
    quiet: false,
    sessionId: process.env.CLAUDE_SESSION_ID || null,
    taskType: null,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") out.cwd = argv[++i] || out.cwd;
    else if (arg === "--format") out.format = argv[++i] || out.format;
    else if (arg === "--session-id") out.sessionId = argv[++i] || null;
    else if (arg === "--task-type") out.taskType = argv[++i] || null;
    else if (arg === "--quiet") out.quiet = true;
  }
  return out;
}

function configDir() {
  return process.env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
}

function readTeamContext() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir(), "team-context.json"), "utf8"));
    if (!parsed || typeof parsed !== "object") return null;
    const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl.trim().replace(/\/+$/, "") : "";
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    const serverId = typeof parsed.serverId === "string" ? parsed.serverId.trim() : "";
    const userId = parsed.user && typeof parsed.user === "object" && typeof parsed.user.id === "string"
      ? parsed.user.id.trim()
      : "";
    const configuredTeam = parsed.team && typeof parsed.team === "object" && typeof parsed.team.id === "string"
      ? parsed.team.id.trim()
      : "";
    const selectedTeamId = typeof parsed.selectedTeamId === "string" && parsed.selectedTeamId.trim()
      ? parsed.selectedTeamId.trim()
      : configuredTeam;
    if (!/^https?:\/\//i.test(apiUrl) || !token || !serverId || !userId || !selectedTeamId) return null;
    if (typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) <= Date.now()) return null;
    return { ...parsed, apiUrl, token, serverId, userId, selectedTeamId };
  } catch {
    return null;
  }
}

function clearLegacyCache(root) {
  const dir = path.join(root, ".AI-OS", "context-snapshot");
  fs.rmSync(path.join(dir, "current.md"), { force: true });
  fs.rmSync(path.join(dir, "current.json"), { force: true });
}

function detectClient(root, cwd) {
  const rel = path.relative(root, path.resolve(cwd)).replace(/\\/g, "/");
  const parts = rel.split("/").filter(Boolean);
  return parts[0] === "clients" && parts[1] ? parts[1] : null;
}

function createProfileKey(serverId, userId) {
  return crypto
    .createHash("sha256")
    .update(`team-os-profile:v1\n${serverId}\n${userId}`, "utf8")
    .digest("hex");
}

async function teamRequest(config, pathname, teamId = null) {
  const headers = { authorization: `Bearer ${config.token}` };
  if (teamId) headers["x-ai-team-id"] = teamId;
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    headers,
    signal: AbortSignal.timeout(6000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && body.error && typeof body.error === "object"
      ? body.error
      : {};
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : `Team OS request failed (${response.status})`,
    );
  }
  return body;
}

async function ensureActiveScope(config, teamId, clientId = null) {
  const body = await teamRequest(config, "/v1/auth/teams");
  const teams = Array.isArray(body && body.teams) ? body.teams : [];
  const active = teams.some((team) => team && typeof team === "object" && team.id === teamId);
  if (!active) throw new Error("The session Team membership is no longer active");
  if (clientId) {
    const clientsBody = await teamRequest(config, "/v1/team/clients", teamId);
    const clients = Array.isArray(clientsBody && clientsBody.clients) ? clientsBody.clients : [];
    const allowed = clients.some((client) => (
      client &&
      typeof client === "object" &&
      (client.id === clientId || client.slug === clientId)
    ));
    if (!allowed) throw new Error("The session client access is no longer active");
  }
}

async function fetchSnapshot(config, teamId, client, cwd, taskType) {
  const params = new URLSearchParams();
  if (client) params.set("client", client);
  if (cwd) params.set("cwd", cwd);
  if (taskType) params.set("taskType", taskType);
  const suffix = params.toString() ? `?${params.toString()}` : "";
  const body = await teamRequest(config, `/v1/context/snapshot${suffix}`, teamId);
  const snapshot = body && typeof body === "object" ? body.snapshot : null;
  if (!snapshot || typeof snapshot.markdown !== "string" || !snapshot.markdown.trim()) {
    throw new Error("Team OS context snapshot response was empty");
  }
  return snapshot;
}

function emitHook(markdown) {
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: "SessionStart",
      additionalContext: markdown,
    },
  }));
}

function emitResult(flags, loaded) {
  if (flags.format === "hook") {
    emitHook(loaded.snapshotMarkdown);
  } else if (flags.format === "json") {
    process.stdout.write(`${JSON.stringify({
      ...loaded.metadata,
      overlayDir: loaded.overlayDir,
    }, null, 2)}\n`);
  } else if (!flags.quiet) {
    console.log(`Team OS context overlay ready at ${loaded.overlayDir}`);
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  const root = findWorkspaceRoot(flags.cwd);
  clearLegacyCache(root);

  const config = readTeamContext();
  if (!config) return;
  if (!flags.sessionId || !String(flags.sessionId).trim()) {
    throw new Error("Claude session_id is required for a Team OS context overlay");
  }

  const profileKey = createProfileKey(config.serverId, config.userId);
  if (
    process.env.AI_OS_PROFILE_KEY &&
    process.env.AI_OS_PROFILE_KEY !== profileKey
  ) {
    throw new Error("The inherited Team OS profile does not match the saved login");
  }
  if (
    (process.env.AI_OS_SERVER_ID && process.env.AI_OS_SERVER_ID !== config.serverId) ||
    (process.env.AI_OS_USER_ID && process.env.AI_OS_USER_ID !== config.userId)
  ) {
    throw new Error("The inherited Team OS identity does not match the saved login");
  }
  const profileTempDir = path.join(root, ".command-centre", "profiles", profileKey, "tmp");
  const ownerExpectation = {
    profileTempDir,
    ownerType: "claude_session",
    ownerId: String(flags.sessionId),
    profileKey,
    serverId: config.serverId,
    userId: config.userId,
  };

  const existing = overlayModule.loadRuntimeContextOverlayForOwner(ownerExpectation);
  if (existing) {
    await ensureActiveScope(config, existing.metadata.teamId, existing.metadata.clientId);
    emitResult(flags, existing);
    return;
  }

  const pinnedTeamId = process.env.AI_OS_WORK_MODE === "team"
    ? (process.env.AI_OS_TEAM_ID || "").trim()
    : "";
  const teamId = pinnedTeamId || config.selectedTeamId;
  const pinnedClientId = process.env.AI_OS_WORK_MODE === "team"
    ? (process.env.AI_OS_CLIENT_ID || "").trim() || null
    : null;
  const clientId = process.env.AI_OS_WORK_MODE === "team"
    ? pinnedClientId
    : detectClient(root, flags.cwd);
  await ensureActiveScope(config, teamId, clientId);
  const snapshot = await fetchSnapshot(
    config,
    teamId,
    clientId,
    flags.cwd,
    flags.taskType,
  );
  const loaded = overlayModule.createOrLoadRuntimeContextOverlay(
    {
      ...ownerExpectation,
      teamId,
      clientId,
    },
    snapshot.markdown,
    flags.taskType || "claude-session",
  );
  emitResult(flags, loaded);
}

main().catch((error) => {
  try {
    clearLegacyCache(findWorkspaceRoot(process.cwd()));
  } catch {
    // no-op
  }
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.quiet && flags.format !== "hook") {
    console.error(`Team OS context unavailable: ${error instanceof Error ? error.message : String(error)}`);
  }
  process.exitCode = flags.format === "hook" ? 0 : 1;
});
