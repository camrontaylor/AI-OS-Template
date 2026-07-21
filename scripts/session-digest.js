#!/usr/bin/env node
// session-digest.js - turn a raw Claude Code session transcript into a small,
// clean digest an LLM can read cheaply. Deterministic, no network.
//
// Used by the nightly `session-backfill` cron to reconstruct Goal / Decisions /
// Corrections / Preferences / Open threads for sessions that ended without a
// manual meta-wrap-up. The raw .jsonl can be megabytes; this emits a few KB.
//
// Usage:
//   node scripts/session-digest.js <session-id | /path/to/transcript.jsonl>
//
// It resolves a bare session id by searching ~/.claude/projects/*/<id>.jsonl,
// so it works for root and every client workspace transcript.

const fs = require("fs");
const os = require("os");
const path = require("path");

function resolveTranscript(arg) {
  if (!arg) return null;
  if (arg.endsWith(".jsonl") && fs.existsSync(arg)) return arg;
  const projectsRoot = path.join(os.homedir(), ".claude", "projects");
  let dirs = [];
  try {
    dirs = fs.readdirSync(projectsRoot, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const d of dirs) {
    if (!d.isDirectory()) continue;
    const candidate = path.join(projectsRoot, d.name, `${arg}.jsonl`);
    if (fs.existsSync(candidate)) return candidate;
  }
  return null;
}

// The user's real words only - strip the harness/hook noise injected around
// each prompt so the LLM reads intent, not machinery.
function cleanUserText(text) {
  return String(text || "")
    .replace(/<system-reminder>[\s\S]*?<\/system-reminder>/gi, " ")
    .replace(/<environment_context[\s\S]*?<\/environment_context>/gi, " ")
    .replace(/<[^>\n]{1,40}-(?:reminder|context|hint)>[\s\S]*?<\/[^>\n]{1,40}>/gi, " ")
    .replace(/<local-command-[a-z]+>[\s\S]*?<\/local-command-[a-z]+>/gi, " ")
    .replace(/<command-(?:name|message|args)>[\s\S]*?<\/command-(?:name|message|args)>/gi, " ")
    .replace(/UserPromptSubmit hook additional context:[\s\S]*?(?=\n\n|$)/gi, " ")
    .replace(/^\s*You are running as a scheduled (?:cron )?job for AI-?OS[\s\S]*?(?=\n\n|$)/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function textFromContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content
    .filter((c) => c && c.type === "text" && typeof c.text === "string")
    .map((c) => c.text)
    .join("\n")
    .trim();
}

function truncate(s, max) {
  const t = String(s || "").replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trim()}...` : t;
}

function main() {
  const arg = process.argv[2];
  const transcript = resolveTranscript(arg);
  if (!transcript) {
    process.stderr.write(`session-digest: no transcript found for "${arg || ""}"\n`);
    process.exit(2);
  }

  const userPrompts = [];
  const assistantTexts = [];
  const files = [];
  const seenFiles = new Set();

  for (const line of fs.readFileSync(transcript, "utf8").split(/\r?\n/)) {
    if (!line.trim()) continue;
    let obj;
    try {
      obj = JSON.parse(line);
    } catch {
      continue;
    }
    const msg = obj && obj.message;
    if (!msg || !msg.role) continue;

    if (msg.role === "user") {
      const text = cleanUserText(textFromContent(msg.content));
      // Skip tool_result-only user turns (content is an array of tool_result).
      if (text && text.length > 2) userPrompts.push(truncate(text, 400));
    } else if (msg.role === "assistant") {
      const text = textFromContent(msg.content);
      if (text) assistantTexts.push(truncate(text, 600));
      const content = Array.isArray(msg.content) ? msg.content : [];
      for (const part of content) {
        if (part && part.type === "tool_use" && /^(Write|Edit|MultiEdit)$/.test(part.name || "")) {
          const fp = (part.input || {}).file_path;
          if (fp && !seenFiles.has(fp)) {
            seenFiles.add(fp);
            files.push(fp);
          }
        }
      }
    }
  }

  const out = [];
  out.push(`# Session digest`);
  out.push(`transcript: ${transcript}`);
  out.push(`turns: ${userPrompts.length} user / ${assistantTexts.length} assistant`);
  out.push("");
  out.push(`## User prompts (intent)`);
  userPrompts.slice(0, 12).forEach((p, i) => out.push(`${i + 1}. ${p}`));
  out.push("");
  out.push(`## Files written or edited`);
  if (files.length === 0) out.push("(none)");
  else files.slice(0, 30).forEach((f) => out.push(`- ${f}`));
  out.push("");
  out.push(`## Assistant reasoning (last turns)`);
  assistantTexts.slice(-10).forEach((t, i) => out.push(`${i + 1}. ${t}`));

  process.stdout.write(`${out.join("\n")}\n`);
}

main();
