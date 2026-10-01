import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getClientAiOsDir, getConfig } from "@/lib/config";
import { getDb } from "@/lib/db";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";
import type { ChatComposerSurface } from "@/types/chat-composer";
import { getActiveLocalProfileDescriptor } from "@/lib/db";
import { isWorkScopeError, readWorkScopeFromRow, workScopeErrorBody } from "@/lib/identity/work-scope";
import { assertMaterializedPathAccessible, MaterializedFileAccessError } from "@/lib/materialized-file-ownership";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { parseSkillOrigin, resolveSkillFileTarget, type ResolvedSkillFileTarget } from "@/lib/skill-catalog";

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

function isWithinDirectory(targetPath: string, baseDir: string): boolean {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function isChatComposerSurface(value: string | null): value is ChatComposerSurface {
  return value === "conversation" || value === "task" || value === "question";
}

function getChatScopeClientId(surface: ChatComposerSurface, scopeId: string): string | null {
  const db = getDb();

  if (surface === "conversation") {
    const row = db.prepare("SELECT clientId, workScope FROM conversations WHERE id = ?").get(scopeId) as { clientId: string | null; workScope: string | null } | undefined;
    if (!row) throw new Error("Conversation not found");
    readWorkScopeFromRow(row);
    return row.clientId ?? null;
  }

  if (surface === "task") {
    const row = db.prepare("SELECT clientId, workScope FROM tasks WHERE id = ?").get(scopeId) as { clientId: string | null; workScope: string | null } | undefined;
    if (!row) throw new Error("Task not found");
    readWorkScopeFromRow(row);
    return row.clientId ?? null;
  }

  const row = db.prepare(
    `SELECT c.clientId, c.workScope
     FROM messages m
     LEFT JOIN conversations c ON c.id = m.conversationId
     WHERE m.id = ?`
  ).get(scopeId) as { clientId: string | null; workScope: string | null } | undefined;
  if (!row) throw new Error("Message scope not found");
  readWorkScopeFromRow(row);
  return row.clientId ?? null;
}

function getBaseDir(request: NextRequest, filePath: string): string {
  const profile = getActiveLocalProfileDescriptor();
  const surface = request.nextUrl.searchParams.get("surface");
  const scopeId = request.nextUrl.searchParams.get("scopeId");
  if (isChatComposerSurface(surface) && scopeId) {
    getChatScopeClientId(surface, scopeId);
  }
  if (
    profile.mode === "team" &&
    (filePath.startsWith("tmp/chat-drafts/") || filePath.startsWith("tmp/goal-drafts/"))
  ) {
    return profile.dataDir;
  }
  if (filePath.startsWith(".tmp/chat-drafts/") && isChatComposerSurface(surface) && scopeId) {
    const clientId = getChatScopeClientId(surface, scopeId);
    return clientId ? getClientAiOsDir(clientId) : getConfig().aiOsDir;
  }

  const clientId = request.nextUrl.searchParams.get("clientId");
  if (request.nextUrl.searchParams.get("surface") === "docs" && (filePath === "clients" || filePath.startsWith("clients/"))) {
    return getConfig().aiOsDir;
  }
  return getClientAiOsDir(clientId);
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const filePath = request.nextUrl.searchParams.get("path");
  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }
  let skillTarget: ResolvedSkillFileTarget | null = null;
  try {
    const requestedOrigin = request.nextUrl.searchParams.get("skillOrigin");
    const skillOrigin = parseSkillOrigin(requestedOrigin);
    if (requestedOrigin && !skillOrigin) {
      return NextResponse.json({ error: "Invalid skill origin" }, { status: 400 });
    }
    if (skillOrigin) skillTarget = await resolveSkillFileTarget(request, filePath, skillOrigin);

    const isDocsRequest = request.nextUrl.searchParams.get("surface") === "docs";
    const profile = getActiveLocalProfileDescriptor();
    const isProfileAttachment = profile.mode === "team" &&
      (filePath.startsWith("tmp/chat-drafts/") || filePath.startsWith("tmp/goal-drafts/"));
    if (!skillTarget && !isDocsRequest && !isProfileAttachment && isHostedTeamMode() && !request.nextUrl.searchParams.get("clientId")) {
      return hostedModeForbiddenResponse() as NextResponse;
    }

  // Path traversal protection: reject paths containing ..
  if (filePath.includes("..")) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

    let baseDir: string;
    try {
      baseDir = skillTarget?.baseDir ?? getBaseDir(request, filePath);
    } catch (error) {
      if (isWorkScopeError(error)) {
        return NextResponse.json(workScopeErrorBody(error), { status: error.status });
      }
      throw error;
    }
    const resolvedPath = path.resolve(baseDir, skillTarget?.storagePath ?? filePath);

  // Path traversal protection: ensure resolved path is within the active workspace
  if (!isWithinDirectory(resolvedPath, baseDir)) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }
    if (!skillTarget) {
      try {
        assertMaterializedPathAccessible(resolvedPath);
      } catch (error) {
        if (error instanceof MaterializedFileAccessError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
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
  } catch (error) {
    if (error instanceof RequestPrincipalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  } finally {
    await skillTarget?.close();
  }
}
