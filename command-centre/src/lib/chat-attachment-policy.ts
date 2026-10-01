const CHAT_ATTACHMENT_EXTENSIONS = [
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "pdf",
  "md",
  "txt",
  "csv",
  "json",
  "html",
  "log",
  "yaml",
  "yml",
  "sh",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "css",
  "scss",
  "sql",
  "xml",
  "toml",
] as const;

export const CHAT_ATTACHMENT_MAX_BYTES = 10 * 1024 * 1024;
export const CHAT_ATTACHMENT_ALLOWED_EXTENSIONS = new Set<string>(CHAT_ATTACHMENT_EXTENSIONS);
export const CHAT_ATTACHMENT_ACCEPT_ATTR = `image/*,${CHAT_ATTACHMENT_EXTENSIONS
  .filter((ext) => !["png", "jpg", "jpeg", "gif", "webp", "svg"].includes(ext))
  .map((ext) => `.${ext}`)
  .join(",")}`;

export function getChatAttachmentExtension(fileName: string): string {
  const lastDot = fileName.lastIndexOf(".");
  return lastDot >= 0 ? fileName.slice(lastDot + 1).toLowerCase() : "";
}

export function isAllowedChatAttachmentExtension(extension: string): boolean {
  return CHAT_ATTACHMENT_ALLOWED_EXTENSIONS.has(extension.toLowerCase());
}

export function getChatAttachmentValidationError(file: { name: string; size: number }): string | null {
  const extension = getChatAttachmentExtension(file.name);
  if (!extension || !isAllowedChatAttachmentExtension(extension)) {
    return extension
      ? `File type .${extension} is not allowed`
      : "That file type is not allowed";
  }
  if (file.size > CHAT_ATTACHMENT_MAX_BYTES) {
    return "File too large (max 10MB)";
  }
  return null;
}
