import type { TaskLevel } from "@/types/task";

/**
 * Shared signal-word lists used on both the server (`scope-goal`) and
 * client (`task-create-input`) to correct Haiku's bias toward "task".
 *
 * These regexes are intentionally conservative — they only fire on
 * unambiguous language. If you change them, update the prompt examples
 * in `scope-goal/route.ts` so the model's output matches the rules.
 */

export const gsdSignals: RegExp[] = [
  /\bapp\b/,
  /\bplatform\b/,
  /\bsystem\b/,
  /\binfrastructure\b/,
  /\bmigrat(e|ion)\b/,
  /\brebuild\b/,
  /\bentire\b/,
  /\bmulti-tenant\b/,
  /\bautomate the (whole|entire)\b/,
  /\bbuild (me |us )?(an? |out )?(an? )?app\b/,
];

export const projectSignals: RegExp[] = [
  /\bcampaign\b/,
  /\blaunch\b/,
  /\bfunnel\b/,
  /\bsequence\b/,
  /\bseries\b/,
  /\blanding page\b/,
  /\bkit\b/,
  /\bbundle\b/,
  /\bemails?\b.*\band\b/,
  /,.*,/, // comma-separated list
];

export function hasGsdSignal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return gsdSignals.some((re) => re.test(lower));
}

export function hasProjectSignal(goal: string): boolean {
  const lower = goal.toLowerCase();
  return projectSignals.some((re) => re.test(lower));
}

/**
 * Classify a goal into a level using keyword matching alone. Returns
 * null when no signal words fire — in that case, let the LLM decide.
 *
 * When `defaultLevel` is provided, it acts as a tiebreaker: if no signal
 * words fire the default is returned instead of null. Signal words always
 * override the default.
 */
export function classifyByKeywords(goal: string, defaultLevel?: TaskLevel | null): TaskLevel | null {
  if (hasGsdSignal(goal)) return "gsd";
  if (hasProjectSignal(goal)) return "project";
  return defaultLevel ?? null;
}
