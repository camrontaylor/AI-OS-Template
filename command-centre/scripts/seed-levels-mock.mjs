#!/usr/bin/env node
// Seeds mock tasks at every level so the unified task modal can be exercised:
//   - Level 1: standalone task with a rich Claude/user conversation
//   - Level 2: planned project with 4 subtasks, each with its own conversation
//   - Level 3: GSD project with phases
//
// Safe to re-run: wipes any existing mocks with the same ids first.
//
// Usage: node scripts/seed-levels-mock.mjs

import Database from "better-sqlite3";
import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";
import crypto from "crypto";
import { createRequire } from "module";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { findWorkspaceRoot } = require("./workspace-root.cjs");
const repoRoot = findWorkspaceRoot(__dirname);
const dbPath = path.join(repoRoot, ".command-centre", "data.db");

const db = new Database(dbPath);
db.pragma("journal_mode = WAL");

// --------------------------------------------------------------------------
// Helpers
// --------------------------------------------------------------------------

const now = new Date();
const iso = (offsetSec) => new Date(now.getTime() + offsetSec * 1000).toISOString();

const MOCK_IDS = [
  "mock-l1-landing-headline",
  "mock-l2-pricing-launch",
  "mock-l2-pricing-copy",
  "mock-l2-pricing-design",
  "mock-l2-pricing-analytics",
  "mock-l2-pricing-seo",
  "mock-l3-cc-rebuild",
  "mock-l3-cc-phase-1",
  "mock-l3-cc-phase-2",
  "mock-l3-cc-phase-3",
];

// Wipe previous runs
const delLogs = db.prepare("DELETE FROM task_logs WHERE taskId = ?");
const delOuts = db.prepare("DELETE FROM task_outputs WHERE taskId = ?");
const delTask = db.prepare("DELETE FROM tasks WHERE id = ?");
for (const id of MOCK_IDS) {
  delLogs.run(id);
  delOuts.run(id);
  delTask.run(id);
}

const insertTask = db.prepare(
  `INSERT INTO tasks (
    id, title, description, status, level, parentId, projectSlug, columnOrder,
    createdAt, updatedAt, startedAt, completedAt, activityLabel,
    needsInput, phaseNumber, gsdStep
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
);

const insertLog = db.prepare(
  `INSERT INTO task_logs (id, taskId, type, timestamp, content, toolName, toolArgs, toolResult)
   VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
);

function pushLog(taskId, type, content, offsetSec, fields = {}) {
  insertLog.run(
    crypto.randomUUID(),
    taskId,
    type,
    iso(offsetSec),
    content,
    fields.toolName ?? null,
    fields.toolArgs ? JSON.stringify(fields.toolArgs) : null,
    fields.toolResult ?? null
  );
}

// --------------------------------------------------------------------------
// Level 1 — standalone task
// --------------------------------------------------------------------------

const L1_ID = "mock-l1-landing-headline";
insertTask.run(
  L1_ID,
  "Rewrite the landing page headline",
  "Punch up the hero headline so it speaks to the ICP pain around scattered tools.",
  "review",
  "task",
  null,
  null,
  -1, // surface to top of feed
  iso(-1800),
  iso(-120),
  iso(-1800),
  iso(-120),
  "Proposed 3 variants",
  0,
  null,
  null
);

pushLog(L1_ID, "text", "Let me read the current hero copy and the brand voice notes first.", -1790);
pushLog(L1_ID, "tool_use", "", -1785, {
  toolName: "Read",
  toolArgs: { file_path: "/brand_context/voice-profile.md" },
});
pushLog(L1_ID, "tool_result", "voice-profile.md — 64 lines", -1782);
pushLog(L1_ID, "text", `Here are three directions I'd take the headline, from safest to sharpest:

**1. "Stop stitching tools together. Ship work instead."**
Leans on the ICP frustration. Clear contrast.

**2. "The AI teammate your ops stack was missing."**
Positioning-led. Good for paid.

**3. "Fewer tabs. Same work. Half the week back."**
Benefit-led, concrete, feels human.

Which direction do you want me to push on?`, -600);
pushLog(L1_ID, "user_reply", "Go with option 3 but make the second line punchier.", -300);
pushLog(L1_ID, "text", `Here's the tightened version:

**"Fewer tabs. Same work. Your week back."**

I like cutting "half" — it turns a hedge into a promise.`, -180);

// --------------------------------------------------------------------------
// Level 2 — planned project with wizard-style subtasks
// --------------------------------------------------------------------------

// Ensure a brief.md exists so the project materializes through syncProjects
const L2_SLUG = "mock-pricing-launch";
const briefDir = path.join(repoRoot, "projects", "briefs", L2_SLUG);
const briefPath = path.join(briefDir, "brief.md");
if (!fs.existsSync(briefDir)) fs.mkdirSync(briefDir, { recursive: true });
if (!fs.existsSync(briefPath)) {
  fs.writeFileSync(
    briefPath,
    `---
project: ${L2_SLUG}
status: active
level: 2
created: ${iso(-86400).slice(0, 10)}
---

# Launch the new pricing page

## Goal
Ship a pricing page that reflects the new 3-tier structure and
maps to the updated ICP.

## Deliverables
- Copy for all three tiers + comparison table
- Visual design + component build
- Analytics events + SEO metadata
`
  );
}

const L2_PARENT_ID = "mock-l2-pricing-launch";
insertTask.run(
  L2_PARENT_ID,
  "Launch the new pricing page",
  "Ship the new 3-tier pricing page — copy, design, analytics, SEO.",
  "running",
  "project",
  null,
  L2_SLUG,
  -2,
  iso(-7200),
  iso(-60),
  iso(-7200),
  null,
  "3 of 4 subtasks in flight",
  1,
  null,
  null
);

// Parent-level conversation (scoping)
pushLog(L2_PARENT_ID, "text", "I've broken the pricing launch into 4 subtasks and kicked them off. Here's how I'm thinking about dependencies:", -7150);
pushLog(L2_PARENT_ID, "text", `- **Copy** runs first (the design needs the strings)
- **Design** picks up once tier names are locked
- **Analytics** can run in parallel — it only needs the page skeleton
- **SEO** is last, after copy is final

Ping me when you want to review individual subtasks.`, -7140);
pushLog(L2_PARENT_ID, "user_reply", "Sounds right. Let me know which one needs me first.", -3600);
pushLog(L2_PARENT_ID, "text", "Copy is ready for review — I'll surface it on the subtask row above when the draft lands.", -1800);

// Subtasks
const L2_SUBS = [
  {
    id: "mock-l2-pricing-copy",
    title: "Write the tier copy + comparison table",
    status: "review",
    order: 0,
    label: "Draft ready",
    needs: 1,
    logs: [
      ["text", "Reading the positioning doc and the old pricing page so the voice carries through.", -7100],
      ["tool_use", "", -7080, { toolName: "Read", toolArgs: { file_path: "/brand_context/positioning.md" } }],
      ["tool_result", "positioning.md — 48 lines", -7078],
      ["text", `Here's the first pass at tier copy:

**Starter** — For solo operators. $0.
**Team** — For teams getting work out the door. $49/seat.
**Scale** — For orgs running multiple clients. Custom.

The comparison table has 14 rows grouped under: *Core workflow*, *Collaboration*, *Scale & compliance*. Want me to paste the full table?`, -3000],
      ["user_reply", "Yes, paste the full table.", -2800],
      ["question", "Quick check before I lock the row order — should 'Brand context memory' live under *Core workflow* or under *Scale & compliance*?", -180],
    ],
  },
  {
    id: "mock-l2-pricing-design",
    title: "Design the pricing page layout",
    status: "running",
    order: 1,
    label: "Working on it",
    needs: 0,
    logs: [
      ["text", "Waiting on final tier names from the copy subtask before I lock the grid.", -6000],
      ["tool_use", "", -1200, { toolName: "Read", toolArgs: { file_path: "/brand_context/voice-profile.md" } }],
      ["tool_result", "voice-profile.md — 64 lines", -1198],
      ["text", "Building out the 3-column comparison table component now.", -900],
    ],
  },
  {
    id: "mock-l2-pricing-analytics",
    title: "Instrument analytics events",
    status: "done",
    order: 2,
    label: "Shipped",
    needs: 0,
    logs: [
      ["text", "Mapped the events we need: `pricing_view`, `tier_hover`, `cta_click`, `plan_selected`.", -5400],
      ["tool_use", "", -5000, {
        toolName: "Write",
        toolArgs: {
          file_path: path.join(repoRoot, "projects/briefs", L2_SLUG, "analytics-spec.md"),
          content: "# Analytics spec\n\n- pricing_view\n- tier_hover\n- cta_click\n- plan_selected\n",
        },
      }],
      ["tool_result", "File created successfully", -4998],
      ["text", "Events are instrumented and firing in staging. Done.", -4800],
    ],
  },
  {
    id: "mock-l2-pricing-seo",
    title: "SEO meta + schema markup",
    status: "backlog",
    order: 3,
    label: "Blocked on copy",
    needs: 0,
    logs: [],
  },
];

for (const sub of L2_SUBS) {
  insertTask.run(
    sub.id,
    sub.title,
    null,
    sub.status,
    "task",
    L2_PARENT_ID,
    L2_SLUG,
    sub.order,
    iso(-7100),
    iso(-sub.order * 100 - 60),
    sub.status === "backlog" ? null : iso(-7000),
    sub.status === "done" ? iso(-4800) : null,
    sub.label,
    sub.needs,
    null,
    null
  );
  for (const [type, content, offset, fields] of sub.logs) {
    pushLog(sub.id, type, content, offset, fields || {});
  }
}

// --------------------------------------------------------------------------
// Level 3 — GSD project with phases
// --------------------------------------------------------------------------

const L3_SLUG = "mock-cc-rebuild";
const l3BriefDir = path.join(repoRoot, "projects", "briefs", L3_SLUG);
const l3BriefPath = path.join(l3BriefDir, "brief.md");
if (!fs.existsSync(l3BriefDir)) fs.mkdirSync(l3BriefDir, { recursive: true });
if (!fs.existsSync(l3BriefPath)) {
  fs.writeFileSync(
    l3BriefPath,
    `---
project: ${L3_SLUG}
status: active
level: 3
created: ${iso(-172800).slice(0, 10)}
---

# Command centre UI rebuild

## Goal
Rebuild the command centre modal UX around a single unified conversation
view, with proper level routing and subtask drill-ins.

## Phases
1. Audit current modal surfaces
2. Design new unified modal spec
3. Implement + validate against mock data
`
  );
}

const L3_PARENT_ID = "mock-l3-cc-rebuild";
insertTask.run(
  L3_PARENT_ID,
  "Command centre UI rebuild",
  "Multi-phase rebuild of the task modal around a unified conversation view.",
  "running",
  "gsd",
  null,
  L3_SLUG,
  -3,
  iso(-172800),
  iso(-60),
  iso(-172800),
  null,
  "Phase 2 of 3",
  1,
  2,
  "execute"
);

pushLog(L3_PARENT_ID, "text", `Phase 1 (audit) landed yesterday. Phase 2 is in execute — I'm building the unified modal now. Phase 3 will validate against the L1/L2/L3 mocks we just seeded.

I'll flag any phase that needs your review on the subtask rows above.`, -3600);

const L3_PHASES = [
  {
    id: "mock-l3-cc-phase-1",
    title: "Phase 1 — Audit current modal surfaces",
    status: "done",
    phaseNumber: 1,
    gsdStep: "verify",
    label: "Verified",
    order: 0,
    logs: [
      ["text", "Audited all 7 modal surfaces and mapped them to pain points.", -170000],
      ["tool_use", "", -169800, { toolName: "Grep", toolArgs: { pattern: "activeTab", path: "src/components/modal" } }],
      ["tool_result", "12 matches across 4 files", -169798],
      ["text", "Findings: summary vs activity split is the biggest driver of confusion. Recommending a single conversation view.", -169000],
    ],
  },
  {
    id: "mock-l3-cc-phase-2",
    title: "Phase 2 — Design new unified modal spec",
    status: "running",
    phaseNumber: 2,
    gsdStep: "execute",
    label: "Needs input",
    needs: 1,
    order: 1,
    logs: [
      ["text", "Drafting the unified modal spec. The conversation tab will be the single default for all levels; a compact subtask strip sits on top for parents.", -80000],
      ["tool_use", "", -60000, {
        toolName: "Write",
        toolArgs: {
          file_path: path.join(repoRoot, "projects/briefs", L3_SLUG, "unified-modal-spec.md"),
          content: "# Unified modal spec\n\n- Drop the Summary tab\n- Add SubtasksStrip above ModalChat for parents\n- Left-align Claude text, right-align user replies\n",
        },
      }],
      ["tool_result", "File created successfully", -59998],
      ["question", "Before I lock the unified modal spec — should the project chat default to collapsed or expanded when the dashboard opens?", -300],
    ],
  },
  {
    id: "mock-l3-cc-phase-3",
    title: "Phase 3 — Implement + validate against mocks",
    status: "backlog",
    phaseNumber: 3,
    gsdStep: "plan",
    label: "Waiting on phase 2",
    order: 2,
    logs: [],
  },
];

for (const phase of L3_PHASES) {
  insertTask.run(
    phase.id,
    phase.title,
    null,
    phase.status,
    "task",
    L3_PARENT_ID,
    L3_SLUG,
    phase.order,
    iso(-170000),
    iso(-60),
    phase.status === "backlog" ? null : iso(-170000),
    phase.status === "done" ? iso(-169000) : null,
    phase.label,
    phase.needs ?? 0,
    phase.phaseNumber,
    phase.gsdStep
  );
  for (const [type, content, offset, fields] of phase.logs) {
    pushLog(phase.id, type, content, offset, fields || {});
  }
}

console.log("Seeded mock tasks:");
console.log(`  L1 → ${L1_ID}`);
console.log(`  L2 → ${L2_PARENT_ID} (slug: ${L2_SLUG}, 4 subtasks)`);
console.log(`  L3 → ${L3_PARENT_ID} (slug: ${L3_SLUG}, 3 phases)`);
console.log(`\nOpen the command centre → Feed. The L2 card shows "Your turn" (copy subtask is asking a question).`);
