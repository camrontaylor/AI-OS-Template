import { NextRequest, NextResponse } from "next/server";
import {
  parseQuestionSpecs,
  serializeAnswersToProse,
  type QuestionAnswers,
  type QuestionSpec,
} from "@/types/question-spec";
import { runClaudeTextPrompt } from "@/lib/run-claude-text-prompt";

interface PlanSubtasksBody {
  goal: string;
  questions?: unknown;
  answers?: QuestionAnswers;
  level?: "project" | "gsd";
  /** Optional pre-loaded context summary from gather-context */
  contextSummary?: string;
}

export interface PlannedSubtask {
  title: string;
  description: string;
  dependsOn: number[];
  wave: number;
  acceptanceCriteria: string[];
}

export interface PlanSubtasksResult {
  /** The generated breakdown — empty when the model asked for follow-ups */
  suggestedSubtasks: PlannedSubtask[];
  /**
   * Sonnet can ask its own clarifying questions before committing to a
   * breakdown. When this array is non-empty the client should render it
   * in Step 1 (merged with any prior questions) instead of advancing.
   */
  followUpQuestions: QuestionSpec[];
  /** "ai" = Sonnet produced the output; "fallback" = generic scaffold */
  source: "ai" | "fallback";
  /** Optional rationale the client can show as a banner */
  note?: string;
}

function fallbackSubtasks(goal: string): PlannedSubtask[] {
  return [
    {
      title: "Draft the brief",
      description: `Write a one-page brief covering the goal, audience, and constraints for: ${goal.slice(0, 120)}`,
      dependsOn: [],
      wave: 1,
      acceptanceCriteria: ["brief.md exists and covers goal, audience, constraints"],
    },
    {
      title: "Produce the core deliverable",
      description: "Build the main output that the goal asks for, following the brief.",
      dependsOn: [0],
      wave: 2,
      acceptanceCriteria: ["Primary deliverable is complete and self-contained"],
    },
    {
      title: "Review and polish",
      description: "Review the output for quality, tone, and completeness. Fix gaps.",
      dependsOn: [1],
      wave: 3,
      acceptanceCriteria: ["Output passes a self-review checklist"],
    },
  ];
}

/**
 * POST /api/tasks/plan-subtasks
 *
 * Given a goal, the typed questions asked so far, and the user's answers,
 * Sonnet either (a) returns a concrete subtask breakdown or (b) asks for
 * more information via followUpQuestions. The wizard loops through this
 * endpoint until Sonnet stops asking for more info or the user bails.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as PlanSubtasksBody;
    const goal = (body.goal ?? "").trim();
    if (!goal) {
      return NextResponse.json({ error: "goal is required" }, { status: 400 });
    }

    const specs: QuestionSpec[] = body.questions ? parseQuestionSpecs(body.questions) : [];
    const answers = body.answers ?? {};
    const answersBlock =
      specs.length > 0 ? serializeAnswersToProse(specs, answers) : "";

    const level = body.level === "gsd" ? "gsd" : "project";
    const contextBlock =
      typeof body.contextSummary === "string" && body.contextSummary.trim().length > 0
        ? `\n\n## Known context (already loaded — use this to ground the breakdown)\n\n${body.contextSummary.trim()}`
        : "";

    // Build a compact log of what's already been asked so Sonnet doesn't
    // repeat itself. IDs are what the client uses to dedupe new questions.
    const askedIdsLine =
      specs.length > 0
        ? `\n\nQuestions already asked (IDs — do NOT repeat these): ${specs.map((s) => s.id).join(", ")}`
        : "";

    const prompt = `You are a senior project planner. A user submitted this goal and answered some upfront clarifying questions. Your job is to produce a concrete breakdown of the work into 3-7 actionable subtasks — OR, if you genuinely need more information before you can do that well, ask up to 3 targeted follow-up questions.

## Decision rule (read carefully)

Default to producing subtasks. Only ask follow-up questions when the answers so far are missing something essential that would fundamentally change the shape of the plan — not things you could reasonably guess or assume. Examples of legitimate follow-ups:
- The goal says "landing page" but doesn't reveal the product; you literally don't know what to write copy about.
- Success criteria are undefined and the deliverable depends on them (e.g. "build a dashboard" with no idea what metrics matter).
- There are two fundamentally different directions the project could take and you need the user to pick one.

Do NOT ask follow-ups for:
- Tone, voice, or stylistic preferences you can default sensibly.
- Minor scope decisions (page length, number of sections, etc).
- Anything already answered in the clarifications below.

## Subtask rules (when producing the breakdown)

- Each title starts with an action verb (Draft, Write, Design, Build, Configure, Test, Launch, Review, etc.)
- Wave 1 = foundation work with no dependencies. Wave 2+ can run in parallel after their dependencies are met. Same-wave tasks cannot depend on each other.
- Each subtask must have at least one **observable** acceptance criterion (not vague — something you could literally check).
- dependsOn is an array of 0-based indices into this same list. Wave 1 subtasks have dependsOn: [].
- Aim for ${level === "gsd" ? "5-7" : "3-6"} subtasks. Meaningful chunks only — no "set up folder" filler.
- Tailor the breakdown to the SPECIFIC goal and the user's SPECIFIC answers. Don't produce a generic "brief → build → review" template — use the actual context.

## Follow-up question rules (when asking)

Each question is a typed QuestionSpec:
- "id": short snake_case identifier, must NOT collide with any already-asked ID
- "prompt": the question text
- "type": "text" | "multiline" | "select" | "multiselect"
- "options": only for select/multiselect, 2-6 enumerable choices
- "required": true for the most load-bearing question
Prefer "select" when there's a small enumerable answer space.

## Goal

${goal}
${answersBlock ? `\n## Clarifications so far\n\n${answersBlock}` : ""}${contextBlock}${askedIdsLine}

Return ONLY valid JSON (no markdown, no explanation). Use exactly one of these two shapes:

Shape A — subtask breakdown:
{
  "suggestedSubtasks": [
    { "title": "…", "description": "…", "dependsOn": [0], "wave": 2, "acceptanceCriteria": ["…"] }
  ]
}

Shape B — follow-up questions:
{
  "followUpQuestions": [
    { "id": "…", "prompt": "…", "type": "select", "options": ["…", "…"], "required": true }
  ]
}`;

    const result = await runClaude(prompt);
    if (!result) {
      console.error("[plan-subtasks] Sonnet returned null — using fallback scaffold");
      return NextResponse.json({
        suggestedSubtasks: fallbackSubtasks(goal),
        followUpQuestions: [],
        source: "fallback",
        note: "Planner was unavailable — showing a generic scaffold. Edit or replace before creating the project.",
      } satisfies PlanSubtasksResult);
    }

    try {
      const jsonStr = result.replace(/```json?\s*/g, "").replace(/```/g, "").trim();
      const raw = JSON.parse(jsonStr) as Record<string, unknown>;

      // Follow-up questions take precedence
      const rawFollowUps = Array.isArray(raw.followUpQuestions)
        ? raw.followUpQuestions
        : null;
      if (rawFollowUps && rawFollowUps.length > 0) {
        const followUpQuestions = parseQuestionSpecs(rawFollowUps);
        // Strip any that collide with already-asked IDs
        const askedIds = new Set(specs.map((s) => s.id));
        const fresh = followUpQuestions.filter((q) => !askedIds.has(q.id));
        if (fresh.length > 0) {
          return NextResponse.json({
            suggestedSubtasks: [],
            followUpQuestions: fresh,
            source: "ai",
          } satisfies PlanSubtasksResult);
        }
        // If Sonnet only repeated questions, fall through to subtask parsing
      }

      const rawList = Array.isArray(raw.suggestedSubtasks) ? raw.suggestedSubtasks : [];
      const cleaned: PlannedSubtask[] = rawList
        .map((s): PlannedSubtask | null => {
          if (!s || typeof s !== "object") return null;
          const obj = s as Record<string, unknown>;
          const title = typeof obj.title === "string" ? obj.title.trim() : "";
          if (!title) return null;
          const description = typeof obj.description === "string" ? obj.description : "";
          const dependsOn = Array.isArray(obj.dependsOn)
            ? (obj.dependsOn as unknown[])
                .map((n) => (typeof n === "number" ? n : null))
                .filter((n): n is number => n !== null)
            : [];
          const wave = typeof obj.wave === "number" && obj.wave >= 1 ? obj.wave : 1;
          const acceptanceCriteria = Array.isArray(obj.acceptanceCriteria)
            ? (obj.acceptanceCriteria as unknown[])
                .map((c) => (typeof c === "string" ? c : null))
                .filter((c): c is string => c !== null)
            : [];
          return { title, description, dependsOn, wave, acceptanceCriteria };
        })
        .filter((s): s is PlannedSubtask => s !== null);

      if (cleaned.length > 0) {
        console.log(`[plan-subtasks] Sonnet returned ${cleaned.length} subtasks for: ${goal.slice(0, 80)}`);
        return NextResponse.json({
          suggestedSubtasks: cleaned,
          followUpQuestions: [],
          source: "ai",
        } satisfies PlanSubtasksResult);
      }

      console.warn("[plan-subtasks] Sonnet returned no usable subtasks — using fallback");
      return NextResponse.json({
        suggestedSubtasks: fallbackSubtasks(goal),
        followUpQuestions: [],
        source: "fallback",
        note: "Planner returned an empty breakdown — showing a generic scaffold. Edit or replace before creating.",
      } satisfies PlanSubtasksResult);
    } catch (err) {
      console.error("[plan-subtasks] Parse failure:", err);
      console.error("[plan-subtasks] Raw output was:", result.slice(0, 500));
      return NextResponse.json({
        suggestedSubtasks: fallbackSubtasks(goal),
        followUpQuestions: [],
        source: "fallback",
        note: "Planner output couldn't be parsed — showing a generic scaffold.",
      } satisfies PlanSubtasksResult);
    }
  } catch (err) {
    console.error("POST /api/tasks/plan-subtasks error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

function runClaude(prompt: string): Promise<string | null> {
  return runClaudeTextPrompt({
    prompt,
    model: "sonnet",
    timeoutMs: 90_000,
  });
}
