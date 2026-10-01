"use client";

import {
  buildPlannedProjectNameFromFallback,
  buildPlannedProjectNameFromTitle,
  type PlannedProjectNameResult,
  type PlannedProjectNameSource,
} from "@/lib/planned-project-naming";

function isSource(value: unknown): value is PlannedProjectNameSource {
  return value === "title" || value === "ai" || value === "fallback";
}

export async function resolvePlannedProjectNameForClient(
  userTitle: string | null | undefined,
  prompt: string,
): Promise<PlannedProjectNameResult> {
  const titleResult = buildPlannedProjectNameFromTitle(userTitle);
  if (titleResult) return titleResult;

  try {
    const res = await fetch("/api/projects/name", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt }),
    });

    if (res.ok) {
      const data = (await res.json()) as {
        name?: unknown;
        slug?: unknown;
        source?: unknown;
      };
      if (
        typeof data.name === "string" &&
        data.name.trim() &&
        typeof data.slug === "string" &&
        data.slug.trim()
      ) {
        return {
          name: data.name.trim(),
          slug: data.slug.trim(),
          source: isSource(data.source) ? data.source : "ai",
        };
      }
    }
  } catch {
    // Fall back below; project creation should still work offline.
  }

  return buildPlannedProjectNameFromFallback(prompt);
}
