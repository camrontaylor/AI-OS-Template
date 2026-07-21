import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import type { Task } from "@/types/task";

/**
 * Context-gathering for the scoping wizard.
 *
 * Before asking the user clarifying questions we sweep two sources:
 *   1. brand_context/*.md   — voice, positioning, ICP
 *   2. URLs in the goal     — fetched and stripped to plain text
 *
 * The output is a compact summary the LLM can ground questions in
 * (e.g. "Is this for your existing audience?" instead of "Who is your
 * audience?"), plus a structured `sources` list the wizard renders
 * above the questions so the user can see what was loaded.
 */

export interface ContextSource {
  /** "brand" = a brand_context file, "url" = a fetched link */
  kind: "brand" | "url";
  /** Display label (filename or hostname) */
  label: string;
  /** Where it came from (absolute path or URL) */
  origin: string;
  /** Up to ~1500 chars of plain text */
  snippet: string;
}

export interface GatheredContext {
  /** Compact prose summary suitable for LLM grounding */
  summary: string;
  /** Structured sources for UI rendering */
  sources: ContextSource[];
}

const BRAND_FILES = [
  "voice-profile.md",
  "positioning.md",
  "icp.md",
  "samples.md",
];

const SNIPPET_CHARS = 1500;
const URL_TIMEOUT_MS = 6000;
const MAX_URLS = 3;

function truncate(text: string, max: number): string {
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (cleaned.length <= max) return cleaned;
  return cleaned.slice(0, max).trimEnd() + "…";
}

function readBrandFile(brandDir: string, name: string): ContextSource | null {
  const filePath = path.join(brandDir, name);
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size === 0) return null;
    const raw = fs.readFileSync(filePath, "utf-8").trim();
    if (!raw) return null;
    return {
      kind: "brand",
      label: name.replace(/\.md$/, ""),
      origin: filePath,
      snippet: truncate(raw, SNIPPET_CHARS),
    };
  } catch {
    return null;
  }
}

function gatherBrandContext(clientId: string | null): ContextSource[] {
  const baseDir = clientId ? getClientAiOsDir(clientId) : getConfig().agenticOsDir;
  const brandDir = path.join(baseDir, "brand_context");
  const sources: ContextSource[] = [];
  for (const name of BRAND_FILES) {
    const src = readBrandFile(brandDir, name);
    if (src) sources.push(src);
  }
  return sources;
}

function extractUrls(text: string): string[] {
  // Liberal URL regex: http(s)://, optional www., domain, optional path.
  const re = /https?:\/\/[^\s<>"'`)]+/gi;
  const found = text.match(re) ?? [];
  // Dedupe + cap
  const seen = new Set<string>();
  const out: string[] = [];
  for (const u of found) {
    const cleaned = u.replace(/[.,;:)\]]+$/, "");
    if (seen.has(cleaned)) continue;
    seen.add(cleaned);
    out.push(cleaned);
    if (out.length >= MAX_URLS) break;
  }
  return out;
}

function htmlToText(html: string): string {
  // Strip script/style blocks first, then tags, then collapse whitespace.
  const noScripts = html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ");
  const noTags = noScripts.replace(/<[^>]+>/g, " ");
  const decoded = noTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
  return decoded.replace(/\s+/g, " ").trim();
}

async function fetchUrlSource(url: string): Promise<ContextSource | null> {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (compatible; AI-OS-CommandCentre/1.0; +https://ai-os.local)",
        Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });
    clearTimeout(timer);
    if (!res.ok) return null;
    const ctype = res.headers.get("content-type") ?? "";
    const body = await res.text();
    const text = ctype.includes("html") ? htmlToText(body) : body;
    if (!text) return null;
    let host = url;
    try {
      host = new URL(url).hostname.replace(/^www\./, "");
    } catch {
      /* leave as raw url */
    }
    return {
      kind: "url",
      label: host,
      origin: url,
      snippet: truncate(text, SNIPPET_CHARS),
    };
  } catch {
    return null;
  }
}

async function gatherUrlContext(goal: string): Promise<ContextSource[]> {
  const urls = extractUrls(goal);
  if (urls.length === 0) return [];
  const results = await Promise.all(urls.map(fetchUrlSource));
  return results.filter((s): s is ContextSource => s !== null);
}

function buildSummary(sources: ContextSource[]): string {
  if (sources.length === 0) return "";
  const lines: string[] = [];
  for (const s of sources) {
    const header = s.kind === "brand"
      ? `[brand_context/${s.label}]`
      : `[${s.label}]`;
    lines.push(`${header}\n${s.snippet}`);
  }
  return lines.join("\n\n");
}

/**
 * Build a short markdown block summarising the sibling tasks of a child,
 * to prepend to its initial prompt. Follows the Claude Code convention of
 * short prompt + fat filesystem: the manifest deliberately tells the
 * subtask to read the project directory rather than trust the summary.
 *
 * Returns null when:
 *   - the task has no parent (top-level / Level 1)
 *   - the parent has no other children
 *   - none of the siblings are done or in-flight yet
 */
export function buildSiblingContextBlock(task: Task): string | null {
  if (!task.parentId) return null;

  type SiblingRow = {
    id: string;
    title: string;
    status: string;
    activityLabel: string | null;
    columnOrder: number;
  };

  const db = getDb();
  const siblings = db
    .prepare(
      `SELECT id, title, status, activityLabel, columnOrder
       FROM tasks WHERE parentId = ? AND id != ? ORDER BY columnOrder ASC`,
    )
    .all(task.parentId, task.id) as SiblingRow[];
  if (siblings.length === 0) return null;

  const done = siblings.filter((s) => s.status === "done");
  const inFlight = siblings.filter(
    (s) => s.status === "running" || s.status === "review",
  );
  if (done.length === 0 && inFlight.length === 0) return null;

  const lines: string[] = [
    "## Sibling task context",
    "",
    "You are one task in a larger project. Your siblings and their state:",
    "",
  ];

  const lastTextStmt = db.prepare(
    `SELECT content FROM task_logs WHERE taskId = ? AND type = 'text' ORDER BY timestamp DESC LIMIT 1`,
  );

  for (const s of done) {
    const row = lastTextStmt.get(s.id) as { content: string } | undefined;
    const raw = row?.content || s.activityLabel || "(no summary)";
    const summary = raw.replace(/\s+/g, " ").trim().slice(0, 200);
    lines.push(`- [done] **${s.title}** — ${summary}`);
  }
  for (const s of inFlight) {
    const label = s.activityLabel ? ` — ${s.activityLabel}` : "";
    lines.push(`- [${s.status}] **${s.title}**${label}`);
  }

  if (task.projectSlug) {
    lines.push("");
    lines.push(
      `All siblings share the project directory \`projects/briefs/${task.projectSlug}/\`. ` +
        `Read any files there that are relevant before starting — they are the source of ` +
        `truth, not this summary. Write your own outputs into the same directory with a ` +
        `clear filename so later siblings can pick them up.`,
    );
  }

  return lines.join("\n");
}

/**
 * Gather brand and URL context for a goal. Best-effort, never throws —
 * any failure just produces an empty list for that source.
 */
export async function gatherContext(
  goal: string,
  clientId: string | null
): Promise<GatheredContext> {
  const [brand, urls] = await Promise.all([
    Promise.resolve(gatherBrandContext(clientId)),
    gatherUrlContext(goal),
  ]);
  const sources = [...brand, ...urls];
  return {
    summary: buildSummary(sources),
    sources,
  };
}
