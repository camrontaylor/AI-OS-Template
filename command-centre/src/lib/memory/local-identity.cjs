"use strict";

const crypto = require("node:crypto");
const fs = require("node:fs");
const path = require("node:path");

function localUserConfigPath(rootDir) {
  return path.join(rootDir, ".command-centre", "local-memory-user.json");
}

function legacyLocalUserConfigPath(rootDir) {
  return path.join(rootDir, ".command-centre", "memory", "local-user.json");
}

function readIdentityRecord(filePath) {
  let raw;
  try {
    raw = fs.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") return null;
    throw error;
  }

  try {
    // Windows PowerShell 5.1 writes a UTF-8 BOM by default. Accept it as a
    // transport marker; the JSON record itself is still validated strictly.
    const parsed = JSON.parse(raw.replace(/^\uFEFF/, ""));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.userId !== "string" ||
      !parsed.userId.trim()
    ) {
      throw new Error("missing a non-empty userId");
    }
    return { ...parsed, userId: parsed.userId.trim() };
  } catch (error) {
    throw new Error(
      `Invalid local memory identity at ${filePath}: ` +
        `${error instanceof Error ? error.message : String(error)}. ` +
        "Refusing to replace it automatically.",
    );
  }
}

function writeIdentityRecord(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
}

/**
 * Publish a fully-written identity without ever overwriting another process's
 * winner. The hard-link is the exclusive create operation; unlike opening the
 * destination with `wx`, a racing reader can never observe partial JSON.
 */
function writeIdentityRecordExclusive(filePath, record) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${crypto.randomBytes(6).toString("hex")}.tmp`,
  );
  try {
    fs.writeFileSync(tempPath, `${JSON.stringify(record, null, 2)}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    try {
      fs.linkSync(tempPath, filePath);
      return record;
    } catch (error) {
      if (!error || error.code !== "EEXIST") throw error;
      const winner = readIdentityRecord(filePath);
      if (!winner) {
        throw new Error(`Local memory identity disappeared during creation: ${filePath}`);
      }
      return winner;
    }
  } finally {
    fs.rmSync(tempPath, { force: true });
  }
}

function readLocalUserId(rootDir) {
  const record =
    readIdentityRecord(localUserConfigPath(rootDir)) ||
    readIdentityRecord(legacyLocalUserConfigPath(rootDir));
  return record ? record.userId.trim() : null;
}

function ensureLocalUserId(rootDir) {
  const filePath = localUserConfigPath(rootDir);
  const existing = readIdentityRecord(filePath);
  if (existing) return existing.userId.trim();

  const legacy = readIdentityRecord(legacyLocalUserConfigPath(rootDir));
  if (legacy) {
    return writeIdentityRecordExclusive(filePath, legacy).userId;
  }

  const userId = `local-${
    crypto.randomUUID ? crypto.randomUUID() : crypto.randomBytes(16).toString("hex")
  }`;
  return writeIdentityRecordExclusive(filePath, {
    version: 1,
    userId,
    createdAt: new Date().toISOString(),
  }).userId;
}

module.exports = {
  ensureLocalUserId,
  legacyLocalUserConfigPath,
  localUserConfigPath,
  readIdentityRecord,
  readLocalUserId,
  writeIdentityRecord,
};
