import { NextResponse } from "next/server";
import matter from "gray-matter";

import { fetchTeamSkillFile, fetchTeamSkills, TeamApiError, type TeamSkillSummary } from "@/lib/team-api-context";

export const dynamic = "force-dynamic";

function isBrokenFoldedDescription(description: unknown): boolean {
  return typeof description === "string" && description.trim() === ">";
}

function skillFileContent(file: { content?: string; contentBase64?: string; encoding?: "utf-8" | "base64" }): string {
  if (file.encoding === "base64" || file.contentBase64) {
    return Buffer.from(file.contentBase64 ?? "", "base64").toString("utf-8");
  }
  return file.content ?? "";
}

async function repairSkillDescription(skill: TeamSkillSummary): Promise<TeamSkillSummary> {
  if (!isBrokenFoldedDescription(skill.description)) return skill;
  try {
    const file = await fetchTeamSkillFile(`.claude/skills/${skill.slug}/SKILL.md`);
    const parsed = matter(skillFileContent(file));
    const description = typeof parsed.data.description === "string" ? parsed.data.description.trim() : "";
    if (!description || isBrokenFoldedDescription(description)) {
      return { ...skill, description: null };
    }
    return {
      ...skill,
      name: skill.name || (typeof parsed.data.name === "string" && parsed.data.name.trim() ? parsed.data.name.trim() : skill.name),
      description,
    };
  } catch {
    return { ...skill, description: null };
  }
}

export async function GET() {
  try {
    const skills = await Promise.all((await fetchTeamSkills()).map(repairSkillDescription));
    return NextResponse.json({ signedIn: true, skills });
  } catch (error) {
    return NextResponse.json(
      {
        signedIn: false,
        skills: [],
        error: error instanceof Error ? error.message : "Could not load server skills",
      },
      { status: error instanceof TeamApiError ? error.status : 500 },
    );
  }
}
