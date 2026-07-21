/**
 * Structured question system — typed alternative to free-prose Q&A.
 *
 * A `QuestionSpec` describes a single question the user should answer.
 * A list of them is rendered by the `QuestionModal` component (inline in
 * the scoping wizard, or as an overlay when a running task pauses for
 * clarification).
 *
 * Used in two places:
 *   1. Pre-execution — scope-goal returns typed questions for the wizard
 *   2. Mid-execution — Claude emits a fenced `ask-user-questions` block
 */

export type QuestionType = "text" | "multiline" | "select" | "multiselect";

export interface QuestionSpec {
  /** Stable identifier used as form field key and answer map key */
  id: string;
  /** Human-readable prompt shown above the input */
  prompt: string;
  /** Input widget type */
  type: QuestionType;
  /** Only for select/multiselect — list of choices */
  options?: string[];
  /** If true, answer required before the form can be submitted */
  required?: boolean;
  /** Optional hint text for text/multiline inputs */
  placeholder?: string;
  /** Optional semantic hint so the UI can render first-class actions */
  intent?: "plan_approval";
  /** Optional metadata payload used by the reply route / UI */
  metadata?: Record<string, unknown>;
}

/** Answer map keyed by QuestionSpec.id */
export type QuestionAnswers = Record<string, string | string[]>;

export interface ExtractedQuestionSpecs {
  specs: QuestionSpec[];
  matchedText: string;
}

/**
 * Validate and sanitize raw JSON into a QuestionSpec[]. Unknown types
 * fall back to "text". Returns an empty list if the input is malformed.
 */
export function parseQuestionSpecs(raw: unknown): QuestionSpec[] {
  if (!Array.isArray(raw)) return [];
  const out: QuestionSpec[] = [];
  for (let i = 0; i < raw.length; i++) {
    const q = raw[i] as Record<string, unknown> | null;
    if (!q || typeof q !== "object") continue;
    const prompt = typeof q.prompt === "string" ? q.prompt.trim() : "";
    if (!prompt) continue;
    const rawType = typeof q.type === "string" ? q.type : "text";
    const type: QuestionType =
      rawType === "multiline" || rawType === "select" || rawType === "multiselect"
        ? rawType
        : "text";
    const id =
      typeof q.id === "string" && q.id.trim().length > 0
        ? q.id.trim()
        : `q${i + 1}`;
    const options =
      (type === "select" || type === "multiselect") && Array.isArray(q.options)
        ? q.options
            .filter((o): o is string => typeof o === "string" && o.trim().length > 0)
            .map((o) => o.trim())
        : undefined;
    const spec: QuestionSpec = {
      id,
      prompt,
      type,
      required: q.required === true,
    };
    if (options && options.length > 0) spec.options = options;
    if (typeof q.placeholder === "string") spec.placeholder = q.placeholder;
    if (q.intent === "plan_approval") spec.intent = "plan_approval";
    if (q.metadata && typeof q.metadata === "object" && !Array.isArray(q.metadata)) {
      spec.metadata = q.metadata as Record<string, unknown>;
    }
    out.push(spec);
  }
  return out;
}

function parseQuestionSpecsPayload(payload: string): QuestionSpec[] {
  try {
    const parsed = JSON.parse(payload.trim());
    const raw = Array.isArray(parsed)
      ? parsed
      : Array.isArray((parsed as Record<string, unknown>)?.questions)
        ? (parsed as { questions: unknown[] }).questions
        : null;
    return raw ? parseQuestionSpecs(raw) : [];
  } catch {
    return [];
  }
}

/**
 * Detect typed question payloads embedded in plain text.
 *
 * Supports:
 * - ```ask-user-questions fences
 * - generic fenced JSON blocks
 * - raw JSON array/object strings
 */
export function extractQuestionSpecsFromText(text: string): ExtractedQuestionSpecs | null {
  const taggedFence = text.match(/```ask-user-questions\s*\r?\n([\s\S]*?)\r?\n```/i);
  if (taggedFence?.[0] && taggedFence[1]) {
    const specs = parseQuestionSpecsPayload(taggedFence[1]);
    if (specs.length > 0) {
      return { specs, matchedText: taggedFence[0] };
    }
  }

  const genericFenceRegex = /```(?:json|javascript|js|ts|tsx)?\s*\r?\n([\s\S]*?)\r?\n```/gi;
  for (const match of text.matchAll(genericFenceRegex)) {
    const matchedText = match[0];
    const payload = match[1];
    if (!matchedText || !payload) continue;
    const specs = parseQuestionSpecsPayload(payload);
    if (specs.length > 0) {
      return { specs, matchedText };
    }
  }

  const trimmed = text.trim();
  if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
    const specs = parseQuestionSpecsPayload(trimmed);
    if (specs.length > 0) {
      return { specs, matchedText: trimmed };
    }
  }

  return null;
}

export function stripQuestionSpecsFromText(text: string, matchedText?: string): string {
  const cleaned = matchedText ? text.replace(matchedText, "") : text;
  return cleaned.replace(/\n{3,}/g, "\n\n").trim();
}

/**
 * Serialise a set of answers into a prose block that can be sent to
 * Claude as a continuation message. This preserves session continuity —
 * the CLI receives a normal text message, no schema changes required.
 */
export function serializeAnswersToProse(
  questions: QuestionSpec[],
  answers: QuestionAnswers,
): string {
  const lines: string[] = ["Here are my answers:", ""];
  questions.forEach((q, i) => {
    const raw = answers[q.id];
    let answerText: string;
    if (Array.isArray(raw)) {
      answerText = raw.length > 0 ? raw.join(", ") : "(no answer)";
    } else if (typeof raw === "string" && raw.trim().length > 0) {
      answerText = raw.trim();
    } else {
      answerText = "(no answer)";
    }
    lines.push(`${i + 1}. ${q.prompt}`);
    lines.push(`   → ${answerText}`);
    lines.push("");
  });
  return lines.join("\n").trim();
}

/**
 * Check whether a complete set of answers has been provided for the
 * given specs. Used to gate form submission.
 */
export function areAnswersComplete(
  questions: QuestionSpec[],
  answers: QuestionAnswers,
): boolean {
  for (const q of questions) {
    if (!q.required) continue;
    const a = answers[q.id];
    if (Array.isArray(a)) {
      if (a.length === 0) return false;
    } else if (typeof a !== "string" || a.trim().length === 0) {
      return false;
    }
  }
  return true;
}
