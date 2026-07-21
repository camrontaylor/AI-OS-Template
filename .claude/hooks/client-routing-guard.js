#!/usr/bin/env node
// UserPromptSubmit hook - scope declaration for root-scoped work that looks client-specific.
//
// This hook is intentionally non-destructive. It discovers clients generically
// from clients/* and, when a root-session prompt clearly targets exactly one
// client, injects a scope-declaration instruction. Per Agency Discipline
// (AGENTS.md), the assistant does NOT stop to ask: it states the scope in one
// line and proceeds under the client scope by default, correctable in one line.
// It only pauses first if the target is genuinely ambiguous or the action is
// irreversible or outward-facing.

const fs = require("fs");
const path = require("path");
const {
  findContextRoot,
  findWorkspaceRoot,
  isClientRoot,
  resolveMemoryTarget,
  stripMachineContext,
} = require(path.join(__dirname, "..", "..", "scripts", "lib", "memory-target-resolver.js"));

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

    const target = resolveMemoryTarget({ cwd, prompt });
    if (target.targetType !== "client" || target.reason !== "single client mention") return;

    const client = target.client;
    const relativeDir = `clients/${client.slug}`;
    const message =
      `AI-OS client routing (Agency Discipline): this prompt appears to target ` +
      `${client.displayName} (${relativeDir}) while the session is at the root. ` +
      `Do not stop to ask. State the scope in one line and proceed under the ` +
      `client scope by default: "Reading this as ${client.displayName} work, ` +
      `working under ${relativeDir}/ - say so if this is root/shared." Keep ` +
      `outputs, memory, learnings, and project files under ${relativeDir}/, ` +
      `correctable in one line. Only pause to ask first if the target is ` +
      `genuinely ambiguous or the action is irreversible or outward-facing.`;

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
