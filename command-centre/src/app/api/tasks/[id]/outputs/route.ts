import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { classifyFileWithDisk, type FileSnapshot } from "@/lib/file-diff";
import type { OutputFile } from "@/types/task";
import path from "path";
import fs from "fs";
import crypto from "crypto";

/** Extensions to skip when backfilling (source code / config). */
const SKIP_EXTENSIONS = new Set([
  "ts", "tsx", "js", "jsx", "css", "scss", "less",
  "py", "rb", "go", "rs", "java", "c", "cpp", "h",
  "sh", "bash", "zsh", "sql",
  "lock", "map", "tsbuildinfo", "env", "gitignore", "eslintrc", "prettierrc",
]);

/**
 * Try to register a single file path as a task output.
 * Validates extension, checks disk existence, and deduplicates.
 */
function tryRegisterFile(
  taskId: string,
  filePath: string,
  db: ReturnType<typeof getDb>,
  config: ReturnType<typeof getConfig>,
): boolean {
  const fileName = path.basename(filePath);
  const extension = path.extname(filePath).replace(".", "").toLowerCase();

  if (!extension || SKIP_EXTENSIONS.has(extension)) return false;
  if (!fs.existsSync(filePath)) return false;

  // Deduplicate
  const existing = db.prepare(
    "SELECT id FROM task_outputs WHERE taskId = ? AND filePath = ? LIMIT 1"
  ).get(taskId, filePath) as { id: string } | undefined;
  if (existing) return false;

  let sizeBytes: number | null = null;
  try { sizeBytes = fs.statSync(filePath).size; } catch { /* ok */ }

  const relativePath = path.relative(config.agenticOsDir, filePath);
  const id = crypto.randomUUID();
  const now = new Date().toISOString();

  db.prepare(
    "INSERT INTO task_outputs (id, taskId, fileName, filePath, relativePath, extension, sizeBytes, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
  ).run(id, taskId, fileName, filePath, relativePath, extension, sizeBytes, now);
  return true;
}

/**
 * Backfill task_outputs for tasks that ran before live file tracking was added.
 *
 * Strategy 1: Scan tool_use log entries for Write/Edit tool calls with file_path args.
 * Strategy 2: Scan text log entries for absolute file paths mentioned in Claude's output.
 *             This catches older tasks where tool_use events weren't logged.
 */
function backfillOutputsFromLogs(taskId: string, db: ReturnType<typeof getDb>): void {
  const config = getConfig();

  // Strategy 1: Scan tool_use entries for Write/Edit/MultiEdit
  const toolEntries = db.prepare(
    `SELECT toolArgs FROM task_logs
     WHERE taskId = ? AND type = 'tool_use'
     AND lower(toolName) IN ('write', 'edit', 'multiedit')
     ORDER BY timestamp ASC`
  ).all(taskId) as Array<{ toolArgs: string | null }>;

  let found = false;
  for (const entry of toolEntries) {
    if (!entry.toolArgs) continue;
    try {
      const args = JSON.parse(entry.toolArgs);
      const filePath: string | undefined = args.file_path ?? args.path;
      if (!filePath || typeof filePath !== "string") continue;
      if (tryRegisterFile(taskId, filePath, db, config)) found = true;
    } catch { /* skip */ }
  }

  if (found) return;

  // Strategy 2: Scan text entries for absolute file paths under the configured AI-OS root.
  const textEntries = db.prepare(
    `SELECT content FROM task_logs
     WHERE taskId = ? AND type = 'text' AND content IS NOT NULL
     ORDER BY timestamp ASC`
  ).all(taskId) as Array<{ content: string }>;

  const agenticOsDir = config.agenticOsDir;
  // Escape special regex characters in the path (especially spaces)
  const escapedDir = agenticOsDir.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const pathRegex = new RegExp(escapedDir + `/[\\w/ ._-]+\\.[\\w]{1,15}`, "g");

  for (const entry of textEntries) {
    const matches = entry.content.match(pathRegex);
    if (!matches) continue;
    for (const match of matches) {
      // Clean up trailing punctuation that might have been captured
      const cleaned = match.replace(/[.,;:!?)}\]]+$/, "");
      try {
        tryRegisterFile(taskId, cleaned, db, config);
      } catch { /* skip */ }
    }
  }
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;

  const db = getDb();

  // Verify task exists and get snapshot + projectSlug
  const task = db.prepare("SELECT id, startSnapshot, projectSlug, clientId FROM tasks WHERE id = ?").get(id) as
    | { id: string; startSnapshot: string | null; projectSlug: string | null; clientId: string | null }
    | undefined;
  if (!task) {
    return NextResponse.json({ error: "Task not found" }, { status: 404 });
  }

  let outputs = db
    .prepare("SELECT * FROM task_outputs WHERE taskId = ? ORDER BY createdAt ASC")
    .all(id) as OutputFile[];

  // Backfill: if no outputs exist, scan log entries for Write/Edit tool calls
  if (outputs.length === 0) {
    backfillOutputsFromLogs(id, db);
    outputs = db
      .prepare("SELECT * FROM task_outputs WHERE taskId = ? ORDER BY createdAt ASC")
      .all(id) as OutputFile[];
  }

  // Enrich with diff status if snapshot exists
  if (task.startSnapshot && task.projectSlug) {
    try {
      const snapshot: FileSnapshot = JSON.parse(task.startSnapshot);
      const config = getConfig();
      const cwd = task.clientId ? getClientAiOsDir(task.clientId) : config.agenticOsDir;
      const projectDir = path.join(cwd, "projects", "briefs", task.projectSlug);

      for (const file of outputs) {
        // Derive relative-to-project path from the full relativePath
        const projectPrefix = `projects/briefs/${task.projectSlug}/`;
        const relToProject = file.relativePath.startsWith(projectPrefix)
          ? file.relativePath.slice(projectPrefix.length)
          : file.relativePath;
        file.diffStatus = classifyFileWithDisk(snapshot, projectDir, relToProject);
      }
    } catch {
      // If parsing fails, leave diffStatus undefined
    }
  }

  return NextResponse.json(outputs);
}
