import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import {
  CHAT_ATTACHMENT_MAX_BYTES,
  getChatAttachmentExtension,
  getChatAttachmentValidationError,
} from "@/lib/chat-attachment-policy";
import { getConfig } from "@/lib/config";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";
import {
  assertMaterializedPathWritable,
  MaterializedFileAccessError,
  registerMaterializedFiles,
} from "@/lib/materialized-file-ownership";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse() as NextResponse;
    }

    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const targetDir = formData.get("dir") as string | null;

    if (!file) {
      return NextResponse.json({ error: "No file provided" }, { status: 400 });
    }

    if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
      return NextResponse.json({ error: "File too large (max 10MB)" }, { status: 400 });
    }

    const ext = getChatAttachmentExtension(file.name);
    const validationError = getChatAttachmentValidationError(file);
    if (validationError) {
      return NextResponse.json(
        { error: validationError },
        { status: 400 }
      );
    }

    // Default to projects/ directory
    const dir = targetDir || "projects";

    // Path traversal protection
    if (dir.includes("..")) {
      return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
    }

    const config = getConfig();
    const resolvedDir = path.resolve(config.aiOsDir, dir);

    if (!resolvedDir.startsWith(config.aiOsDir)) {
      return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
    }

    // Ensure directory exists
    fs.mkdirSync(resolvedDir, { recursive: true });

    // Sanitize filename: keep only safe chars
    const safeName = file.name.replace(/[^a-zA-Z0-9._-]/g, "_");
    const resolvedPath = path.join(resolvedDir, safeName);
    assertMaterializedPathWritable(resolvedPath);

    // Write file
    const buffer = Buffer.from(await file.arrayBuffer());
    fs.writeFileSync(resolvedPath, buffer);
    registerMaterializedFiles([resolvedPath], {
      scope: dir.startsWith("clients/") ? "client" : "team",
      kind: "uploaded-file",
    });

    const relativePath = path.relative(config.aiOsDir, resolvedPath);

    return NextResponse.json({
      fileName: safeName,
      filePath: resolvedPath,
      relativePath,
      extension: ext,
      sizeBytes: file.size,
    });
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "File not found" }, { status: 404 });
    }
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
