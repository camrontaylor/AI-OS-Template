import { NextRequest, NextResponse } from "next/server";
import { listDirectory } from "@/lib/file-service";
import { listTaskWorkspaceRoot, resolveTaskFile, resolveTaskWorkspace } from "@/lib/task-file-access";
import { searchTaskWorkspaceFiles } from "@/lib/task-file-search";

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const dir = request.nextUrl.searchParams.get("dir") ?? "";
  const query = request.nextUrl.searchParams.get("query")?.trim() ?? "";
  const context = resolveTaskWorkspace(id);
  if (!context) return NextResponse.json({ error: "Task not found" }, { status: 404 });
  const roots = (listTaskWorkspaceRoot(id) ?? []).filter((node) => node !== null);
  if (query) {
    return NextResponse.json(searchTaskWorkspaceFiles({
      baseDir: context.baseDir,
      roots,
      query,
    }));
  }
  if (!dir) return NextResponse.json(roots);
  const resolved = resolveTaskFile(id, dir);
  if (!resolved) return NextResponse.json({ error: "Access denied" }, { status: 403 });
  try {
    return NextResponse.json(listDirectory(resolved.relativePath, { baseDir: context.baseDir }));
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to list directory";
    return NextResponse.json({ error: message }, { status: message.includes("not found") ? 404 : 403 });
  }
}
