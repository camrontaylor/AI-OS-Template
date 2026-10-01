"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

function teamContextPath() {
  const configDir = process.env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
  return path.join(configDir, "team-context.json");
}

function resolveLocalRuntimeProfile(aiOsDir) {
  const dataDir = path.join(aiOsDir, ".command-centre");
  const contextPath = teamContextPath();
  if (!fs.existsSync(contextPath)) {
    return Object.freeze({
      version: 1,
      mode: "solo",
      profileKey: "solo",
      dbPath: path.join(dataDir, "data.db"),
    });
  }

  let context;
  try {
    context = JSON.parse(fs.readFileSync(contextPath, "utf8"));
  } catch {
    throw new Error("The saved Team OS login is unavailable for cron execution.");
  }
  const serverId = typeof context?.serverId === "string" ? context.serverId : "";
  const userId = typeof context?.user?.id === "string" ? context.user.id : "";
  const token = typeof context?.token === "string" ? context.token.trim() : "";
  if (!serverId || serverId !== serverId.trim() || !userId || userId !== userId.trim() || !token) {
    throw new Error("The saved Team OS identity is unavailable for cron execution.");
  }
  const profileKey = crypto
    .createHash("sha256")
    .update(`team-os-profile:v1\n${serverId}\n${userId}`, "utf8")
    .digest("hex");
  return Object.freeze({
    version: 1,
    mode: "team",
    profileKey,
    dbPath: path.join(dataDir, "profiles", profileKey, "data.db"),
  });
}

module.exports = { resolveLocalRuntimeProfile };
