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
const { resolveMemoryTarget } = require(path.join(
  __dirname,
  "..",
  "..",
  "scripts",
  "lib",
  "memory-target-resolver.js"
));

const GREETING_RE =
  /^(hi|hey|hello|yo|sup|gm|hiya|howdy|morning|good (morning|afternoon|evening)|hey there|hello there|what'?s up|whats up|ok|okay|thanks|thank you|ty)[\s!.?,]*$/i;

function isGreetingOnly(prompt) {
  const cleaned = prompt.trim();
  if (!cleaned) return true;
  return cleaned.length <= 30 && GREETING_RE.test(cleaned);
}

function isScheduledAutomation(prompt) {
  const cleaned = String(prompt || "")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .trim();
  return /^you are running as a scheduled (?:cron )?job for ai-?os\b/i.test(cleaned);
}

function dateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function visiblePromptLine(prompt) {
  let cleaned = prompt
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .trim();

  const taskMatch = cleaned.match(
    /(?:^|\n|\s)\s*(?:#{1,6}\s*)?Task:?\s*([\s\S]*?)(?=(?:\n|\s+)\s*(?:#{1,6}\s*)?(?:Steps?|Rules?|Requirements?|Output):?|\n\s*\d+[.)]\s|$)/i
  );
  if (taskMatch && taskMatch[1].trim()) {
    cleaned = taskMatch[1].trim();
  } else {
    cleaned = cleaned
      .replace(/^\s*you are running as a scheduled (?:cron )?job for ai-?os[.!]?\s*/i, "")
      .replace(/^\s*read claude\.md for system context[.!]?\s*/i, "");
  }

  cleaned = cleaned
    .replace(/^\s*(?:#{1,6}\s*)?Task:?\s*/i, "")
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

    // Cron has its own status, logs, and durable reports. Treating each routine
    // run as a human session filled daily logs and semantic recall with system
    // procedure text, so scheduled automation is intentionally not captured.
    if (!sessionId || isGreetingOnly(prompt) || isScheduledAutomation(prompt)) return;

    const marker = path.join(os.tmpdir(), `aios-session-memory-${sessionId}.done`);
    if (fs.existsSync(marker)) return;

    const target = resolveMemoryTarget({ cwd, prompt });
    const root = target.targetType === "unknown" ? null : target.targetRoot;
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
