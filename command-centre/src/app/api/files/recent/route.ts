import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";

// GET /api/files/recent?limit=10&clientId=xxx
// Returns recent output files across all tasks, joined with task info.
export async function GET(request: NextRequest) {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse();
    }

    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "10", 10), 50);
    const clientId = searchParams.get("clientId");

    const db = getDb();

    let query = `
      SELECT o.id, o.taskId, o.fileName, o.filePath, o.relativePath, o.extension, o.sizeBytes, o.createdAt,
             t.title as taskTitle, t.level as taskLevel, t.projectSlug, t.clientId
      FROM task_outputs o
      JOIN tasks t ON o.taskId = t.id
    `;
    const params: unknown[] = [];

    if (clientId && clientId !== "root") {
      query += " WHERE t.clientId = ?";
      params.push(clientId);
    }

    query += " ORDER BY o.createdAt DESC LIMIT ?";
    params.push(limit);

    const rows = db.prepare(query).all(...params);
    return NextResponse.json(rows);
  } catch (error) {
    console.error("GET /api/files/recent error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
