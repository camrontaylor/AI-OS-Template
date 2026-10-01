import type { NextRequest } from "next/server";

import { skillNameFromSlashCommand } from "@/lib/slash-commands";
import { isTeamScopedRequest } from "@/lib/team-mode";
import {
  requireSkillPermissionForRequest,
} from "./request-principal";

const SLASH_COMMAND_RE = /(^|[\s("'`])\/([a-z0-9][a-z0-9:._-]*)/gi;

export function extractSkillUseRequests(
  ...texts: Array<string | null | undefined>
): string[] {
  const skills = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    SLASH_COMMAND_RE.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = SLASH_COMMAND_RE.exec(text)) !== null) {
      const skillName = skillNameFromSlashCommand(match[2]);
      if (skillName) skills.add(skillName);
    }
  }
  return [...skills].sort();
}

export async function requireSkillUseForRequest(
  request: NextRequest,
  ...texts: Array<string | null | undefined>
): Promise<string[]> {
  const skillNames = extractSkillUseRequests(...texts);
  if (skillNames.length === 0 || !isTeamScopedRequest(request)) return skillNames;

  const explicitTeamSkills = new Set<string>();
  for (const text of texts) {
    if (!text) continue;
    const teamAlias = /(^|[\s("'`])\/team:([a-z0-9][a-z0-9._-]*)/gi;
    let match: RegExpExecArray | null;
    while ((match = teamAlias.exec(text)) !== null) explicitTeamSkills.add(match[2].toLowerCase());
  }

  // Local and client versions are installation resources. Team permissions
  // are checked only when the caller explicitly forces the Team origin. For
  // the default alias, the session catalog exposes the Team plugin only after
  // the server has returned an active grant.
  for (const skillName of explicitTeamSkills) {
    const ctx = await requireSkillPermissionForRequest(request, skillName, "skill.use");
    await ctx.close();
  }
  return skillNames;
}
