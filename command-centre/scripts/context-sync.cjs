#!/usr/bin/env node
/**
 * context-sync — syncs Team OS context between the server and this workspace.
 *
 * System/team files are pulled from the server. Private user files sync both
 * ways with hash metadata. .mcp.json uses the encrypted user-config-file route.
 */

const crypto = require("crypto");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const {
  PRIVATE_SYNC_FILES,
  SYSTEM_PULL_ONLY_FILES,
  TEAM_CONTEXT_DIRS,
  listSkillLocalFiles,
  toAbs,
} = require("./context-sync-registry.cjs");

let activeProfileKey = null;

function readMaterializedOwner(root, relPath) {
  try {
    const registry = JSON.parse(fs.readFileSync(path.join(root, ".command-centre", "materialized-ownership-v1.json"), "utf8"));
    const normalized = relPath.replace(/\\/g, "/");
    return registry?.version === 1 && registry.files && typeof registry.files === "object"
      ? registry.files[normalized] || null
      : null;
  } catch {
    return null;
  }
}

function assertMaterializedWriteAccess(root, relPath) {
  const owner = readMaterializedOwner(root, relPath);
  if (owner && owner.profileKey !== activeProfileKey) {
    throw new Error("A synced local file belongs to another signed-in profile");
  }
}

function parseArgs(argv) {
  const flags = {
    cwd: process.cwd(),
    dryRun: false,
    pullOnly: false,
    quiet: false,
    mcp: true,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") flags.cwd = argv[++i] || flags.cwd;
    else if (arg === "--dry-run") flags.dryRun = true;
    else if (arg === "--pull-only") flags.pullOnly = true;
    else if (arg === "--quiet") flags.quiet = true;
    else if (arg === "--no-mcp") flags.mcp = false;
    else if (arg === "--help" || arg === "-h") flags.help = true;
  }
  return flags;
}

function configDir() {
  return process.env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(process.env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
}

function readTeamContext() {
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(configDir(), "team-context.json"), "utf8"));
    const apiUrl = typeof parsed.apiUrl === "string" ? parsed.apiUrl.trim().replace(/\/+$/, "") : "";
    const token = typeof parsed.token === "string" ? parsed.token.trim() : "";
    if (!/^https?:\/\//i.test(apiUrl) || token === "") return null;
    if (typeof parsed.expiresAt === "string" && Date.parse(parsed.expiresAt) <= Date.now()) return null;
    const serverId = typeof parsed.serverId === "string" ? parsed.serverId.trim() : "";
    const userId = parsed.user && typeof parsed.user.id === "string" ? parsed.user.id.trim() : "";
    const profileKey = serverId && userId
      ? sha256(`team-os-profile:v1\n${serverId}\n${userId}`)
      : null;
    return { apiUrl, token, serverId, userId, profileKey };
  } catch {
    return null;
  }
}

function statePath(root) {
  return path.join(root, ".AI-OS", "context-sync", "state.json");
}

function readState(root) {
  try {
    const parsed = JSON.parse(fs.readFileSync(statePath(root), "utf8"));
    return parsed && typeof parsed === "object" && parsed.files && typeof parsed.files === "object"
      ? parsed
      : { version: 1, files: {} };
  } catch {
    return { version: 1, files: {} };
  }
}

function writeState(root, state, dryRun) {
  if (dryRun) return;
  const filePath = statePath(root);
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(state, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
}

function writeMaterializedOwnership(root, config, state, dryRun) {
  if (dryRun || !config.profileKey || !config.serverId || !config.userId) return;
  const registryFile = path.join(root, ".command-centre", "materialized-ownership-v1.json");
  let registry = { version: 1, files: {} };
  try {
    const parsed = JSON.parse(fs.readFileSync(registryFile, "utf8"));
    if (parsed?.version === 1 && parsed.files && typeof parsed.files === "object") registry = parsed;
  } catch {}
  const now = new Date().toISOString();
  for (const [key, value] of Object.entries(state.files)) {
    const separator = key.indexOf(":");
    if (separator < 1) continue;
    const visibility = key.slice(0, separator);
    if (!new Set(["team", "private", "secret"]).has(visibility)) continue;
    const relativePath = key.slice(separator + 1).replace(/\\/g, "/");
    const fullPath = toAbs(root, relativePath);
    if (!fs.existsSync(fullPath) || !fs.statSync(fullPath).isFile()) continue;
    registry.files[relativePath] = {
      version: 1,
      relativePath,
      profileKey: config.profileKey,
      identityDigest: sha256(`materialized-owner:v1\n${config.serverId}\n${config.userId}`),
      scope: visibility === "team" ? "team" : visibility === "secret" ? "config" : "private",
      kind: visibility === "secret" ? "user-config" : "context-sync",
      contentSha256: sha256(fs.readFileSync(fullPath)),
      updatedAt: now,
    };
  }
  fs.mkdirSync(path.dirname(registryFile), { recursive: true });
  const temporary = `${registryFile}.${process.pid}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(registry, null, 2)}\n`, { mode: 0o600 });
  fs.renameSync(temporary, registryFile);
}

function sha256(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function readLocal(root, relPath) {
  const owner = readMaterializedOwner(root, relPath);
  if (owner && owner.profileKey !== activeProfileKey) return null;
  const abs = toAbs(root, relPath);
  if (!fs.existsSync(abs)) return null;
  return fs.readFileSync(abs, "utf8");
}

function writeLocal(root, relPath, content, dryRun) {
  if (dryRun) return;
  assertMaterializedWriteAccess(root, relPath);
  const abs = toAbs(root, relPath);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, content, "utf8");
}

function writeConflictCopy(root, relPath, content, dryRun) {
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const safeName = relPath.replace(/[\\/]/g, "__");
  const conflictRel = `.AI-OS/context-sync/conflicts/${stamp}-${safeName}`;
  writeLocal(root, conflictRel, content, dryRun);
  return conflictRel;
}

function log(flags, message) {
  if (!flags.quiet) console.log(message);
}

async function teamFetch(config, pathname, options = {}) {
  const headers = { authorization: `Bearer ${config.token}` };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  const response = await fetch(`${config.apiUrl}${pathname}`, {
    method: options.method || "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
    signal: AbortSignal.timeout(10000),
    cache: "no-store",
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = body && typeof body === "object" && body.error && typeof body.error === "object"
      ? body.error
      : {};
    const err = new Error(
      typeof error.message === "string"
        ? error.message
        : `Team OS request failed (${response.status})`,
    );
    err.status = response.status;
    err.code = typeof error.code === "string" ? error.code : undefined;
    throw err;
  }
  return body;
}

async function listDocs(config, visibility) {
  const params = new URLSearchParams({ visibility });
  const body = await teamFetch(config, `/v1/context/documents?${params.toString()}`);
  const docs = Array.isArray(body.documents) ? body.documents : [];
  const out = new Map();
  for (const doc of docs) {
    if (!doc || typeof doc !== "object") continue;
    if (typeof doc.path !== "string" || typeof doc.content !== "string") continue;
    out.set(doc.path, {
      path: doc.path,
      content: doc.content,
      sha256: typeof doc.sha256 === "string" ? doc.sha256 : sha256(doc.content),
      updatedAt: typeof doc.updatedAt === "string" ? doc.updatedAt : null,
      kind: typeof doc.kind === "string" ? doc.kind : "other",
    });
  }
  return out;
}

async function putDoc(config, item, expectedSha256, dryRun) {
  if (dryRun) return;
  const body = {
    visibility: item.visibility,
    path: item.path,
    kind: item.kind || "other",
    content: item.content,
    ...(item.client ? { client: item.client } : {}),
    ...(expectedSha256 ? { expectedSha256 } : {}),
  };
  await teamFetch(config, "/v1/context/document", { method: "PUT", body });
}

function privateDocPaths(root, serverDocs) {
  const out = new Set(PRIVATE_SYNC_FILES);
  for (const relPath of listSkillLocalFiles(root)) out.add(relPath);
  for (const relPath of serverDocs.keys()) {
    if (
      PRIVATE_SYNC_FILES.includes(relPath) ||
      /^\.claude\/skills\/[^/]+\/SKILL\.local\.md$/.test(relPath)
    ) {
      out.add(relPath);
    }
  }
  return Array.from(out).sort((a, b) => a.localeCompare(b));
}

function stateKey(visibility, relPath) {
  return `${visibility}:${relPath}`;
}

async function syncSystemDocs(root, config, state, flags, report) {
  const serverDocs = await listDocs(config, "system");
  for (const relPath of SYSTEM_PULL_ONLY_FILES) {
    const remote = serverDocs.get(relPath);
    if (!remote) continue;
    const local = readLocal(root, relPath);
    if (local === remote.content) {
      state.files[stateKey("system", relPath)] = {
        sha256: remote.sha256,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      continue;
    }

    if (relPath === "context/SOUL.md" && local != null) {
      report.conflicts.push(`${relPath} changed locally and on the server; kept the local file.`);
      continue;
    }

    if ((relPath === "AGENTS.md" || relPath === "CLAUDE.md") && local != null) {
      const localRel = relPath === "AGENTS.md" ? "AGENTS.local.md" : "CLAUDE.local.md";
      if (readLocal(root, localRel) == null) {
        writeLocal(root, localRel, local, flags.dryRun);
        report.pulled.push(`${relPath} pulled; previous local content saved to ${localRel}`);
      } else {
        const conflictRel = writeConflictCopy(root, relPath, local, flags.dryRun);
        report.conflicts.push(`${relPath} pulled; previous local content saved to ${conflictRel}`);
      }
    } else {
      report.pulled.push(`${relPath} pulled from server`);
    }

    writeLocal(root, relPath, remote.content, flags.dryRun);
    state.files[stateKey("system", relPath)] = {
      sha256: remote.sha256,
      serverSha256: remote.sha256,
      syncedAt: new Date().toISOString(),
    };
  }
}

async function pullTeamDocs(root, config, state, flags, report) {
  const serverDocs = await listDocs(config, "team");
  for (const remote of serverDocs.values()) {
    if (!TEAM_CONTEXT_DIRS.some((dir) => remote.path.startsWith(`${dir}/`))) continue;

    const local = readLocal(root, remote.path);
    const localSha = local == null ? null : sha256(local);
    const last = state.files[stateKey("team", remote.path)] || null;
    const lastSha = typeof last?.sha256 === "string" ? last.sha256 : null;

    if (local == null) {
      writeLocal(root, remote.path, remote.content, flags.dryRun);
      state.files[stateKey("team", remote.path)] = {
        sha256: remote.sha256,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      report.pulled.push(`${remote.path} pulled from team context`);
      continue;
    }

    if (localSha === remote.sha256) {
      state.files[stateKey("team", remote.path)] = {
        sha256: localSha,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      continue;
    }

    // Local content matches what we last pulled — only the server moved, safe to pull.
    if (lastSha != null && localSha === lastSha) {
      writeLocal(root, remote.path, remote.content, flags.dryRun);
      state.files[stateKey("team", remote.path)] = {
        sha256: remote.sha256,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      report.pulled.push(`${remote.path} pulled from team context`);
      continue;
    }

    // Local has edits this sync never saw. Team docs are pull-only here (they
    // push via the dashboard), so the server still wins, but local work is
    // never silently destroyed — it's preserved as a conflict copy first.
    const conflictRel = writeConflictCopy(root, remote.path, local, flags.dryRun);
    writeLocal(root, remote.path, remote.content, flags.dryRun);
    state.files[stateKey("team", remote.path)] = {
      sha256: remote.sha256,
      serverSha256: remote.sha256,
      syncedAt: new Date().toISOString(),
    };
    report.conflicts.push(`${remote.path} has local edits; server version pulled, local content saved to ${conflictRel}`);
  }
}

async function syncPrivateDocs(root, config, state, flags, report) {
  const serverDocs = await listDocs(config, "private");
  for (const relPath of privateDocPaths(root, serverDocs)) {
    const remote = serverDocs.get(relPath) || null;
    const local = readLocal(root, relPath);
    const localSha = local == null ? null : sha256(local);
    const last = state.files[stateKey("private", relPath)] || null;
    const lastSha = typeof last?.sha256 === "string" ? last.sha256 : null;
    const lastServerSha = typeof last?.serverSha256 === "string" ? last.serverSha256 : lastSha;

    if (local == null && !remote) continue;

    if (local == null && remote) {
      writeLocal(root, relPath, remote.content, flags.dryRun);
      state.files[stateKey("private", relPath)] = {
        sha256: remote.sha256,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      report.pulled.push(`${relPath} pulled from private context`);
      continue;
    }

    if (local != null && !remote) {
      if (!flags.pullOnly) {
        await putDoc(config, {
          visibility: "private",
          path: relPath,
          kind: inferKindForSync(relPath),
          content: local,
        }, null, flags.dryRun);
        state.files[stateKey("private", relPath)] = {
          sha256: localSha,
          serverSha256: localSha,
          syncedAt: new Date().toISOString(),
        };
        report.pushed.push(`${relPath} pushed as private context`);
      }
      continue;
    }

    if (localSha === remote.sha256) {
      state.files[stateKey("private", relPath)] = {
        sha256: localSha,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      continue;
    }

    if (!lastSha) {
      report.conflicts.push(`${relPath} differs locally and on the server; kept the local file.`);
      continue;
    }

    const localChanged = localSha !== lastSha;
    const serverChanged = remote.sha256 !== lastServerSha;
    if (!localChanged && serverChanged) {
      writeLocal(root, relPath, remote.content, flags.dryRun);
      state.files[stateKey("private", relPath)] = {
        sha256: remote.sha256,
        serverSha256: remote.sha256,
        syncedAt: new Date().toISOString(),
      };
      report.pulled.push(`${relPath} pulled from private context`);
    } else if (localChanged && !serverChanged && !flags.pullOnly) {
      await putDoc(config, {
        visibility: "private",
        path: relPath,
        kind: inferKindForSync(relPath),
        content: local,
      }, remote.sha256, flags.dryRun);
      state.files[stateKey("private", relPath)] = {
        sha256: localSha,
        serverSha256: localSha,
        syncedAt: new Date().toISOString(),
      };
      report.pushed.push(`${relPath} pushed as private context`);
    } else {
      report.conflicts.push(`${relPath} changed locally and on the server; kept the local file.`);
    }
  }
}

function inferKindForSync(relPath) {
  const name = path.posix.basename(relPath);
  if (name === "AGENTS.md" || name === "CLAUDE.md" || name === "SOUL.md") return "agents";
  if (name === "USER.md") return "user";
  if (name === "MEMORY.md") return "memory";
  if (name === "learnings.md") return "learnings";
  if (relPath.includes("brand_context/")) return "brand";
  if (name === "prompt-tags.md" || name.endsWith(".local.md")) return "preferences";
  return "other";
}

async function fetchRemoteMcp(config) {
  const params = new URLSearchParams({ path: ".mcp.json" });
  const body = await teamFetch(config, `/v1/user/config-file?${params.toString()}`);
  return body && typeof body === "object" && body.file && typeof body.file === "object"
    ? body.file
    : null;
}

async function writeRemoteMcp(config, content, expectedSha256, dryRun) {
  if (dryRun) return;
  await teamFetch(config, "/v1/user/config-file", {
    method: "PUT",
    body: {
      path: ".mcp.json",
      content,
      ...(expectedSha256 ? { expectedSha256 } : {}),
    },
  });
}

async function syncMcp(root, config, state, flags, report) {
  if (!flags.mcp) return;
  let remote = null;
  try {
    remote = await fetchRemoteMcp(config);
  } catch (error) {
    if (error.code === "secret_crypto_unavailable") {
      report.skipped.push(".mcp.json remote backup disabled: server secret key env vars are not configured.");
      return;
    }
    report.skipped.push(`.mcp.json remote backup skipped: ${error.message}`);
    return;
  }

  const relPath = ".mcp.json";
  const local = readLocal(root, relPath);
  const localSha = local == null ? null : sha256(local);
  const remoteSha = remote && typeof remote.sha256 === "string" ? remote.sha256 : null;
  const last = state.files[stateKey("secret", relPath)] || null;
  const lastSha = typeof last?.sha256 === "string" ? last.sha256 : null;
  const lastServerSha = typeof last?.serverSha256 === "string" ? last.serverSha256 : lastSha;

  if (local == null && !remote) return;

  if (local == null && remote && typeof remote.content === "string") {
    writeLocal(root, relPath, remote.content, flags.dryRun);
    state.files[stateKey("secret", relPath)] = {
      sha256: remoteSha,
      serverSha256: remoteSha,
      syncedAt: new Date().toISOString(),
    };
    report.pulled.push(".mcp.json restored from encrypted server backup");
    return;
  }

  if (local != null && !remote) {
    if (!flags.pullOnly) {
      try {
        await writeRemoteMcp(config, local, null, flags.dryRun);
        state.files[stateKey("secret", relPath)] = {
          sha256: localSha,
          serverSha256: localSha,
          syncedAt: new Date().toISOString(),
        };
        report.pushed.push(".mcp.json backed up to encrypted server storage");
      } catch (error) {
        report.skipped.push(`.mcp.json remote backup skipped: ${error.message}`);
      }
    }
    return;
  }

  if (localSha === remoteSha) {
    state.files[stateKey("secret", relPath)] = {
      sha256: localSha,
      serverSha256: remoteSha,
      syncedAt: new Date().toISOString(),
    };
    return;
  }

  if (!lastSha) {
    report.conflicts.push(".mcp.json differs locally and on the server; kept the local file.");
    return;
  }

  const localChanged = localSha !== lastSha;
  const serverChanged = remoteSha !== lastServerSha;
  if (!localChanged && serverChanged && typeof remote.content === "string") {
    writeLocal(root, relPath, remote.content, flags.dryRun);
    state.files[stateKey("secret", relPath)] = {
      sha256: remoteSha,
      serverSha256: remoteSha,
      syncedAt: new Date().toISOString(),
    };
    report.pulled.push(".mcp.json restored from encrypted server backup");
  } else if (localChanged && !serverChanged && !flags.pullOnly) {
    try {
      await writeRemoteMcp(config, local, remoteSha, flags.dryRun);
      state.files[stateKey("secret", relPath)] = {
        sha256: localSha,
        serverSha256: localSha,
        syncedAt: new Date().toISOString(),
      };
      report.pushed.push(".mcp.json backed up to encrypted server storage");
    } catch (error) {
      report.skipped.push(`.mcp.json remote backup skipped: ${error.message}`);
    }
  } else {
    report.conflicts.push(".mcp.json changed locally and on the server; kept the local file.");
  }
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log("Usage: node scripts/context-sync.cjs [--cwd <path>] [--dry-run] [--pull-only] [--quiet] [--no-mcp]");
    return;
  }
  const config = readTeamContext();
  if (!config) throw new Error("Sign in to Team OS first: npm run team login");
  activeProfileKey = config.profileKey;
  const root = findWorkspaceRoot(flags.cwd);
  const state = readState(root);
  const report = { pulled: [], pushed: [], conflicts: [], skipped: [] };

  await syncSystemDocs(root, config, state, flags, report);
  await pullTeamDocs(root, config, state, flags, report);
  await syncPrivateDocs(root, config, state, flags, report);
  await syncMcp(root, config, state, flags, report);
  writeState(root, state, flags.dryRun);
  writeMaterializedOwnership(root, config, state, flags.dryRun);

  log(flags, `Context sync complete: ${report.pulled.length} pulled, ${report.pushed.length} pushed, ${report.conflicts.length} conflict(s), ${report.skipped.length} skipped.`);
  for (const item of report.conflicts) log(flags, `Conflict: ${item}`);
  for (const item of report.skipped) log(flags, `Skipped: ${item}`);
}

main().catch((error) => {
  console.error(`context-sync failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
