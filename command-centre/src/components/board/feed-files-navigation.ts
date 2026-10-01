export function buildDirectoryChain(relativePath: string | null | undefined): string[] {
  if (!relativePath) return [];
  const parts = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .split("/")
    .filter(Boolean);

  return parts.map((_, index) => parts.slice(0, index + 1).join("/"));
}

export function buildFileAncestorChain(relativePath: string | null | undefined): string[] {
  if (!relativePath) return [];
  const normalizedPath = relativePath
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "");
  const lastSeparator = normalizedPath.lastIndexOf("/");
  return lastSeparator < 0
    ? []
    : buildDirectoryChain(normalizedPath.slice(0, lastSeparator));
}
