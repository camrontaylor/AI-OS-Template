import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { isWorkScopeError, readWorkScopeFromRow, workScopeErrorBody } from "@/lib/identity/work-scope";
import type { Message } from "@/types/chat";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const db = getDb();
    const conversation = db.prepare(
      "SELECT clientId, workScope FROM conversations WHERE id = ?",
    ).get(id) as { clientId: string | null; workScope: string | null } | undefined;
    if (!conversation) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    readWorkScopeFromRow(conversation);

    const rows = db
      .prepare("SELECT * FROM messages WHERE conversationId = ? ORDER BY createdAt ASC")
      .all(id) as Array<Record<string, unknown>>;

    // Parse metadata JSON
    const messages: Message[] = rows.map((row) => ({
      ...row,
      metadata: row.metadata ? JSON.parse(row.metadata as string) : null,
    })) as Message[];

    return NextResponse.json({ messages });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/chat/conversations/[id]/messages error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
