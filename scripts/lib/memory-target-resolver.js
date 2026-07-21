#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const ALL_CLIENTS_RE =
  /\b(all|every|each)\s+clients?\b|\bclients?\s+folders?\b|clients\/\*|\bevery\s+clients?\s+folders?\b/i;
const SHARED_SYSTEM_RE =
  /\b(ai-?os|template|root|shared|methodology|memory system|memsearch|migrate|migration|sync|all-client|multi-client|client folders?)\b/i;

function stripMachineContext(prompt) {
  return String(prompt || "")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findWorkspaceRoot(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 16; i += 1) {
    if (
      fs.existsSync(path.join(dir, "AGENTS.md")) &&
      fs.existsSync(path.join(dir, ".claude")) &&
      fs.existsSync(path.join(dir, "clients"))
    ) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function findContextRoot(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 16; i += 1) {
    const hasContext = fs.existsSync(path.join(dir, "context"));
    const hasInstructions =
      fs.existsSync(path.join(dir, "AGENTS.md")) ||
      fs.existsSync(path.join(dir, "CLAUDE.md"));
    if (hasContext && hasInstructions) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function isClientRoot(root) {
  return Boolean(root) && path.basename(path.dirname(root)) === "clients";
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function aliasMatches(prompt, alias) {
  const cleaned = alias.trim().toLowerCase();
  if (!cleaned || cleaned.length < 3) return false;
  const pattern = escapeRegExp(cleaned).replace(/[-\s]+/g, "[-\\s]+");
  return new RegExp(`(^|[^a-z0-9])${pattern}([^a-z0-9]|$)`, "i").test(prompt);
}

function clientAliases(slug, displayName) {
  const aliases = new Set([slug, slug.replace(/-/g, " "), displayName]);
  const words = displayName
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
  if (words.length > 1) {
    aliases.add(words.map((word) => word[0]).join(""));
    if (words[words.length - 1] === "af") {
      aliases.add(`${words.slice(0, -1).map((word) => word[0]).join("")}f`);
    }
  }
  return [...aliases].filter(Boolean);
}

function clientDisplayName(clientDir) {
  const agentsPath = path.join(clientDir, "AGENTS.md");
  try {
    const firstLine = fs.readFileSync(agentsPath, "utf8").split(/\r?\n/, 1)[0] || "";
    return firstLine.replace(/^# Client:\s*/, "").trim() || path.basename(clientDir);
  } catch {
    return path.basename(clientDir);
  }
}

function discoverClients(workspaceRoot) {
  const clientsDir = path.join(workspaceRoot, "clients");
  try {
    return fs
      .readdirSync(clientsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => {
        const dir = path.join(clientsDir, entry.name);
        const displayName = clientDisplayName(dir);
        return {
          slug: entry.name,
          displayName,
          dir,
          aliases: clientAliases(entry.name, displayName),
        };
      })
      .filter((client) => fs.existsSync(path.join(client.dir, "context")));
  } catch {
    return [];
  }
}

function explicitClientPath(prompt, client) {
  const normalized = String(prompt || "").replace(/\\/g, "/");
  return new RegExp(
    `(^|[^a-z0-9_/])clients/${escapeRegExp(client.slug)}(/|[^a-z0-9_-]|$)`,
    "i"
  ).test(normalized);
}

function resolveMemoryTarget(options = {}) {
  const cwd = options.cwd || process.cwd();
  const prompt = stripMachineContext(options.prompt || options.message || "");
  const workspaceRoot = findWorkspaceRoot(cwd);
  const contextRoot = findContextRoot(cwd) || workspaceRoot;

  if (!workspaceRoot || !contextRoot) {
    return {
      targetType: "unknown",
      reason: "workspace root not found",
      cwd,
      prompt,
      workspaceRoot,
      contextRoot,
      targetRoot: null,
      client: null,
      matches: [],
    };
  }

  const clients = discoverClients(workspaceRoot);
  const currentClient = isClientRoot(contextRoot)
    ? clients.find((client) => path.resolve(client.dir) === path.resolve(contextRoot)) || null
    : null;
  const explicitMatches = clients.filter((client) => explicitClientPath(prompt, client));
  const aliasMatchesList = clients.filter((client) =>
    client.aliases.some((alias) => aliasMatches(prompt, alias))
  );
  const matches = explicitMatches.length > 0 ? explicitMatches : aliasMatchesList;
  const allClients = ALL_CLIENTS_RE.test(prompt);
  const sharedSystem = SHARED_SYSTEM_RE.test(prompt);

  if (allClients || sharedSystem) {
    return {
      targetType: "root",
      reason: allClients ? "all clients prompt" : "shared system prompt",
      cwd,
      prompt,
      workspaceRoot,
      contextRoot,
      targetRoot: workspaceRoot,
      client: null,
      matches,
    };
  }

  if (explicitMatches.length === 1) {
    return {
      targetType: "client",
      reason: "explicit client path",
      cwd,
      prompt,
      workspaceRoot,
      contextRoot,
      targetRoot: explicitMatches[0].dir,
      client: explicitMatches[0],
      matches: explicitMatches,
    };
  }

  if (currentClient) {
    return {
      targetType: "client",
      reason: "current client workspace",
      cwd,
      prompt,
      workspaceRoot,
      contextRoot,
      targetRoot: currentClient.dir,
      client: currentClient,
      matches,
    };
  }

  if (matches.length === 1) {
    return {
      targetType: "client",
      reason: "single client mention",
      cwd,
      prompt,
      workspaceRoot,
      contextRoot,
      targetRoot: matches[0].dir,
      client: matches[0],
      matches,
    };
  }

  if (matches.length > 1) {
    return {
      targetType: "ambiguous",
      reason: "multiple client mentions",
      cwd,
      prompt,
      workspaceRoot,
      contextRoot,
      targetRoot: null,
      client: null,
      matches,
    };
  }

  return {
    targetType: "root",
    reason: "root workspace default",
    cwd,
    prompt,
    workspaceRoot,
    contextRoot,
    targetRoot: workspaceRoot,
    client: null,
    matches: [],
  };
}

function serializable(result) {
  return {
    ...result,
    workspaceRoot: result.workspaceRoot,
    contextRoot: result.contextRoot,
    targetRoot: result.targetRoot,
    client: result.client
      ? {
          slug: result.client.slug,
          displayName: result.client.displayName,
          dir: result.client.dir,
        }
      : null,
    matches: (result.matches || []).map((client) => ({
      slug: client.slug,
      displayName: client.displayName,
      dir: client.dir,
    })),
  };
}

if (require.main === module) {
  const args = process.argv.slice(2);
  let cwd = process.cwd();
  let prompt = "";
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--cwd") {
      cwd = args[index + 1] || cwd;
      index += 1;
      continue;
    }
    if (arg === "--prompt") {
      prompt = args[index + 1] || "";
      index += 1;
      continue;
    }
  }
  process.stdout.write(`${JSON.stringify(serializable(resolveMemoryTarget({ cwd, prompt })), null, 2)}\n`);
}

module.exports = {
  ALL_CLIENTS_RE,
  SHARED_SYSTEM_RE,
  aliasMatches,
  clientAliases,
  discoverClients,
  explicitClientPath,
  findContextRoot,
  findWorkspaceRoot,
  isClientRoot,
  resolveMemoryTarget,
  stripMachineContext,
};
