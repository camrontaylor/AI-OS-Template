import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getClientAiOsDir } from "@/lib/config";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";

export interface ContextFile {
  name: string;
  path: string;
  size: number;
  modifiedAt: string;
  type: "memory" | "learnings" | "soul" | "user" | "other";
}

function categorize(name: string): ContextFile["type"] {
  if (name === "SOUL.md") return "soul";
  if (name === "USER.md") return "user";
  if (name === "learnings.md") return "learnings";
  return "other";
}

function readContextDir(dir: string, prefix: string = ""): ContextFile[] {
  const results: ContextFile[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (!isMaterializedPathAccessible(fullPath)) continue;
    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;

    if (entry.isDirectory()) {
      if (entry.name === "memory") {
        // Read memory files
        const memoryFiles = readMemoryDir(fullPath);
        results.push(...memoryFiles);
      }
    } else if (entry.name.endsWith(".md")) {
      const stat = fs.statSync(fullPath);
      results.push({
        name: entry.name,
        path: relativePath,
        size: stat.size,
        modifiedAt: stat.mtime.toISOString(),
        type: categorize(entry.name),
      });
    }
  }

  return results;
}

function readMemoryDir(dir: string): ContextFile[] {
  const results: ContextFile[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir);
  for (const name of entries) {
    if (!name.endsWith(".md")) continue;
    const fullPath = path.join(dir, name);
    if (!isMaterializedPathAccessible(fullPath)) continue;
    const stat = fs.statSync(fullPath);
    results.push({
      name,
      path: `memory/${name}`,
      size: stat.size,
      modifiedAt: stat.mtime.toISOString(),
      type: "memory",
    });
  }

  return results;
}

export async function GET(request: NextRequest) {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse() as NextResponse;
    }

    const clientId = request.nextUrl.searchParams.get("clientId");
    const baseDir = getClientAiOsDir(clientId);
    const contextDir = path.join(baseDir, "context");

    const files = readContextDir(contextDir);
    return NextResponse.json(files);
  } catch (error) {
    console.error("GET /api/context error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
