export interface MarkdownFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

export function parseMarkdownFrontmatter(raw: unknown): MarkdownFrontmatter;
export function stringifyMarkdownFrontmatter(
  content: unknown,
  data: Record<string, unknown>
): string;
