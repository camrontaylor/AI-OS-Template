import { NextRequest, NextResponse } from "next/server";
import { getDb } from "@/lib/db";
import { hasGsdSignal, hasProjectSignal } from "@/lib/level-signals";
import { parseQuestionSpecs, type QuestionSpec } from "@/types/question-spec";
import { gatherContext, type ContextSource } from "@/lib/gather-context";
import { runClaudeTextPrompt } from "@/lib/run-claude-text-prompt";

interface ActiveProject {
  slug: string;
  name: string;
  goal: string | null;
}

interface ActiveTask {
  id: string;
  title: string;
  projectSlug: string | null;
}

export interface ScopeResult {
  level: "task" | "project" | "gsd";
  confidence: number;
  overlaps: { slug: string; name: string; reason: string }[];
  /**
   * Short, human-readable project title distilled from the goal — 3-6 words,
   * Title Case, no filler like "Help me…" or "I want to…". Used as the
   * default project name in the scoping wizard so the feed shows meaningful
   * titles instead of the raw first few words of the goal.
   */
  projectTitle?: string;
  /** Typed clarifying questions — rendered by QuestionModal */
  questions: QuestionSpec[];
  suggestedSubtasks: {
    title: string;
    description: string;
    dependsOn: number[];
    wave: number;
    acceptanceCriteria: string[];
  }[];
  /**
   * Context the system already knows about (brand_context files + URLs
   * fetched from the goal). Surfaced in the wizard above the questions
   * so the user can see what's been loaded before they answer.
   */
  contextSources?: ContextSource[];
}

function fallbackQuestions(level: "project" | "gsd"): QuestionSpec[] {
  if (level === "project") {
    return [
      {
        id: "audience",
        prompt: "Who is the primary audience or user for this?",
        type: "text",
        required: true,
      },
      {
        id: "success",
        prompt: "What does success look like — how will you know it's done well?",
        type: "multiline",
      },
      {
        id: "constraints",
        prompt: "Are there existing assets, tools, or constraints we should work within?",
        type: "multiline",
      },
      {
        id: "deadline",
        prompt: "Is there a deadline or timeline we need to hit?",
        type: "text",
      },
    ];
  }
  return [
    {
      id: "flows",
      prompt: "What are the core user flows this needs to support?",
      type: "multiline",
      required: true,
    },
    {
      id: "constraints",
      prompt: "What are the non-negotiable constraints (compliance, performance, budget)?",
      type: "multiline",
    },
    {
      id: "integrations",
      prompt: "Which existing systems does this need to integrate with?",
      type: "multiline",
    },
    {
      id: "success",
      prompt: "What does success look like in 90 days?",
      type: "multiline",
    },
  ];
}

/**
 * POST /api/tasks/scope-goal
 *
 * Intelligent routing: takes a raw goal text and determines level,
 * detects overlaps with active projects, suggests clarifications,
 * and decomposes into subtasks with dependency info.
 */
export async function POST(request: NextRequest) {
  try {
    const { goal, clientId } = (await request.json()) as {
      goal: string;
      clientId?: string | null;
    };
    if (!goal || typeof goal !== "string" || goal.trim().length === 0) {
      return NextResponse.json(
        { error: "goal is required" },
        { status: 400 }
      );
    }

    // Sweep brand_context/ files and any URLs in the goal so questions
    // can be grounded in what we already know.
    const gathered = await gatherContext(goal, clientId ?? null);
    if (gathered.sources.length > 0) {
      console.log(
        `[scope-goal] gathered ${gathered.sources.length} context source(s): ${gathered.sources.map((s) => `${s.kind}:${s.label}`).join(", ")}`
      );
    }

    const db = getDb();

    // Fetch active projects from DB projects table
    const activeProjects = db
      .prepare(
        `SELECT slug, name, goal FROM projects WHERE status = 'active' ORDER BY updatedAt DESC LIMIT 20`
      )
      .all() as ActiveProject[];

    // Fetch active non-done task titles
    const activeTasks = db
      .prepare(
        `SELECT id, title, projectSlug FROM tasks
         WHERE status NOT IN ('done')
         AND parentId IS NULL
         ORDER BY updatedAt DESC
         LIMIT 30`
      )
      .all() as ActiveTask[];

    const projectContext =
      activeProjects.length > 0
        ? `\n\nActive projects:\n${activeProjects.map((p) => `- ${p.slug}: ${p.name}${p.goal ? ` — ${p.goal}` : ""}`).join("\n")}`
        : "";

    const taskContext =
      activeTasks.length > 0
        ? `\n\nActive tasks:\n${activeTasks.map((t) => `- ${t.title}${t.projectSlug ? ` [project: ${t.projectSlug}]` : ""}`).join("\n")}`
        : "";

    const prompt = `You are a goal routing and breakdown assistant. Classify and decompose this goal.

CRITICAL: For levels "project" and "gsd", the "questions" array MUST contain at least 2 QuestionSpec objects. An empty questions array for these levels is a bug. Ask questions even if you think you can guess — the user WANTS to answer them.

## How to classify

There are exactly three levels. Pick the most ambitious level that fits — **do not default to "task" when uncertain**. When torn between two levels, pick the larger one.

### "task" — a single deliverable, one sitting
Exactly one concrete output. No subtasks. A junior could finish it in under an hour with no planning.
Examples:
- "Write a cold email to intro our new pricing"
- "Fix the login redirect bug on mobile Safari"
- "Summarise this PDF into 5 bullets"
- "Draft a LinkedIn post announcing the hire"
- "Generate three headline options for the homepage"
- "Rename the 'projects' column to 'initiatives' in the dashboard"

### "project" — 2–8 related deliverables, a campaign or launch
Multiple related outputs that ship together. Usually a campaign, launch, content bundle, or small piece of software with a clear surface area. Needs a brief and subtasks but not a full architectural phase plan. A landing page counts as project when it has copy + design + CTA logic + launch plan; counts as task if the user literally just wants HTML drafted.
Examples:
- "Launch the Q2 newsletter: landing page, 3 emails, social posts, ad creative"
- "Build me a landing page for the new product" (copy + layout + CTA + hero + social proof)
- "Create a podcast launch kit: cover art, show notes template, 5 episode briefs, promo plan"
- "Run a week-long product hunt launch campaign"
- "Produce a 10-post LinkedIn content series on AI adoption for CFOs"
- "Set up a lead magnet funnel: ebook, landing page, email sequence"
- "Redesign the pricing page with 3 tier variants and A/B test plan"

### "gsd" — multi-phase, architectural, spans weeks
A whole app, a platform, a major system migration, or anything that needs research + roadmap + multiple execution phases with verification between them. Requires the GSD methodology (discuss → plan → execute → verify per phase).
Examples:
- "Build me out an app for tracking client feedback across channels"
- "Redesign the entire onboarding system with new auth, billing, and welcome flows"
- "Create a multi-tenant invoicing platform with Stripe integration"
- "Automate the whole marketing ops pipeline from lead capture to CRM sync"
- "Build an internal tool that replaces our current project management setup"
- "Migrate the backend from Rails to Next.js with zero downtime"

## Anti-patterns

- "Build me out an app" → **always "gsd"**, never "task". If the word "app" appears, it's almost certainly gsd unless they explicitly say "mobile-friendly one-pager" or similar.
- "Landing page" → default to "project" unless the user explicitly says "just the HTML" or "one-pager copy only".
- "Campaign", "launch", "funnel", "sequence", "series" → **always "project"** minimum, never "task".
- "Platform", "system", "app", "infrastructure", "migrate", "rebuild", "entire" → **always "gsd"**.
- Any goal with "and", "plus", or a comma-separated list of deliverables → "project" minimum.
- Confidence below 0.7 on "task" level means you probably picked wrong. Re-read the goal and see if it's actually "project".

## Subtask Decomposition (for "project" level)

Break into 2-8 subtasks. Each MUST have:
- A title starting with an action verb (Build, Write, Design, Configure, Test, etc.)
- A wave number: Wave 1 = foundation (must complete first). Wave 2+ = can run in parallel after dependencies met. Same-wave tasks have no dependencies on each other.
- At least one acceptance criterion (observable truth, not vague)
- Dependency list (by subtask index, 0-based). Wave 1 tasks have empty dependsOn.

Verify completeness: if every subtask's acceptance criteria are met, is the original goal achieved? If not, add a subtask.

## Overlap Detection

Check if the goal overlaps with any active project or task. Only flag genuine overlaps — not vague similarity.${projectContext}${taskContext}${
      gathered.summary
        ? `\n\n## Known context (already loaded — DO NOT ask the user about anything we already know)\n\n${gathered.summary}\n\nWhen you ask questions, ground them in this context. For example, instead of asking "Who is your audience?" when an ICP is loaded, ask "Is this for your existing audience (per the loaded ICP) or a new segment?" as a select with Yes/No options. Whenever the loaded context already answers a topic, either skip that question entirely OR convert it into a confirmation question (select with Yes/No).`
        : ""
    }

## Questions (typed clarifications)

Questions are the most important part of your output for "project" and "gsd" levels. They're shown to the user as an interactive quiz before any tasks are queued.

Each question is a typed object (QuestionSpec). Pick the widget type that will make the user's answer cleanest:
- "text" — a one-line answer (names, deadlines, short phrases)
- "multiline" — a paragraph answer (success criteria, constraints, flows)
- "select" — exactly one choice from a small enumerable set. Provide "options". Prefer this over free-text whenever you can enumerate 2–6 likely answers.
- "multiselect" — multiple choices from an enumerable set. Provide "options".

PREFER SELECT/MULTISELECT whenever the space of reasonable answers is small (tone, audience type, channel, format, etc.).

Each question must include:
- "id": short snake_case identifier (e.g. "audience", "tone")
- "prompt": the question text itself
- "type": one of the four widget types above
- "required": true for the 1-2 most important questions; false otherwise
- "options": array of strings (only for select/multiselect)

Rules by level:
- **"task"**: usually no questions. Only ask if the goal is literally unreadable.
- **"project"**: 2–4 questions covering scope boundaries, target audience or channel, success criteria, constraints, existing assets, tone or format preferences.
- **"gsd"**: 3–5 questions covering core user flows, non-negotiable constraints, integrations, data model, success metrics, deployment context.

Never ask more than 5 questions. Never ask trivia you could assume.

## Goal

"${goal.trim()}"

## Project title

Distill the goal into a short, human-readable title: 3-6 words, Title Case, no filler. Strip leading verbs like "Help me", "I want to", "Can you", "Please". Name the THING, not the request.

Examples:
- "help me connect up to the telegram channel" → "Telegram Channel Integration"
- "build me out an app for tracking client feedback" → "Client Feedback Tracker"
- "launch the Q2 newsletter with landing page and emails" → "Q2 Newsletter Launch"
- "redesign the pricing page with 3 tiers" → "Pricing Page Redesign"
- "write a cold email about our new pricing" → "Cold Email: New Pricing"

Return ONLY valid JSON (no markdown, no explanation):
{
  "level": "task" | "project" | "gsd",
  "confidence": number (0-1),
  "projectTitle": string,
  "overlaps": [{"slug": string, "name": string, "reason": string}],
  "questions": [{"id": string, "prompt": string, "type": "text" | "multiline" | "select" | "multiselect", "options": [string], "required": boolean}],
  "suggestedSubtasks": [{"title": string, "description": string, "dependsOn": [number], "wave": number, "acceptanceCriteria": [string]}]
}`;

    const result = await runClaude(prompt);

    if (!result) {
      // Fallback: keyword-classify so a failed Haiku call still lands in
      // the right place instead of quietly becoming a task.
      const fallbackLevel = hasGsdSignal(goal)
        ? "gsd"
        : hasProjectSignal(goal)
          ? "project"
          : "task";
      return NextResponse.json({
        level: fallbackLevel,
        confidence: fallbackLevel === "task" ? 0.5 : 0.75,
        overlaps: [],
        questions:
          fallbackLevel === "task" ? [] : fallbackQuestions(fallbackLevel),
        suggestedSubtasks: [],
        contextSources: gathered.sources,
      } satisfies ScopeResult);
    }

    // Parse the JSON response
    let scopeResult: ScopeResult;
    try {
      const jsonStr = result
        .replace(/```json?\s*/g, "")
        .replace(/```/g, "")
        .trim();
      const raw = JSON.parse(jsonStr) as Record<string, unknown>;

      // Validate and sanitize
      let level: ScopeResult["level"] = "task";
      if (raw.level === "project" || raw.level === "gsd") level = raw.level;
      let confidence =
        typeof raw.confidence === "number" ? raw.confidence : 0.5;
      if (confidence < 0 || confidence > 1) confidence = 0.5;
      const overlaps = Array.isArray(raw.overlaps)
        ? (raw.overlaps as ScopeResult["overlaps"])
        : [];
      // Accept both "questions" (new) and legacy "clarifications" (string[])
      let questions = parseQuestionSpecs(raw.questions);
      if (questions.length === 0 && Array.isArray(raw.clarifications)) {
        questions = (raw.clarifications as unknown[])
          .filter((s): s is string => typeof s === "string" && s.trim().length > 0)
          .map((s, i) => ({
            id: `q${i + 1}`,
            prompt: s,
            type: "multiline" as const,
          }));
      }
      const suggestedSubtasks = Array.isArray(raw.suggestedSubtasks)
        ? (raw.suggestedSubtasks as ScopeResult["suggestedSubtasks"])
        : [];

      const projectTitle =
        typeof raw.projectTitle === "string" && raw.projectTitle.trim().length > 0
          ? raw.projectTitle.trim().slice(0, 80)
          : undefined;

      scopeResult = {
        level,
        confidence,
        projectTitle,
        overlaps,
        questions,
        suggestedSubtasks,
        contextSources: gathered.sources,
      };

      // Server-side correction: Haiku has a strong bias toward "task".
      const gsdMatch = hasGsdSignal(goal);
      const projectMatch = hasProjectSignal(goal);

      if (scopeResult.level === "task" && gsdMatch) {
        console.warn(
          "[scope-goal] Upgrading task → gsd based on signal words in: " +
            goal.slice(0, 80)
        );
        scopeResult.level = "gsd";
        scopeResult.confidence = Math.max(scopeResult.confidence, 0.75);
      } else if (scopeResult.level === "task" && projectMatch) {
        console.warn(
          "[scope-goal] Upgrading task → project based on signal words in: " +
            goal.slice(0, 80)
        );
        scopeResult.level = "project";
        scopeResult.confidence = Math.max(scopeResult.confidence, 0.75);
      } else if (scopeResult.level === "project" && gsdMatch) {
        console.warn(
          "[scope-goal] Upgrading project → gsd based on signal words in: " +
            goal.slice(0, 80)
        );
        scopeResult.level = "gsd";
        scopeResult.confidence = Math.max(scopeResult.confidence, 0.75);
      }

      // Safety net: Haiku sometimes ignores the instruction to ask questions
      // for project/gsd levels. If it comes back empty, inject a generic
      // fallback set so the wizard has something to show.
      if (
        (scopeResult.level === "project" || scopeResult.level === "gsd") &&
        scopeResult.questions.length === 0
      ) {
        console.warn(
          "[scope-goal] Haiku returned empty questions for level=" +
            scopeResult.level +
            "; injecting fallback questions"
        );
        scopeResult.questions = fallbackQuestions(scopeResult.level);
      }

      console.log(
        "[scope-goal] level=" +
          scopeResult.level +
          " questions=" +
          scopeResult.questions.length +
          " subtasks=" +
          scopeResult.suggestedSubtasks.length
      );
    } catch {
      console.error(
        "[scope-goal] Failed to parse AI response:",
        result.slice(0, 200)
      );
      const fallbackLevel = hasGsdSignal(goal)
        ? "gsd"
        : hasProjectSignal(goal)
          ? "project"
          : "task";
      return NextResponse.json({
        level: fallbackLevel,
        confidence: fallbackLevel === "task" ? 0.5 : 0.75,
        overlaps: [],
        questions:
          fallbackLevel === "task" ? [] : fallbackQuestions(fallbackLevel),
        suggestedSubtasks: [],
        contextSources: gathered.sources,
      } satisfies ScopeResult);
    }

    // Persist the scoping decision to agent_decisions
    try {
      const decisionId = crypto.randomUUID();
      const now = new Date().toISOString();
      // Create a conversation for tracking
      const conversationId = crypto.randomUUID();
      db.prepare(
        `INSERT INTO conversations (id, title, status, createdAt, updatedAt)
         VALUES (?, ?, 'active', ?, ?)`
      ).run(conversationId, `Scope: ${goal.slice(0, 60)}`, now, now);

      db.prepare(
        `INSERT INTO agent_decisions (id, conversationId, decisionType, reasoning, level, createdAt)
         VALUES (?, ?, 'scope', ?, ?, ?)`
      ).run(
        decisionId,
        conversationId,
        JSON.stringify(scopeResult),
        scopeResult.level,
        now
      );
    } catch (err) {
      console.error("[scope-goal] Failed to persist decision:", err);
    }

    return NextResponse.json(scopeResult);
  } catch (error) {
    console.error("POST /api/tasks/scope-goal error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

function runClaude(prompt: string): Promise<string | null> {
  return runClaudeTextPrompt({
    prompt,
    model: "haiku",
    timeoutMs: 15_000,
  });
}
