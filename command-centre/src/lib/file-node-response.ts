import type { FileNode } from "@/types/file";

export function asFileNodes(payload: unknown): FileNode[] {
  return Array.isArray(payload) ? (payload as FileNode[]) : [];
}

export async function fetchFileNodes(url: string): Promise<FileNode[]> {
  const res = await fetch(url);
  if (!res.ok) return [];
  const payload: unknown = await res.json();
  return asFileNodes(payload);
}
