export type PlannedProjectNameSource = "title" | "ai" | "fallback";

export interface PlannedProjectNameResult {
  name: string;
  slug: string;
  source: PlannedProjectNameSource;
}

const MAX_NAME_LENGTH = 80;
const MAX_SLUG_LENGTH = 60;

export function sanitizeProjectName(value: string | null | undefined): string {
  if (!value) return "";

  const firstLine =
    value
      .replace(/^```(?:text|markdown)?/i, "")
      .replace(/```$/i, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find(Boolean) ?? "";

  const cleaned = firstLine
    .replace(/^[-*]\s+/, "")
    .replace(/^["'`]+|["'`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length <= MAX_NAME_LENGTH) return cleaned;

  const clipped = cleaned
    .slice(0, MAX_NAME_LENGTH - 3)
    .replace(/\s+\S*$/, "")
    .trim();
  return `${clipped || cleaned.slice(0, MAX_NAME_LENGTH - 3)}...`;
}

export function slugifyProjectName(name: string): string {
  const slug = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH)
    .replace(/-+$/g, "");

  return slug || "project";
}

export function buildPlannedProjectNameFromTitle(
  userTitle: string | null | undefined,
): PlannedProjectNameResult | null {
  const name = sanitizeProjectName(userTitle);
  if (!name) return null;
  return { name, slug: slugifyProjectName(name), source: "title" };
}

export function buildPlannedProjectNameFromAi(
  aiName: string | null | undefined,
): PlannedProjectNameResult | null {
  const name = sanitizeProjectName(aiName);
  if (!name) return null;
  return { name, slug: slugifyProjectName(name), source: "ai" };
}

export function buildPlannedProjectNameFromFallback(
  prompt: string | null | undefined,
): PlannedProjectNameResult {
  const name = sanitizeProjectName(prompt) || "New project";
  return { name, slug: slugifyProjectName(name), source: "fallback" };
}
