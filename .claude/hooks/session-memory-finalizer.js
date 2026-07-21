#!/usr/bin/env node
// Stop hook - keeps the current daily memory block useful between full wrap-ups.
//
// session-memory-block.js creates the skeleton on the first real prompt.
// meta-wrap-up remains the full deliberate closeout. This hook only replaces
// empty placeholders with conservative facts available from the assistant's
// latest response, especially the Next Actions footer.

const fs = require("fs");
const path = require("path");

const AUTO_MARKER = "<!-- aios-auto-finalized: true -->";
const PLACEHOLDER_RE = /\b(Pending Title|None yet\.?|Session in progress\.?|None)\b/i;

function dateStr(d) {
  const yyyy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

function findWorkspaceRoot(start) {
  let dir = start || process.cwd();
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

function clientDirs(workspaceRoot) {
  const clientsRoot = path.join(workspaceRoot, "clients");
  try {
    return fs
      .readdirSync(clientsRoot, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => path.join(clientsRoot, entry.name))
      .filter((dir) => fs.existsSync(path.join(dir, "context")));
  } catch {
    return [];
  }
}

function candidateMemoryFiles(workspaceRoot, today) {
  return [
    path.join(workspaceRoot, "context", "memory", `${today}.md`),
    ...clientDirs(workspaceRoot).map((dir) => path.join(dir, "context", "memory", `${today}.md`)),
  ];
}

function findSessionBlock(content, sessionId) {
  const marker = `<!-- aios-session-id: ${sessionId} -->`;
  const markerIndex = content.indexOf(marker);
  if (markerIndex === -1) return null;

  const sessionRe = /^## Session [0-9]+\s*$/gm;
  let current = null;
  let next = null;
  let match;
  while ((match = sessionRe.exec(content)) !== null) {
    if (match.index <= markerIndex) {
      current = match;
      continue;
    }
    next = match;
    break;
  }

  if (!current) return null;
  return {
    start: current.index,
    end: next ? next.index : content.length,
    text: content.slice(current.index, next ? next.index : content.length),
  };
}

function sectionRegex(heading) {
  return new RegExp(`(^### ${heading}\\n)([\\s\\S]*?)(?=\\n### |\\n## Session |(?![\\s\\S]))`, "m");
}

function sectionText(block, heading) {
  const match = block.match(sectionRegex(heading));
  return match ? match[2].trim() : "";
}

function replaceSection(block, heading, lines) {
  const body = `${lines.join("\n")}\n`;
  const re = sectionRegex(heading);
  if (re.test(block)) {
    return block.replace(re, `$1${body}`);
  }
  const trimmed = block.replace(/\s*$/, "\n\n");
  return `${trimmed}### ${heading}\n${body}`;
}

function removeSection(block, heading) {
  return block.replace(
    new RegExp(`\\n?### ${heading}\\n[\\s\\S]*?(?=\\n### |\\n## Session |(?![\\s\\S]))`, "m"),
    ""
  );
}

function stripMarkdown(text) {
  return String(text || "")
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/[*_#>`]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function truncate(text, max = 180) {
  const cleaned = stripMarkdown(text);
  return cleaned.length > max ? `${cleaned.slice(0, max - 3).trim()}...` : cleaned;
}

function titleCase(words) {
  return words
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

function titleFrom(goal, response) {
  // No hardcoded topic branches: they titled 86 sessions in two weeks with the
  // same wrong label ("Memory Diagnosis"), corrupting title-based recall.
  // Always derive from the actual goal/response words instead.
  const cleanGoal = stripMarkdown(goal);
  const source = cleanGoal && !isPlaceholderOnly(cleanGoal) ? cleanGoal : String(response || "");

  const stop = new Set([
    "a",
    "an",
    "and",
    "are",
    "can",
    "for",
    "how",
    "i",
    "is",
    "it",
    "my",
    "of",
    "on",
    "please",
    "the",
    "this",
    "to",
    "work",
    "you",
  ]);
  const words = stripMarkdown(source)
    .split(/[^a-z0-9]+/i)
    .filter((word) => word.length > 2 && !stop.has(word.toLowerCase()))
    .slice(0, 3);
  return words.length >= 2 ? titleCase(words) : "Session Notes";
}

function relativePath(workspaceRoot, value) {
  let cleaned = value.trim().replace(/^<|>$/g, "");
  cleaned = cleaned.replace(/:[0-9]+$/, "");
  if (path.isAbsolute(cleaned)) {
    const rel = path.relative(workspaceRoot, cleaned);
    if (!rel.startsWith("..") && rel !== "") return rel;
  }
  return cleaned;
}

function extractFilePaths(response, workspaceRoot) {
  const found = [];
  const seen = new Set();
  const add = (candidate) => {
    const rel = relativePath(workspaceRoot, candidate);
    if (!/\.(md|js|sh|json|toml|py|ts|tsx|css|html)$/i.test(rel)) return;
    if (/^(bash|node|npm|python|git)\s/i.test(rel)) return;
    if (seen.has(rel)) return;
    seen.add(rel);
    found.push(rel);
  };

  const linkRe = /\[[^\]]+\]\((\/[^)\n]+)\)/g;
  let match;
  while ((match = linkRe.exec(response)) !== null) add(match[1]);

  const codeRe = /`([^`]+)`/g;
  while ((match = codeRe.exec(response)) !== null) add(match[1]);

  return found.slice(0, 5);
}

// Ground truth for Deliverables: the actual Write/Edit/MultiEdit tool calls in
// the session transcript, not whatever files the assistant happened to re-link
// in its last message. This is what makes deliverable capture impossible to
// forget - it reflects what was done, not what was remembered.
function extractFilePathsFromTranscript(transcriptPath, workspaceRoot) {
  if (!transcriptPath) return [];
  let raw;
  try {
    raw = fs.readFileSync(transcriptPath, "utf8");
  } catch {
    return [];
  }

  const found = [];
  const seen = new Set();
  const EXCLUDE = /(?:^|\/)(?:node_modules|\.memsearch|\.tmp|\.backup|\.versions|\.worktrees|\.git|scratchpad)\//;
  const add = (candidate) => {
    if (!candidate || typeof candidate !== "string") return;
    const rel = relativePath(workspaceRoot, candidate);
    if (!/\.(md|js|sh|json|toml|py|ts|tsx|jsx|mjs|cjs|css|html|yml|yaml)$/i.test(rel)) return;
    if (rel.startsWith("..") || path.isAbsolute(rel)) return; // outside the workspace (never leak absolute home paths)
    if (EXCLUDE.test(`/${rel}`)) return;
    if (/^context\/memory\//.test(rel)) return; // the log writing itself, not a deliverable
    if (/(?:^|\/)package-lock\.json$/.test(rel)) return;
    if (seen.has(rel)) return;
    seen.add(rel);
    found.push(rel);
  };

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim() || line.indexOf("tool_use") === -1) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const content = obj && obj.message && obj.message.content;
    if (!Array.isArray(content)) continue;
    for (const part of content) {
      if (!part || part.type !== "tool_use") continue;
      if (!/^(Write|Edit|MultiEdit)$/.test(part.name || "")) continue;
      add((part.input || {}).file_path);
    }
  }

  return found.slice(0, 10);
}

function extractNextActions(response) {
  const lines = String(response || "").split(/\r?\n/);
  const actions = [];
  let inNext = false;

  for (const raw of lines) {
    const line = raw.trim();
    if (/^(\*\*)?Next Actions(\*\*)?\s*$/i.test(line) || /^#{1,6}\s+Next Actions\s*$/i.test(line)) {
      inNext = true;
      continue;
    }
    if (inNext && (/^(\*\*)?[A-Z][A-Za-z ]+(\*\*)?\s*$/.test(line) || /^#{1,6}\s+/.test(line))) {
      break;
    }
    if (!inNext) {
      const oneLine = line.match(/^Next:\s*(.+)$/i);
      if (oneLine) actions.push(oneLine[1]);
      continue;
    }
    const action = line.match(/^(?:[-*]|\d+\.)\s+(.+)$/);
    if (action) actions.push(action[1]);
  }

  return actions.map((action) => truncate(action)).filter(Boolean).slice(0, 3);
}

function isPlaceholderOnly(text) {
  // Exact match on the whole section, never a substring test: a real entry
  // that merely CONTAINS the word "None" must not read as a placeholder
  // (the substring version silently deleted real Decisions content).
  const cleaned = text.trim();
  if (!cleaned) return true;
  const lines = cleaned.split(/\r?\n/).map((line) => line.replace(/^[-*]\s*/, "").trim());
  return lines.every(
    (line) => !line || /^(?:Pending Title|None yet\.?|None\.?|Session in progress\.?)$/i.test(line)
  );
}

function patchBlock(block, response, workspaceRoot, extraPaths = []) {
  const alreadyAuto = block.includes(AUTO_MARKER);
  const needsPatch = alreadyAuto || PLACEHOLDER_RE.test(block);
  if (!needsPatch || !response.trim()) return block;

  let nextBlock = block;
  if (!nextBlock.includes(AUTO_MARKER)) {
    const markerRe = /(<!-- aios-session-id: [^>]+ -->\n)/;
    nextBlock = markerRe.test(nextBlock)
      ? nextBlock.replace(markerRe, `$1${AUTO_MARKER}\n`)
      : `${AUTO_MARKER}\n${nextBlock}`;
  }

  const title = sectionText(nextBlock, "Title");
  const goal = sectionText(nextBlock, "Goal");
  if (isPlaceholderOnly(title)) {
    nextBlock = replaceSection(nextBlock, "Title", [titleFrom(goal, response)]);
  }

  // Strictly additive: never rewrite or remove content a human or wrap-up
  // wrote. When the section is a placeholder, fill it; when it has real
  // content, only APPEND new file paths (Deliverables) and never touch the
  // existing lines. The old refresh-on-every-Stop behavior destroyed curated
  // Decisions/Deliverables/Open threads daily (2026-07-16 audit, critical).
  const deliverables = sectionText(nextBlock, "Deliverables");
  const seenPath = new Set();
  const responsePaths = [...extractFilePaths(response, workspaceRoot), ...extraPaths]
    .filter((file) => (seenPath.has(file) ? false : seenPath.add(file)))
    .slice(0, 10);
  if (isPlaceholderOnly(deliverables)) {
    if (responsePaths.length > 0) {
      nextBlock = replaceSection(
        nextBlock,
        "Deliverables",
        responsePaths.map((file) => `- \`${file}\``)
      );
    } else {
      nextBlock = removeSection(nextBlock, "Deliverables");
    }
  } else if (alreadyAuto && responsePaths.length > 0) {
    const existingLines = deliverables.split(/\r?\n/).filter((line) => line.trim());
    const fresh = responsePaths.filter((file) => !deliverables.includes(file));
    if (fresh.length > 0 && existingLines.length + fresh.length <= 10) {
      nextBlock = replaceSection(nextBlock, "Deliverables", [
        ...existingLines,
        ...fresh.map((file) => `- \`${file}\``),
      ]);
    }
  }

  const decisions = sectionText(nextBlock, "Decisions");
  if (isPlaceholderOnly(decisions)) {
    nextBlock = removeSection(nextBlock, "Decisions");
  }

  const openThreads = sectionText(nextBlock, "Open threads");
  const threadsAreBoilerplate =
    isPlaceholderOnly(openThreads) ||
    /Awaiting next user input; run meta-wrap-up for full session finalization\./i.test(openThreads);
  if (threadsAreBoilerplate) {
    const actions = extractNextActions(response);
    if (actions.length > 0) {
      nextBlock = replaceSection(
        nextBlock,
        "Open threads",
        actions.map((action) => `- ${action}`)
      );
    } else {
      nextBlock = removeSection(nextBlock, "Open threads");
    }
  }

  return nextBlock.replace(/\s*$/, "\n");
}

function repairAutoBlock(block) {
  const isAuto = block.includes(AUTO_MARKER);
  const storedGoal = sectionText(block, "Goal");
  const isScheduled = /^You are running as a scheduled (?:cron )?job for AI-?OS\b/i.test(storedGoal);
  if (!isAuto && !isScheduled) return block;

  let repaired = block;
  const goal = sectionText(repaired, "Goal");
  if (goal) {
    const compactGoal = visibleStoredGoal(goal);
    if (compactGoal !== goal.trim()) {
      repaired = replaceSection(repaired, "Goal", [compactGoal]);
    }
  }

  const title = sectionText(repaired, "Title");
  if (/^(Memory Diagnosis|Scheduled Job|Pending Title)$/i.test(title)) {
    repaired = replaceSection(repaired, "Title", [titleFrom(sectionText(repaired, "Goal"), "")]);
  }

  const deliverables = sectionText(repaired, "Deliverables");
  if (isAuto && deliverables) {
    const cleaned = deliverables
      .split(/\r?\n/)
      .map((line) => line.replace(/\s+- mentioned in assistant response\.\s*$/i, ""))
      .filter((line) => !/^- Assistant response:/i.test(line.trim()))
      .filter(Boolean)
      .filter((line, index, lines) => lines.indexOf(line) === index);
    if (cleaned.length > 0) {
      repaired = replaceSection(repaired, "Deliverables", cleaned);
    } else {
      repaired = removeSection(repaired, "Deliverables");
    }
  }

  const openThreads = sectionText(repaired, "Open threads");
  if (isAuto && /^-(?:\s*)Awaiting next user input; run meta-wrap-up for full session finalization\.$/im.test(openThreads)) {
    repaired = removeSection(repaired, "Open threads");
  }

  const decisions = sectionText(repaired, "Decisions");
  if (isAuto && isPlaceholderOnly(decisions)) repaired = removeSection(repaired, "Decisions");

  return repaired.replace(/\n{3,}/g, "\n\n").replace(/\s*$/, "\n");
}

function visibleStoredGoal(goal) {
  let cleaned = String(goal || "").trim();
  const taskMatch = cleaned.match(/(?:#{1,6}\s*)?Task:?\s*(.+?)(?=\s+(?:Steps?|Rules?|Requirements?|Output):|$)/i);
  if (taskMatch && taskMatch[1].trim()) cleaned = taskMatch[1].trim();
  cleaned = cleaned
    .replace(/^you are running as a scheduled (?:cron )?job for ai-?os[.!]?\s*/i, "")
    .replace(/^read claude\.md for system context[.!]?\s*/i, "")
    .replace(/^(?:#{1,6}\s*)?Task:?\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
  return truncate(cleaned || "Session started.", 180);
}

function repairFile(file) {
  const content = fs.readFileSync(file, "utf8");
  const starts = [...content.matchAll(/^## Session [0-9]+\s*$/gm)].map((match) => match.index);
  if (starts.length === 0) return false;

  let repaired = content.slice(0, starts[0]);
  for (let i = 0; i < starts.length; i += 1) {
    const start = starts[i];
    const end = i + 1 < starts.length ? starts[i + 1] : content.length;
    repaired += repairAutoBlock(content.slice(start, end));
  }
  if (repaired === content) return false;
  fs.writeFileSync(file, repaired);
  return true;
}

if (process.argv[2] === "--repair") {
  let changed = 0;
  for (const file of process.argv.slice(3)) {
    try {
      if (repairFile(file)) changed += 1;
    } catch {
      // Skip non-memory inputs without blocking the repair batch.
    }
  }
  process.stdout.write(`Repaired ${changed} memory log file(s).\n`);
  process.exit(0);
}

function patchSessionFile(file, sessionId, response, workspaceRoot, transcriptPath) {
  let content;
  try {
    content = fs.readFileSync(file, "utf8");
  } catch {
    return false;
  }

  const block = findSessionBlock(content, sessionId);
  if (!block) return false;

  const extraPaths = extractFilePathsFromTranscript(transcriptPath, workspaceRoot);
  const patched = patchBlock(block.text, response, workspaceRoot, extraPaths);
  if (patched === block.text) return true;

  fs.writeFileSync(file, `${content.slice(0, block.start)}${patched}${content.slice(block.end)}`);
  return true;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const sessionId = data.session_id;
    const response = data.last_assistant_message || "";
    const transcriptPath = data.transcript_path || "";
    const cwd = data.cwd || process.env.CLAUDE_PROJECT_DIR || process.cwd();
    if (!sessionId || !response.trim()) return;

    const workspaceRoot = findWorkspaceRoot(cwd);
    if (!workspaceRoot) return;

    const today = dateStr(new Date());
    for (const file of candidateMemoryFiles(workspaceRoot, today)) {
      if (patchSessionFile(file, sessionId, response, workspaceRoot, transcriptPath)) return;
    }
  } catch {
    // Never block Stop.
  }
});

setTimeout(() => process.exit(0), 4000).unref();
