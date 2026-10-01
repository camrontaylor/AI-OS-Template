import type { SkillCatalogEntry, SkillFileSelection } from "@/types/file";

export function primarySkillFileSelection(skill: SkillCatalogEntry): SkillFileSelection {
  return {
    path: `.claude/skills/${skill.folderName}/SKILL.md`,
    origin: skill.effectiveOrigin,
  };
}

export function isSkillFileReadOnly(selection: SkillFileSelection): boolean {
  if (selection.origin === "team") return true;
  return selection.origin === "local" && !selection.path.endsWith("/SKILL.local.md");
}
