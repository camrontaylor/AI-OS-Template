import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { resolvePlanningDir } from "@/lib/config";
import { parseRoadmap } from "@/lib/gsd-parser";
import { isMaterializedPathAccessible } from "@/lib/materialized-file-ownership";

export async function GET(request: NextRequest) {
  try {
    const projectOverride = request.nextUrl.searchParams.get("project");
    const resolved = resolvePlanningDir({ overrideSlug: projectOverride });

    if (!resolved) {
      return NextResponse.json({ exists: false });
    }

    const { planningDir } = resolved;

    const roadmapPath = path.join(planningDir, "ROADMAP.md");
    if (!fs.existsSync(roadmapPath) || !isMaterializedPathAccessible(roadmapPath)) {
      return NextResponse.json({ exists: false });
    }

    const content = fs.readFileSync(roadmapPath, "utf-8");
    const nameMatch = content.match(/^# Roadmap:\s*(.+)/m);
    const projectName = nameMatch ? nameMatch[1].trim() : "Unknown project";

    const phasesDir = path.join(planningDir, "phases");
    const phases = parseRoadmap(content, phasesDir);
    const completedPhases = phases.filter((p) => p.status === "complete").length;

    // Current phase: first non-complete phase
    const currentPhaseData = phases.find((p) => p.status !== "complete");
    const currentPhase = currentPhaseData?.number ?? (phases.length > 0 ? phases[phases.length - 1].number : null);

    return NextResponse.json({
      exists: true,
      projectName,
      currentPhase,
      totalPhases: phases.length,
      completedPhases,
    });
  } catch {
    return NextResponse.json({ exists: false });
  }
}
