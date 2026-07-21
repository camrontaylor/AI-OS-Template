import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getClientAiOsDir } from "@/lib/config";

export async function GET(request: NextRequest): Promise<NextResponse> {
  const filePath = request.nextUrl.searchParams.get("path");
  const clientId = request.nextUrl.searchParams.get("clientId");

  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  // Path traversal protection: reject paths containing ..
  if (filePath.includes("..")) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

  const baseDir = getClientAiOsDir(clientId);
  const resolvedPath = path.resolve(baseDir, filePath);

  // Path traversal protection: ensure resolved path is within the active workspace
  if (!resolvedPath.startsWith(baseDir)) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

  // Check file exists
  if (!fs.existsSync(resolvedPath)) {
    return NextResponse.json({ error: "File not found" }, { status: 404 });
  }

  const fileBuffer = fs.readFileSync(resolvedPath);
  const fileName = path.basename(resolvedPath);

  return new NextResponse(fileBuffer, {
    headers: {
      "Content-Disposition": `attachment; filename="${fileName}"`,
      "Content-Type": "application/octet-stream",
    },
  });
}
