import { computeUnifiedDiff, type FileSnapshot } from "./file-diff";

export type TaskChangeStatus = "added" | "modified" | "unchanged" | "deleted";
export type TaskChangeUnavailableReason = "binary" | "deleted" | "oversized" | "unreadable" | null;

export interface TaskChange {
  relativePath: string;
  projectRelativePath: string;
  status: TaskChangeStatus;
  diff: string | null;
  unavailableReason: TaskChangeUnavailableReason;
}

export function buildTaskChanges(
  before: FileSnapshot,
  after: FileSnapshot,
  projectPrefix: string,
): TaskChange[] {
  const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return paths.map((projectRelativePath) => {
    const previous = before[projectRelativePath];
    const current = after[projectRelativePath];
    const relativePath = `${projectPrefix.replace(/\/$/, "")}/${projectRelativePath}`;
    if (!current) return { relativePath, projectRelativePath, status: "deleted", diff: null, unavailableReason: "deleted" };
    const status: TaskChangeStatus = !previous
      ? "added"
      : previous.size !== current.size
        || (previous.digest !== undefined && current.digest !== undefined && previous.digest !== current.digest)
        || (previous.content !== undefined && current.content !== previous.content)
        ? "modified"
        : "unchanged";
    if (status === "unchanged") return { relativePath, projectRelativePath, status, diff: null, unavailableReason: null };
    if (current.unavailableReason) {
      return { relativePath, projectRelativePath, status, diff: null, unavailableReason: current.unavailableReason };
    }
    if (current.content === undefined) {
      const unavailableReason = current.size >= 256 * 1024 ? "oversized" : "binary";
      return { relativePath, projectRelativePath, status, diff: null, unavailableReason };
    }
    if (status === "modified" && previous?.content === undefined && previous?.unavailableReason) {
      return { relativePath, projectRelativePath, status, diff: null, unavailableReason: "unreadable" };
    }
    return {
      relativePath,
      projectRelativePath,
      status,
      diff: computeUnifiedDiff(previous?.content ?? "", current.content),
      unavailableReason: null,
    };
  });
}
