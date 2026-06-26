#!/usr/bin/env node
// UserPromptSubmit hook - creates today's canonical memory session block.
//
// The title hook tells the model to emit a copyable title, and meta-wrap-up
// finalizes the session. This hook owns the missing middle: on the first real
// prompt in a session, create the `context/memory/YYYY-MM-DD.md` block that
// later tracking and wrap-up can update. It is intentionally small and local:
// no network, no subprocesses, and silent failure so prompts are never blocked.

const fs = require("fs");
const path = require("path");
const os = require("os");

const GREETING_RE =
  /^(hi|hey|hello|yo|sup|gm|hiya|howdy|morning|good (morning|afternoon|evening)|hey there|hello there|what'?s up|whats up|ok|okay|thanks|thank you|ty)[\s!.?,]*$/i;
const ALL_CLIENTS_RE =
  /\b(all|every|each)\s+clients?\b|\bclients?\s+folders?\b|clients\/\*|\bevery\s+clients?\s+folders?\b/i;

function isGreetingOnly(prompt) {
  const cleaned = prompt.trim();
  if (!cleaned) return true;
  return cleaned.length <= 30 && GREETING_RE.test(cleaned);
}

function dateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function findContextRoot(startDir) {
  let dir = startDir || process.cwd();
  for (let i = 0; i < 10; i++) {
    const hasContext = fs.existsSync(path.join(dir, "context"));
    const hasInstructions =
      fs.existsSync(path.join(dir, "AGENTS.md")) ||
      fs.existsSync(path.join(dir, "CLAUDE.md"));
    if (hasContext && hasInstructions) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  dir = startDir || process.cwd();
  for (let i = 0; i < 10; i++) {
    const hasAgents = fs.existsSync(path.join(dir, "AGENTS.md"));
    const hasClaudeDir = fs.existsSync(path.join(dir, ".claude"));
    if (hasAgents && hasClaudeDir) return dir;

    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  return null;
}

function isClientRoot(root) {
  return path.basename(path.dirname(root)) === "clients";
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
        return {
          dir,
          aliases: clientAliases(entry.name, clientDisplayName(dir)),
        };
      })
      .filter((client) => fs.existsSync(path.join(client.dir, "context")));
  } catch {
    return [];
  }
}

function clientRootForPrompt(root, prompt) {
  if (isClientRoot(root) || ALL_CLIENTS_RE.test(prompt)) return null;
  const matches = discoverClients(root).filter((client) =>
    client.aliases.some((alias) => aliasMatches(prompt, alias))
  );
  return matches.length === 1 ? matches[0].dir : null;
}

function visiblePromptLine(prompt) {
  let cleaned = prompt
    .replace(/<codex_internal_context[\s\S]*?<\/codex_internal_context>/gi, " ")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) cleaned = "Session started.";
  if (cleaned.length > 180) cleaned = `${cleaned.slice(0, 177)}...`;
  return cleaned;
}

function nextSessionNumber(content) {
  let max = 0;
  const re = /^## Session ([0-9]+)\s*$/gm;
  let match;
  while ((match = re.exec(content)) !== null) {
    const n = Number(match[1]);
    if (n > max) max = n;
  }
  return max + 1;
}

function ensureTrailingBlank(content) {
  if (!content.trim()) return "";
  return content.endsWith("\n\n") ? content : content.replace(/\s*$/, "\n\n");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const sessionId = data.session_id;
    const prompt = data.prompt || data.message || "";
    const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();

    if (!sessionId || isGreetingOnly(prompt)) return;

    const marker = path.join(os.tmpdir(), `aios-session-memory-${sessionId}.done`);
    if (fs.existsSync(marker)) return;

    const contextRoot = findContextRoot(cwd);
    const root = contextRoot ? clientRootForPrompt(contextRoot, prompt) || contextRoot : null;
    if (!root) return;

    const today = dateStr(new Date());
    const memoryDir = path.join(root, "context", "memory");
    const memoryFile = path.join(memoryDir, `${today}.md`);
    const sessionMarker = `<!-- aios-session-id: ${sessionId} -->`;

    fs.mkdirSync(memoryDir, { recursive: true });

    let content = "";
    try {
      content = fs.readFileSync(memoryFile, "utf8");
    } catch {
      content = `# ${today}\n\n`;
    }

    if (content.includes(sessionMarker)) {
      fs.writeFileSync(marker, String(Date.now()));
      return;
    }

    const sessionNumber = nextSessionNumber(content);
    const goal = visiblePromptLine(prompt);
    const block =
      `## Session ${sessionNumber}\n` +
      `${sessionMarker}\n\n` +
      `### Title\n` +
      `Pending Title\n\n` +
      `### Goal\n` +
      `${goal}\n\n` +
      `### Deliverables\n` +
      `- None yet.\n\n` +
      `### Decisions\n` +
      `- None yet.\n\n` +
      `### Open threads\n` +
      `- Session in progress.\n`;

    fs.writeFileSync(memoryFile, `${ensureTrailingBlank(content)}${block}`);
    fs.writeFileSync(marker, String(Date.now()));
  } catch {
    // Never block the prompt.
  }
});

setTimeout(() => process.exit(0), 4000).unref();
