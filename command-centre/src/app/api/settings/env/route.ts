import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";

function getEnvPath(): string {
  return path.join(getConfig().aiOsDir, ".env");
}

export async function GET() {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse();
    }

    const envPath = getEnvPath();

    if (!fs.existsSync(envPath)) {
      return NextResponse.json({ content: "", exists: false, lastModified: null });
    }

    const content = fs.readFileSync(envPath, "utf-8");
    const stat = fs.statSync(envPath);

    return NextResponse.json({
      content,
      exists: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read .env";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse();
    }

    const body = await request.json();
    const { content, lastModified } = body as { content: string; lastModified?: string };

    if (typeof content !== "string") {
      return NextResponse.json({ error: "content must be a string" }, { status: 400 });
    }

    const envPath = getEnvPath();

    // Optimistic concurrency check
    if (lastModified && fs.existsSync(envPath)) {
      const stat = fs.statSync(envPath);
      const currentModified = stat.mtime.toISOString();
      if (currentModified !== lastModified) {
        return NextResponse.json(
          { error: "File was modified since you loaded it. Reload and try again." },
          { status: 409 }
        );
      }
    }

    // Atomic write: write to temp file, then rename
    const tmpPath = envPath + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, envPath);

    const stat = fs.statSync(envPath);

    return NextResponse.json({
      saved: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save .env";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
