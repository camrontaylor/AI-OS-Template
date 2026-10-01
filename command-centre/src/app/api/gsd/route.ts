import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolvePlanningDir } from "@/lib/config";
import { parseRoadmap } from "@/lib/gsd-parser";
import type { GsdProject } from "@/types/gsd";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";

function readFileOrNull(filePath: string): string | null {
  try {
    if (!isMaterializedPathAccessible(filePath)) return null;
    return fs.readFileSync(filePath, "utf-8");
  } catch {
    return null;
  }
}

export async function GET(request: NextRequest) {
  try {
    const projectOverride = request.nextUrl.searchParams.get("project");
    const resolved = resolvePlanningDir({ overrideSlug: projectOverride });

    if (!resolved) {
      return NextResponse.json({ hasPlanning: false } as Partial<GsdProject>);
    }

    const { planningDir, projectSlug } = resolved;

    const roadmapContent = readFileOrNull(path.join(planningDir, "ROADMAP.md"));
    const stateContent = readFileOrNull(path.join(planningDir, "STATE.md"));
    const projectContent = readFileOrNull(path.join(planningDir, "PROJECT.md"));

    if (!roadmapContent) {
      return NextResponse.json({ hasPlanning: false } as Partial<GsdProject>);
    }

    // Parse project name from ROADMAP header
    const nameMatch = roadmapContent.match(/^# Roadmap:\s*(.+)/m);
    const name = nameMatch ? nameMatch[1].trim() : "GSD Project";

    // Parse core value from PROJECT.md or STATE.md
    let coreValue = "";
    if (stateContent) {
      const cvMatch = stateContent.match(/\*\*Core value:\*\*\s*(.+)/);
      if (cvMatch) coreValue = cvMatch[1].trim();
    }
    if (!coreValue && projectContent) {
      const cvMatch = projectContent.match(/## Core Value\s*\n\s*(.+)/);
      if (cvMatch) coreValue = cvMatch[1].trim();
    }

    // Parse state
    let currentPhaseNumber = 1;
    let milestone = "v1.0";
    let lastUpdated = "";
    if (stateContent) {
      const phaseMatch = stateContent.match(/^Phase:\s*(\d+)/m);
      if (phaseMatch) currentPhaseNumber = parseInt(phaseMatch[1]);
      const milestoneMatch = stateContent.match(/^milestone:\s*(.+)/m);
      if (milestoneMatch) milestone = milestoneMatch[1].trim();
      const updatedMatch = stateContent.match(/^last_updated:\s*"?([^"\n]+)"?/m);
      if (updatedMatch) lastUpdated = updatedMatch[1].trim();
    }

    const phasesDir = path.join(planningDir, "phases");
    const displayPrefix = `projects/briefs/${projectSlug}/.planning`;
    const phases = parseRoadmap(roadmapContent, phasesDir, displayPrefix);

    const completedPhases = phases.filter((p) => p.status === "complete").length;

    const project: GsdProject = {
      name,
      coreValue,
      currentPhaseNumber,
      totalPhases: phases.length,
      completedPhases,
      milestone,
      lastUpdated,
      phases,
      hasPlanning: true,
      briefSlug: projectSlug,
    };

    return NextResponse.json(project);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
