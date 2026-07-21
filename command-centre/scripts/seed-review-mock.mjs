#!/usr/bin/env node
// Seeds a single mock review-queue task that showcases the new inline
// FileOutputCard rendering (Create + Edit) in the chat timeline.
//
// Safe to re-run: it clears any previous mock with the same id first.
//
// Usage: node scripts/seed-review-mock.mjs

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

const TASK_ID = "mock-review-file-card-demo";
const now = new Date();
const iso = (offsetSec) => new Date(now.getTime() + offsetSec * 1000).toISOString();

// Clear any previous run
db.prepare("DELETE FROM task_logs WHERE taskId = ?").run(TASK_ID);
db.prepare("DELETE FROM task_outputs WHERE taskId = ?").run(TASK_ID);
db.prepare("DELETE FROM tasks WHERE id = ?").run(TASK_ID);

// Insert the task
db.prepare(
  `INSERT INTO tasks (id, title, description, status, level, columnOrder, createdAt, updatedAt, startedAt, completedAt, activityLabel)
   VALUES (?, ?, ?, 'review', 'task', 0, ?, ?, ?, ?, ?)`
).run(
  TASK_ID,
  "Sketch the UI spec for Levels & Routing",
  "Turn the Level 1 / Level 2 / GSD routing ideas into a concrete UI spec we can implement.",
  iso(-600),
  iso(-60),
  iso(-600),
  iso(-60),
  "Wrote UI spec, edited chat-entry renderer"
);

// Compose log entries
const entries = [];

function push(type, content, fields = {}) {
  entries.push({
    id: crypto.randomUUID(),
    taskId: TASK_ID,
    type,
    timestamp: iso(entries.length * 6 - 580),
    content,
    toolName: fields.toolName ?? null,
    toolArgs: fields.toolArgs ? JSON.stringify(fields.toolArgs) : null,
    toolResult: fields.toolResult ?? null,
  });
}

// 1. Short intro text
push(
  "text",
  "I'll sketch the screens, components, states and copy for Task vs Planned Project vs GSD, including the Auto-routing flow."
);

// 2. Context reads (will collapse into a "files read" chip)
push("tool_use", "", {
  toolName: "Read",
  toolArgs: { file_path: path.join(repoRoot, "docs/command-centre/legacy/brief.md") },
});
push("tool_result", "brief.md — 142 lines");
push("tool_use", "", {
  toolName: "Grep",
  toolArgs: { pattern: "Level 1|Level 2|GSD", path: "docs/command-centre/legacy" },
});
push("tool_result", "8 matches across 3 files");

// 3. Substantial text block (the "What I'd implement first" recap)
push(
  "text",
  `### What I'd implement first (highest leverage)

- **Auto route option + Routing result card** (teaches levels without forcing jargon)
- **Planned project scoping wizard** that writes \`brief.md\` + proposes subtasks
- Tighten **GSD guardrail CTAs** ("Open active GSD", "Archive current")

 I'll turn that into a concise UI spec you can hand to implementation: screens, components, states, and the exact copy/CTAs for Level 1 vs Level 2 vs GSD (including Auto routing). Then I'll save it in the \`command-centre\` docs so it stays with the product history.`
);

// 4. Write tool_use — the spec file (this should render as a "Created" FileOutputCard)
// Read the real file content so the preview pane shows actual markdown.
import fs from "fs";
const specPath = path.join(repoRoot, "docs/command-centre/legacy/2026-04-10_ui-levels-routing-ui-spec.md");
const specContent = fs.existsSync(specPath) ? fs.readFileSync(specPath, "utf-8") : "# UI spec placeholder\n";

push("tool_use", "", {
  toolName: "Write",
  toolArgs: {
    file_path: specPath,
    content: specContent,
  },
});
push("tool_result", "File created successfully");

// 5. Short confirmation text
push("text", "UI spec saved. The card above should show the breadcrumb + line count and expand to preview the file inline.");

// 6. Edit tool_use — a small edit to chat-entry.tsx (renders as "Edited" card)
push("tool_use", "", {
  toolName: "Edit",
  toolArgs: {
    file_path: path.join(repoRoot, "command-centre/src/components/modal/chat-entry.tsx"),
    old_string: "export function FileOutputCard({ entry }: { entry: LogEntry }) {",
    new_string: "export function FileOutputCard({ entry }: { entry: LogEntry }) {\n  // Cursor-style inline file card",
  },
});
push("tool_result", "File edited successfully");

// 7. Wrap-up text
push(
  "text",
  "Added a tiny comment to anchor the FileOutputCard component. Ready for your review — the two cards above should both expand to show breadcrumb + preview."
);

// Insert log entries
const insertLog = db.prepare(
  `INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult)
   VALUES (@id, @taskId, @type, @timestamp, @content, @toolName, @toolArgs, @toolResult)`
);
const insertMany = db.transaction((rows) => {
  for (const row of rows) insertLog.run(row);
});
insertMany(entries);

// Register outputs so the FILES sidebar shows entries
const outputs = [
  {
    id: crypto.randomUUID(),
    taskId: TASK_ID,
    fileName: "2026-04-10_ui-levels-routing-ui-spec.md",
    filePath: specPath,
    relativePath: "docs/command-centre/legacy/2026-04-10_ui-levels-routing-ui-spec.md",
    extension: "md",
    sizeBytes: fs.existsSync(specPath) ? fs.statSync(specPath).size : 0,
    createdAt: iso(-120),
  },
  {
    id: crypto.randomUUID(),
    taskId: TASK_ID,
    fileName: "chat-entry.tsx",
    filePath: path.join(repoRoot, "command-centre/src/components/modal/chat-entry.tsx"),
    relativePath: "command-centre/src/components/modal/chat-entry.tsx",
    extension: "tsx",
    sizeBytes: 0,
    createdAt: iso(-70),
  },
];
const insertOutput = db.prepare(
  `INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt)
   VALUES (@id, @taskId, @fileName, @filePath, @relativePath, @extension, @sizeBytes, @createdAt)`
);
for (const o of outputs) insertOutput.run(o);

console.log(`Seeded mock review task ${TASK_ID} with ${entries.length} log entries and ${outputs.length} outputs.`);
console.log(`Open the command centre → Feed → look for: "Sketch the UI spec for Levels & Routing" (status: review).`);
