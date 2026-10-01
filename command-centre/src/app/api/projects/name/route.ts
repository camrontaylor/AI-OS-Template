import { NextRequest, NextResponse } from "next/server";
import { resolvePlannedProjectName } from "@/lib/planned-project-naming.server";

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      title?: string | null;
      prompt?: string | null;
    };

    const title = typeof body.title === "string" ? body.title : null;
    const prompt = typeof body.prompt === "string" ? body.prompt : "";

    if (!title?.trim() && !prompt.trim()) {
      return NextResponse.json(
        { error: "title or prompt is required" },
        { status: 400 },
      );
    }

    const result = await resolvePlannedProjectName({
      userTitle: title,
      prompt,
    });

    return NextResponse.json(result);
  } catch (error) {
    console.error("POST /api/projects/name error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
