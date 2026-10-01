import type { FileNode, TaskFileSearchResponse } from "@/types/file";
import { listDirectory } from "./file-service";

export const TASK_FILE_SEARCH_LIMIT = 30;

interface SearchTaskWorkspaceFilesOptions {
  baseDir: string;
  roots: FileNode[];
  query: string;
  limit?: number;
}

/**
 * Search visible Task workspace files without requiring the client-side tree
 * to load or expand each directory first. The returned tree contains only
 * matching files and the directory chain needed to locate them.
 */
export function searchTaskWorkspaceFiles({
  baseDir,
  roots,
  query,
  limit = TASK_FILE_SEARCH_LIMIT,
}: SearchTaskWorkspaceFilesOptions): TaskFileSearchResponse {
  const normalizedQuery = query.trim().toLowerCase();
  if (!normalizedQuery || limit < 1) return { nodes: [], truncated: false };

  let matchCount = 0;
  let truncated = false;

  const visit = (node: FileNode): FileNode | null => {
    if (truncated) return null;

    if (node.type === "file") {
      if (!node.path.toLowerCase().includes(normalizedQuery)) return null;
      matchCount += 1;
      if (matchCount > limit) {
        truncated = true;
        return null;
      }
      return node;
    }

    let childNodes: FileNode[];
    try {
      childNodes = listDirectory(node.path, { baseDir });
    } catch {
      return null;
    }

    const matchingChildren: FileNode[] = [];
    for (const child of childNodes) {
      const matchingChild = visit(child);
      if (matchingChild) matchingChildren.push(matchingChild);
      if (truncated) break;
    }

    return matchingChildren.length > 0
      ? { ...node, children: matchingChildren }
      : null;
  };

  const nodes: FileNode[] = [];
  for (const root of roots) {
    const matchingRoot = visit(root);
    if (matchingRoot) nodes.push(matchingRoot);
    if (truncated) break;
  }

  return { nodes, truncated };
}
