export interface SlashCommand {
  command: string;
  label: string;
  description: string;
  category: "session" | "gsd" | "skill" | "system";
}

export const SLASH_COMMANDS: SlashCommand[] = [
  // Session
  { command: "/onboarding", label: "Onboarding", description: "First-run setup - build your brand voice, positioning, and audience", category: "session" },
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
  { command: "/viz-excalidraw-diagram", label: "Diagram", description: "Generate Excalidraw diagrams", category: "skill" },
  { command: "/ops-cron", label: "Schedule", description: "Schedule recurring tasks", category: "skill" },

  // System
  { command: "/meta-skill-creator", label: "Skill Creator", description: "Build or modify skills", category: "system" },
];

const CATEGORY_ORDER: Record<string, number> = { session: 0, skill: 1, gsd: 2, system: 3 };

export function filterCommands(query: string): SlashCommand[] {
  const q = query.toLowerCase().replace(/^\//, "");
  if (!q) return SLASH_COMMANDS;
  return SLASH_COMMANDS
    .filter((c) =>
      c.command.toLowerCase().includes(q) ||
      c.label.toLowerCase().includes(q) ||
      c.description.toLowerCase().includes(q)
    )
    .sort((a, b) => CATEGORY_ORDER[a.category] - CATEGORY_ORDER[b.category]);
}

export const CATEGORY_LABELS: Record<string, string> = {
  session: "Session",
  gsd: "GSD",
  skill: "Skills",
  system: "System",
};
