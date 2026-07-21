#!/usr/bin/env node
// UserPromptSubmit hook - Agency Discipline reinforcement.
//
// Why this exists: Agency Discipline (AGENTS.md) is an always-on posture, but a
// posture decays as context fills, exactly like the Next Actions Footer does.
// This hook injects a just-in-time reminder of the core so the model takes
// ownership instead of doing the one literal slice. It only reminds; it does not
// run anything or block the prompt.
//
// Fires once per session, on the first non-trivial prompt. "Fragment with big
// hidden scope" is not lexically detectable and is the user's most important
// prompt, so we do NOT try to detect it: we detect trivia and fire on the
// complement, and let the Scale-to-the-turn governor self-suppress. Per-prompt
// reinforcement for client writing lives in writing-context-gate.js instead, so
// this one stays a single, complete, early injection. On any error it emits
// nothing and exits 0 so the prompt is never blocked.

const fs = require("fs");
const path = require("path");
const os = require("os");

const AGENCY_HINT =
  "AI-OS Agency Discipline (AGENTS.md): take ownership of the whole job, and protect the user's decision budget. " +
  "1) Read the WHOLE job the pieces imply, not the literal slice, and cover every part - the top failure is doing only one aspect of what was asked. " +
  "2) Self-source before asking: assume the context exists and go get it. Client work: refresh and read clients/<slug>/context/current-state.md, then run `bash scripts/agency-gather.sh <slug>` and targeted-read what the job needs (never dump the whole folder). System/AI-OS work: read the file(s) the prompt names, recent context/memory/*.md, MEMORY.md, the matching SKILL.md/hook, and AGENTS.md before asserting anything. A clean semantic-search result does NOT mean the answer isn't sitting in an unopened client/system file. " +
  "3) Decide, do not hand back. Anything you can undo, do it and note it as a one-line reversible move; only ask when the call is genuinely the user's (irreversible, outward-facing, or real taste/direction), and then ask one high-value question with a recommendation. Their daily decision capacity is scarce - ration questions hard. " +
  // baked-in:meta-bake-it-in | evidence discipline, stale-copy failure class | 2026-07-21
  "4) Before an outward-facing or judgment deliverable, check your own work: ground every checkable claim at its SOURCE, not a copy (summaries, snapshots, and prior-session notes are leads to their primaries; live or primary wins; stale gets re-checked or date-labelled), tag what you assert (verified fact with source and date / our proposal with the approver named / unknown with the owner named), describe other parties only from their own current words, and for taste or claim-heavy deliverables spawn a fresh subagent critic fed the grounded facts (not the transcript). Make judgment calls visible reversible moves; never a hidden decision or a self-issued green check. " +
  "Scale to the turn: a trivial ask gets a direct answer with none of this. Off-switch for one turn: 'just the literal thing' / 'narrow mode'.";

const GREETING_RE =
  /^(hi|hey|hello|yo|sup|gm|hiya|howdy|morning|good (morning|afternoon|evening)|hey there|hello there|what'?s up|whats up)[\s!.?,]*$/i;

const TRIVIAL_RE =
  /^(thanks|thank you|ok|okay|yes|no|cool|got it|done|continue|go on|nice|sounds good|yep|yeah|sure|k)[.! ]*$/i;

function isTrivial(prompt) {
  const cleaned = String(prompt || "").trim();
  if (!cleaned) return true;
  if (cleaned.length <= 30 && GREETING_RE.test(cleaned)) return true;
  if (TRIVIAL_RE.test(cleaned)) return true;
  return false;
}

let input = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => (input += chunk));
process.stdin.on("end", () => {
  try {
    const data = JSON.parse(input || "{}");
    const sessionId = data.session_id;
    const prompt = data.prompt || data.message || "";
    if (!sessionId) return;

    const marker = path.join(os.tmpdir(), "cc-agency-" + sessionId + ".done");

    // Already fired this session -> stay silent.
    if (fs.existsSync(marker)) return;

    // Trivial opener -> do not consume the once-per-session fire; wait for a real task.
    if (isTrivial(prompt)) return;

    try {
      fs.writeFileSync(marker, String(Date.now()));
    } catch {}

    process.stdout.write(
      JSON.stringify({
        hookSpecificOutput: {
          hookEventName: "UserPromptSubmit",
          additionalContext: AGENCY_HINT,
        },
      })
    );
  } catch {
    // Never block the prompt.
  }
});
