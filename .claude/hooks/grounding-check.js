#!/usr/bin/env node
// Stop hook (non-blocking, observability only).
// Surfaces replies that made a definite factual claim about the user's world
// while using NO grounding tool in the turn - the "answered thin from memory"
// failure the 2026-07-24 memory-grounding audit targets. It NEVER blocks the
// session: it always exits 0.
//
// What it flags: a substantive answer (not a clarifying question, not a wrap-up
// summary) that BOTH (a) contains a memory/claim marker like "you decided",
// "as we discussed", "currently uses", "as of", AND (b) fired zero grounding
// tools this turn (Read/Grep/Glob/WebSearch/WebFetch/Task, a search-y Bash, or
// an MCP search/fetch). That pairing is a claim about the user's world asserted
// without re-grounding at a source.
//
// Why log-only and deliberately coarse: a Stop hook cannot truly know whether
// the model re-grounded - it may have re-read a file EARLIER in the session, or
// the claim may be safely model-general. So this is a review signal for the
// operator, not an alarm, the same posture as footer-presence-check.js. False
// positives are expected; read head/tail and judge. If Stage 1 (dated,
// re-grounding-framed recall) works, this log should stay short.
//
// Output: one JSON line per hit to .claude/hooks_info/grounding-misses.log
// (gitignored). Review with: tail .claude/hooks_info/grounding-misses.log

const fs = require("fs");
const path = require("path");

const GROUNDING_TOOLS = new Set([
  "Read", "Grep", "Glob", "WebSearch", "WebFetch", "Task", "Agent", "NotebookRead",
]);

// A Bash call counts as grounding only when its command actually reads or
// searches a source, not for `ls` / `git status` / etc.
const BASH_GROUNDING_RE =
  /\b(memsearch|rg|grep|cat|head|tail|less|find|awk|sed|jq|curl|wget|web_?fetch|memory-search|agency-gather)\b/i;

// MCP tools that fetch or search an external/live source count as grounding.
const MCP_GROUNDING_RE = /(search|fetch|read|query|get[_-]?page|web[_-])/i;

// Markers that the answer made a definite claim about the user's own world or
// leaned on stored/past context - the surface where stale memory bites.
const CLAIM_MARKER_RE =
  /\b(you (decided|said|mentioned|asked|told me|wanted)|as (we |you )?discussed|as agreed|previously|last (session|time|week|month)|on record|your (client|project|setup|config|stack|account|repo)|is (set to|configured)|currently (uses?|set|on|configured)|as of|already (has|have|set up)|we (decided|agreed|established))\b/i;

function isGroundingTool(name, input) {
  if (!name) return false;
  if (GROUNDING_TOOLS.has(name)) return true;
  if (name === "Bash") {
    const cmd = (input && (input.command || input.cmd)) || "";
    return BASH_GROUNDING_RE.test(String(cmd));
  }
  if (name.startsWith("mcp__")) return MCP_GROUNDING_RE.test(name);
  return false;
}

function contentItems(entry) {
  const c = entry && entry.message && entry.message.content;
  return Array.isArray(c) ? c : [];
}

// A tool-result turn is also type "user"; only a human prompt counts as the
// turn boundary. A real prompt is a string, or an array with no tool_result.
function isRealUserPrompt(entry) {
  if (!entry || entry.type !== "user" || !entry.message) return false;
  if (typeof entry.message.content === "string") return true;
  const items = contentItems(entry);
  if (!items.length) return false;
  return !items.some((it) => it && it.type === "tool_result");
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (c) => (input += c));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const tpath = data.transcript_path;
    if (!tpath || !fs.existsSync(tpath)) return; // can't judge grounding -> don't guess

    let lines;
    try {
      lines = fs.readFileSync(tpath, "utf8").split("\n").filter(Boolean);
    } catch {
      return;
    }

    const entries = [];
    for (const ln of lines) {
      try { entries.push(JSON.parse(ln)); } catch {}
    }
    if (!entries.length) return;

    // The turn = everything after the last real (human) user prompt.
    let lastUserIdx = -1;
    for (let i = entries.length - 1; i >= 0; i--) {
      if (isRealUserPrompt(entries[i])) { lastUserIdx = i; break; }
    }
    if (lastUserIdx < 0) return;
    const turn = entries.slice(lastUserIdx + 1);
    if (!turn.length) return;

    let grounded = false;
    let answer = "";
    for (const e of turn) {
      if (e && e.type === "assistant") {
        for (const it of contentItems(e)) {
          if (!it) continue;
          if (it.type === "tool_use" && isGroundingTool(it.name, it.input)) grounded = true;
          if (it.type === "text" && typeof it.text === "string") answer = it.text;
        }
      }
    }
    if (typeof data.last_assistant_message === "string" && data.last_assistant_message.trim()) {
      answer = data.last_assistant_message;
    }
    answer = answer.trim();
    if (!answer) return;

    // Skip non-answers: clarifying questions, tiny replies, wrap-up summaries.
    // The claim-marker gate below is the precision filter; this floor only drops
    // trivial one-liners and short acknowledgments, not real answers.
    if (answer.length < 500) return;
    if (/\?\s*$/.test(answer)) return;
    if (/session summary/i.test(answer.slice(0, 200))) return;

    if (grounded) return;                       // re-grounded this turn -> fine
    if (!CLAIM_MARKER_RE.test(answer)) return;  // no definite user-world claim -> skip

    const dir = path.join(__dirname, "..", "hooks_info");
    try { fs.mkdirSync(dir, { recursive: true }); } catch {}
    const rec = {
      ts: new Date().toISOString(),
      session: data.session_id || null,
      chars: answer.length,
      claim_marker: (CLAIM_MARKER_RE.exec(answer) || [""])[0],
      head: answer.slice(0, 100).replace(/\s+/g, " "),
      tail: answer.slice(-100).replace(/\s+/g, " "),
    };
    fs.appendFileSync(path.join(dir, "grounding-misses.log"), JSON.stringify(rec) + "\n");
  } catch {
    // Never throw from a hook.
  }
});
