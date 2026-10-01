import { NextRequest, NextResponse } from "next/server";
import { readFile, writeFile, deleteFile, moveFile, normalizeRelativePath } from "@/lib/file-service";
import { getClientAiOsDir } from "@/lib/config";
import {
  skillNameFromPath,
} from "@/lib/identity/request-principal";
import { hostedModeForbiddenResponse, isHostedTeamMode } from "@/lib/team-mode";
import type { SkillPermission } from "@/lib/identity/types";
import path from "node:path";
import { assertMaterializedPathAccessible, assertMaterializedPathWritable } from "@/lib/materialized-file-ownership";
import { RequestPrincipalError } from "@/lib/identity/request-principal";
import { parseSkillOrigin, resolveSkillFileTarget, type ResolvedSkillFileTarget } from "@/lib/skill-catalog";

const ALLOWED_ROOTS = ["context", "team_context", "brand_context", "docs", "projects", ".planning", ".claude/skills", "clients"];
const ALLOWED_ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "README.md"];

function isDocsRequest(request: NextRequest): boolean {
  return request.nextUrl.searchParams.get("surface") === "docs";
}

function isRootWorkspacePath(filePath: string): boolean {
  return filePath === "clients" || filePath.startsWith("clients/");
}

function validateFilePath(segments: string[], options: { docs?: boolean } = {}): string | null {
  const filePath = normalizeRelativePath(segments.join("/"));
  if (options.docs) return filePath || null;
  // Allow specific root-level files
  if (ALLOWED_ROOT_FILES.includes(filePath)) return filePath;
  const isAllowed = ALLOWED_ROOTS.some(
    (root) => filePath === root || filePath.startsWith(root + "/")
  );
  if (!isAllowed) return null;
  return filePath;
}

function getBaseDir(request: NextRequest, filePath: string): string {
  const clientId = request.nextUrl.searchParams.get("clientId");
  if (isDocsRequest(request) && isRootWorkspacePath(filePath)) {
    return getClientAiOsDir(null);
  }
  return getClientAiOsDir(clientId);
}

function isInstallationOrClientSkillPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  return normalized === ".claude/skills" ||
    normalized.startsWith(".claude/skills/") ||
    /^clients\/[^/]+\/\.claude\/skills(?:\/|$)/.test(normalized);
}

function assertOwnedAccess(request: NextRequest, filePath: string): void {
  if (isInstallationOrClientSkillPath(filePath)) return;
  assertMaterializedPathAccessible(path.resolve(getBaseDir(request, filePath), filePath));
}

function assertOwnedWrite(request: NextRequest, filePath: string): void {
  if (isInstallationOrClientSkillPath(filePath)) return;
  assertMaterializedPathWritable(path.resolve(getBaseDir(request, filePath), filePath));
}

function isSharedContextPath(filePath: string): boolean {
  return filePath === "brand_context" ||
    filePath.startsWith("brand_context/") ||
    filePath === "team_context" ||
    filePath.startsWith("team_context/");
}

async function requireSkillFileAccess(
  request: NextRequest,
  filePath: string,
  permission: SkillPermission,
): Promise<NextResponse | null> {
  const clientId = request.nextUrl.searchParams.get("clientId");
  const skillName = isInstallationOrClientSkillPath(filePath) ? skillNameFromPath(filePath) : null;
  if (skillName) {
    if (permission !== "skill.read" && !isEditableSkillPath(filePath)) {
      return NextResponse.json(
        { error: "Local base skills are read-only here. Edit SKILL.local.md or a client-owned skill instead." },
        { status: 403 },
      );
    }
    // Files exposed by this route are installation/client resources. Team OS
    // grants apply only to the separate Team plugin cache.
    return null;
  }
  if (!isDocsRequest(request) && isHostedTeamMode() && !clientId && !isSharedContextPath(filePath)) {
    return hostedModeForbiddenResponse() as NextResponse;
  }
  return null;
}

function isEditableSkillPath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, "/");
  const parts = normalized.split("/").filter(Boolean);
  const claudeIndex = parts.findIndex((part, index) => part === ".claude" && parts[index + 1] === "skills");
  if (claudeIndex === -1) return true;

  const isClientOwned = claudeIndex >= 2 && parts[claudeIndex - 2] === "clients";
  if (isClientOwned) return true;

  const pathInsideSkill = parts.slice(claudeIndex + 3).join("/");
  return pathInsideSkill === "SKILL.local.md";
}

async function getSkillTarget(
  request: NextRequest,
  filePath: string,
): Promise<ResolvedSkillFileTarget | null | NextResponse> {
  const requestedOrigin = request.nextUrl.searchParams.get("skillOrigin");
  if (!requestedOrigin) return null;
  const origin = parseSkillOrigin(requestedOrigin);
  if (!origin) return NextResponse.json({ error: "Invalid skill origin" }, { status: 400 });
  return resolveSkillFileTarget(request, filePath, origin);
}

function requestPrincipalResponse(error: unknown): NextResponse | null {
  if (error instanceof RequestPrincipalError) {
    return NextResponse.json({ error: error.message }, { status: error.status });
  }
  return null;
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let skillTarget: ResolvedSkillFileTarget | null = null;
  try {
    const { path: segments } = await params;
    const filePath = validateFilePath(segments, { docs: isDocsRequest(request) });
    if (!filePath) {
      return NextResponse.json(
        { error: "Access denied: file is outside the allowed documentation roots" },
        { status: 403 }
      );
    }
    const resolvedTarget = await getSkillTarget(request, filePath);
    if (resolvedTarget instanceof NextResponse) return resolvedTarget;
    skillTarget = resolvedTarget;
    if (!skillTarget) {
      const authz = await requireSkillFileAccess(request, filePath, "skill.read");
      if (authz) return authz;
      assertOwnedAccess(request, filePath);
    }

    const file = readFile(
      skillTarget?.storagePath ?? filePath,
      skillTarget?.baseDir ?? getBaseDir(request, filePath),
      { skipOwnershipCheck: Boolean(skillTarget) },
    );
    return NextResponse.json(skillTarget ? { ...file, path: filePath } : file);
  } catch (error) {
    const principalResponse = requestPrincipalResponse(error);
    if (principalResponse) return principalResponse;
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Path traversal") ? 403 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await skillTarget?.close();
  }
}

export async function PUT(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let skillTarget: ResolvedSkillFileTarget | null = null;
  try {
    const { path: segments } = await params;
    const filePath = validateFilePath(segments, { docs: isDocsRequest(request) });
    if (!filePath) {
      return NextResponse.json(
        { error: "Access denied: file is outside the allowed documentation roots" },
        { status: 403 }
      );
    }
    const resolvedTarget = await getSkillTarget(request, filePath);
    if (resolvedTarget instanceof NextResponse) return resolvedTarget;
    skillTarget = resolvedTarget;
    if (skillTarget && !skillTarget.writable) {
      return NextResponse.json({ error: "This skill version is read-only here." }, { status: 403 });
    }
    if (!skillTarget) {
      const authz = await requireSkillFileAccess(request, filePath, "skill.edit");
      if (authz) return authz;
      assertOwnedWrite(request, filePath);
    }

    const body = await request.json();
    const { content, lastModified } = body as { content: string; lastModified?: string };

    if (typeof content !== "string") {
      return NextResponse.json(
        { error: "content is required and must be a string" },
        { status: 400 }
      );
    }

    const result = writeFile(
      skillTarget?.storagePath ?? filePath,
      content,
      lastModified,
      skillTarget?.baseDir ?? getBaseDir(request, filePath),
      { skipOwnershipCheck: Boolean(skillTarget), skipOwnershipRegistration: Boolean(skillTarget) },
    );
    return NextResponse.json(skillTarget ? { ...result, path: filePath } : result);
  } catch (error) {
    const principalResponse = requestPrincipalResponse(error);
    if (principalResponse) return principalResponse;
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Path traversal") ? 403 : message.includes("modified since you loaded") ? 409 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await skillTarget?.close();
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let sourceSkillTarget: ResolvedSkillFileTarget | null = null;
  let destinationSkillTarget: ResolvedSkillFileTarget | null = null;
  try {
    const { path: segments } = await params;
    const docs = isDocsRequest(request);
    const fromPath = validateFilePath(segments, { docs });
    if (!fromPath) {
      return NextResponse.json(
        { error: "Access denied" },
        { status: 403 }
      );
    }
    const resolvedSource = await getSkillTarget(request, fromPath);
    if (resolvedSource instanceof NextResponse) return resolvedSource;
    sourceSkillTarget = resolvedSource;
    if (sourceSkillTarget && !sourceSkillTarget.writable) {
      return NextResponse.json({ error: "This skill version is read-only here." }, { status: 403 });
    }
    if (!sourceSkillTarget) {
      const sourceAuthz = await requireSkillFileAccess(request, fromPath, "skill.edit");
      if (sourceAuthz) return sourceAuthz;
      assertOwnedAccess(request, fromPath);
    }

    const body = await request.json();
    const { destination } = body as { destination: string };

    if (!destination || typeof destination !== "string") {
      return NextResponse.json(
        { error: "destination is required" },
        { status: 400 }
      );
    }

    // Validate destination path
    const destSegments = normalizeRelativePath(destination).split("/");
    const destPath = validateFilePath(destSegments, { docs });
    if (!destPath) {
      return NextResponse.json(
        { error: "Access denied: invalid destination" },
        { status: 403 }
      );
    }
    const resolvedDestination = await getSkillTarget(request, destPath);
    if (resolvedDestination instanceof NextResponse) return resolvedDestination;
    destinationSkillTarget = resolvedDestination;
    if (destinationSkillTarget && (!destinationSkillTarget.writable || destinationSkillTarget.baseDir !== sourceSkillTarget?.baseDir)) {
      return NextResponse.json({ error: "This skill move is not allowed." }, { status: 403 });
    }
    if (!destinationSkillTarget) {
      const destAuthz = await requireSkillFileAccess(request, destPath, "skill.edit");
      if (destAuthz) return destAuthz;
      assertOwnedWrite(request, destPath);
    }

    moveFile(
      sourceSkillTarget?.storagePath ?? fromPath,
      destinationSkillTarget?.storagePath ?? destPath,
      sourceSkillTarget?.baseDir ?? getBaseDir(request, fromPath),
      { skipOwnershipCheck: Boolean(sourceSkillTarget), skipOwnershipRegistration: Boolean(sourceSkillTarget) },
    );
    return NextResponse.json({ moved: true, from: fromPath, to: destPath });
  } catch (error) {
    const principalResponse = requestPrincipalResponse(error);
    if (principalResponse) return principalResponse;
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Path traversal") ? 403 : message.includes("not found") ? 404 : message.includes("already exists") ? 409 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await sourceSkillTarget?.close();
    await destinationSkillTarget?.close();
  }
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  let skillTarget: ResolvedSkillFileTarget | null = null;
  try {
    const { path: segments } = await params;
    const filePath = validateFilePath(segments, { docs: isDocsRequest(request) });
    if (!filePath) {
      return NextResponse.json(
        { error: "Access denied: file is outside the allowed documentation roots" },
        { status: 403 }
      );
    }
    const resolvedTarget = await getSkillTarget(request, filePath);
    if (resolvedTarget instanceof NextResponse) return resolvedTarget;
    skillTarget = resolvedTarget;
    if (skillTarget && !skillTarget.writable) {
      return NextResponse.json({ error: "This skill version is read-only here." }, { status: 403 });
    }
    if (!skillTarget) {
      const authz = await requireSkillFileAccess(request, filePath, "skill.admin");
      if (authz) return authz;
      assertOwnedAccess(request, filePath);
    }

    deleteFile(
      skillTarget?.storagePath ?? filePath,
      skillTarget?.baseDir ?? getBaseDir(request, filePath),
      { skipOwnershipCheck: Boolean(skillTarget) },
    );
    return NextResponse.json({ deleted: true, path: filePath });
  } catch (error) {
    const principalResponse = requestPrincipalResponse(error);
    if (principalResponse) return principalResponse;
    const message = error instanceof Error ? error.message : "Internal server error";
    const status = message.includes("Path traversal") ? 403 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message }, { status });
  } finally {
    await skillTarget?.close();
  }
}
