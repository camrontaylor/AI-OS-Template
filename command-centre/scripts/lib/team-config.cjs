const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function configDir() {
  if (process.env.AI_OS_TEAM_CONFIG_DIR) {
    return path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR);
  }
  return path.join(os.homedir(), ".AI-OS");
}

function configPath() {
  return path.join(configDir(), "team-context.json");
}

function statusCachePath() {
  return path.join(configDir(), "team-status.json");
}

function loginRequiredMessage() {
  return "You are not logged in. Run: npm run team -- login --api-url <url> --email <email>";
}

function normalizeApiUrl(value) {
  const url = String(value ?? "").trim().replace(/\/+$/, "");
  if (!url) throw new Error("--api-url is required");
  if (!/^https?:\/\//i.test(url)) throw new Error("--api-url must start with http:// or https://");
  return url;
}

function writeConfig(config) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(
    configPath(),
    `${JSON.stringify({ ...config, version: 3, savedAt: new Date().toISOString() }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function readConfigOptional() {
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(), "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.apiUrl !== "string" || typeof parsed.token !== "string") return null;
    const apiUrl = parsed.apiUrl.trim().replace(/\/+$/, "");
    const token = parsed.token.trim();
    if (!/^https?:\/\//i.test(apiUrl) || token === "") return null;
    const savedTeamId = typeof parsed.team?.id === "string" ? parsed.team.id.trim() : "";
    return {
      ...parsed,
      apiUrl,
      token,
      serverId: typeof parsed.serverId === "string" ? parsed.serverId : null,
      selectedTeamId: typeof parsed.selectedTeamId === "string"
        ? parsed.selectedTeamId
        : savedTeamId || null,
      teams: Array.isArray(parsed.teams) ? parsed.teams : [],
    };
  } catch {
    return null;
  }
}

function isExpired(config) {
  return typeof config?.expiresAt === "string" && Date.parse(config.expiresAt) <= Date.now();
}

function readConfig() {
  const config = readConfigOptional();
  if (!config) throw new Error(loginRequiredMessage());
  if (isExpired(config)) {
    markTeamUnavailable(config, "Saved Team OS login expired. Sign in again.");
    throw new Error("Your saved Team OS login has expired. Run: npm run team -- login --api-url <url> --email <email>");
  }
  return config;
}

function clearConfig() {
  try {
    fs.rmSync(configPath(), { force: true });
  } catch {
    /* ignore */
  }
}

function clearStatusCache() {
  try {
    fs.rmSync(statusCachePath(), { force: true });
  } catch {
    /* ignore */
  }
}

function teamLabel(team) {
  if (!team || typeof team !== "object") return null;
  return team.slug || team.name || team.id || null;
}

function writeStatusCache(cache) {
  fs.mkdirSync(configDir(), { recursive: true });
  fs.writeFileSync(
    statusCachePath(),
    `${JSON.stringify({ version: 1, checkedAt: new Date().toISOString(), ...cache }, null, 2)}\n`,
    { mode: 0o600 },
  );
}

function readStatusCache() {
  try {
    const parsed = JSON.parse(fs.readFileSync(statusCachePath(), "utf-8"));
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function markTeamConnected(config, whoami = {}) {
  writeStatusCache({
    status: "connected",
    apiUrl: config.apiUrl,
    savedAt: config.savedAt ?? null,
    expiresAt: config.expiresAt ?? null,
    user: whoami.user ?? config.user ?? null,
    team: whoami.team ?? config.team ?? null,
    membership: whoami.membership ?? config.membership ?? null,
    label: teamLabel(whoami.team ?? config.team),
  });
}

function markTeamUnavailable(config, error) {
  if (!config) return;
  writeStatusCache({
    status: "unavailable",
    apiUrl: config.apiUrl,
    savedAt: config.savedAt ?? null,
    expiresAt: config.expiresAt ?? null,
    user: config.user ?? null,
    team: config.team ?? null,
    membership: config.membership ?? null,
    label: teamLabel(config.team),
    error: error instanceof Error ? error.message : String(error || "Team API unavailable"),
  });
}

function markTeamSignedOut() {
  writeStatusCache({ status: "signed_out", label: null });
}

module.exports = {
  clearConfig,
  clearStatusCache,
  configDir,
  configPath,
  isExpired,
  loginRequiredMessage,
  markTeamConnected,
  markTeamSignedOut,
  markTeamUnavailable,
  normalizeApiUrl,
  readConfig,
  readConfigOptional,
  readStatusCache,
  statusCachePath,
  teamLabel,
  writeConfig,
  writeStatusCache,
};
