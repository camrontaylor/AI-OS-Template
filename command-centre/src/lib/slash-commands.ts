export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  category: "session" | "gsd" | "skill" | "system";
}

export interface ActiveSlashCommandToken {
  start: number;
  end: number;
  query: string;
}

export interface SlashCommandInsertion {
  value: string;
  selectionStart: number;
  selectionEnd: number;
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Session
  { command: "/start-here", label: "Start Here", description: "Kick off the day — session recap, goal-setting", category: "session" },
  { command: "/wrap-up", label: "Wrap Up", description: "Close out the session — review, feedback, commit", category: "session" },

  // GSD workflow
  { command: "/gsd-discuss-phase", label: "Discuss Phase", description: "Gather context before planning a phase", category: "gsd" },
  { command: "/gsd-plan-phase", label: "Plan Phase", description: "Create detailed phase plan (PLAN.md)", category: "gsd" },
  { command: "/gsd-execute-phase", label: "Execute Phase", description: "Execute all plans in a phase", category: "gsd" },
  { command: "/gsd-verify-work", label: "Verify Work", description: "Validate built features through UAT", category: "gsd" },
  { command: "/gsd-progress", label: "Progress", description: "Check project progress and next steps", category: "gsd" },
  { command: "/gsd-stats", label: "Stats", description: "Project statistics — phases, plans, timeline", category: "gsd" },
  { command: "/gsd-autonomous", label: "Autonomous", description: "Run all remaining phases autonomously", category: "gsd" },
  { command: "/gsd-new-project", label: "New Project", description: "Initialize a new GSD project", category: "gsd" },
  { command: "/gsd-new-milestone", label: "New Milestone", description: "Start a new milestone cycle", category: "gsd" },
  { command: "/gsd-phase", label: "Manage Phase", description: "Add, edit, insert, or remove roadmap phases", category: "gsd" },
  { command: "/gsd-capture", label: "Capture", description: "Capture an idea, task, or backlog item from context", category: "gsd" },
  { command: "/gsd-review-backlog", label: "Review Backlog", description: "Review and promote backlog items", category: "gsd" },
  { command: "/gsd-debug", label: "Debug", description: "Systematic debugging with persistent state", category: "gsd" },
  { command: "/gsd-ship", label: "Ship", description: "Create PR, run review, prepare for merge", category: "gsd" },
  { command: "/archive-gsd", label: "Archive GSD", description: "Archive completed GSD project and keep .planning/ in place", category: "gsd" },
  { command: "/gsd-complete-milestone", label: "Complete Milestone", description: "Archive completed milestone and prepare for next", category: "gsd" },
  { command: "/gsd-pause-work", label: "Pause Work", description: "Create context handoff when pausing mid-phase", category: "gsd" },
  { command: "/gsd-resume-work", label: "Resume Work", description: "Resume work from previous session", category: "gsd" },
  { command: "/gsd-health", label: "Health Check", description: "Diagnose planning directory and repair issues", category: "gsd" },
  { command: "/gsd-map-codebase", label: "Map Codebase", description: "Analyze codebase with parallel mapper agents", category: "gsd" },
  { command: "/gsd-help", label: "Help", description: "Show available GSD commands", category: "gsd" },

  // Skills
  { command: "/mkt-brand-voice", label: "Brand Voice", description: "Extract or build a brand voice profile", category: "skill" },
  { command: "/mkt-positioning", label: "Positioning", description: "Find the angle that makes something sell", category: "skill" },
  { command: "/mkt-icp", label: "ICP", description: "Build an ideal customer profile", category: "skill" },
  { command: "/mkt-copywriting", label: "Copywriting", description: "Landing pages, emails, ads, social posts", category: "skill" },
  { command: "/mkt-content-repurposing", label: "Content Repurposing", description: "Repurpose content across platforms", category: "skill" },
  { command: "/mkt-ugc-scripts", label: "UGC Scripts", description: "Short-form video scripts", category: "skill" },
  { command: "/str-ai-seo", label: "AI SEO", description: "Optimize for AI search engines", category: "skill" },
  { command: "/str-trending-research", label: "Trending Research", description: "Research what's trending in the last 30 days", category: "skill" },
  { command: "/viz-stitch-design", label: "Stitch Design", description: "Design UI screens using Stitch", category: "skill" },
  { command: "/viz-image-gen", label: "Image Gen", description: "Generate images via GPT Image or Gemini", category: "skill" },
  { command: "/viz-excalidraw-diagram", label: "Diagram", description: "Generate Excalidraw diagrams", category: "skill" },
  { command: "/ops-cron", label: "Schedule", description: "Schedule recurring tasks", category: "skill" },

  // System
  { command: "/meta-skill-creator", label: "Skill Creator", description: "Build or modify skills", category: "system" },
];

const CATEGORY_ORDER: Record<string, number> = { session: 0, skill: 1, gsd: 2, system: 3 };
const KNOWN_COMMANDS = new Map(SLASH_COMMANDS.map((command) => [command.command, command]));
const SKILL_COMMAND_PREFIXES = new Set(["mkt", "str", "ops", "viz", "acc", "tool", "meta"]);

export function skillNameFromSlashCommand(command: string): string | null {
  const raw = command.trim().replace(/^\//, "").toLowerCase();
  const normalized = raw.startsWith("team:") || raw.startsWith("local:")
    ? raw.slice(raw.indexOf(":") + 1)
    : raw;
  if (!normalized) return null;

  const slashCommand = `/${normalized}`;
  const known = KNOWN_COMMANDS.get(slashCommand);
  if (known) return known.category === "skill" ? normalized : null;

  const [prefix] = normalized.split("-", 1);
  if (!prefix || !SKILL_COMMAND_PREFIXES.has(prefix)) return null;
  if (!/^[a-z0-9][a-z0-9._-]*$/.test(normalized)) return null;
  return normalized;
}

function commandAllowed(command: SlashCommand, allowedSkillNames?: Set<string> | null): boolean {
  if (command.category !== "skill" || !allowedSkillNames) return true;
  const skillName = skillNameFromSlashCommand(command.command);
  return Boolean(skillName && allowedSkillNames.has(skillName));
}

export function filterCommands(
  query: string,
  allowedSkillNames?: Iterable<string> | null,
): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, "");
  const allowed = allowedSkillNames ? new Set([...allowedSkillNames].map((name) => name.toLowerCase())) : null;
  if (!q) {
    return SLASH_COMMANDS
      .filter((c) => commandAllowed(c, allowed))
      .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
  }
  return SLASH_COMMANDS
    .filter((c) =>
      commandAllowed(c, allowed) &&
      (c.command.toLowerCase().includes(q) ||
        c.label.toLowerCase().includes(q) ||
        c.description.toLowerCase().includes(q))
    )
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
}

function clampCursor(value: string, cursor: number): number {
  if (!Number.isFinite(cursor)) return value.length;
  return Math.min(Math.max(Math.trunc(cursor), 0), value.length);
}

/**
 * Finds the whitespace-delimited slash token containing the cursor.
 *
 * A command token must begin at the start of the message or immediately after
 * whitespace. Extra path separators and URL punctuation are deliberately not
 * accepted, so paths and inline slashes cannot open the command menu.
 */
export function findActiveSlashCommandToken(
  value: string,
  cursor: number,
): ActiveSlashCommandToken | null {
  const position = clampCursor(value, cursor);
  let start = position;
  let end = position;

  while (start > 0 && !/\s/.test(value[start - 1])) start -= 1;
  while (end < value.length && !/\s/.test(value[end])) end += 1;

  if (position <= start) return null;

  const token = value.slice(start, end);
  const query = value.slice(start, position);
  if (!/^\/[A-Za-z0-9:._-]*$/.test(token)) return null;
  if (!/^\/[A-Za-z0-9:._-]*$/.test(query)) return null;

  return { start, end, query };
}

/**
 * Returns the active token only when the current query can display at least
 * one command. A bare slash is allowed so it can open the full command menu.
 */
export function getActiveSlashCommandToken(
  value: string,
  cursor: number,
): ActiveSlashCommandToken | null {
  const token = findActiveSlashCommandToken(value, cursor);
  if (!token) return null;
  const query = token.query.toLowerCase();
  if (
    query === "/"
    || SLASH_COMMANDS.some((command) =>
      command.command.toLowerCase().startsWith(query)
    )
  ) {
    return token;
  }
  return null;
}

/**
 * Replaces the complete active token, even when the cursor is in its middle.
 * Existing horizontal whitespace after the token is reused; otherwise one
 * trailing space is inserted and the cursor is placed after it.
 */
export function replaceActiveSlashCommand(
  value: string,
  cursor: number,
  command: string,
): SlashCommandInsertion | null {
  const token = findActiveSlashCommandToken(value, cursor);
  if (!token || !/^\/[A-Za-z0-9:._-]+$/.test(command)) return null;

  const reusesTrailingSpace =
    token.end < value.length && /[ \t]/.test(value[token.end]);
  const replacement = command + (reusesTrailingSpace ? "" : " ");
  const nextValue =
    value.slice(0, token.start) + replacement + value.slice(token.end);
  const nextCursor =
    token.start + replacement.length + (reusesTrailingSpace ? 1 : 0);

  return {
    value: nextValue,
    selectionStart: nextCursor,
    selectionEnd: nextCursor,
  };
}

export const CATEGORY_LABELS: Record<string, string> = {
  session: "Session",
  gsd: "GSD",
  skill: "Skills",
  system: "System",
};
