export type SyncDiffDirection = "pull" | "push";
export type SyncDiffOperation = "write-local" | "write-remote" | "delete-local" | "delete-remote";
export type SyncDiffLineKind = "same" | "remove" | "add";

export interface SyncDiffConflict {
  operation?: SyncDiffOperation;
  localContent?: string;
  remoteContent?: string;
}

export interface SyncDiffLine {
  kind: SyncDiffLineKind;
  value: string;
}

const MAX_RENDERED_DIFF_LINES = 360;
const MAX_LCS_LINES = 420;

export function diffContentsForConflict(
  conflict: SyncDiffConflict,
  direction: SyncDiffDirection,
): { beforeContent: string; afterContent: string } {
  if (conflict.operation === "delete-local") {
    return { beforeContent: conflict.localContent ?? "", afterContent: "" };
  }
  if (conflict.operation === "delete-remote") {
    return { beforeContent: conflict.remoteContent ?? "", afterContent: "" };
  }
  if (conflict.operation === "write-local") {
    return { beforeContent: conflict.localContent ?? "", afterContent: conflict.remoteContent ?? "" };
  }
  if (conflict.operation === "write-remote") {
    return { beforeContent: conflict.remoteContent ?? "", afterContent: conflict.localContent ?? "" };
  }
  if (direction === "pull") {
    return { beforeContent: conflict.localContent ?? "", afterContent: conflict.remoteContent ?? "" };
  }
  return { beforeContent: conflict.remoteContent ?? "", afterContent: conflict.localContent ?? "" };
}

export function diffLines(beforeContent = "", afterContent = ""): SyncDiffLine[] {
  const before = splitDiffLines(beforeContent);
  const after = splitDiffLines(afterContent);
  if (before.length * after.length > MAX_LCS_LINES * MAX_LCS_LINES) {
    return pairedDiffLines(beforeContent, afterContent);
  }

  const dp = Array.from({ length: before.length + 1 }, () => Array(after.length + 1).fill(0) as number[]);
  for (let i = before.length - 1; i >= 0; i -= 1) {
    for (let j = after.length - 1; j >= 0; j -= 1) {
      dp[i][j] = before[i] === after[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const out: SyncDiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < before.length && j < after.length) {
    if (before[i] === after[j]) {
      out.push({ kind: "same", value: before[i] });
      i += 1;
      j += 1;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      out.push({ kind: "remove", value: before[i] });
      i += 1;
    } else {
      out.push({ kind: "add", value: after[j] });
      j += 1;
    }
  }
  while (i < before.length) {
    out.push({ kind: "remove", value: before[i] });
    i += 1;
  }
  while (j < after.length) {
    out.push({ kind: "add", value: after[j] });
    j += 1;
  }
  return out.slice(0, MAX_RENDERED_DIFF_LINES);
}

function normalizeDiffText(value = ""): string {
  const withoutBom = value.charCodeAt(0) === 0xfeff ? value.slice(1) : value;
  const withLf = withoutBom.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  return withLf.endsWith("\n") ? withLf.slice(0, -1) : withLf;
}

function splitDiffLines(value = ""): string[] {
  const normalized = normalizeDiffText(value);
  return normalized === "" ? [] : normalized.split("\n");
}

function pairedDiffLines(beforeContent = "", afterContent = ""): SyncDiffLine[] {
  const before = splitDiffLines(beforeContent);
  const after = splitDiffLines(afterContent);
  const out: SyncDiffLine[] = [];
  const max = Math.max(before.length, after.length);
  for (let index = 0; index < max; index += 1) {
    const beforeLine = index < before.length ? before[index] : undefined;
    const afterLine = index < after.length ? after[index] : undefined;
    if (beforeLine === afterLine) {
      out.push({ kind: "same", value: beforeLine ?? "" });
    } else {
      if (beforeLine !== undefined) out.push({ kind: "remove", value: beforeLine });
      if (afterLine !== undefined) out.push({ kind: "add", value: afterLine });
    }
  }
  return out.slice(0, MAX_RENDERED_DIFF_LINES);
}
