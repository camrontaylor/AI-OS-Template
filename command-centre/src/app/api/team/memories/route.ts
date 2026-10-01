import { createRequire } from "node:module";
import { NextRequest, NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { kickLocalMemoryConsolidation } from "@/lib/memory/local-consolidation";
import { fetchTeamMemories, postTeamMemoryAction, TeamApiError } from "@/lib/team-api-context";

export const dynamic = "force-dynamic";

const require = createRequire(import.meta.url);
const { prepareMemoryApiIngestBody } = require("../../../../../scripts/lib/memory-api-payload.cjs") as {
  prepareMemoryApiIngestBody: (input: { content: string; sourcePath: string }) => Promise<Record<string, unknown>>;
};

function errorStatus(error: unknown): number {
  return error instanceof TeamApiError ? error.status : 400;
}

function messageFor(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

function provisionalSourcePath(body: Record<string, unknown>): string {
  if (typeof body.sourcePath === "string" && body.sourcePath.trim()) {
    return body.sourcePath.trim();
  }
  if (typeof body.sourceId === "string" && body.sourceId.trim()) {
    return `published/${body.sourceId.trim().slice(0, 8)}.md`;
  }
  const captureId = typeof body.captureId === "string" && body.captureId.trim()
    ? body.captureId.trim().slice(0, 8)
    : "pending";
  return `reviewed/pending/${captureId}.md`;
}

export async function GET() {
  try {
    kickLocalMemoryConsolidation({ rootDir: getConfig().aiOsDir, reason: "team-memories" });
    return NextResponse.json(await fetchTeamMemories());
  } catch (error) {
    return NextResponse.json(
      { error: messageFor(error, "Team memories unavailable") },
      { status: errorStatus(error) },
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => ({})) as Record<string, unknown>;
    const action = typeof body.action === "string" ? body.action.trim() : "";
    if (action === "accept" || action === "update") {
      const content = typeof body.content === "string" ? body.content : "";
      const prepared = await prepareMemoryApiIngestBody({
        content,
        sourcePath: provisionalSourcePath(body),
      });
      return NextResponse.json(await postTeamMemoryAction({ ...body, ...prepared }));
    }
    return NextResponse.json(await postTeamMemoryAction(body));
  } catch (error) {
    return NextResponse.json(
      { error: messageFor(error, "Team memory action failed") },
      { status: errorStatus(error) },
    );
  }
}
