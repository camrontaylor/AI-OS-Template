const path = require("node:path");

const { teamRequest } = require("./team-api.cjs");
const { isExpired, readConfigOptional } = require("./team-config.cjs");

const VALID_MEMORY_MODES = new Set(["auto", "team", "local"]);
const VALID_VISIBILITIES = ["system", "team", "client", "private"];

class TeamMemoryRoutingError extends Error {
  constructor(message, code = "TEAM_MEMORY_ROUTING_ERROR") {
    super(message);
    this.name = "TeamMemoryRoutingError";
    this.code = code;
  }
}

function normalizeMemoryMode(raw) {
  const mode = String(raw ?? "auto").trim().toLowerCase() || "auto";
  if (!VALID_MEMORY_MODES.has(mode)) {
    throw new TeamMemoryRoutingError(
      `TEAM_OS_MEMORY_MODE must be auto, team, or local (got "${mode}")`,
      "TEAM_MEMORY_INVALID_MODE",
    );
  }
  return mode;
}

function requestedMemoryMode(flags = {}, env = process.env) {
  if (flags.local && flags.teamApi) {
    throw new TeamMemoryRoutingError(
      "Use either --team-api or --local, not both",
      "TEAM_MEMORY_INVALID_MODE",
    );
  }
  if (flags.local) return "local";
  if (flags.teamApi) return "team";
  return normalizeMemoryMode(env.TEAM_OS_MEMORY_MODE);
}

function timeoutSignal(timeoutMs) {
  if (typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function") {
    return AbortSignal.timeout(timeoutMs);
  }
  return undefined;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

function idFromRecord(value) {
  return value && typeof value === "object" && typeof value.id === "string"
    ? value.id.trim()
    : "";
}

function readTeamLogin() {
  const config = readConfigOptional();
  if (!config) return { config: null, expired: false };
  return { config, expired: isExpired(config) };
}

async function resolveTeamMemoryRoute({
  flags = {},
  env = process.env,
  request = teamRequest,
  timeoutMs = 6000,
  checkLive = true,
} = {}) {
  const mode = requestedMemoryMode(flags, env);
  if (mode === "local") {
    return { target: "local", mode, reason: "forced-local" };
  }

  const { config, expired } = readTeamLogin();
  if (!config) {
    if (mode === "team") {
      throw new TeamMemoryRoutingError(
        "Team OS memory mode was requested, but no saved Team OS login exists. Run npm run team -- login first, or use --local.",
        "TEAM_MEMORY_NOT_SIGNED_IN",
      );
    }
    return { target: "local", mode, reason: "signed-out" };
  }

  if (expired) {
    throw new TeamMemoryRoutingError(
      "Saved Team OS login expired. Sign in again, or use --local for offline PGLite.",
      "TEAM_MEMORY_LOGIN_EXPIRED",
    );
  }

  if (!checkLive) {
    return { target: "team", mode, config, whoami: null };
  }

  try {
    const whoami = await request(config, "/v1/team/whoami", {
      signal: timeoutSignal(timeoutMs),
    });
    return { target: "team", mode, config, whoami };
  } catch (error) {
    throw new TeamMemoryRoutingError(
      "Team OS memory is connected but unavailable; refusing to use local PGLite silently. " +
        "Sign in again, or use --local / TEAM_OS_MEMORY_MODE=local for offline PGLite. " +
        `Reason: ${errorMessage(error)}`,
      "TEAM_MEMORY_UNAVAILABLE",
    );
  }
}

function savedTeamContextFromRoute(route) {
  if (!route || route.target !== "team" || !route.config) return null;
  const whoami = route.whoami && typeof route.whoami === "object" ? route.whoami : {};
  const teamId = idFromRecord(whoami.team || route.config.team);
  const userId = idFromRecord(whoami.user || route.config.user);
  if (!teamId || !userId) return null;
  return {
    config: route.config,
    teamId,
    userId,
    membership: whoami.membership || route.config.membership || null,
  };
}

function parseInclude(raw) {
  if (raw == null) return null;
  const parts = String(raw).split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length === 0) {
    throw new TeamMemoryRoutingError("--include must contain at least one visibility", "TEAM_MEMORY_INVALID_SCOPE");
  }
  for (const part of parts) {
    if (!VALID_VISIBILITIES.includes(part)) {
      throw new TeamMemoryRoutingError(
        `--include has invalid visibility "${part}" (allowed: ${VALID_VISIBILITIES.join(", ")})`,
        "TEAM_MEMORY_INVALID_SCOPE",
      );
    }
  }
  return parts;
}

function clientSlugFromCwd(rootDir, cwd) {
  if (!cwd) return null;
  const root = path.resolve(rootDir);
  const current = path.resolve(cwd);
  const rel = path.relative(root, current).replace(/\\/g, "/");
  if (rel === "" || rel.startsWith("../") || rel === ".." || path.isAbsolute(rel)) return null;
  const parts = rel.split("/").filter(Boolean);
  return parts[0] === "clients" && parts[1] ? parts[1] : null;
}

function buildTeamSearchScope(flags = {}, { rootDir, cwd = process.env.INIT_CWD || process.cwd() } = {}) {
  const explicitInclude = parseInclude(flags.include);
  const clientId = flags.client || (rootDir ? clientSlugFromCwd(rootDir, cwd) : null);
  const include = explicitInclude || ["system", "team", "private"];
  if (!explicitInclude && clientId) include.push("client");
  return {
    teamId: null,
    clientId: include.includes("client") ? clientId ?? null : null,
    userId: null,
    include,
  };
}

function isHashEmbedderRequestedForTeam(flags = {}, env = process.env) {
  const requested = flags.embedder != null ? flags.embedder : env.MEMORY_EMBEDDER;
  if (String(env.TEAM_OS_MEMORY_TEST_EMBEDDER ?? "").trim().toLowerCase() === "hash") {
    return false;
  }
  return String(requested ?? "").trim().toLowerCase() === "hash";
}

function assertTeamEmbedderAllowed(flags = {}, env = process.env) {
  if (!isHashEmbedderRequestedForTeam(flags, env)) return;
  throw new TeamMemoryRoutingError(
    "Team OS memory requires client-provided BGE-M3/1024 embeddings. Remove --embedder hash / MEMORY_EMBEDDER=hash, or use --local for offline PGLite.",
    "TEAM_MEMORY_HASH_EMBEDDER",
  );
}

module.exports = {
  TeamMemoryRoutingError,
  assertTeamEmbedderAllowed,
  buildTeamSearchScope,
  clientSlugFromCwd,
  normalizeMemoryMode,
  requestedMemoryMode,
  resolveTeamMemoryRoute,
  savedTeamContextFromRoute,
};
