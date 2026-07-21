#!/usr/bin/env node
// UserPromptSubmit hook - just-in-time AI-OS writing context reminder.
//
// This does not load files or block prompts. It only injects the canonical
// Writing Context Gate from AGENTS.md when a normal user prompt looks like it
// asks for drafting, rewriting, reviewing, or polishing text that may need
// brand, client, memory, or relationship context.

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

const WRITING_CONTEXT_HINT =
  "AI-OS writing context gate: this prompt appears to involve drafting, rewriting, reviewing, or polishing text. Before producing the draft, classify the writing surface and invoke the matching installed skill without waiting for the user to name it: comms-message for one-to-one client/stakeholder messages; mkt-copywriting for sales/public copy; mkt-content-repurposing for repurposed content; mkt-ugc-scripts for spoken/video scripts; mkt-brand-voice for voice/tone work; or the matching specialist skill from the Skill Registry. Read that skill's SKILL.md, any SKILL.local.md, the Context Matrix files, and the relevant context/learnings.md section first. For client work, client-local memory, learnings, brand context, project notes, and synced notes outrank root context for facts, names, promises, scope, and relationship history. Invoke memory-recall when past decisions, client facts, deadlines, scope, money, approvals, delays, conflict, prior wording, or 'as discussed' context could change the writing. Keep quick low-risk wording checks light; use broad search only when facts or relationship risk matter. If no writing skill fits, say that briefly, load available context, and then answer. Agency Discipline: self-source client facts first - run `bash scripts/agency-gather.sh <slug>` and read clients/<slug>/context/ before drafting, and do not ask for what you can read; for an outward-facing deliverable, check the draft with a fresh subagent critic fed the grounded facts before showing it.";

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

  // Avoid nagging on normal coding prompts. The AGENTS.md rule still applies
  // if the coding work itself includes user-facing copy.
  if (CODE_TASK_RE.test(text) && CODE_OR_SYSTEM_RE.test(text) && !/client-facing|public-facing|copy|message|email|post|voice|tone/i.test(text)) {
    return false;
  }

  return true;
}

try {
  const input = readInput();
  const prompt = input.prompt || input.message || "";
  if (!isLikelyWritingPrompt(prompt)) process.exit(0);

  // Once per session: the hint restates an AGENTS.md rule the model already
  // has, so re-injecting ~380 tokens on every matching turn is pure tax
  // (2026-07-16 audit). First matching prompt gets the nudge; after that the
  // standing rule carries it.
  const sessionId = input.session_id || "";
  if (sessionId) {
    const marker = path.join(os.tmpdir(), `aios-writing-gate-${sessionId}.done`);
    if (fs.existsSync(marker)) process.exit(0);
    try { fs.writeFileSync(marker, String(Date.now())); } catch {}
  }

  process.stdout.write(
    JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "UserPromptSubmit",
        additionalContext: WRITING_CONTEXT_HINT,
      },
    })
  );
} catch {
  // Never block the prompt.
}
