import { NextRequest, NextResponse } from "next/server";
import { listDirectory, normalizeRelativePath } from "@/lib/file-service";
import { getClientAiOsDir } from "@/lib/config";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";
import path from "node:path";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { parseSkillOrigin, resolveSkillFileTarget } from "@/lib/skill-catalog";

const ALLOWED_ROOTS = ["context", "team_context", "brand_context", "docs", "projects", ".planning", ".claude/skills", "clients"];

function isSharedContextPath(dir: string): boolean {
  return dir === "brand_context" ||
    dir.startsWith("brand_context/") ||
    dir === "team_context" ||
    dir.startsWith("team_context/");
}

export async function GET(request: NextRequest) {
  let closeSkillTarget: (() => Promise<void>) | null = null;
  try {
    const { searchParams } = new URL(request.url);
    const dirParam = searchParams.get("dir");
    const clientId = searchParams.get("clientId");
    const isDocsRequest = searchParams.get("surface") === "docs";

    if (dirParam === null && !isDocsRequest) {
      return NextResponse.json(
        { error: "dir query parameter is required" },
        { status: 400 }
      );
    }

    const dir = normalizeRelativePath(dirParam ?? "");
    const requestedSkillOrigin = searchParams.get("skillOrigin");
    const skillOrigin = parseSkillOrigin(requestedSkillOrigin);
    if (requestedSkillOrigin && !skillOrigin) {
      return NextResponse.json({ error: "Invalid skill origin" }, { status: 400 });
    }
    const skillTarget = skillOrigin ? await resolveSkillFileTarget(request, dir, skillOrigin) : null;
    closeSkillTarget = skillTarget?.close ?? null;
    if (!skillTarget && !isDocsRequest && isHostedTeamMode() && !clientId && !isSharedContextPath(dir)) {
      return hostedModeForbiddenResponse();
    }

    // Validate that the requested directory starts with an allowed root
    const isAllowed = isDocsRequest || ALLOWED_ROOTS.some(
      (root) => dir === root || dir.startsWith(root + "/")
    );
    if (!isAllowed) {
      return NextResponse.json(
        { error: "Access denied: directory is outside the allowed documentation roots" },
        { status: 403 }
      );
    }

    const limitParam = searchParams.get("limit");
    const limit = limitParam ? parseInt(limitParam, 10) : undefined;
    const baseDir = skillTarget?.baseDir ?? (
      isDocsRequest && (dir === "clients" || dir.startsWith("clients/"))
        ? getClientAiOsDir(null)
        : getClientAiOsDir(clientId)
    );
    const storageDir = skillTarget?.storagePath ?? dir;

    const nodes = listDirectory(storageDir, {
      limit,
      baseDir,
      includeHidden: isDocsRequest,
      skipOwnershipCheck: Boolean(skillTarget),
    })
      .filter((node) => Boolean(skillTarget) || isMaterializedPathAccessible(path.resolve(baseDir, node.path)))
      .map((node) => skillTarget ? { ...node, path: path.posix.join(dir, node.name) } : node);
    return NextResponse.json(nodes);
  } catch (error) {
    if (error instanceof RequestPrincipalError) {
      return NextResponse.json({ error: error.message }, { status: error.status });
    }
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Path traversal") ? 403 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await closeSkillTarget?.();
  }
}
