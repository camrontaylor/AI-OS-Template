import type { NextRequest } from "next/server";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const TRUE_VALUES = new Set(["1", "true", "yes", "on", "hosted", "team"]);

function envFlag(value: string | undefined): boolean {
  return TRUE_VALUES.has((value ?? "").trim().toLowerCase());
}

function teamContextPath(env: NodeJS.ProcessEnv): string | null {
  if (env !== process.env && !env.AI_OS_TEAM_CONFIG_DIR) return null;
  const dir = env.AI_OS_TEAM_CONFIG_DIR
    ? path.resolve(env.AI_OS_TEAM_CONFIG_DIR)
    : path.join(os.homedir(), ".AI-OS");
  return path.join(dir, "team-context.json");
}

export function hasSavedTeamApiContext(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    const filePath = teamContextPath(env);
    if (!filePath) return false;
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.apiUrl !== "string" ||
      typeof parsed.token !== "string"
    ) {
      return false;
    }
    return /^https?:\/\//i.test(parsed.apiUrl.trim()) && parsed.token.trim() !== "";
  } catch {
    return false;
  }
}

export function isHostedTeamMode(env: NodeJS.ProcessEnv = process.env): boolean {
  return (
    envFlag(env.AI_OS_HOSTED_MODE) ||
    envFlag(env.TEAM_OS_HOSTED_MODE) ||
    (env.AI_OS_MODE ?? "").trim().toLowerCase() === "hosted" ||
    (Boolean(env.AI_OS_TEAM_CONFIG_DIR) && hasSavedTeamApiContext(env))
  );
}

export function isTeamScopedRequest(request: NextRequest): boolean {
  return (
    isHostedTeamMode() ||
    Boolean(request.headers.get("x-ai-team-id")?.trim()) ||
    Boolean(request.nextUrl.searchParams.get("teamId")?.trim())
  );
}

export function hostedModeForbiddenResponse() {
  return Response.json(
    {
      error:
        "This local-only action is disabled in hosted team mode. Use Team OS routes for team files and settings.",
    },
    { status: 403 },
  );
}
