import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { spawn } from "child_process";
import { getConfig } from "@/lib/config";

// Opens the given path (file or folder) in the host OS file explorer.
export async function GET(request: NextRequest): Promise<NextResponse> {
  const targetPath = request.nextUrl.searchParams.get("path");

  if (!targetPath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }
  if (targetPath.includes("..")) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

  const config = getConfig();
  const resolvedPath = path.resolve(config.agenticOsDir, targetPath);
  if (!resolvedPath.startsWith(config.agenticOsDir)) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }
  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  try {
    const platform = process.platform;
    if (platform === "darwin") {
      spawn("open", [resolvedPath], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "win32") {
      spawn("explorer", [resolvedPath], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [resolvedPath], { detached: true, stdio: "ignore" }).unref();
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
