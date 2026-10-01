import {
  FileText,
  Image as ImageIcon,
  PenTool,
  Braces,
  Code,
  Terminal,
  Table,
  File as FileIcon,
  type LucideIcon,
} from "lucide-react";

/**
 * Returns a file-type-appropriate Lucide icon for a given filename.
 * Used by file trees and preview headers so that different content types
 * are visually distinguishable at a glance.
 */
export function getFileIcon(fileName: string): LucideIcon {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "md":
    case "mdx":
    case "txt":
    case "pdf":
      return FileText;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
    case "ico":
      return ImageIcon;
    case "excalidraw":
      return PenTool;
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return Braces;
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "rb":
    case "go":
    case "rs":
    case "java":
    case "c":
    case "h":
    case "cpp":
    case "css":
    case "scss":
    case "html":
      return Code;
    case "sh":
    case "bash":
    case "zsh":
    case "ps1":
    case "fish":
      return Terminal;
    case "csv":
    case "tsv":
    case "xlsx":
    case "xls":
      return Table;
    default:
      return FileIcon;
  }
}

/** Returns a colour to tint the file icon, picked to match the Docs palette. */
export function getFileIconColor(fileName: string): string {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "md":
    case "mdx":
    case "txt":
      return "var(--cc-text-secondary)"; // neutral grey (matches current default)
    case "pdf":
      return "var(--cc-status-danger)"; // red tint
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
    case "svg":
    case "ico":
      return "var(--cc-status-info)"; // blue
    case "excalidraw":
      return "var(--cc-status-purple-bright)"; // purple
    case "json":
    case "yaml":
    case "yml":
    case "toml":
      return "var(--cc-status-warning-bright)"; // amber
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "mjs":
    case "cjs":
    case "py":
    case "rb":
    case "go":
    case "rs":
    case "java":
    case "c":
    case "h":
    case "cpp":
    case "css":
    case "scss":
    case "html":
      return "var(--cc-palette-green)"; // green
    case "sh":
    case "bash":
    case "zsh":
    case "ps1":
    case "fish":
      return "var(--cc-text-secondary)"; // slate
    case "csv":
    case "tsv":
    case "xlsx":
    case "xls":
      return "var(--cc-palette-green)"; // emerald
    default:
      return "var(--cc-text-secondary)";
  }
}
