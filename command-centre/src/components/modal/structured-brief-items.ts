export interface StructuredBriefItem {
  title: string;
  description: string;
}

function cleanTitle(value: string): string {
  return value.trim().replace(/^\*\*(.+)\*\*$/, "$1").trim();
}

function isEligibleFence(languageClassName?: string): boolean {
  if (!languageClassName) return true;
  return languageClassName.split(/\s+/).includes("language-json");
}

export function parseStructuredBriefItems(
  raw: string,
  languageClassName?: string,
): StructuredBriefItem[] | null {
  if (!isEligibleFence(languageClassName)) return null;
  const text = raw.trim();
  if (!text.startsWith("[") || !text.endsWith("]")) return null;

  try {
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed) || parsed.length === 0 || parsed.length > 100) return null;

    const items = parsed.map((value) => {
      if (!value || typeof value !== "object" || Array.isArray(value)) return null;
      const candidate = value as Record<string, unknown>;
      if (Object.keys(candidate).some((key) => key !== "title" && key !== "description")) return null;
      if (typeof candidate.title !== "string" || !cleanTitle(candidate.title)) return null;
      if (candidate.description !== undefined && typeof candidate.description !== "string") return null;
      return {
        title: cleanTitle(candidate.title),
        description: typeof candidate.description === "string" ? candidate.description.trim() : "",
      };
    });

    return items.every(Boolean) ? items as StructuredBriefItem[] : null;
  } catch {
    return null;
  }
}
