import {
  extractQuestionSpecsFromText,
  parseQuestionSpecs,
  stripQuestionSpecsFromText,
  type QuestionSpec,
} from "@/types/question-spec";
import type { LogEntry } from "@/types/task";

const APPROVED_BRIEF_OPEN = /```approved-brief\s*\n/i;
const ASK_USER_QUESTIONS_OPEN = /```ask-user-questions\s*\n/i;
const STANDALONE_TRIPLE_FENCE = /^```[ \t]*$/gm;

interface ApprovedBriefExtraction {
  body: string;
  matchedText: string;
}

function normalizeNewlines(text: string): string {
  return text.replace(/\r\n/g, "\n").trim();
}

function normalizeLineEndings(text: string): string {
  return String(text ?? "").replace(/\r\n/g, "\n");
}

function collapseBlankLines(text: string): string {
  return text
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim();
}

function extractApprovedBriefBlock(text: string): ApprovedBriefExtraction | null {
  const normalized = normalizeLineEndings(text);
  const opener = normalized.match(APPROVED_BRIEF_OPEN);
  if (!opener || opener.index == null) {
    return null;
  }

  const bodyStart = opener.index + opener[0].length;
  const askMatch = normalized.slice(bodyStart).match(ASK_USER_QUESTIONS_OPEN);
  const searchEnd = askMatch?.index != null ? bodyStart + askMatch.index : normalized.length;
  const searchRegion = normalized.slice(bodyStart, searchEnd);

  let closingFenceStart = -1;
  let closingFenceEnd = -1;
  STANDALONE_TRIPLE_FENCE.lastIndex = 0;

  let match: RegExpExecArray | null;
  while ((match = STANDALONE_TRIPLE_FENCE.exec(searchRegion)) !== null) {
    closingFenceStart = bodyStart + match.index;
    closingFenceEnd = closingFenceStart + match[0].length;
  }

  if (closingFenceStart < 0) {
    return null;
  }

  return {
    body: normalizeNewlines(normalized.slice(bodyStart, closingFenceStart)),
    matchedText: normalized.slice(opener.index, closingFenceEnd),
  };
}

function extractApprovedBriefBlockFromText(text: string): string | null {
  return extractApprovedBriefBlock(text)?.body ?? null;
}

export interface ApprovedPlanVersion {
  id: string;
  content: string;
  createdAt: string;
  status: "active" | "superseded";
}

export function extractApprovedPlanVersionsFromLogs(logEntries: LogEntry[]): ApprovedPlanVersion[] {
  const versions: Array<Omit<ApprovedPlanVersion, "status">> = [];
  let turnStart = 0;
  const collectTurn = (turnEnd: number) => {
    const entries = logEntries.slice(turnStart, turnEnd);
    const text = entries.filter((entry) => entry.type === "text").map((entry) => entry.content).join("\n");
    const content = extractApprovedBriefBlockFromText(text);
    if (!content || versions.some((version) => version.content === content)) return;
    const timestamp = [...entries].reverse().find((entry) => entry.timestamp)?.timestamp ?? new Date(0).toISOString();
    versions.push({ id: `plan-${versions.length + 1}`, content, createdAt: timestamp });
  };
  for (let index = 0; index < logEntries.length; index += 1) {
    if (logEntries[index].type !== "user_reply") continue;
    collectTurn(index);
    turnStart = index + 1;
  }
  collectTurn(logEntries.length);
  return versions.map((version, index) => ({
    ...version,
    status: index === versions.length - 1 ? "active" : "superseded",
  }));
}

export function extractApprovedBriefBlockFromLogs(logEntries: LogEntry[]): string | null {
  for (let i = logEntries.length - 1; i >= 0; i -= 1) {
    const entry = logEntries[i];
    if (entry.type !== "text") continue;
    const approvedBrief = extractApprovedBriefBlockFromText(entry.content);
    if (approvedBrief) {
      return approvedBrief;
    }
  }

  return null;
}

export interface PendingPlanReviewData {
  question: QuestionSpec;
  questionEntryId: string;
  questionEntryIndex: number;
  turnTextEntryIds: string[];
  briefContent: string | null;
  summaryText: string | null;
}

type PlanApprovalQuestionMatch = {
  question: QuestionSpec;
  entryId: string;
  entryIndex: number;
};

function findLatestPlanApprovalQuestion(
  logEntries: LogEntry[],
  options: { requirePending: boolean },
): PlanApprovalQuestionMatch | null {
  for (let i = logEntries.length - 1; i >= 0; i -= 1) {
    const entry = logEntries[i];
    if (
      entry.type !== "structured_question"
      || (options.requirePending && entry.questionAnswers)
      || !entry.questionSpec
    ) {
      continue;
    }

    try {
      const specs = parseQuestionSpecs(JSON.parse(entry.questionSpec));
      const planApprovalQuestion = specs.find(
        (question) => question.intent === "plan_approval" || question.id === "plan_action",
      );
      if (planApprovalQuestion) {
        return {
          question: planApprovalQuestion,
          entryId: entry.id,
          entryIndex: i,
        };
      }
    } catch {
      return null;
    }
  }

  return null;
}

function joinTurnTextEntries(entries: LogEntry[]): string {
  return normalizeNewlines(
    entries
      .map((entry) => String(entry.content ?? "").replace(/\r\n/g, "\n"))
      .filter((chunk) => chunk.trim().length > 0)
      .join("\n"),
  );
}

function buildPlanSummaryText(turnText: string): string | null {
  let summaryText = stripApprovedBriefBlockFromText(turnText);
  const extractedQuestions = extractQuestionSpecsFromText(summaryText);
  if (extractedQuestions) {
    summaryText = stripQuestionSpecsFromText(summaryText, extractedQuestions.matchedText);
  }

  const normalized = collapseBlankLines(normalizeNewlines(summaryText));
  return normalized.length > 0 ? normalized : null;
}

function buildPlanReviewDataFromQuestionMatch(
  logEntries: LogEntry[],
  questionMatch: PlanApprovalQuestionMatch | null,
): PendingPlanReviewData | null {
  if (!questionMatch) {
    return null;
  }

  let turnStartIndex = 0;
  for (let i = questionMatch.entryIndex - 1; i >= 0; i -= 1) {
    if (logEntries[i].type === "user_reply") {
      turnStartIndex = i + 1;
      break;
    }
  }

  const turnTextEntries = logEntries
    .slice(turnStartIndex, questionMatch.entryIndex)
    .filter((entry) => entry.type === "text");

  const turnText = joinTurnTextEntries(turnTextEntries);
  const briefContent =
    extractApprovedBriefBlockFromText(turnText)
    ?? extractApprovedBriefBlockFromLogs(logEntries.slice(turnStartIndex, questionMatch.entryIndex));
  const summaryText = buildPlanSummaryText(turnText);

  return {
    question: questionMatch.question,
    questionEntryId: questionMatch.entryId,
    questionEntryIndex: questionMatch.entryIndex,
    turnTextEntryIds: turnTextEntries.map((entry) => entry.id),
    briefContent,
    summaryText,
  };
}

export function getPendingPlanApprovalQuestion(logEntries: LogEntry[]): QuestionSpec | null {
  return findLatestPlanApprovalQuestion(logEntries, { requirePending: true })?.question ?? null;
}

export function getPendingPlanReviewData(logEntries: LogEntry[]): PendingPlanReviewData | null {
  return buildPlanReviewDataFromQuestionMatch(
    logEntries,
    findLatestPlanApprovalQuestion(logEntries, { requirePending: true }),
  );
}

export function extractPendingApprovedBriefFromLogs(logEntries: LogEntry[]): string | null {
  return getPendingPlanReviewData(logEntries)?.briefContent ?? null;
}

export function stripApprovedBriefBlockFromText(text: string): string {
  const extracted = extractApprovedBriefBlock(text);
  if (!extracted) {
    return text;
  }

  return collapseBlankLines(
    normalizeLineEndings(text).replace(extracted.matchedText, "\n\n"),
  );
}

export function extractApprovedBriefFromLogs(logEntries: LogEntry[]): string | null {
  const approvedBlock =
    buildPlanReviewDataFromQuestionMatch(
      logEntries,
      findLatestPlanApprovalQuestion(logEntries, { requirePending: false }),
    )?.briefContent
    ?? extractApprovedBriefBlockFromLogs(logEntries);
  if (approvedBlock) {
    return approvedBlock;
  }

  for (let i = logEntries.length - 1; i >= 0; i -= 1) {
    const entry = logEntries[i];
    if (entry.type === "text" && entry.content.trim().length > 0) {
      return normalizeNewlines(entry.content);
    }
  }

  return null;
}
