// Shared prompt classification for the UserPromptSubmit hooks.
//
// writing-context-gate.js and auto-recall.js must agree on (a) what counts as
// a writing-shaped prompt and (b) whether the writing gate would fire for a
// given session, so auto-recall can skip learnings/preference chunks the gate
// is about to inject verbatim (2026-07-28 review pass 2: measured ~400 chars
// of the same preference text arriving twice on one prompt). Single source of
// truth lives here.

const fs = require("fs");
const path = require("path");
const os = require("os");

const WRITING_RE =
  /\b(draft|write|rewrite|edit|polish|sharpen|improve|copyedit|review|critique|humanize|de-ai|clean up|make this sound|tone|voice|wording|phrasing|message|reply|respond|response|follow up|send|email|dm|slack|comment|client-facing|stakeholder|prospect|proposal|brief|post|caption|thread|newsletter|landing page|sales page|headline|cta|ad copy|email copy|social post|script)\b/i;

const STRONG_WRITING_RE =
  /\b(how should i reply|how do i reply|thoughts on this message|write this to|send .{0,40}\b(client|customer|lead|prospect|supplier|partner|stakeholder)|reply to|respond to|follow up with|make this sound like me|in my voice|brand voice|landing page copy|sales page|ad copy|email copy|social post|linkedin post|newsletter|client-facing)\b/i;

const CODE_OR_SYSTEM_RE =
  /\b(code|function|unit test|integration test|spec file|typescript|javascript|python|react|component|hooks?|api|sql|schema|migration|css|html|script\.sh|shell script|bash script|cli|command|regex|json|yaml|toml|config|settings|audit|cron|memory system|README|AGENTS\.md|SKILL\.md|\.md\b|\.sh\b|tests?)\b/i;

const CODE_TASK_RE =
  /\b(write|edit|review|update|create|generate|fix|implement|refactor|patch|improve|audit)\b[\s\S]{0,80}\b(code|function|unit test|integration test|typescript|javascript|python|react|component|api|sql|schema|migration|script\.sh|shell script|bash script|cli|hooks?|settings|json|config|cron|deploy script|error message|tests?)\b/i;

function isLikelyWritingPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text) return false;
  if (STRONG_WRITING_RE.test(text)) return true;
  if (!WRITING_RE.test(text)) return false;
  if (
    CODE_TASK_RE.test(text) &&
    CODE_OR_SYSTEM_RE.test(text) &&
    !/client-facing|public-facing|copy|message|email|post|voice|tone/i.test(text)
  ) {
    return false;
  }
  return true;
}

// Headless cron runs have no human reader. Same detector shape as
// session-title-hint.js / session-memory-block.js.
function isScheduledAutomation(prompt) {
  const cleaned = String(prompt || "")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .trim();
  return /^you are running as a scheduled (?:cron )?job for ai-?os\b/i.test(cleaned);
}

// The writing gate's fire budget, shared so auto-recall can predict whether
// the gate will inject on this same prompt regardless of hook ordering.
const GATE_MAX_FIRES = clampNum(process.env.AI_OS_WRITING_GATE_MAX_FIRES, 3, 1, 10);
const GATE_COOLDOWN_MS = clampNum(process.env.AI_OS_WRITING_GATE_COOLDOWN_MS, 600000, 0, 3600000);

function clampNum(raw, def, lo, hi) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

function gateStatePath(sessionId) {
  return path.join(os.tmpdir(), `aios-writing-gate-${sessionId}.json`);
}

function readGateState(sessionId) {
  try {
    const s = JSON.parse(fs.readFileSync(gateStatePath(sessionId), "utf8"));
    return { fires: Array.isArray(s.fires) ? s.fires.filter((t) => Number.isFinite(t)) : [] };
  } catch {
    if (sessionId && fs.existsSync(path.join(os.tmpdir(), `aios-writing-gate-${sessionId}.done`))) {
      return { fires: [0] };
    }
    return { fires: [] };
  }
}

// Would the writing gate fire for this session right now (budget + cooldown)?
// Content availability is not checked here - callers treat a "yes" as "the
// gate may inject learnings on this prompt".
function gateWouldFire(sessionId, now) {
  if (!sessionId) return false;
  const state = readGateState(sessionId);
  if (state.fires.length >= GATE_MAX_FIRES) return false;
  const last = state.fires.length ? Math.max(...state.fires) : 0;
  return (now || Date.now()) - last >= GATE_COOLDOWN_MS;
}

// Did the gate fire within the last few seconds - i.e. on THIS prompt? Hook
// execution order is not guaranteed, so the overlap check needs both sides:
// "will fire" (recall ran first) and "just fired" (gate ran first).
function gateFiredRecently(sessionId, now, windowMs) {
  if (!sessionId) return false;
  const state = readGateState(sessionId);
  if (!state.fires.length) return false;
  const last = Math.max(...state.fires);
  return (now || Date.now()) - last < (windowMs || 15000);
}

module.exports = {
  WRITING_RE,
  STRONG_WRITING_RE,
  CODE_OR_SYSTEM_RE,
  CODE_TASK_RE,
  isLikelyWritingPrompt,
  isScheduledAutomation,
  GATE_MAX_FIRES,
  GATE_COOLDOWN_MS,
  gateStatePath,
  readGateState,
  gateWouldFire,
  gateFiredRecently,
};
