import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import {
  assertNoWorkScopeInput,
  captureNewWorkScope,
  isWorkScopeError,
  normalizeWorkScopedRow,
  readWorkScopeFromRow,
  sameStoredWorkScope,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const row = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    if (!row) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    const conversation = normalizeWorkScopedRow(row as { clientId: string | null; workScope: string | null });
    if (new URL(request.url).searchParams.get("defaultScope") === "1") {
      const captured = await captureNewWorkScope(conversation.clientId);
      if (!sameStoredWorkScope(conversation.workScope, captured.scope)) {
        return NextResponse.json({ error: "Conversation is outside the current default work scope" }, { status: 409 });
      }
    }
    return NextResponse.json(conversation);
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/chat/conversations/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const body = await request.json();
    assertNoWorkScopeInput(body);
    const existing = db.prepare("SELECT clientId, workScope FROM conversations WHERE id = ?").get(id) as
      | { clientId: string | null; workScope: string | null }
      | undefined;
    if (!existing) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    readWorkScopeFromRow(existing);
    const now = new Date().toISOString();

    const updates: string[] = [`updatedAt = ?`];
    const values: unknown[] = [now];

    if (body.title !== undefined) {
      updates.push("title = ?");
      values.push(body.title);
    }
    if (body.status !== undefined) {
      updates.push("status = ?");
      values.push(body.status);
    }

    values.push(id);

    db.prepare(`UPDATE conversations SET ${updates.join(", ")} WHERE id = ?`).run(...values);

    const updated = db.prepare("SELECT * FROM conversations WHERE id = ?").get(id);
    return NextResponse.json(normalizeWorkScopedRow(updated as { clientId: string | null; workScope: string | null }));
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("PATCH /api/chat/conversations/[id] error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
