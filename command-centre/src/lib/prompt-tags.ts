import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "./config";

export interface PromptTag {
  name: string;
  body: string;
  starter: boolean;
  /** Category for grouped display in the menu. */
  category: "context" | "brand" | "brief" | "memory";
  /** Short one-line description shown in the menu. */
  description: string;
}

/** Parse `context/prompt-tags.md` — `## tag-name` headings, optional `starter: true` line right under. */
export function parsePromptTags(markdown: string): PromptTag[] {
  const lines = markdown.split("\n");
  const tags: PromptTag[] = [];
  let current: PromptTag | null = null;
  let bodyLines: string[] = [];

  const flush = () => {
    if (current) {
      current.body = bodyLines.join("\n").trim();
      // Derive description from first non-empty line of body
      current.description = current.body.split("\n").find((l) => l.trim())?.slice(0, 80) ?? "";
      tags.push(current);
    }
    current = null;
    bodyLines = [];
  };

  for (const line of lines) {
    const m = line.match(/^##\s+(\S[^\s].*?)\s*$/);
    if (m && !m[1].startsWith("#")) {
      flush();
      current = { name: m[1].trim(), body: "", starter: false, category: "context", description: "" };
      continue;
    }
    if (current) {
      const sm = line.match(/^starter:\s*(true|false)\s*$/i);
      if (sm && bodyLines.length === 0) {
        current.starter = sm[1].toLowerCase() === "true";
        continue;
      }
      bodyLines.push(line);
    }
  }
  flush();
  return tags.filter((t) => t.body.length > 0);
}

export function getPromptTagsPath(clientId?: string | null): string {
  const config = getConfig();
  const dir = clientId ? getClientAiOsDir(clientId) : config.agenticOsDir;
  return path.join(dir, "context", "prompt-tags.md");
}

/** Pretty-print a filename stem into a human label. */
function stemToLabel(stem: string): string {
  return stem
    .replace(/[-_]/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Auto-discover brand_context/*.md files as tags. */
function discoverBrandContextTags(agenticOsDir: string): PromptTag[] {
  const brandDir = path.join(agenticOsDir, "brand_context");
  if (!fs.existsSync(brandDir)) return [];
  const tags: PromptTag[] = [];
  try {
    for (const file of fs.readdirSync(brandDir)) {
      if (!file.endsWith(".md")) continue;
      const stem = file.replace(/\.md$/, "");
      const fp = path.join(brandDir, file);
      const content = fs.readFileSync(fp, "utf-8").trim();
      if (!content) continue;
      // Extract first heading or first line as description
      const firstLine = content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
      tags.push({
        name: `brand/${stem}`,
        body: `Read and apply brand_context/${file}:\n\n${content}`,
        starter: false,
        category: "brand",
        description: firstLine.slice(0, 80) || `Brand ${stemToLabel(stem)}`,
      });
    }
  } catch { /* ignore */ }
  return tags;
}

/** Auto-discover key context files (SOUL.md, USER.md, learnings.md, etc.). */
function discoverContextTags(agenticOsDir: string): PromptTag[] {
  const contextDir = path.join(agenticOsDir, "context");
  if (!fs.existsSync(contextDir)) return [];
  const tags: PromptTag[] = [];
  const contextFiles = ["SOUL.md", "USER.md", "learnings.md"];
  try {
    for (const file of contextFiles) {
      const fp = path.join(contextDir, file);
      if (!fs.existsSync(fp)) continue;
      const content = fs.readFileSync(fp, "utf-8").trim();
      if (!content) continue;
      const stem = file.replace(/\.md$/, "").toLowerCase();
      const firstLine = content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").trim() ?? "";
      tags.push({
        name: `context/${stem}`,
        body: `Read and apply context/${file}:\n\n${content}`,
        starter: false,
        category: "context",
        description: firstLine.slice(0, 80) || `Context ${stemToLabel(stem)}`,
      });
    }
  } catch { /* ignore */ }
  return tags;
}

/** Auto-discover project brief tags from projects/briefs/. */
function discoverBriefTags(agenticOsDir: string): PromptTag[] {
  const briefsDir = path.join(agenticOsDir, "projects", "briefs");
  if (!fs.existsSync(briefsDir)) return [];
  const tags: PromptTag[] = [];
  try {
    for (const dir of fs.readdirSync(briefsDir)) {
      const briefPath = path.join(briefsDir, dir, "brief.md");
      if (!fs.existsSync(briefPath)) continue;
      const content = fs.readFileSync(briefPath, "utf-8").trim();
      if (!content) continue;
      const firstLine = content.split("\n").find((l) => l.trim())?.replace(/^#+\s*/, "").replace(/^---\s*$/, "").trim() ?? "";
      // Try to extract a meaningful description from frontmatter or first heading
      const goalMatch = content.match(/^goal:\s*(.+)/m);
      const desc = goalMatch?.[1]?.trim() || firstLine.slice(0, 80) || dir;
      tags.push({
        name: `brief/${dir}`,
        body: `Read the project brief at projects/briefs/${dir}/brief.md before doing anything. Treat it as the source of truth.\n\n${content}`,
        starter: false,
        category: "brief",
        description: desc,
      });
    }
  } catch { /* ignore */ }
  return tags;
}

export function loadPromptTags(clientId?: string | null): PromptTag[] {
  try {
    const config = getConfig();
    const agenticOsDir = clientId ? getClientAiOsDir(clientId) : config.agenticOsDir;

    // 1. Manual prompt tags from context/prompt-tags.md
    const fp = path.join(agenticOsDir, "context", "prompt-tags.md");
    const manual = fs.existsSync(fp)
      ? parsePromptTags(fs.readFileSync(fp, "utf-8"))
      : [];

    // 2. Auto-discovered context files
    const contextFiles = discoverContextTags(agenticOsDir);

    // 3. Auto-discovered brand context files
    const brand = discoverBrandContextTags(agenticOsDir);

    // 4. Auto-discovered project briefs
    const briefs = discoverBriefTags(agenticOsDir);

    // Deduplicate: manual tags win over auto-discovered ones
    const seen = new Set(manual.map((t) => t.name));
    const all = [...manual];
    for (const t of [...contextFiles, ...brand, ...briefs]) {
      if (!seen.has(t.name)) {
        seen.add(t.name);
        all.push(t);
      }
    }
    return all;
  } catch {
    return [];
  }
}

/** Replace `@tag-name` references in a prompt with the corresponding tag body. */
export function expandPromptTags(prompt: string, clientId?: string | null): string {
  const tags = loadPromptTags(clientId);
  if (tags.length === 0) return prompt;
  const map = new Map(tags.map((t) => [t.name, t.body]));
  return prompt.replace(/(^|[^\w@])@([a-z0-9][\w\/-]*)/gi, (full, prefix, name) => {
    const body = map.get(name);
    if (!body) return full;
    return `${prefix}[@${name}]\n${body}\n`;
  });
}
