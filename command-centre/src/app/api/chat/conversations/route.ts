import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { assertValidClientId } from "@/lib/clients";
import {
  assertNoWorkScopeInput,
  captureNewWorkScope,
  isWorkScopeError,
  normalizeWorkScopedRow,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";
import type { Conversation } from "@/types/chat";

export async function GET(request: NextRequest) {
  try {
    const db = getDb();
    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status");
    const clientId = searchParams.get("clientId");
    const requireDefaultScope = searchParams.get("defaultScope") === "1";

    const conditions: string[] = [];
    const params: unknown[] = [];

    if (status) {
      conditions.push("status = ?");
      params.push(status);
    }
    if (clientId === "root") {
      conditions.push("clientId IS NULL");
    } else if (clientId) {
      conditions.push("clientId = ?");
      params.push(clientId);
    }
    if (requireDefaultScope) {
      const captured = await captureNewWorkScope(clientId === "root" ? null : clientId);
      if (captured.scope.mode === "solo") {
        conditions.push("(workScope IS NULL OR workScope = ?)");
      } else {
        conditions.push("workScope = ?");
      }
      params.push(captured.serialized);
    }

    const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
    const rows = db
      .prepare(`SELECT * FROM conversations${where} ORDER BY updatedAt DESC LIMIT 20`)
      .all(...params) as Array<Record<string, unknown> & { clientId: string | null; workScope: string | null }>;

    return NextResponse.json(rows.map((row) => normalizeWorkScopedRow(row)));
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("GET /api/chat/conversations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const db = getDb();
    const body = await request.json();
    assertNoWorkScopeInput(body);
    const { clientId: rawClientId, title } = body;

    let clientId: string | null;
    try {
      clientId = assertValidClientId(rawClientId);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Invalid client selection";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    const captured = await captureNewWorkScope(clientId);

    const now = new Date().toISOString();
    const conversation: Conversation = {
      id: crypto.randomUUID(),
      title: title || null,
      status: "active",
      createdAt: now,
      updatedAt: now,
      clientId: captured.clientId,
      workScope: captured.scope,
    };

    db.prepare(
      `INSERT INTO conversations (id, title, status, createdAt, updatedAt, clientId, workScope)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      conversation.id,
      conversation.title,
      conversation.status,
      conversation.createdAt,
      conversation.updatedAt,
      conversation.clientId,
      captured.serialized,
    );

    return NextResponse.json(conversation, { status: 201 });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    console.error("POST /api/chat/conversations error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
