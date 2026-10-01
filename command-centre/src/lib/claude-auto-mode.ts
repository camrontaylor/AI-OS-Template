import { getClaudeModelLabel, normalizeClaudeModel } from "@/lib/claude-options";
import type { ClaudeModel, PermissionMode } from "@/types/task";

export const AUTO_MODE_MINIMUM_CLI_VERSION = "2.1.83" as const;

export type ClaudeCliCapabilityStatus = "available" | "missing" | "unknown";
export type AutoModeCliCompatibility = "compatible" | "incompatible" | "unknown";
export type AutoModeCapabilityReason =
  | "cli_missing"
  | "cli_too_old"
  | "version_unparseable"
  | "check_failed"
  | "check_timeout";
export type AutoModeUnavailableReason = "cli_missing" | "cli_too_old" | "model_incompatible";

export interface ClaudeCapabilities {
  checkedAt: string;
  cli: {
    status: ClaudeCliCapabilityStatus;
    version: string | null;
  };
  autoMode: {
    cliCompatibility: AutoModeCliCompatibility;
    minimumVersion: typeof AUTO_MODE_MINIMUM_CLI_VERSION;
    reason: AutoModeCapabilityReason | null;
  };
}

export interface AutoModeUnavailable {
  code: "auto_mode_unavailable";
  reason: AutoModeUnavailableReason;
  error: string;
}

export type AutoModeModelCompatibility = "compatible" | "incompatible" | "unknown";

export function parseClaudeCliVersion(output: string): string | null {
  const match = output.match(/\b(\d+)\.(\d+)\.(\d+)\b/);
  return match ? `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}` : null;
}

export function compareVersions(left: string, right: string): number {
  const leftParts = left.split(".").map(Number);
  const rightParts = right.split(".").map(Number);
  for (let index = 0; index < 3; index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference > 0 ? 1 : -1;
  }
  return 0;
}

function extractExplicitClaudeModelVersion(model: string): [number, number] | null {
  const afterFamily = model.match(/(?:sonnet|opus)[-_.]?(\d+)(?:[-_.](\d+))?/i);
  if (afterFamily) return [Number(afterFamily[1]), Number(afterFamily[2] ?? 0)];

  const beforeFamily = model.match(/claude[-_.]?(\d+)(?:[-_.](\d+))?[-_.]?(?:sonnet|opus)/i);
  if (beforeFamily) return [Number(beforeFamily[1]), Number(beforeFamily[2] ?? 0)];

  return null;
}

export function getAutoModeModelCompatibility(
  model: ClaudeModel | null | undefined,
): AutoModeModelCompatibility {
  const normalized = normalizeClaudeModel(model);
  if (!normalized) return "unknown";

  const lower = normalized.toLowerCase();
  if (lower === "haiku" || /(^|[-_.])haiku($|[-_.])/i.test(lower)) {
    return "incompatible";
  }
  if (/^claude[-_.]?3(?:$|[-_.])/i.test(lower)) {
    return "incompatible";
  }
  if (lower === "fable") return "unknown";
  if (lower === "sonnet" || lower === "opus") return "compatible";

  if (/(sonnet|opus)/i.test(lower)) {
    const version = extractExplicitClaudeModelVersion(lower);
    if (!version) return "unknown";
    const [major, minor] = version;
    return major > 4 || (major === 4 && minor >= 6) ? "compatible" : "incompatible";
  }

  return "unknown";
}

export function getAutoModeModelError(model: ClaudeModel | null | undefined): string | null {
  if (getAutoModeModelCompatibility(model) !== "incompatible") return null;
  return `Auto is not available with ${getClaudeModelLabel(model)}. Choose a supported Sonnet or Opus model.`;
}

export function permissionStateUsesAuto(
  permissionMode: PermissionMode | string | null | undefined,
  executionPermissionMode?: PermissionMode | string | null,
): boolean {
  return permissionMode === "auto" || executionPermissionMode === "auto";
}
