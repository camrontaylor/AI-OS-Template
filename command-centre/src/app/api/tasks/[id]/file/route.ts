import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import { writeFile } from "@/lib/file-service";
import { getDb } from "@/lib/db";
import { isHostedTeamMode } from "@/lib/team-mode";
import { resolveTaskFile } from "@/lib/task-file-access";
import { assertTaskMutable, TaskArchiveError } from "@/lib/task-archive";

const MAX_TEXT_SIZE = 1024 * 1024;
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);
const RAW_EXTENSIONS = new Set(["pdf", "html", "htm", ...IMAGE_EXTENSIONS]);
const BINARY_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "tar", "gz", "mp4", "mp3", "wav", "ogg", "webm"]);
const MIME: Record<string, string> = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", svg: "image/svg+xml", ico: "image/x-icon", pdf: "application/pdf", html: "text/html; charset=utf-8", htm: "text/html; charset=utf-8" };

export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filePath = request.nextUrl.searchParams.get("path") ?? "";
  const resolved = resolveTaskFile(id, filePath);
  if (!resolved) return NextResponse.json({ error: "File is outside the Task workspace" }, { status: 403 });
  if (!fs.existsSync(resolved.absolutePath)) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const stat = fs.statSync(resolved.absolutePath);
  const extension = path.extname(resolved.absolutePath).slice(1).toLowerCase();
  if (request.nextUrl.searchParams.get("meta") === "1") {
    return NextResponse.json({
      type: stat.isDirectory() ? "directory" : "file",
      extension,
      size: stat.size,
      lastModified: stat.mtime.toISOString(),
    });
  }
  if (!stat.isFile()) return NextResponse.json({ error: "File not found" }, { status: 404 });
  if (request.nextUrl.searchParams.get("download") === "1") {
    return new NextResponse(fs.readFileSync(resolved.absolutePath), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${path.basename(resolved.absolutePath)}"` } });
  }
  if (request.nextUrl.searchParams.get("raw") === "1" && RAW_EXTENSIONS.has(extension)) {
    const headers: Record<string, string> = {
      "Content-Type": MIME[extension] ?? "application/octet-stream",
      "Cache-Control": "private, max-age=300",
      "X-Content-Type-Options": "nosniff",
    };
    if (extension === "html" || extension === "htm") {
      headers["Content-Security-Policy"] = "default-src 'none'; img-src data: blob:; style-src 'unsafe-inline'; font-src data:";
    }
    return new NextResponse(fs.readFileSync(resolved.absolutePath), { headers });
  }
  if (BINARY_EXTENSIONS.has(extension)) return NextResponse.json({ error: `Unsupported binary file (.${extension})`, extension, size: stat.size }, { status: 415 });
  if (stat.size > MAX_TEXT_SIZE) return NextResponse.json({ content: null, truncated: true, extension, size: stat.size, lastModified: stat.mtime.toISOString() });
  return NextResponse.json({ content: fs.readFileSync(resolved.absolutePath, "utf-8"), truncated: false, extension, size: stat.size, lastModified: stat.mtime.toISOString() });
}

export async function PUT(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const filePath = request.nextUrl.searchParams.get("path") ?? "";
  const resolved = resolveTaskFile(id, filePath);
  if (!resolved) return NextResponse.json({ error: "File is outside the Task workspace" }, { status: 403 });
  try {
    assertTaskMutable(getDb(), id);
  } catch (error) {
    if (error instanceof TaskArchiveError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  }
  const body = await request.json() as { content?: unknown; lastModified?: string };
  if (typeof body.content !== "string") return NextResponse.json({ error: "content is required" }, { status: 400 });
  try {
    const saved = writeFile(resolved.relativePath, body.content, body.lastModified, resolved.baseDir);
    return NextResponse.json({ ok: true, lastModified: saved.lastModified });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to save file";
    return NextResponse.json({ error: message }, { status: message.includes("modified since") ? 409 : 400 });
  }
}

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (isHostedTeamMode()) return NextResponse.json({ error: "Reveal is unavailable in hosted mode" }, { status: 403 });
  const { id } = await params;
  const body = await request.json() as { path?: string; action?: string };
  const resolved = resolveTaskFile(id, body.path ?? "");
  if (!resolved || body.action !== "reveal") return NextResponse.json({ error: "Invalid reveal request" }, { status: 400 });
  if (!fs.existsSync(resolved.absolutePath)) return NextResponse.json({ error: "File not found" }, { status: 404 });
  const command = process.platform === "darwin" ? "open" : process.platform === "win32" ? "explorer" : "xdg-open";
  spawn(command, [resolved.absolutePath], { detached: true, stdio: "ignore", windowsHide: true }).unref();
  return NextResponse.json({ ok: true });
}
