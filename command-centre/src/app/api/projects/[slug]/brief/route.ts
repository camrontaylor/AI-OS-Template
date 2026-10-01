import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig, getClientAiOsDir } from "@/lib/config";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";

/**
 * GET /api/projects/[slug]/brief?clientId=xxx
 * Returns the raw brief.md content for a project.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ slug: string }> }
) {
  try {
    const { slug } = await params;
    const { searchParams } = new URL(request.url);
    const clientId = searchParams.get("clientId");

    const baseDir =
      clientId && clientId !== "root"
        ? getClientAiOsDir(clientId)
        : getConfig().aiOsDir;

    const briefPath = path.join(baseDir, "projects", "briefs", slug, "brief.md");

    if (!fs.existsSync(briefPath) || !isMaterializedPathAccessible(briefPath)) {
      return NextResponse.json({ error: "Brief not found" }, { status: 404 });
    }

    const content = fs.readFileSync(briefPath, "utf-8");
    return NextResponse.json({ content, path: briefPath });
  } catch (error) {
    console.error("GET /api/projects/[slug]/brief error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
