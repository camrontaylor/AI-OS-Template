import fs from "fs";
import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { captureSnapshot, type FileSnapshot } from "@/lib/file-diff";
import { buildTaskChanges } from "@/lib/task-changes";
import { resolveTaskFile, resolveTaskWorkspace } from "@/lib/task-file-access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const context = resolveTaskWorkspace(id);
  if (!context) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  if (!context.projectSlug) return NextResponse.json({ changes: [], projectSlug: null });
  const row = getDb().prepare("SELECT startSnapshot FROM tasks WHERE id = ?").get(id) as { startSnapshot: string | null } | undefined;
  let before: FileSnapshot = {};
  try { before = row?.startSnapshot ? JSON.parse(row.startSnapshot) : {}; } catch { before = {}; }
  const projectRelative = `projects/briefs/${context.projectSlug}`;
  const resolvedProject = resolveTaskFile(id, projectRelative);
  if (!resolvedProject) return NextResponse.json({ error: "Invalid project boundary" }, { status: 403 });
  const projectDir = resolvedProject.absolutePath;
  const after = fs.existsSync(projectDir) ? captureSnapshot(projectDir) : {};
  return NextResponse.json({ changes: buildTaskChanges(before, after, projectRelative), projectSlug: context.projectSlug });
}
