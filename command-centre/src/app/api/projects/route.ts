import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { getDb } from "@/lib/db";
import {
  assertMaterializedPathAccessible,
  assertMaterializedPathWritable,
  isMaterializedPathAccessible,
  MaterializedFileAccessError,
  registerMaterializedFiles,
} from "@/lib/materialized-file-ownership";
import type { Project } from "@/types/project";

/**
 * GET /api/projects?clientId=xxx
 *
 * Scans projects/briefs/{name}/brief.md for project briefs (file-based, source of truth).
 * Enriches with task counts from the DB.
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const baseDir =
      clientId && clientId !== "root"
        ? getClientAiOsDir(clientId)
        : getConfig().aiOsDir;

    const briefsDir = path.join(baseDir, "projects", "briefs");
    if (!fs.existsSync(briefsDir)) {
      return NextResponse.json([]);
    }

    const entries = fs.readdirSync(briefsDir, { withFileTypes: true });
    const projects: Project[] = [];
    const db = getDb();

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const briefPath = path.join(briefsDir, entry.name, "brief.md");
      if (!fs.existsSync(briefPath)) continue;
      if (!isMaterializedPathAccessible(briefPath)) continue;

      const content = fs.readFileSync(briefPath, "utf-8");
      const parsed = parseBriefFrontmatter(content, entry.name, briefPath);
      if (!parsed) continue;

      // Enrich with task counts from DB
      const counts = db.prepare(
        `SELECT
          COUNT(*) as taskCount,
          SUM(CASE WHEN status = 'done' THEN 1 ELSE 0 END) as doneCount
        FROM tasks WHERE projectSlug = ?`
      ).get(parsed.slug) as { taskCount: number; doneCount: number } | undefined;

      projects.push({
        id: parsed.slug,
        slug: parsed.slug,
        name: parsed.name,
        status: (parsed.status as Project["status"]) || "active",
        level: parsed.level,
        briefPath: parsed.path,
        goal: parsed.goal,
        clientId: clientId || null,
        createdAt: parsed.created || new Date().toISOString(),
        updatedAt: parsed.created || new Date().toISOString(),
        taskCount: counts?.taskCount ?? 0,
        doneCount: counts?.doneCount ?? 0,
      });
    }

    // Sort newest first
    projects.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return NextResponse.json(projects);
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    console.error("GET /api/projects error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/projects
 * Create a new project by writing brief.md to projects/briefs/{slug}/.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      slug: string;
      name: string;
      level?: number;
      goal?: string;
      clientId?: string;
      deliverables?: Array<{ title: string; description?: string; acceptanceCriteria?: string[] }>;
    };

    if (!body.slug || !body.name) {
      return NextResponse.json(
        { error: "slug and name are required" },
        { status: 400 }
      );
    }

    const baseDir =
      body.clientId && body.clientId !== "root"
        ? getClientAiOsDir(body.clientId)
        : getConfig().aiOsDir;

    const projectDir = path.join(baseDir, "projects", "briefs", body.slug);
    const briefPath = path.join(projectDir, "brief.md");

    // Don't overwrite existing briefs
    if (fs.existsSync(briefPath)) {
      assertMaterializedPathAccessible(briefPath);
      const content = fs.readFileSync(briefPath, "utf-8");
      const parsed = parseBriefFrontmatter(content, body.slug, briefPath);
      return NextResponse.json({
        id: body.slug,
        slug: body.slug,
        name: parsed?.name || body.name,
        status: parsed?.status || "active",
        level: parsed?.level || body.level || 2,
        briefPath,
        goal: parsed?.goal || body.goal || null,
        clientId: body.clientId || null,
        createdAt: parsed?.created || new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      });
    }

    assertMaterializedPathWritable(briefPath);

    // Create directory and brief.md
    fs.mkdirSync(projectDir, { recursive: true });

    const today = new Date().toISOString().split("T")[0];
    const level = body.level || 2;

    // Build deliverables section from provided data or use placeholder
    let deliverablesSection: string;
    let acceptanceSection: string;
    if (body.deliverables && body.deliverables.length > 0) {
      deliverablesSection = body.deliverables
        .map((d) => {
          let item = `- **${d.title}**`;
          if (d.description) item += `\n  ${d.description}`;
          return item;
        })
        .join("\n");
      const allCriteria = body.deliverables
        .flatMap((d) => d.acceptanceCriteria ?? [])
        .filter(Boolean);
      acceptanceSection = allCriteria.length > 0
        ? allCriteria.map((c) => `- ${c}`).join("\n")
        : "_To be defined alongside deliverables._";
    } else {
      deliverablesSection = "_Claude will define deliverables and create subtasks on the first turn._";
      acceptanceSection = "_To be defined alongside deliverables._";
    }

    const briefContent = `---
project: ${body.slug}
status: active
level: ${level}
created: ${today}
---

# ${body.name}

## Goal

${body.goal || "To be defined."}

## Deliverables

${deliverablesSection}

## Acceptance Criteria

${acceptanceSection}
`;

    fs.writeFileSync(briefPath, briefContent, "utf-8");
    registerMaterializedFiles([briefPath], {
      scope: body.clientId && body.clientId !== "root" ? "client" : "team",
      kind: "project-brief",
    });

    const project: Project = {
      id: body.slug,
      slug: body.slug,
      name: body.name,
      status: "active",
      level,
      briefPath,
      goal: body.goal || null,
      clientId: body.clientId || null,
      createdAt: today,
      updatedAt: today,
    };

    return NextResponse.json(project, { status: 201 });
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Project not found" }, { status: 404 });
    }
    console.error("POST /api/projects error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/projects
 * Update project status by modifying brief.md frontmatter.
 * Body: { slug, status?, name?, goal?, clientId? }
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      slug: string;
      status?: string;
      name?: string;
      goal?: string;
      clientId?: string;
    };

    if (!body.slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const baseDir =
      body.clientId && body.clientId !== "root"
        ? getClientAiOsDir(body.clientId)
        : getConfig().aiOsDir;

    const briefPath = path.join(baseDir, "projects", "briefs", body.slug, "brief.md");

    if (!fs.existsSync(briefPath)) {
      return NextResponse.json({ error: "Project brief not found" }, { status: 404 });
    }

    assertMaterializedPathAccessible(briefPath);
    assertMaterializedPathWritable(briefPath);
    let content = fs.readFileSync(briefPath, "utf-8");

    // Update frontmatter fields
    if (body.status && ["active", "paused", "complete", "archived"].includes(body.status)) {
      content = content.replace(/^(status:\s*).+$/m, `$1${body.status}`);
    }

    if (body.name) {
      content = content.replace(/^(project:\s*).+$/m, `$1${body.slug}`);
      // Also update the H1 title if it exists
      content = content.replace(/^# .+$/m, `# ${body.name}`);
    }

    fs.writeFileSync(briefPath, content, "utf-8");
    registerMaterializedFiles([briefPath], {
      scope: body.clientId && body.clientId !== "root" ? "client" : "team",
      kind: "project-brief",
    });

    // Re-read to return current state
    const parsed = parseBriefFrontmatter(content, body.slug, briefPath);

    const project: Project = {
      id: body.slug,
      slug: body.slug,
      name: parsed?.name || body.slug,
      status: (parsed?.status as Project["status"]) || "active",
      level: parsed?.level || 2,
      briefPath,
      goal: parsed?.goal || null,
      clientId: body.clientId || null,
      createdAt: parsed?.created || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    return NextResponse.json(project);
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Project brief not found" }, { status: 404 });
    }
    console.error("PATCH /api/projects error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}

// ── Brief parsing ──

interface ParsedBrief {
  slug: string;
  name: string;
  status: string;
  level: number;
  created: string;
  goal: string | null;
  path: string;
}

function parseBriefFrontmatter(
  content: string,
  slug: string,
  briefPath: string
): ParsedBrief | null {
  const match = content.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;

  const frontmatter = match[1];
  const fields: Record<string, string> = {};

  for (const line of frontmatter.split("\n")) {
    const colonIdx = line.indexOf(":");
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const value = line.slice(colonIdx + 1).trim();
    fields[key] = value;
  }

  let goal: string | null = null;
  const goalMatch = content.match(/## Goal\s*\n+(.+)/);
  if (goalMatch) goal = goalMatch[1].trim();

  const h1 = content.match(/^#\s+(.+)$/m);
  const name =
    h1?.[1]?.trim() ||
    fields.name ||
    slug
      .split("-")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ");

  return {
    slug,
    name,
    status: fields.status || "unknown",
    level: parseInt(fields.level || "2", 10),
    created: fields.created || "",
    goal,
    path: briefPath,
  };
}
