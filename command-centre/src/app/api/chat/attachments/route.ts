import { NextRequest, NextResponse } from "next/server";
import {
  cleanupChatAttachmentStorage,
  clearChatDraftScope,
  deleteChatDraftAttachment,
  storeChatDraftFiles,
} from "@/lib/chat-attachment-service";
import type { ChatComposerSurface } from "@/types/chat-composer";
import { isWorkScopeError, workScopeErrorBody } from "@/lib/identity/work-scope";

function isChatComposerSurface(value: string): value is ChatComposerSurface {
  return value === "conversation" || value === "task" || value === "question";
}

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const surface = String(formData.get("surface") || "");
    const scopeId = String(formData.get("scopeId") || "");
    const draftKey = String(formData.get("draftKey") || "");
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (!isChatComposerSurface(surface) || !scopeId || !draftKey) {
      return NextResponse.json({ error: "surface, scopeId, and draftKey are required" }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const attachments = await storeChatDraftFiles({ surface, scopeId, draftKey, files });
    cleanupChatAttachmentStorage({ surface, scopeId });

    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const surface = String(body.surface || "");
    const scopeId = String(body.scopeId || "");
    const draftKey = String(body.draftKey || "");
    const relativePath = typeof body.relativePath === "string" ? body.relativePath : null;

    if (!isChatComposerSurface(surface) || !scopeId || !draftKey) {
      return NextResponse.json({ error: "surface, scopeId, and draftKey are required" }, { status: 400 });
    }

    if (relativePath) {
      deleteChatDraftAttachment({ surface, scopeId, draftKey, relativePath });
    } else {
      clearChatDraftScope({ surface, scopeId, draftKey });
    }

    cleanupChatAttachmentStorage({ surface, scopeId });

    return NextResponse.json({ ok: true });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
