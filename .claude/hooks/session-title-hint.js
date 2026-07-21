#!/usr/bin/env node
// UserPromptSubmit hook - AI-OS session title reinforcement.
//
// Why this exists: the copyable 2-3 word session title (AGENTS.md Session
// Title Fence rule, originally a CLAUDE.local.md rule from 2026-06-15) has to
// win at the exact moment the louder "silent startup / begin immediately / no
// preamble" rules push the opposite way, so models can skip it. This hook
// injects a just-in-time reminder right before the model's first reply. It does
// NOT auto-write any title or touch a tool's transcript. It only reminds.
//
// Fires exactly once per session, on the first non-greeting prompt. Pure sync,
// no network. On any error it emits nothing and exits 0 so input is never blocked.

const fs = require("fs");
const path = require("path");
const os = require("os");

const TITLE_HINT =
  "AI-OS session title (first reply of this session only): if this message states a real, nameable task or goal, the VERY FIRST thing in your reply must be a fenced code block (triple backticks) whose only content is a 2-3 word Title Case label naming the session, with normal spaces, e.g. a block containing just `Session Titling`. Nothing else inside the fence: no /rename, no heading, no ### Title, no quotes, no blank lines, no extra words. The user copies the fence verbatim into the current tool's session rename field when available. Put every word of explanation OUTSIDE the fence, then continue straight into the work (this is the one allowed exception to begin-immediately and no-preamble). Emit exactly one such block this whole session. Use the same 2-3 words for the `### Title` line in today's context/memory session block. Skip entirely if this message is only a greeting, a status check, or trivial Q&A with no nameable goal.";

// Pure greeting / no-task openers - if the session opens with one of these we do
// NOT consume the once-per-session fire, so the reminder still lands on the first
// real task prompt that follows.
const GREETING_RE =
  /^(hi|hey|hello|yo|sup|gm|hiya|howdy|morning|good (morning|afternoon|evening)|hey there|hello there|what'?s up|whats up|ok|okay|thanks|thank you|ty)[\s!.?,]*$/i;

function isGreetingOnly(prompt) {
  const cleaned = prompt.trim();
  if (!cleaned) return true;
  if (cleaned.length <= 30 && GREETING_RE.test(cleaned)) return true;
  return false;
}

// Headless cron runs have no rename field and no human reader; injecting the
// title reminder there is pure token waste (same detector as
// session-memory-block.js).
function isScheduledAutomation(prompt) {
  const cleaned = String(prompt || "")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .trim();
  return /^you are running as a scheduled (?:cron )?job for ai-?os\b/i.test(cleaned);
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const sessionId = data.session_id;
    const prompt = data.prompt || data.message || "";
    if (!sessionId) return; // nothing we can key on

    const marker = path.join(os.tmpdir(), "cc-titlehint-" + sessionId + ".done");

    // Already fired this session → stay silent.
    if (fs.existsSync(marker)) return;

    // Greeting-only opener → wait for the real task prompt; do not fire or mark.
    if (isGreetingOnly(prompt)) return;

    // Scheduled cron run → no human, no rename field; mark done so the hook
    // stays silent for the whole headless session.
    if (isScheduledAutomation(prompt)) {
      try {
        fs.writeFileSync(marker, String(Date.now()));
      } catch {}
      return;
    }

    // First real prompt of the session: fire the reminder and mark as done.
    try {
      fs.writeFileSync(marker, String(Date.now()));
    } catch {}

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: TITLE_HINT,
        },
      })
    );
  } catch {
    // Never block the prompt - emit nothing on any failure.
  }
});
