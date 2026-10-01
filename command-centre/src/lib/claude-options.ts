import type { ClaudeModel, ClaudeThinkingEffort } from "@/types/task";

export interface ClaudeModelOption {
  value: ClaudeModel;
  label: string;
}

export const CLAUDE_MODEL_OPTIONS: ClaudeModelOption[] = [
  { value: "haiku", label: "Haiku" },
  { value: "sonnet", label: "Sonnet" },
  { value: "opus", label: "Opus" },
  { value: "fable", label: "Fable" },
];

export const VALID_CLAUDE_MODELS: ClaudeModel[] = CLAUDE_MODEL_OPTIONS.map((option) => option.value);
export const DEFAULT_CLAUDE_MODEL: ClaudeModel = "opus";

export const VALID_CLAUDE_THINKING_EFFORTS: ClaudeThinkingEffort[] = [
  "auto",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
];

const FULL_EFFORT_MODELS = new Set(["fable", "opus"]);
const SONNET_EFFORT_MODELS = new Set(["sonnet"]);
const HAIKU_EFFORT_MODELS = new Set(["haiku"]);
const FULL_EFFORTS: ClaudeThinkingEffort[] = ["auto", "low", "medium", "high", "xhigh", "max"];
const SONNET_EFFORTS: ClaudeThinkingEffort[] = ["auto", "low", "medium", "high", "max"];
const HAIKU_EFFORTS: ClaudeThinkingEffort[] = ["auto"];
const CONTROL_CHAR_PATTERN = /[\u0000-\u001f\u007f]/;
const WHITESPACE_PATTERN = /\s/;

export function isClaudeThinkingEffort(value: unknown): value is ClaudeThinkingEffort {
  return typeof value === "string" && VALID_CLAUDE_THINKING_EFFORTS.includes(value as ClaudeThinkingEffort);
}

export function isNullableClaudeThinkingEffort(value: unknown): value is ClaudeThinkingEffort | null {
  return value === null || isClaudeThinkingEffort(value);
}

export function normalizeClaudeModel(value: unknown): ClaudeModel | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (CONTROL_CHAR_PATTERN.test(trimmed) || WHITESPACE_PATTERN.test(trimmed)) return null;
  const lower = trimmed.toLowerCase();
  return VALID_CLAUDE_MODELS.includes(lower) ? lower : trimmed;
}

export function isClaudeModel(value: unknown): value is ClaudeModel {
  return normalizeClaudeModel(value) !== null;
}

export function isNullableClaudeModel(value: unknown): value is ClaudeModel | null {
  return value === null || isClaudeModel(value);
}

export function isKnownClaudeModel(value: unknown): value is ClaudeModel {
  const model = normalizeClaudeModel(value);
  return Boolean(model && VALID_CLAUDE_MODELS.includes(model.toLowerCase()));
}

export function getClaudeModelLabel(model: ClaudeModel | null | undefined): string {
  const normalized = normalizeClaudeModel(model) ?? DEFAULT_CLAUDE_MODEL;
  return CLAUDE_MODEL_OPTIONS.find((option) => option.value === normalized.toLowerCase())?.label ?? normalized;
}

export function getSupportedClaudeThinkingEfforts(model: ClaudeModel | null | undefined): ClaudeThinkingEffort[] {
  const normalized = normalizeClaudeModel(model)?.toLowerCase() ?? DEFAULT_CLAUDE_MODEL;
  if (HAIKU_EFFORT_MODELS.has(normalized)) return HAIKU_EFFORTS;
  if (SONNET_EFFORT_MODELS.has(normalized)) return SONNET_EFFORTS;
  if (FULL_EFFORT_MODELS.has(normalized)) return FULL_EFFORTS;
  return FULL_EFFORTS;
}

export function isClaudeThinkingEffortSupportedForModel(
  model: ClaudeModel | null | undefined,
  effort: ClaudeThinkingEffort | null | undefined,
): boolean {
  return effort == null || getSupportedClaudeThinkingEfforts(model).includes(effort);
}

export function normalizeClaudeThinkingEffortForModel(
  model: ClaudeModel | null | undefined,
  effort: ClaudeThinkingEffort | null | undefined,
): ClaudeThinkingEffort | null {
  if (effort == null) return null;
  if (isClaudeThinkingEffortSupportedForModel(model, effort)) return effort;
  const normalized = normalizeClaudeModel(model)?.toLowerCase() ?? DEFAULT_CLAUDE_MODEL;
  if (SONNET_EFFORT_MODELS.has(normalized) && effort === "xhigh") return "high";
  return "auto";
}
