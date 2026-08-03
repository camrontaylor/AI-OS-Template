#!/usr/bin/env node
// UserPromptSubmit hook - just-in-time AI-OS writing context.
//
// v1 of this hook injected ~380 tokens of instructions telling the model to go
// read the learnings files. The 2026-07-28 memory diagnosis showed that the
// instruction-only approach loses to momentum: the July failure record is full
// of client-facing drafts written while the exact rule they broke sat unread in
// clients/<slug>/context/learnings.md (vendor-email register, tier-gating
// verification, Nick message shape...). Proximity beats availability, so v2
// injects the CONTENT of the load-bearing learnings sections at the moment a
// writing-shaped prompt arrives: the matching skill section, the user's
// Preferences, and the recent What-doesn't-work-well lessons.
//
// Guarantees:
//   - Never blocks the prompt; any error exits silently.
//   - Hard character budget (default 8000) so a large learnings file can never
//     flood the context.
//   - At most MAX_FIRES content injections per session with a cooldown; after
//     that the standing rules carry it. A fire is only consumed when content
//     is actually injected.
//   - Silent on scheduled cron runs (no human reader).
//
// Prompt classification and the fire-budget contract are shared with
// auto-recall.js via lib/writing-prompt.js so the two hooks never disagree.

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const shared = require(path.join(__dirname, "lib", "writing-prompt.js"));

const PROJECT_DIR = process.env.CLAUDE_PROJECT_DIR || path.resolve(__dirname, "..", "..");

const BUDGET = clampNum(process.env.AI_OS_WRITING_GATE_BUDGET, 8000, 2000, 20000);
const MAX_FIRES = shared.GATE_MAX_FIRES;
const COOLDOWN_MS = shared.GATE_COOLDOWN_MS;

function clampNum(raw, def, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

// Which skill section of learnings.md matters for this prompt.
function skillSectionFor(prompt) {
  const text = String(prompt || "");
  if (/\b(email|message|reply|respond|dm|slack|comment|follow up|send|whatsapp|client-facing|stakeholder|vendor)\b/i.test(text)) {
    return "comms-message";
  }
  if (/\b(landing page|sales page|headline|cta|ad copy|copy|caption|social post|newsletter|post)\b/i.test(text)) {
    return "mkt-copywriting";
  }
  return null;
}

// Find the workspace (client folder if inside one, else the repo root) from cwd.
function findWorkspace(cwd) {
  let dir = cwd;
  let client = null;
  let root = null;
  for (let i = 0; i < 12; i++) {
    const base = path.basename(path.dirname(dir));
    if (base === "clients" && fs.existsSync(path.join(dir, "context"))) client = dir;
    if (
      fs.existsSync(path.join(dir, "AGENTS.md")) &&
      fs.existsSync(path.join(dir, ".claude")) &&
      fs.existsSync(path.join(dir, "clients"))
    ) {
      root = dir;
      break;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return { client, root };
}

// Extract one "## Heading" section body (to the next #/## heading). Returns "".
function extractSection(content, heading) {
  const lines = String(content || "").split("\n");
  const start = lines.findIndex((l) => l.trim().toLowerCase() === `## ${heading}`.toLowerCase());
  if (start < 0) return "";
  const body = [];
  for (let i = start + 1; i < lines.length; i++) {
    if (/^#{1,2}\s/.test(lines[i])) break;
    body.push(lines[i]);
  }
  return body.join("\n").trim();
}

// Keep the TAIL of a section within maxChars: entries are appended newest-last,
// so the tail is the most recent lessons - the ones most likely still live.
function tailClip(text, maxChars) {
  const t = String(text || "").trim();
  if (t.length <= maxChars) return t;
  const clipped = t.slice(t.length - maxChars);
  const firstBullet = clipped.indexOf("\n- ");
  return (firstBullet >= 0 ? clipped.slice(firstBullet + 1) : clipped).trim();
}

function buildInjection(prompt, cwd) {
  const { client, root } = findWorkspace(cwd);
  const wsDir = client || root;
  if (!wsDir) return null;
  const learningsPath = path.join(wsDir, "context", "learnings.md");
  let content = "";
  try {
    content = fs.readFileSync(learningsPath, "utf8");
  } catch {
    return null;
  }
  if (!content.trim()) return null;

  const rel = client ? `clients/${path.basename(client)}/context/learnings.md` : "context/learnings.md";
  const parts = [];
  let spent = 0;

  const push = (label, body, cap) => {
    const clipped = tailClip(body, Math.min(cap, Math.max(0, BUDGET - spent)));
    if (!clipped) return;
    parts.push(`#### ${label}\n${clipped}`);
    spent += clipped.length;
  };

  const skill = skillSectionFor(prompt);
  const skillBody = skill ? extractSection(content, skill) : "";
  if (skillBody) push(`Skill rules: ${skill}`, skillBody, 3500);
  push("The user's standing preferences", extractSection(content, "Preferences"), 2500);
  push("Recent confirmed mistakes - do not repeat these", extractSection(content, "What doesn't work well"), 3000);

  if (parts.length === 0) return null;

  // Framing scales with fit (2026-07-28 review pass 2): when the matched skill
  // section exists, its rules genuinely target this surface - hard framing.
  // When only the generic Preferences/mistakes tails are available, many
  // entries were written for OTHER surfaces (vendor emails, tables, ops), so
  // blind application would be wrong - scoped framing instead.
  const framing = skillBody
    ? `The sections below are the user's own standing record from \`${rel}\` - they are RULES for this draft, not suggestions. ` +
      `Apply them directly; when one seems to conflict with the current ask, say so instead of silently dropping it.`
    : `The sections below are the user's standing record from \`${rel}\`, captured across different surfaces. ` +
      `Apply the entries whose stated scope fits THIS surface; entries scoped to other surfaces (e.g. vendor emails, tables, ops tooling) are context, not rules for this draft.`;

  const message =
    `AI-OS writing context gate: this prompt looks like drafting, rewriting, reviewing, or polishing text. ` +
    framing +
    `\n\n` +
    parts.join("\n\n") +
    `\n\nAlso: classify the writing surface and invoke the matching skill (comms-message for one-to-one client/stakeholder messages, ` +
    `mkt-copywriting for sales/public copy, mkt-brand-voice for voice work) and follow its Context Needs table. ` +
    `For client work, self-source facts first: run \`bash scripts/agency-gather.sh <slug>\` and read what the job needs - never ask for what you can read. ` +
    `Client-local memory and learnings outrank root context for facts, names, promises, scope, and relationship history. ` +
    `Any outside-world capability claim (vendor features, pricing, tiers, API surfaces) in a client-facing draft gets verified at the vendor's current live source first. ` +
    `For an outward-facing deliverable, check the draft with a fresh subagent critic fed the grounded facts before showing it.`;

  return { message, rel, labels: parts.map((p) => p.split("\n", 1)[0].replace(/^#### /, "")) };
}

// Atomic-ish state write: temp + rename, so a concurrent reader never sees a
// torn file (review pass 2, F8).
function writeState(file, state) {
  try {
    const tmp = file + "." + process.pid + ".tmp";
    fs.writeFileSync(tmp, JSON.stringify(state));
    fs.renameSync(tmp, file);
  } catch {}
}

// Best-effort observability: log WHICH learnings sections were injected, so
// recall-usage review can correlate injections with the corrections they were
// built to prevent (review pass 3). Content never leaves the machine; the
// logger keeps only source/heading/rank. Never blocks the prompt.
function logInjected(prompt, rel, labels, cwd) {
  try {
    const logger = path.join(PROJECT_DIR, "scripts", "lib", "recall-log.py");
    if (!fs.existsSync(logger) || labels.length === 0) return;
    const items = labels.map((label) => ({ source: rel, heading: label }));
    const child = spawn(
      "python3",
      [logger, "--kind", "surfaced", "--caller", "writing-gate", "--query", String(prompt || "").slice(0, 200), "--items-json", JSON.stringify(items)],
      { cwd, detached: true, stdio: "ignore" }
    );
    child.on("error", () => {});
    child.unref();
  } catch {}
}

try {
  const input = readInput();
  const prompt = input.prompt || input.message || "";
  if (process.env.AI_OS_AUTONOMOUS === "1") process.exit(0);
  if (shared.isScheduledAutomation(prompt)) process.exit(0);
  if (!shared.isLikelyWritingPrompt(prompt)) process.exit(0);

  const sessionId = input.session_id || "";
  const state = shared.readGateState(sessionId);
  const now = Date.now();
  const last = state.fires.length ? Math.max(...state.fires) : 0;
  if (state.fires.length >= MAX_FIRES || now - last < COOLDOWN_MS) process.exit(0);

  const cwd = input.cwd && fs.existsSync(input.cwd) ? input.cwd : process.cwd();
  const built = buildInjection(prompt, cwd);
  if (!built) process.exit(0);

  // Consume the fire only now that content will actually be injected, so a
  // client with no learnings never burns its budget on empty fires.
  if (sessionId) {
    state.fires.push(now);
    writeState(shared.gateStatePath(sessionId), state);
  }

  logInjected(prompt, built.rel, built.labels, cwd);

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: built.message,
      },
    })
  );
} catch {
  // Never block the prompt.
}
