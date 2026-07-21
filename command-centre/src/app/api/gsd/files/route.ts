import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolvePlanningDir } from "@/lib/config";

interface PlanningFile {
  name: string;
  relativePath: string;
  size: number;
}

interface PhaseFiles {
  phaseNumber: number;
  dirName: string;
  files: PlanningFile[];
}

/**
 * GET /api/gsd/files?phase=N — list .planning/ files
 *
 * Without ?phase: returns project-level files + list of phase directories
 * With ?phase=N: returns files for that specific phase
 * With ?file=<relativePath>: returns the file content
 */
export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const projectOverride = searchParams.get("project");
    const resolved = resolvePlanningDir({ overrideSlug: projectOverride });

    if (!resolved) {
      return NextResponse.json({ error: "No .planning directory found" }, { status: 404 });
    }

    const { planningDir } = resolved;
    const fileParam = searchParams.get("file");
    const phaseParam = searchParams.get("phase");

    // Return file content
    if (fileParam) {
      const safePath = fileParam.replace(/\.\./g, "");
      const fullPath = path.join(planningDir, safePath);
      if (!fullPath.startsWith(planningDir) || !fs.existsSync(fullPath) || fs.statSync(fullPath).isDirectory()) {
        return NextResponse.json({ error: "File not found" }, { status: 404 });
      }
      const content = fs.readFileSync(fullPath, "utf-8");
      return NextResponse.json({ content, name: path.basename(fullPath) });
    }

    // Return files for a specific phase
    if (phaseParam) {
      const phasesDir = path.join(planningDir, "phases");
      if (!fs.existsSync(phasesDir)) {
        return NextResponse.json({ files: [] });
      }

      const phaseNum = parseInt(phaseParam, 10);
      const prefix = String(phaseNum).padStart(2, "0");
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true });
      const phaseDir = entries.find((e) => e.isDirectory() && e.name.startsWith(prefix + "-"));

      if (!phaseDir) {
        return NextResponse.json({ files: [] });
      }

      const dirPath = path.join(phasesDir, phaseDir.name);
      const files = fs.readdirSync(dirPath)
        .filter((f) => f.endsWith(".md"))
        .map((f) => ({
          name: f,
          relativePath: `phases/${phaseDir.name}/${f}`,
          size: fs.statSync(path.join(dirPath, f)).size,
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      return NextResponse.json({ dirName: phaseDir.name, files });
    }

    // Return project-level overview
    const projectFiles: PlanningFile[] = [];
    const topLevelFiles = ["PROJECT.md", "REQUIREMENTS.md", "ROADMAP.md", "STATE.md"];
    for (const name of topLevelFiles) {
      const fp = path.join(planningDir, name);
      if (fs.existsSync(fp)) {
        projectFiles.push({
          name,
          relativePath: name,
          size: fs.statSync(fp).size,
        });
      }
    }

    // List phase directories
    const phasesDir = path.join(planningDir, "phases");
    const phases: PhaseFiles[] = [];
    if (fs.existsSync(phasesDir)) {
      const entries = fs.readdirSync(phasesDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() && /^\d{2}-/.test(e.name))
        .sort((a, b) => a.name.localeCompare(b.name));

      for (const entry of entries) {
        const match = entry.name.match(/^(\d{2})-/);
        if (!match) continue;
        const phaseNumber = parseInt(match[1], 10);
        const dirPath = path.join(phasesDir, entry.name);
        const files = fs.readdirSync(dirPath)
          .filter((f) => f.endsWith(".md"))
          .map((f) => ({
            name: f,
            relativePath: `phases/${entry.name}/${f}`,
            size: fs.statSync(path.join(dirPath, f)).size,
          }));
        phases.push({ phaseNumber, dirName: entry.name, files });
      }
    }

    // Research files
    const researchDir = path.join(planningDir, "research");
    const researchFiles: PlanningFile[] = [];
    if (fs.existsSync(researchDir)) {
      for (const f of fs.readdirSync(researchDir).filter((f) => f.endsWith(".md"))) {
        researchFiles.push({
          name: f,
          relativePath: `research/${f}`,
          size: fs.statSync(path.join(researchDir, f)).size,
        });
      }
    }

    return NextResponse.json({ projectFiles, phases, researchFiles });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
