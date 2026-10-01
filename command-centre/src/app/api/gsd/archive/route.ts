import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import {
  assertMaterializedPathAccessible,
  MaterializedFileAccessError,
  registerMaterializedFiles,
} from "@/lib/materialized-file-ownership";

export async function POST(request: NextRequest) {
  try {
    const { slug } = (await request.json()) as { slug: string };
    if (!slug) {
      return NextResponse.json({ error: "slug is required" }, { status: 400 });
    }

    const baseDir = getConfig().aiOsDir;
    const briefPath = path.join(baseDir, "projects", "briefs", slug, "brief.md");

    // Validate brief exists
    if (!fs.existsSync(briefPath)) {
      return NextResponse.json(
        { error: `No brief found at projects/briefs/${slug}/brief.md` },
        { status: 404 }
      );
    }

    assertMaterializedPathAccessible(briefPath);
    // Update brief frontmatter: status: active → status: complete
    // .planning/ stays co-located inside the brief folder as a complete historical record.
    let briefContent = fs.readFileSync(briefPath, "utf-8");
    briefContent = briefContent.replace(
      /^(---\n[\s\S]*?)status:\s*active([\s\S]*?\n---)/,
      "$1status: complete$2"
    );
    fs.writeFileSync(briefPath, briefContent);
    registerMaterializedFiles([briefPath], { scope: "team", kind: "project-brief" });

    return NextResponse.json({
      success: true,
      slug,
      message: `Marked ${slug} as complete. Its .planning/ remains in place.`,
    });
  } catch (error) {
    if (error instanceof MaterializedFileAccessError) {
      return NextResponse.json({ error: "Project brief not found" }, { status: 404 });
    }
    console.error("POST /api/gsd/archive error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
