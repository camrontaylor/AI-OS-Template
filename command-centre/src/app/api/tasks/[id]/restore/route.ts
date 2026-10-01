import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import { restoreGoal, TaskArchiveError } from "@/lib/task-archive";
import {
  isWorkScopeError,
  workScopeErrorBody,
} from "@/lib/identity/work-scope";

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { id } = await params;
    const tasks = restoreGoal({ db: getDb(), goalId: id });
    const root = tasks.find((task) => task.id === id);
    if (root) emitTaskEvent({ type: "task:updated", task: root, timestamp: root.updatedAt });
    return NextResponse.json({ tasks });
  } catch (error) {
    if (isWorkScopeError(error)) {
      return NextResponse.json(workScopeErrorBody(error), { status: error.status });
    }
    const status = error instanceof TaskArchiveError ? error.status : 500;
    const message = error instanceof Error ? error.message : "Failed to restore Goal";
    return NextResponse.json({ error: message }, { status });
  }
}
