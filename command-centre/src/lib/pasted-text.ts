export const PASTED_TEXT_LINE_THRESHOLD = 8;
export const PASTED_TEXT_CHAR_THRESHOLD = 320;
export const PASTED_TEXT_SEPARATOR = "\n\n---\n\n";

export interface PendingPastedTextBlock {
  id: string;
  text: string;
}

export interface PastedTextSummary {
  lineCount: number;
  charCount: number;
  label: string;
  preview: string;
}

function normalizePastedText(text: string): string {
  return text.replace(/\r\n/g, "\n");
}

export function countPastedTextLines(text: string): number {
  if (!text) return 1;
  return normalizePastedText(text).split("\n").length;
}

export function shouldCapturePastedText(text: string): boolean {
  if (!text.trim()) return false;
  return (
    countPastedTextLines(text) > PASTED_TEXT_LINE_THRESHOLD ||
    text.length > PASTED_TEXT_CHAR_THRESHOLD
  );
}

export function buildPastedTextLabel(text: string): string {
  const lineCount = countPastedTextLines(text);
  const charCount = text.length;
  return `${lineCount.toLocaleString()} line${lineCount === 1 ? "" : "s"} · ${charCount.toLocaleString()} char${charCount === 1 ? "" : "s"}`;
}

export function buildPastedTextPreview(
  text: string,
  { maxLines = 5, maxChars = 180 }: { maxLines?: number; maxChars?: number } = {},
): string {
  const normalized = normalizePastedText(text).trim();
  if (!normalized) return "Blank text";

  const limitedLines = normalized.split("\n").slice(0, maxLines).join("\n");
  if (limitedLines.length <= maxChars) return limitedLines;
  return `${limitedLines.slice(0, maxChars - 1).trimEnd()}…`;
}

export function getPastedTextSummary(text: string): PastedTextSummary {
  return {
    lineCount: countPastedTextLines(text),
    charCount: text.length,
    label: buildPastedTextLabel(text),
    preview: buildPastedTextPreview(text),
  };
}

export function appendPendingPastedText(
  value: string,
  blocks: ReadonlyArray<PendingPastedTextBlock>,
): string {
  const base = value.trim();
  const appended = blocks.map((block) => block.text).filter(Boolean).join(PASTED_TEXT_SEPARATOR);
  if (!appended) return base;
  return base ? `${base}\n\n${appended}` : appended;
}

export function insertPastedTextAtSelection(
  value: string,
  text: string,
  selectionStart = value.length,
  selectionEnd = selectionStart,
): { value: string; selectionStart: number; selectionEnd: number } {
  const nextValue =
    value.slice(0, selectionStart) +
    text +
    value.slice(selectionEnd);
  const nextCursor = selectionStart + text.length;
  return {
    value: nextValue,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export function removePendingPastedText<T extends { id: string }>(
  blocks: ReadonlyArray<T>,
  id: string,
): T[] {
  return blocks.filter((block) => block.id !== id);
}
