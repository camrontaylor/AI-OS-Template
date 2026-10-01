import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";

function getClaudeSettingsPath(): string {
  return path.join(getConfig().aiOsDir, ".claude", "settings.json");
}

export async function GET() {
  try {
    if (isHostedTeamMode()) {
      return hostedModeForbiddenResponse();
    }

    const settingsPath = getClaudeSettingsPath();

    if (!fs.existsSync(settingsPath)) {
      return NextResponse.json({ content: "", exists: false, lastModified: null });
    }

    const content = fs.readFileSync(settingsPath, "utf-8");
    const stat = fs.statSync(settingsPath);

    return NextResponse.json({
      content,
      exists: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to read .claude/settings.json";
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

    // Validate JSON before saving
    try {
      JSON.parse(content);
    } catch (parseErr) {
      const parseMessage = parseErr instanceof Error ? parseErr.message : "Invalid JSON";
      return NextResponse.json({ error: `Invalid JSON: ${parseMessage}` }, { status: 400 });
    }

    const settingsPath = getClaudeSettingsPath();

    // Optimistic concurrency check
    if (lastModified && fs.existsSync(settingsPath)) {
      const stat = fs.statSync(settingsPath);
      const currentModified = stat.mtime.toISOString();
      if (currentModified !== lastModified) {
        return NextResponse.json(
          { error: "File was modified since you loaded it. Reload and try again." },
          { status: 409 }
        );
      }
    }

    // Ensure .claude directory exists
    const claudeDir = path.dirname(settingsPath);
    if (!fs.existsSync(claudeDir)) {
      fs.mkdirSync(claudeDir, { recursive: true });
    }

    // Atomic write: write to temp file, then rename
    const tmpPath = settingsPath + ".tmp";
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, settingsPath);

    const stat = fs.statSync(settingsPath);

    return NextResponse.json({
      saved: true,
      lastModified: stat.mtime.toISOString(),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Failed to save .claude/settings.json";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
