export interface DocumentScrollAnchor {
  line: number;
  offset: number;
}

export function textareaAnchorFromScroll(scrollTop: number, lineHeight: number): DocumentScrollAnchor {
  const line = Math.floor(scrollTop / lineHeight) + 1;
  return { line, offset: (line - 1) * lineHeight - scrollTop };
}

export function textareaScrollForAnchor(anchor: DocumentScrollAnchor, lineHeight: number): number {
  return Math.max(0, (anchor.line - 1) * lineHeight - anchor.offset);
}

function elementLineHeight(element: HTMLElement): number {
  const computed = getComputedStyle(element);
  const parsed = Number.parseFloat(computed.lineHeight);
  if (Number.isFinite(parsed)) return parsed;
  return Number.parseFloat(computed.fontSize || "16") * 1.6;
}

export function captureDocumentAnchor(container: HTMLElement): DocumentScrollAnchor {
  const containerRect = container.getBoundingClientRect();
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-source-line]"));
  const visible = candidates.find((element) => element.getBoundingClientRect().bottom > containerRect.top + 1)
    ?? candidates.at(-1);
  if (!visible) return { line: 1, offset: -container.scrollTop };
  return {
    line: Number(visible.dataset.sourceLine) || 1,
    offset: visible.getBoundingClientRect().top - containerRect.top,
  };
}

export function restoreDocumentAnchor(container: HTMLElement, anchor: DocumentScrollAnchor): void {
  const candidates = Array.from(container.querySelectorAll<HTMLElement>("[data-source-line]"));
  const target = candidates.reduce<HTMLElement | null>((best, element) => {
    const line = Number(element.dataset.sourceLine) || 1;
    if (line > anchor.line) return best;
    if (!best || line > (Number(best.dataset.sourceLine) || 1)) return element;
    return best;
  }, null) ?? candidates[0];
  if (!target) {
    container.scrollTop = Math.max(0, -anchor.offset);
    return;
  }
  const containerRect = container.getBoundingClientRect();
  container.scrollTop += target.getBoundingClientRect().top - containerRect.top - anchor.offset;
}

export function captureTextareaAnchor(textarea: HTMLTextAreaElement): DocumentScrollAnchor {
  const lineHeight = elementLineHeight(textarea);
  return textareaAnchorFromScroll(textarea.scrollTop, lineHeight);
}

export function restoreTextareaAnchor(textarea: HTMLTextAreaElement, anchor: DocumentScrollAnchor): void {
  const lineHeight = elementLineHeight(textarea);
  textarea.scrollTop = textareaScrollForAnchor(anchor, lineHeight);
}
