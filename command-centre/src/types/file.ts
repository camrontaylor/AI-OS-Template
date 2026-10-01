export interface FileNode {
  name: string;
  path: string;           // relative to aiOsDir
  type: 'file' | 'directory';
  lastModified: string;   // ISO timestamp
  size: number;           // bytes
  children?: FileNode[];  // only for directories
}

export interface FileContent {
  path: string;
  content: string;
  lastModified: string;   // ISO timestamp for optimistic concurrency
}

export interface TaskFileSearchResponse {
  nodes: FileNode[];
  truncated: boolean;
}

export interface SkillDependency {
  skill: string;          // skill folder name (e.g., "tool-youtube")
  required: boolean;      // true = required, false = optional
  description: string;    // what it provides
  fallback: string;       // what happens without it
}

export interface InstalledSkill {
  name: string;           // from frontmatter 'name' field
  category: string;       // extracted from folder prefix (mkt, str, viz, etc.)
  description: string;    // from frontmatter 'description' field
  triggers: string[];     // from frontmatter 'triggers' array
  folderName: string;     // directory name
  dependencies: SkillDependency[];  // parsed from ## Dependencies section in SKILL.md body (per SKILL-01)
}

export type SkillOrigin = "local" | "client" | "team";

export interface SkillCatalogOrigin {
  origin: SkillOrigin;
  command: string;
  permission: "not_required" | "skill.use" | "skill.read" | "skill.edit" | "skill.admin";
  syncState: "installation" | "client" | "synced" | "not_synced" | "offline_authorized" | "plugin_incompatible";
  executable?: boolean;
}

export interface SkillCatalogEntry extends InstalledSkill {
  availableOrigins: SkillCatalogOrigin[];
  effectiveOrigin: SkillOrigin;
  commands: { default: string; local?: string; team?: string };
  clientOverride?: boolean;   // inherited skill customised by this client via SKILL.local.md
  hiddenByClient?: boolean;   // turned off for this client via skillOverrides in settings.local.json
}

export interface SkillFileSelection {
  path: string;
  origin: SkillOrigin;
}
