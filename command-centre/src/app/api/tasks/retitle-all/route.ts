import { NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { emitTaskEvent } from "@/lib/event-bus";
import type { Task } from "@/types/task";
import { runClaudeTextPrompt } from "@/lib/run-claude-text-prompt";

/**
 * POST /api/tasks/retitle-all
 *
 * One-shot migration: walks every task currently in the DB and asks Haiku to
 * distill each title into a short, human-readable label (3-6 words, Title
 * Case, filler prefixes stripped) — the same shape the scoping wizard now
 * produces via scope-goal's new `projectTitle` field.
 *
 * Batched: a single Haiku call handles up to 40 titles at a time so the
 * total cost stays bounded. Skips tasks that are already well-formed
 * (short, already Title Case, no leading filler).
 *
 * Body (optional): { dryRun?: boolean, limit?: number }
 */

const FILLER_RE =
  /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+(?:want|need|would\s+like)\s+(?:to\s+|you\s+to\s+)?|help\s+me\s+(?:to\s+)?|let's\s+|lets\s+)+/i;

// A title is "good enough" if it's short, doesn't start with filler, and
// isn't one of the raw goal-bar sentences. Skip these to save Haiku calls.
function looksCleanAlready(title: string): boolean {
  const t = title.trim();
  if (t.length === 0) return true;
  if (t.length > 80) return false;
  if (FILLER_RE.test(t)) return false;
  if (t.split(/\s+/).length > 8) return false;
  if (t.endsWith(".") || t.endsWith("?") || t.endsWith("!")) return false;
  // Starts with lowercase word → probably a raw sentence, not a title.
  const first = t.split(/\s+/)[0];
  if (first && first[0] === first[0].toLowerCase() && /^[a-z]/.test(first)) {
    return false;
  }
  return true;
}

export async function POST(request: Request) {
  try {
    const body = await request.json().catch(() => ({}));
    const dryRun = Boolean(body?.dryRun);
    const limit = typeof body?.limit === "number" ? body.limit : 500;

    const db = getDb();
    const allTasks = db
      .prepare(
        `SELECT id, title, description, level FROM tasks ORDER BY createdAt DESC LIMIT ?`
      )
      .all(limit) as Pick<Task, "id" | "title" | "description" | "level">[];

    const candidates = allTasks.filter((t) => !looksCleanAlready(t.title));

    if (candidates.length === 0) {
      return NextResponse.json({
        scanned: allTasks.length,
        candidates: 0,
        updated: 0,
        note: "All task titles already look clean.",
      });
    }

    // Batch through Haiku. 40 titles per call keeps the prompt bounded.
    const BATCH_SIZE = 40;
    const batches: (typeof candidates)[] = [];
    for (let i = 0; i < candidates.length; i += BATCH_SIZE) {
      batches.push(candidates.slice(i, i + BATCH_SIZE));
    }

    const renames: Array<{ id: string; oldTitle: string; newTitle: string }> =
      [];

    for (const batch of batches) {
      const lines = batch
        .map(
          (t, i) =>
            `${i + 1}. [id=${t.id.slice(0, 8)}] ${t.title}${
              t.description ? ` — ${t.description.slice(0, 120)}` : ""
            }`
        )
        .join("\n");

      const prompt = `You are renaming tasks to have short, human-readable titles.

Rules for each new title:
- 3-6 words, Title Case
- Strip filler prefixes: "Help me…", "I want to…", "Can you…", "Please…", "Let's…"
- Name the THING, not the request
- Preserve meaning — a copywriting task stays a copywriting task
- If a title is already clean (e.g. "Q2 Newsletter Launch"), return it unchanged

Examples:
- "help me connect up to the telegram channel" → "Telegram Channel Integration"
- "build me out an app for tracking client feedback" → "Client Feedback Tracker"
- "launch the Q2 newsletter with landing page and emails" → "Q2 Newsletter Launch"
- "redesign the pricing page with 3 tiers" → "Pricing Page Redesign"
- "write a cold email about our new pricing" → "Cold Email: New Pricing"

Tasks to rename (numbered, with partial id for reference):

${lines}

Return ONLY valid JSON — an array of objects matching the input order:
[{"n": 1, "title": "New Title"}, {"n": 2, "title": "Another Title"}, ...]`;

      const result = await runClaude(prompt);
      if (!result) {
        console.warn(
          `[retitle-all] Haiku returned null for batch of ${batch.length}`
        );
        continue;
      }

      let parsed: Array<{ n: number; title: string }>;
      try {
        const jsonStr = result
          .replace(/```json?\s*/g, "")
          .replace(/```/g, "")
          .trim();
        const raw = JSON.parse(jsonStr);
        if (!Array.isArray(raw)) throw new Error("not an array");
        parsed = raw
          .map((r: unknown) => {
            if (!r || typeof r !== "object") return null;
            const obj = r as Record<string, unknown>;
            const n = typeof obj.n === "number" ? obj.n : null;
            const title = typeof obj.title === "string" ? obj.title.trim() : null;
            if (n === null || !title) return null;
            return { n, title };
          })
          .filter((x): x is { n: number; title: string } => x !== null);
      } catch (err) {
        console.error(
          `[retitle-all] Failed to parse Haiku batch response:`,
          err,
          result.slice(0, 200)
        );
        continue;
      }

      for (const { n, title } of parsed) {
        const idx = n - 1;
        if (idx < 0 || idx >= batch.length) continue;
        const task = batch[idx];
        const newTitle = title.slice(0, 80);
        if (newTitle === task.title) continue;
        renames.push({ id: task.id, oldTitle: task.title, newTitle });
      }
    }

    if (dryRun) {
      return NextResponse.json({
        scanned: allTasks.length,
        candidates: candidates.length,
        updated: 0,
        dryRun: true,
        renames,
      });
    }

    // Apply updates.
    const updateStmt = db.prepare(
      "UPDATE tasks SET title = ?, updatedAt = ? WHERE id = ?"
    );
    const now = new Date().toISOString();

    for (const r of renames) {
      updateStmt.run(r.newTitle, now, r.id);
      const updated = db
        .prepare("SELECT * FROM tasks WHERE id = ?")
        .get(r.id) as Task | undefined;
      if (updated) {
        emitTaskEvent({
          type: "task:updated",
          task: { ...updated, needsInput: Boolean(updated.needsInput) },
          timestamp: now,
        });
      }
    }

    return NextResponse.json({
      scanned: allTasks.length,
      candidates: candidates.length,
      updated: renames.length,
      renames: renames.map((r) => ({
        id: r.id.slice(0, 8),
        from: r.oldTitle,
        to: r.newTitle,
      })),
    });
  } catch (error) {
    console.error("POST /api/tasks/retitle-all error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function runClaude(prompt: string): Promise<string | null> {
  return runClaudeTextPrompt({
    prompt,
    model: "haiku",
    timeoutMs: 60_000,
  });
}
