import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getClientAiOsDir, getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import type { ChatComposerSurface } from "@/types/chat-composer";

const MAX_PREVIEW_SIZE = 1024 * 1024; // 1MB

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);
const PREVIEW_BINARY_EXTENSIONS = new Set(["pdf"]);
const BINARY_EXTENSIONS = new Set(["doc", "docx", "xls", "xlsx", "ppt", "pptx", "zip", "tar", "gz", "mp4", "mp3", "wav", "ogg", "webm"]);
const RAW_TEXT_EXTENSIONS = new Set(["html", "htm"]);

const MIME_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  pdf: "application/pdf",
  html: "text/html; charset=utf-8",
  htm: "text/html; charset=utf-8",
};

function isChatComposerSurface(value: string | null): value is ChatComposerSurface {
  return value === "conversation" || value === "task" || value === "question";
}

function getChatScopeClientId(surface: ChatComposerSurface, scopeId: string): string | null {
  const db = getDb();

  if (surface === "conversation") {
    const row = db.prepare("SELECT clientId FROM conversations WHERE id = ?").get(scopeId) as { clientId: string | null } | undefined;
    return row?.clientId ?? null;
  }

  if (surface === "task") {
    const row = db.prepare("SELECT clientId FROM tasks WHERE id = ?").get(scopeId) as { clientId: string | null } | undefined;
    return row?.clientId ?? null;
  }

  const row = db.prepare(
    `SELECT c.clientId
     FROM messages m
     LEFT JOIN conversations c ON c.id = m.conversationId
     WHERE m.id = ?`
  ).get(scopeId) as { clientId: string | null } | undefined;
  return row?.clientId ?? null;
}

function getBaseDir(request: NextRequest, filePath: string): string {
  const surface = request.nextUrl.searchParams.get("surface");
  const scopeId = request.nextUrl.searchParams.get("scopeId");

  if (filePath.startsWith(".tmp/chat-drafts/") && isChatComposerSurface(surface) && scopeId) {
    const clientId = getChatScopeClientId(surface, scopeId);
    return clientId ? getClientAiOsDir(clientId) : getConfig().agenticOsDir;
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  return getClientAiOsDir(clientId);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Path traversal protection: reject paths containing ..
  if (filePath.includes("..")) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

  const baseDir = getBaseDir(request, filePath);
  const resolvedPath = path.resolve(baseDir, filePath);

  // Path traversal protection: ensure resolved path is within the active workspace
  if (!resolvedPath.startsWith(baseDir)) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

  // Check file exists
  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const ext = path.extname(resolvedPath).replace(".", "").toLowerCase();
  const stat = fs.statSync(resolvedPath);

  // Binary preview: serve the raw file with proper content-type (images, PDFs)
  if (IMAGE_EXTENSIONS.has(ext) || PREVIEW_BINARY_EXTENSIONS.has(ext)) {
    const mimeType = MIME_TYPES[ext] || "application/octet-stream";
    const fileBuffer = fs.readFileSync(resolvedPath);
    return new NextResponse(fileBuffer, {
      headers: {
        "Content-Type": mimeType,
        "Content-Length": stat.size.toString(),
        "Cache-Control": "private, max-age=300",
      },
    });
  }

  // Non-previewable binary formats
  if (BINARY_EXTENSIONS.has(ext)) {
    return NextResponse.json(
      { error: `Binary file (.${ext}) — use download instead` },
      { status: 400 }
    );
  }

  // Raw HTML: serve as text/html so iframes can render it directly.
  // CSP prevents outbound navigation/scripts from escaping the iframe.
  if (RAW_TEXT_EXTENSIONS.has(ext)) {
    const html = fs.readFileSync(resolvedPath, "utf-8");
    return new NextResponse(html, {
      headers: {
        "Content-Type": MIME_TYPES[ext],
        "Cache-Control": "no-store",
        "Content-Security-Policy":
          "default-src 'self' data: blob: 'unsafe-inline' 'unsafe-eval' https: http:; frame-ancestors 'self';",
      },
    });
  }

  // Text preview: any extension not handled above is treated as text.
  // This covers md, txt, csv, json, log, xml, yaml, excalidraw, etc.
  if (stat.size > MAX_PREVIEW_SIZE) {
    return NextResponse.json({
      content: null,
      truncated: true,
      size: stat.size,
      extension: ext,
    });
  }

  const content = fs.readFileSync(resolvedPath, "utf-8");

  return NextResponse.json({
    content,
    truncated: false,
    size: stat.size,
    extension: ext,
  });
}
