import { NextRequest, NextResponse } from "next/server";
import {
  clearGoalDraftScope,
  deleteGoalDraftAttachment,
  storeGoalDraftFiles,
} from "@/lib/goal-draft-attachment-service";

export async function POST(request: NextRequest): Promise<NextResponse> {
  try {
    const formData = await request.formData();
    const draftId = String(formData.get("draftId") || "");
    const clientIdValue = formData.get("clientId");
    const clientId = typeof clientIdValue === "string" && clientIdValue ? clientIdValue : null;
    const files = formData
      .getAll("files")
      .filter((value): value is File => value instanceof File);

    if (!draftId) {
      return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    }

    if (files.length === 0) {
      return NextResponse.json({ error: "No files provided" }, { status: 400 });
    }

    const attachments = await storeGoalDraftFiles({ draftId, clientId, files });
    return NextResponse.json({ attachments }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest): Promise<NextResponse> {
  try {
    const body = await request.json();
    const draftId = typeof body.draftId === "string" ? body.draftId : "";
    const clientId = typeof body.clientId === "string" && body.clientId ? body.clientId : null;
    const relativePath = typeof body.relativePath === "string" ? body.relativePath : null;

    if (!draftId) {
      return NextResponse.json({ error: "draftId is required" }, { status: 400 });
    }

    if (relativePath) {
      deleteGoalDraftAttachment({ draftId, clientId, relativePath });
    } else {
      clearGoalDraftScope({ draftId, clientId });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Delete failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
