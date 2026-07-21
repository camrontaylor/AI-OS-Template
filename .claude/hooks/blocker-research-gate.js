#!/usr/bin/env node
// UserPromptSubmit hook - just-in-time AI-OS blocker research reminder.
//
// This does not block prompts or run research itself. It injects the canonical
// Blocker Research Gate from AGENTS.md when a prompt is likely to produce a
// feasibility, blocker, or "can we do this?" answer where a shallow "no" would
// be a bad outcome.

const fs = require("fs");
const path = require("path");
const os = require("os");

function readInput() {
  try {
    return JSON.parse(fs.readFileSync(0, "utf8") || "{}");
  } catch {
    return {};
  }
}

const BLOCKER_RESEARCH_HINT =
  "AI-OS blocker research gate: this prompt asks about feasibility, options, a tool/platform limit, or a blocker. Before answering with no, not possible, cannot, or a dead-end caveat, invoke q-question when it fits, then check local AI-OS docs/code/memory and current primary sources when platform/tool capability may have changed. Look for how others solve it, including native support, workaround/custom build, remote/third-party/service path, and operational process changes. If a requested connector or live tool is unavailable, try native connector first, Composio when relevant/authenticated, then web/local fallback; state what failed and how to connect it. The answer must include practical options, a best recommendation, evidence path or sources checked when research matters, confidence, and the smallest next test. A bare 'no' is allowed only for safety, policy, legal, or destructive-action refusals.";

const FEASIBILITY_RE =
  /\b(is it possible|is this possible|can (i|we|you)|could (i|we|you)|would it be possible|how (can|could|do) (i|we|you)|what are (my|our|the) options|options for|best (way|setup|approach|option)|most (scalable|sustainable|reliable)|figure out|find (a way|ways)|look into|research|verify|validate|resolve (this|it|the issue|the blocker)|fix (this|it|the issue|the blocker)|sort (this|it|the issue|the blocker) out)\b/i;

const BLOCKER_RE =
  /\b(blocker|blocked|stuck|dead end|not possible|impossible|can't|cannot|won't work|doesn't work|not supported|unsupported|failed|fails|error|limitation|limit|constraint|workaround|alternative|cop[- ]?out)\b/i;

const DOMAIN_RE =
  /\b(tool|tools|app|apps|connector|connection|integration|api|mcp|plugin|codex|claude|composio|notion|gmail|google|calendar|hubspot|figma|github|vercel|x|twitter|browser|remote|server|worker|cron|automation|background|sleep|laptop|mac|macos|workflow|ai-os)\b/i;

const TRIVIAL_RE =
  /^(thanks|thank you|ok|okay|yes|no|cool|got it|done|continue|go on|nice|sounds good)[.! ]*$/i;

function isLikelyBlockerPrompt(prompt) {
  const text = String(prompt || "").trim();
  if (!text || TRIVIAL_RE.test(text)) return false;

  // BLOCKER_RE alone fired on nearly every debugging turn ("error", "failed",
  // "limit"). It must co-occur with a feasibility phrasing or a domain word
  // to count as a real blocker question (2026-07-16 audit).
  if (BLOCKER_RE.test(text) && (FEASIBILITY_RE.test(text) || DOMAIN_RE.test(text))) return true;
  if (FEASIBILITY_RE.test(text) && DOMAIN_RE.test(text)) return true;

  return false;
}

try {
  const input = readInput();
  const prompt = input.prompt || input.message || "";
  if (!isLikelyBlockerPrompt(prompt)) process.exit(0);

  // Once per session - the standing AGENTS.md rule carries it after the
  // first nudge; re-injecting every matching turn is a token tax.
  const sessionId = input.session_id || "";
  if (sessionId) {
    const marker = path.join(os.tmpdir(), `aios-blocker-gate-${sessionId}.done`);
    if (fs.existsSync(marker)) process.exit(0);
    try { fs.writeFileSync(marker, String(Date.now())); } catch {}
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: BLOCKER_RESEARCH_HINT,
      },
    }),
  );
} catch {
  // Never block the prompt.
}
