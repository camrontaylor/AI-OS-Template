const fs = require("fs");
const path = require("path");

const SYSTEM_PULL_ONLY_FILES = [
  "AGENTS.md",
  "CLAUDE.md",
  "context/SOUL.md",
];

const PRIVATE_SYNC_FILES = [
  "context/USER.md",
  "context/MEMORY.md",
  "context/learnings.md",
  "context/prompt-tags.md",
  "AGENTS.local.md",
  "CLAUDE.local.md",
];

const TEAM_CONTEXT_DIRS = [
  "team_context",
  "brand_context",
];

const SECRET_CONFIG_FILES = [
  ".mcp.json",
];

const EXCLUDED_DIRS = new Set([
  ".AI-OS",
  ".command-centre",
  ".git",
  ".memsearch",
  ".next",
  "backups",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "transcripts",
]);

const EXCLUDED_FILES = new Set([
  ".env",
  ".env.local",
  ".mcp.json",
]);

function posixJoin(...parts) {
  return parts.filter(Boolean).join("/").replace(/\\/g, "/");
}

function toAbs(root, relPath) {
  return path.join(root, ...relPath.split("/"));
}

function existsFile(root, relPath) {
  try {
    return fs.statSync(toAbs(root, relPath)).isFile();
  } catch {
    return false;
  }
}

function isSyncableTextFile(relPath) {
  const name = path.posix.basename(relPath);
  if (EXCLUDED_FILES.has(name) || name.startsWith(".env.")) return false;
  return name.endsWith(".md") || name.endsWith(".txt") || name.endsWith(".json");
}

function walkFiles(root, baseRel) {
  const base = toAbs(root, baseRel);
  if (!fs.existsSync(base)) return [];
  const out = [];
  function walk(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      const rel = path.relative(root, full).replace(/\\/g, "/");
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRS.has(entry.name)) walk(full);
        continue;
      }
      if (entry.isFile() && isSyncableTextFile(rel)) out.push(rel);
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

function listSkillLocalFiles(root) {
  const skillsRoot = path.join(root, ".claude", "skills");
  if (!fs.existsSync(skillsRoot)) return [];
  const out = [];
  for (const entry of fs.readdirSync(skillsRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const rel = posixJoin(".claude/skills", entry.name, "SKILL.local.md");
    if (existsFile(root, rel)) out.push(rel);
  }
  out.sort((a, b) => a.localeCompare(b));
  return out;
}

function inferKind(relPath) {
  const name = path.posix.basename(relPath);
  if (name === "AGENTS.md" || name === "CLAUDE.md" || name === "SOUL.md") return "agents";
  if (name === "USER.md") return "user";
  if (name === "MEMORY.md" || relPath.includes("/memory/")) return "memory";
  if (name === "learnings.md") return "learnings";
  if (relPath.includes("brand_context/")) return "brand";
  if (name === "prompt-tags.md" || name.endsWith(".local.md") || name === "preferences.md") {
    return "preferences";
  }
  return "other";
}

function buildContextImportItems(root) {
  const items = [];

  for (const relPath of PRIVATE_SYNC_FILES) {
    if (existsFile(root, relPath)) {
      items.push({ scope: "private", direction: "push-pull", visibility: "private", path: relPath });
    }
  }
  for (const relPath of listSkillLocalFiles(root)) {
    items.push({ scope: "private", direction: "push-pull", visibility: "private", path: relPath });
  }
  for (const baseRel of TEAM_CONTEXT_DIRS) {
    for (const relPath of walkFiles(root, baseRel)) {
      items.push({ scope: "team", direction: "push-pull", visibility: "team", path: relPath });
    }
  }
  for (const slug of clientSlugs(root)) {
    const agents = `clients/${slug}/AGENTS.md`;
    if (existsFile(root, agents)) {
      items.push({ scope: "client", direction: "push-pull", visibility: "client", client: slug, path: agents });
    }
    for (const relPath of walkFiles(root, `clients/${slug}/brand_context`)) {
      items.push({ scope: "client", direction: "push-pull", visibility: "client", client: slug, path: relPath });
    }
    for (const relPath of [`clients/${slug}/context/MEMORY.md`, `clients/${slug}/context/learnings.md`]) {
      if (existsFile(root, relPath)) {
        items.push({ scope: "client", direction: "push-pull", visibility: "client", client: slug, path: relPath });
      }
    }
  }

  return items.map((item) => ({
    ...item,
    abs: toAbs(root, item.path),
    kind: inferKind(item.path),
    snapshotEligible:
      item.visibility !== "private" ||
      item.path === "context/USER.md" ||
      item.path === "context/MEMORY.md",
  }));
}

const SYNC_REGISTRY = [
  ...SYSTEM_PULL_ONLY_FILES.map((pathName) => ({
    path: pathName,
    scope: "system",
    direction: "pull-only",
    snapshotEligible: true,
    conflictPolicy: pathName === "context/SOUL.md" ? "preserve-local" : "local-to-dot-local",
  })),
  ...PRIVATE_SYNC_FILES.map((pathName) => ({
    path: pathName,
    scope: "private",
    direction: "push-pull",
    snapshotEligible: pathName === "context/USER.md" || pathName === "context/MEMORY.md",
    conflictPolicy: "preserve-local-report",
  })),
  {
    path: ".claude/skills/*/SKILL.local.md",
    scope: "private",
    direction: "push-pull",
    snapshotEligible: false,
    conflictPolicy: "preserve-local-report",
  },
  ...TEAM_CONTEXT_DIRS.map((pathName) => ({
    path: `${pathName}/*`,
    scope: "team",
    direction: "pull-and-import",
    snapshotEligible: true,
    conflictPolicy: "server-wins",
  })),
  ...SECRET_CONFIG_FILES.map((pathName) => ({
    path: pathName,
    scope: "secret",
    direction: "encrypted-push-pull",
    snapshotEligible: false,
    conflictPolicy: "preserve-local-report",
  })),
];

module.exports = {
  SYSTEM_PULL_ONLY_FILES,
  PRIVATE_SYNC_FILES,
  TEAM_CONTEXT_DIRS,
  SECRET_CONFIG_FILES,
  SYNC_REGISTRY,
  buildContextImportItems,
  clientSlugs,
  existsFile,
  inferKind,
  listSkillLocalFiles,
  toAbs,
  walkFiles,
};
