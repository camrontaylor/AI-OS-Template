import fs from "fs";
import path from "path";

export interface FileSnapshot {
  [relativePath: string]: { size: number; content?: string };
}

const MAX_CONTENT_SIZE = 256 * 1024; // 256KB — store content for text files under this limit

const TEXT_EXTS = new Set([
  ".md", ".mdx", ".txt", ".json", ".ts", ".tsx", ".js", ".jsx",
  ".css", ".html", ".htm", ".yaml", ".yml", ".toml", ".csv",
  ".sql", ".sh", ".py", ".rb", ".go", ".rs", ".xml", ".svg",
]);

function isTextFile(filePath: string): boolean {
  return TEXT_EXTS.has(path.extname(filePath).toLowerCase());
}

/** Walk a directory and capture file metadata + content for text files. */
export function captureSnapshot(projectDir: string): FileSnapshot {
  const snapshot: FileSnapshot = {};
  const walk = (dir: string, prefix: string) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith(".") || entry.name === "node_modules") continue;
      const fullPath = path.join(dir, entry.name);
      const relPath = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(fullPath, relPath);
      } else if (entry.isFile()) {
        try {
          const stat = fs.statSync(fullPath);
          const record: { size: number; content?: string } = { size: stat.size };
          if (isTextFile(entry.name) && stat.size < MAX_CONTENT_SIZE) {
            record.content = fs.readFileSync(fullPath, "utf-8");
          }
          snapshot[relPath] = record;
        } catch {
          // skip unreadable files
        }
      }
    }
  };
  walk(projectDir, "");
  return snapshot;
}

export type DiffStatus = "added" | "modified" | "unchanged";

/** Classify a file relative to a baseline snapshot. */
export function classifyFile(
  snapshot: FileSnapshot | null,
  relativeToProject: string,
): DiffStatus {
  if (!snapshot) return "unchanged";
  const baseline = snapshot[relativeToProject];
  if (!baseline) return "added";
  // If we have content, we'd need current content to compare — for now use size as proxy
  return "unchanged";
}

/** Classify a file using current disk state vs snapshot. */
export function classifyFileWithDisk(
  snapshot: FileSnapshot | null,
  projectDir: string,
  relativeToProject: string,
): DiffStatus {
  if (!snapshot) return "unchanged";
  const baseline = snapshot[relativeToProject];
  if (!baseline) return "added";

  const fullPath = path.join(projectDir, relativeToProject);
  try {
    const stat = fs.statSync(fullPath);
    if (stat.size !== baseline.size) return "modified";
    // If we stored content, compare it
    if (baseline.content !== undefined && isTextFile(relativeToProject)) {
      const current = fs.readFileSync(fullPath, "utf-8");
      if (current !== baseline.content) return "modified";
    }
  } catch {
    return "unchanged";
  }
  return "unchanged";
}

/** Compute a simple unified diff between two strings. */
export function computeUnifiedDiff(oldContent: string, newContent: string): string {
  const oldLines = oldContent.split("\n");
  const newLines = newContent.split("\n");
  const result: string[] = [];

  // Simple line-by-line comparison (not Myers, but good enough for review)
  const maxLen = Math.max(oldLines.length, newLines.length);
  for (let i = 0; i < maxLen; i++) {
    const oldLine = i < oldLines.length ? oldLines[i] : undefined;
    const newLine = i < newLines.length ? newLines[i] : undefined;
    if (oldLine === newLine) {
      result.push(` ${oldLine}`);
    } else {
      if (oldLine !== undefined) result.push(`-${oldLine}`);
      if (newLine !== undefined) result.push(`+${newLine}`);
    }
  }
  return result.join("\n");
}
