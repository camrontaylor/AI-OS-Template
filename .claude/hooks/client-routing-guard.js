#!/usr/bin/env node
// UserPromptSubmit hook - warns before root-scoped work that looks client-specific.
//
// This hook is intentionally non-destructive. It discovers clients generically
// from clients/* and injects a hard-stop instruction when a root-session prompt
// clearly targets exactly one client. The assistant must then confirm scope
// before creating root memory, root projects, or root outputs for client work.

const fs = require("fs");
const path = require("path");

const GREETING_RE =
  /^(hi|hey|hello|yo|sup|gm|hiya|howdy|morning|good (morning|afternoon|evening)|hey there|hello there|what'?s up|whats up|ok|okay|thanks|thank you|ty)[\s!.?,]*$/i;
const ALL_CLIENTS_RE =
  /\b(all|every|each)\s+clients?\b|\bclients?\s+folders?\b|clients\/\*|\bevery\s+clients?\s+folders?\b/i;
const SHARED_SYSTEM_RE =
  /\b(ai-?os|template|root|shared|methodology|memory system|memsearch|migrate|migration|sync|all-client|multi-client|client folders?)\b/i;

function isGreetingOnly(prompt) {
  const cleaned = prompt.trim();
  return !cleaned || (cleaned.length <= 30 && GREETING_RE.test(cleaned));
}

function stripMachineContext(prompt) {
  return String(prompt || "")
    .replace(/<codex_internal_context[\s\S]*?<\/codex_internal_context>/gi, " ")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function findWorkspaceRoot(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 12; i++) {
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
  for (let i = 0; i < 12; i++) {
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
  return path.basename(path.dirname(root || "")) === "clients";
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

function discoverClients(root) {
  const clientsDir = path.join(root, "clients");
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
  const normalized = prompt.replace(/\\/g, "/");
  return new RegExp(`(^|[^a-z0-9_/])clients/${escapeRegExp(client.slug)}(/|[^a-z0-9_-]|$)`, "i").test(
    normalized
  );
}

function shouldSkipPrompt(prompt, client) {
  if (ALL_CLIENTS_RE.test(prompt)) return true;
  if (SHARED_SYSTEM_RE.test(prompt)) return true;
  if (explicitClientPath(prompt, client)) return true;
  return false;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const rawPrompt = data.prompt || data.message || "";
    const prompt = stripMachineContext(rawPrompt);
    const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

    if (isGreetingOnly(prompt)) return;

    const workspaceRoot = findWorkspaceRoot(cwd);
    const contextRoot = findContextRoot(cwd) || workspaceRoot;
    if (!workspaceRoot || isClientRoot(contextRoot)) return;

    const matches = discoverClients(workspaceRoot).filter((client) =>
      client.aliases.some((alias) => aliasMatches(prompt, alias))
    );
    if (matches.length !== 1) return;

    const client = matches[0];
    if (shouldSkipPrompt(prompt, client)) return;

    const relativeDir = `clients/${client.slug}`;
    const message =
      `AI-OS client routing hard stop: this prompt appears to target ` +
      `${client.displayName} (${relativeDir}) while the session is at the root. ` +
      `Before doing file edits, memory writes, project outputs, commits, or ` +
      `external actions, ask exactly one confirmation question: ` +
      `"This looks like ${client.displayName} work. Should I switch scope to ` +
      `${relativeDir}/ before proceeding?" If the user confirms, keep outputs, ` +
      `memory, learnings, and project files under ${relativeDir}/. If they say ` +
      `it is root/shared AI-OS work, proceed at the root.`;

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: message,
        },
      })
    );
  } catch {
    // Never block the prompt on hook failure.
  }
});

setTimeout(() => process.exit(0), 4000).unref();
