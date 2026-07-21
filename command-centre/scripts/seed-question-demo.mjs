#!/usr/bin/env node
// Seeds a demo task that showcases inline structured questions in the chat.
// Safe to re-run: clears any previous mock with the same id first.
//
// Usage: node scripts/seed-question-demo.mjs

import Database from "better-sqlite3";
import path from "path";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const repoRoot = findWorkspaceRoot(__dirname);
const dbPath = path.join(repoRoot, ".command-centre", "data.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

const TASK_ID = "mock-structured-question-demo";
const now = new Date();
const iso = (offsetSec) => new Date(now.getTime() + offsetSec * 1000).toISOString();

// Clear any previous run
db.prepare("DELETE FROM task_logs WHERE taskId = ?").run(TASK_ID);
db.prepare("DELETE FROM task_outputs WHERE taskId = ?").run(TASK_ID);
db.prepare("DELETE FROM tasks WHERE id = ?").run(TASK_ID);

// Insert the task — running + needsInput so the form shows
db.prepare(
  `INSERT INTO tasks (id, title, description, status, level, columnOrder, createdAt, updatedAt, startedAt, needsInput, activityLabel)
   VALUES (?, ?, ?, 'running', 'task', 0, ?, ?, ?, 1, ?)`
).run(
  TASK_ID,
  "Brand voice setup (demo)",
  "Set up the brand voice profile for the project.",
  iso(-120),
  iso(-5),
  iso(-120),
  "Waiting for input",
);

const insertLog = db.prepare(
  `INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult, isCollapsed, questionSpec, questionAnswers)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

// 1. Opening text from Claude
insertLog.run(
  crypto.randomUUID(), TASK_ID, "text", iso(-110),
  "I'll help you set up your brand voice profile. Let me start by understanding your brand better.",
  null, null, null, 0, null, null,
);

// 2. Tool use — reading existing context
insertLog.run(
  crypto.randomUUID(), TASK_ID, "tool_use", iso(-100),
  "Read", "Read",
  JSON.stringify({ file_path: "brand_context/voice-profile.md" }),
  null, 1, null, null,
);

// 3. Tool result
insertLog.run(
  crypto.randomUUID(), TASK_ID, "tool_result", iso(-99),
  "(file not found)", null, null,
  "(file not found)", 0, null, null,
);

// 4. Text before asking questions
insertLog.run(
  crypto.randomUUID(), TASK_ID, "text", iso(-90),
  "No existing voice profile found. I need to understand your brand to create one. Let me ask a few questions.",
  null, null, null, 0, null, null,
);

// 5. Structured question — this is the key entry
const questionSpecs = JSON.stringify([
  {
    id: "tone",
    prompt: "What tone best describes your brand?",
    type: "select",
    options: ["Professional & authoritative", "Friendly & conversational", "Bold & provocative", "Calm & reassuring", "Playful & witty"],
    required: true,
  },
  {
    id: "audience",
    prompt: "Who is your primary audience?",
    type: "text",
    placeholder: "e.g. SaaS founders, marketing managers, developers...",
    required: true,
  },
  {
    id: "avoid",
    prompt: "Any words or phrases to avoid?",
    type: "multiline",
    placeholder: "e.g. 'leverage', 'synergy', overly corporate jargon...",
    required: false,
  },
  {
    id: "examples",
    prompt: "Which of these writing styles resonate with you? (pick all that apply)",
    type: "multiselect",
    options: ["Apple — minimal, decisive", "Stripe — technical but warm", "Mailchimp — fun, irreverent", "Notion — clean, understated", "Basecamp — opinionated, direct"],
    required: false,
  },
]);

insertLog.run(
  crypto.randomUUID(), TASK_ID, "structured_question", iso(-85),
  "I have a few questions to shape your voice profile.",
  null, null, null, 0,
  questionSpecs, null, // no answers yet — form should show
);

console.log(`✓ Seeded demo task: "${TASK_ID}"`);
console.log("  Open the command centre and find 'Brand voice setup (demo)' in Claude's Turn.");
db.close();
