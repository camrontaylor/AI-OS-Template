import { NextRequest, NextResponse } from "next/server";
import path from "path";
import fs from "fs";
import { getClientAiOsDir, getConfig } from "@/lib/config";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";
import { assertMaterializedPathAccessible, MaterializedFileAccessError } from "@/lib/materialized-file-ownership";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { parseSkillOrigin, resolveSkillFileTarget, type ResolvedSkillFileTarget } from "@/lib/skill-catalog";

function isWithinDirectory(targetPath: string, baseDir: string): boolean {
  const relative = path.relative(path.resolve(baseDir), path.resolve(targetPath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

export async function GET(request: NextRequest): Promise<NextResponse> {
  const filePath = request.nextUrl.searchParams.get("path");
  const clientId = request.nextUrl.searchParams.get("clientId");
  const isDocsRequest = request.nextUrl.searchParams.get("surface") === "docs";

  if (!filePath) {
    return NextResponse.json({ error: "Missing path parameter" }, { status: 400 });
  }

  let skillTarget: ResolvedSkillFileTarget | null = null;
  try {
    const requestedOrigin = request.nextUrl.searchParams.get("skillOrigin");
    const skillOrigin = parseSkillOrigin(requestedOrigin);
    if (requestedOrigin && !skillOrigin) {
      return NextResponse.json({ error: "Invalid skill origin" }, { status: 400 });
    }
    if (skillOrigin) skillTarget = await resolveSkillFileTarget(request, filePath, skillOrigin);
    if (!skillTarget && !isDocsRequest && isHostedTeamMode() && !clientId) {
      return hostedModeForbiddenResponse() as NextResponse;
    }

  // Path traversal protection: reject paths containing ..
  if (filePath.includes("..")) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }

    const baseDir = skillTarget?.baseDir ?? (
      isDocsRequest && (filePath === "clients" || filePath.startsWith("clients/"))
        ? getConfig().aiOsDir
        : getClientAiOsDir(clientId)
    );
    const resolvedPath = path.resolve(baseDir, skillTarget?.storagePath ?? filePath);

  // Path traversal protection: ensure resolved path is within the active workspace
  if (!isWithinDirectory(resolvedPath, baseDir)) {
    return NextResponse.json({ error: "Path traversal not allowed" }, { status: 403 });
  }
    if (!skillTarget) {
      try {
        assertMaterializedPathAccessible(resolvedPath);
      } catch (error) {
        if (error instanceof MaterializedFileAccessError) {
          return NextResponse.json({ error: error.message }, { status: error.status });
        }
        throw error;
      }
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
  } catch (error) {
    if (error instanceof RequestPrincipalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    throw error;
  } finally {
    await skillTarget?.close();
  }
}
