import type { ApprovalRequest } from "@/types/approval";
import type { PermissionMode } from "@/types/task";

export type PermissionGateKey =
  | "email"
  | "social"
  | "content"
  | "spend"
  | "code"
  | "destructive"
  | "external";

export interface PermissionGate {
  key: PermissionGateKey;
  title: string;
  policy: string;
  proof: string;
}

export interface PermissionModeProfile {
  label: string;
  risk: "low" | "medium" | "high";
  detail: string;
}

export const permissionGates: PermissionGate[] = [
  {
    key: "email",
    title: "Email",
    policy: "Approve, edit, request rewrite, or reject before any send.",
    proof: "Draft and recipient scope must be visible before send.",
  },
  {
    key: "social",
    title: "Social publishing",
    policy: "Draft and schedule locally before any external post.",
    proof: "Channel, copy, media, and scheduled time must be reviewable.",
  },
  {
    key: "content",
    title: "Content publishing",
    policy: "CMS and website publishing require an explicit release decision.",
    proof: "Artifact, destination, and rollback path must be visible.",
  },
  {
    key: "spend",
    title: "Paid spend and accounts",
    policy: "Campaigns stay paused; spend, billing, and account upgrades require approval.",
    proof: "Budget, platform, account, and activation state must be shown.",
  },
  {
    key: "code",
    title: "Code and pull requests",
    policy: "PRs, pushes, deploys, and file mutation gates stay explicit.",
    proof: "Diff, branch, command, and target environment must be inspectable.",
  },
  {
    key: "destructive",
    title: "Destructive actions",
    policy: "Delete, archive, revoke, reset, and irreversible cleanup must stop.",
    proof: "Target, blast radius, and undo path must be stated.",
  },
  {
    key: "external",
    title: "Other external changes",
    policy: "Any connected-service mutation stops when it does not fit a narrower gate.",
    proof: "Tool, target, and requested payload must be available.",
  },
];

const gateLabels: Record<PermissionGateKey, string> = Object.fromEntries(
  permissionGates.map((gate) => [gate.key, gate.title]),
) as Record<PermissionGateKey, string>;

function parseInput(inputJson: string | null | undefined): unknown {
  if (!inputJson?.trim()) return {};
  try {
    return JSON.parse(inputJson);
  } catch {
    return inputJson;
  }
}

function stringifyInput(input: unknown): string {
  if (typeof input === "string") return input;
  try {
    return JSON.stringify(input ?? {});
  } catch {
    return String(input);
  }
}

function requestHaystack(
  request: Pick<ApprovalRequest, "toolName" | "inputJson" | "title" | "description">,
): string {
  return [
    request.toolName,
    request.title,
    request.description,
    stringifyInput(parseInput(request.inputJson)),
  ]
    .filter(Boolean)
    .join("\n")
    .toLowerCase();
}

export function getPermissionGateLabel(key: PermissionGateKey): string {
  return gateLabels[key];
}

export function classifyPermissionGate(
  request: Pick<ApprovalRequest, "toolName" | "inputJson" | "title" | "description">,
): PermissionGateKey {
  const text = requestHaystack(request);
  const toolName = request.toolName.toLowerCase();

  if (/\b(rm\s+-|delete|trash|archive|revoke|drop\s+table|reset\s+--hard|destroy|wipe)\b/.test(text)) {
    return "destructive";
  }

  if (
    /\b(billing|upgrade|subscription|invoice|stripe|paid|ads?|budget|spend|card|payment)\b/.test(text) ||
    /\b(ad|ads|paid|budget|spend)\s+(?:\w+\s+){0,3}campaign\b/.test(text) ||
    /\bcampaign\s+(activation|budget|spend)\b/.test(text) ||
    /\b(activate|launch)\s+(?:\w+\s+){0,3}(ad\s+)?campaign\b/.test(text)
  ) {
    return "spend";
  }

  if (/\b(gmail|email|mailchimp|newsletter|resend|klaviyo|beehiiv|recipient|send mail)\b/.test(text)) {
    return "email";
  }

  if (/\b(linkedin|twitter|x\.com|threads|instagram|tiktok|social|post|tweet)\b/.test(text)) {
    return "social";
  }

  if (/\b(cms|wordpress|webflow|contentful|sanity|publish page|publish article|live page)\b/.test(text)) {
    return "content";
  }

  if (
    toolName === "write" ||
    toolName === "edit" ||
    toolName === "multiedit" ||
    /\b(git|gh\s+pr|pull request|deploy|vercel|netlify|npm\s+version|release)\b/.test(text)
  ) {
    return "code";
  }

  return "external";
}

export function getPermissionModeProfile(mode: PermissionMode | string | null | undefined): PermissionModeProfile {
  switch (mode) {
    case "plan":
      return {
        label: "Plan first",
        risk: "low",
        detail: "Agent drafts the plan and waits before execution.",
      };
    case "default":
      return {
        label: "Default ask mode",
        risk: "medium",
        detail: "Agent asks at configured approval boundaries.",
      };
    case "acceptEdits":
      return {
        label: "Auto-edit",
        risk: "medium",
        detail: "File edits can proceed; higher-risk commands still gate.",
      };
    case "auto":
    case "bypassPermissions":
      return {
        label: "Full auto",
        risk: "high",
        detail: "Agent can run without normal approval prompts.",
      };
    default:
      return {
        label: "Unknown",
        risk: "medium",
        detail: "Permission mode is missing or not recognized.",
      };
  }
}
