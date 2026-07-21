import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { runClaudeTextPrompt } from "@/lib/run-claude-text-prompt";

interface TaskRow {
  id: string;
  title: string;
  description: string | null;
  goalGroup: string | null;
  projectSlug: string | null;
  parentId: string | null;
  level: string;
  status: string;
}

/**
 * POST /api/tasks/cluster-goals
 *
 * Analyzes active ungrouped tasks and assigns semantic goalGroup labels.
 * Tasks with a projectSlug or parentId are skipped — they already have
 * explicit grouping. Only standalone "task" level items get clustered.
 */
export async function POST() {
  try {
    const db = getDb();

    // Fetch all active tasks that could benefit from grouping
    const activeTasks = db
      .prepare(
        `SELECT id, title, description, goalGroup, projectSlug, parentId, level, status
         FROM tasks
         WHERE status NOT IN ('done')
         AND level = 'task'
         AND parentId IS NULL
         ORDER BY updatedAt DESC
         LIMIT 40`
      )
      .all() as TaskRow[];

    if (activeTasks.length < 2) {
      return NextResponse.json({ grouped: 0, message: "Not enough tasks to cluster" });
    }

    // Build the task list for the prompt — include existing groups for context
    const existingGroups = new Set<string>();
    const ungrouped: TaskRow[] = [];

    for (const t of activeTasks) {
      if (t.goalGroup) {
        existingGroups.add(t.goalGroup);
      }
      if (!t.goalGroup && !t.projectSlug) {
        ungrouped.push(t);
      }
    }

    if (ungrouped.length === 0) {
      return NextResponse.json({ grouped: 0, message: "All tasks already grouped" });
    }

    // Build prompt
    const taskLines = ungrouped
      .map((t) => `- [${t.id}] ${t.title}${t.description ? ` — ${t.description.slice(0, 100)}` : ""}`)
      .join("\n");

    const existingGroupList =
      existingGroups.size > 0
        ? `\n\nExisting goal groups (reuse these when tasks fit):\n${[...existingGroups].map((g) => `- ${g}`).join("\n")}`
        : "";

    const prompt = `You are clustering tasks by their semantic goal. Group related tasks under short goal labels (2-5 words, sentence case, no quotes).

Rules:
- Tasks that are clearly related should share the same goal group label
- A task that doesn't relate to any others gets goalGroup: null (don't force it)
- Reuse existing group names when a task fits
- Goal labels should describe the objective, not the action (e.g. "Command centre polish" not "Fix UI bugs")
- Return ONLY valid JSON — an array of objects with "id" and "goalGroup" fields${existingGroupList}

Tasks to cluster:
${taskLines}

Return JSON array:`;

    const result = await runClaude(prompt);
    if (!result) {
      return NextResponse.json({ grouped: 0, message: "AI clustering failed" });
    }

    // Parse the JSON response
    let assignments: Array<{ id: string; goalGroup: string | null }>;
    try {
      // Extract JSON from response (handle markdown code fences)
      const jsonStr = result.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      assignments = JSON.parse(jsonStr);
      if (!Array.isArray(assignments)) throw new Error("Not an array");
    } catch {
      console.error("[cluster-goals] Failed to parse AI response:", result.slice(0, 200));
      return NextResponse.json({ grouped: 0, message: "Failed to parse AI response" });
    }

    // Validate and apply assignments
    const validIds = new Set(ungrouped.map((t) => t.id));
    const update = db.prepare("UPDATE tasks SET goalGroup = ?, updatedAt = ? WHERE id = ?");
    const now = new Date().toISOString();
    let grouped = 0;

    for (const a of assignments) {
      if (!a.id || !validIds.has(a.id)) continue;
      if (a.goalGroup && typeof a.goalGroup === "string" && a.goalGroup.length <= 60) {
        update.run(a.goalGroup, now, a.id);
        grouped++;
      }
    }

    return NextResponse.json({ grouped, total: ungrouped.length });
  } catch (error) {
    console.error("POST /api/tasks/cluster-goals error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function runClaude(prompt: string): Promise<string | null> {
  return runClaudeTextPrompt({
    prompt,
    model: "haiku",
    timeoutMs: 15_000,
  });
}
