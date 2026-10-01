import "server-only";

import fs from "fs";
import path from "path";
import { getClientAiOsDir } from "@/lib/config";
import { extractApprovedBriefFromLogs } from "@/lib/plan-brief";
import type { LogEntry, Task } from "@/types/task";
import {
  assertMaterializedPathWritable,
  isMaterializedPathAccessible,
  registerMaterializedFiles,
} from "./materialized-file-ownership";

const FRONTMATTER_BLOCK = /^---\r?\n[\s\S]*?\r?\n---\r?\n*/;

export function saveApprovedPlanToBrief(task: Task, logEntries: LogEntry[]): string | null {
  if (!task.projectSlug) return null;

  const approvedBrief = extractApprovedBriefFromLogs(logEntries);
  if (!approvedBrief) return null;

  const baseDir = getClientAiOsDir(task.clientId ?? null);
  const briefDir = path.join(baseDir, "projects", "briefs", task.projectSlug);
  const briefPath = path.join(briefDir, "brief.md");
  if (fs.existsSync(briefPath) && !isMaterializedPathAccessible(briefPath)) return null;
  assertMaterializedPathWritable(briefPath);
  fs.mkdirSync(briefDir, { recursive: true });

  let finalContent = approvedBrief;
  if (fs.existsSync(briefPath)) {
    const existing = fs.readFileSync(briefPath, "utf-8");
    const frontmatter = existing.match(FRONTMATTER_BLOCK)?.[0] ?? "";
    if (frontmatter && !approvedBrief.startsWith("---")) {
      finalContent = `${frontmatter.trimEnd()}\n\n${approvedBrief}`;
    }
  }

  fs.writeFileSync(briefPath, finalContent + "\n", "utf-8");
  registerMaterializedFiles([briefPath], {
    scope: task.clientId ? "client" : "team",
    kind: "approved-project-brief",
  });
  return briefPath;
}
