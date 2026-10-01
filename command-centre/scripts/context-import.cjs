#!/usr/bin/env node
/**
 * context-import — imports existing AI-OS Markdown context into Team OS.
 *
 * Uses the Team OS API instead of direct DB writes, so normal server-side
 * permissions, conflict checks, and audits still apply.
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const { buildContextImportItems } = require("./context-sync-registry.cjs");

const TEXT_EXTENSIONS = new Set([".md", ".local.md", ".txt"]);
const EXCLUDED_DIRS = new Set([
  ".AI-OS",
  ".command-centre",
  ".git",
  ".memsearch",
  "backups",
  "build",
  "dist",
  "node_modules",
  "transcripts",
]);
const EXCLUDED_FILES = new Set([".env", ".env.local", ".mcp.json"]);

function parseArgs(argv) {
  const flags = { cwd: process.cwd(), dryRun: false };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--cwd") flags.cwd = argv[++i] || flags.cwd;
    else if (arg === "--dry-run") flags.dryRun = true;
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
    return { apiUrl, token };
  } catch {
    return null;
  }
}

function isTextContextFile(relPath) {
  const name = path.posix.basename(relPath);
  if (EXCLUDED_FILES.has(name) || name.startsWith(".env.")) return false;
  const ext = path.posix.extname(relPath).toLowerCase();
  return TEXT_EXTENSIONS.has(ext) || name === "AGENTS.md";
}

function walkFiles(root, baseRel) {
  const base = path.join(root, ...baseRel.split("/").filter(Boolean));
  if (!fs.existsSync(base)) return [];
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(full);
      } else if (entry.isFile() && isTextContextFile(rel)) {
        out.push(rel);
      }
    }
  }
  walk(base);
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function clientSlugs(root) {
  const clientsRoot = path.join(root, "clients");
  if (!fs.existsSync(clientsRoot)) return [];
  return fs.readdirSync(clientsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b));
}

function inferKind(relPath) {
  const name = path.posix.basename(relPath);
  if (name === "AGENTS.md" || name === "CLAUDE.md" || name === "SOUL.md") return "agents";
  if (name === "USER.md") return "user";
  if (name === "MEMORY.md" || relPath.includes("/memory/")) return "memory";
  if (name === "learnings.md") return "learnings";
  if (relPath.includes("brand_context/")) return "brand";
  if (name === "preferences.md" || name === "prompt-tags.md" || name.endsWith(".local.md")) return "preferences";
  return "other";
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
    throw new Error(
      typeof error.message === "string"
        ? error.message
        : `Team OS request failed (${response.status})`,
    );
  }
  return body;
}

async function currentShaByPath(config, visibility, client) {
  const params = new URLSearchParams({ visibility });
  if (client) params.set("client", client);
  const body = await teamFetch(config, `/v1/context/documents?${params.toString()}`);
  const docs = Array.isArray(body.documents) ? body.documents : [];
  const out = new Map();
  for (const doc of docs) {
    if (doc && typeof doc === "object" && typeof doc.path === "string" && typeof doc.sha256 === "string") {
      out.set(doc.path, doc.sha256);
    }
  }
  return out;
}

async function putDocument(config, item, existingSha, dryRun) {
  const content = fs.readFileSync(item.abs, "utf8");
  const body = {
    visibility: item.visibility,
    path: item.path,
    kind: inferKind(item.path),
    content,
    ...(item.client ? { client: item.client } : {}),
    ...(existingSha ? { expectedSha256: existingSha } : {}),
  };
  if (dryRun) {
    console.log(`[dry-run] ${item.visibility} ${item.path}`);
    return;
  }
  await teamFetch(config, "/v1/context/document", { method: "PUT", body });
  console.log(`Imported ${item.visibility} ${item.path}`);
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.help) {
    console.log("Usage: node scripts/context-import.cjs [--cwd <path>] [--dry-run]");
    return;
  }
  const config = readTeamContext();
  if (!config) throw new Error("Sign in to Team OS first: npm run team login");
  const root = findWorkspaceRoot(flags.cwd);

  const items = buildContextImportItems(root);

  const cache = new Map();
  for (const item of items) {
    const key = `${item.visibility}:${item.client || ""}`;
    if (!cache.has(key)) {
      cache.set(key, await currentShaByPath(config, item.visibility, item.client || null));
    }
    await putDocument(config, item, cache.get(key).get(item.path), flags.dryRun);
  }
  console.log(`Context import complete: ${items.length} file(s) processed.`);
}

main().catch((error) => {
  console.error(`context-import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
