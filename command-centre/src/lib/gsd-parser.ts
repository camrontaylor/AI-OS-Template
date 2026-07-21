import fs from "fs";
import path from "path";
import type { GsdPhase, GsdPlan, PhaseStatus } from "@/types/gsd";

function findPhaseSlug(phasesDir: string, phaseNum: number): string | null {
  if (!fs.existsSync(phasesDir)) return null;
  const prefix = String(phaseNum).padStart(2, "0") + "-";
  const entries = fs.readdirSync(phasesDir);
  return entries.find((e) => e.startsWith(prefix)) || null;
}

export function parseRoadmap(
  content: string,
  phasesDir: string,
  displayPathPrefix?: string
): GsdPhase[] {
  const phases: GsdPhase[] = [];

  // Extract phase list from ## Phases section
  const phasesSection = content.match(/## Phases[\s\S]*?(?=## Phase Details|$)/);
  if (!phasesSection) return phases;

  // Extract phase details
  const detailsSection = content.match(/## Phase Details([\s\S]*?)(?=## Progress|$)/);
  if (!detailsSection) return phases;

  // Parse progress table for status
  const progressSection = content.match(/## Progress[\s\S]*/);
  const statusMap = new Map<number, { status: PhaseStatus; completedDate: string | null }>();
  if (progressSection) {
    const rows = progressSection[0].match(/\|\s*\d+\.\s*.*?\|.*?\|.*?\|.*?\|/g) || [];
    for (const row of rows) {
      const cells = row.split("|").map((c) => c.trim()).filter(Boolean);
      const numMatch = cells[0]?.match(/^(\d+)\./);
      if (numMatch) {
        const num = parseInt(numMatch[1]);
        const statusStr = cells[2]?.toLowerCase() || "";
        let status: PhaseStatus = "not-started";
        if (statusStr.includes("complete")) status = "complete";
        else if (statusStr.includes("progress")) status = "in-progress";
        const completedDate = cells[3]?.trim() === "-" ? null : cells[3]?.trim() || null;
        statusMap.set(num, { status, completedDate });
      }
    }
  }

  // Parse each ### Phase N: Name section
  const phaseRegex = /### Phase (\d+): (.+?)\n([\s\S]*?)(?=### Phase \d+:|$)/g;
  let match;
  while ((match = phaseRegex.exec(detailsSection[1])) !== null) {
    const num = parseInt(match[1]);
    const name = match[2].trim();
    const body = match[3];

    // Goal
    const goalMatch = body.match(/\*\*Goal\*\*:\s*(.+)/);
    const goal = goalMatch ? goalMatch[1].trim() : "";

    // Depends on
    const dependsMatch = body.match(/\*\*Depends on\*\*:\s*(.+)/);
    const dependsOn = dependsMatch ? dependsMatch[1].trim() : "";

    // Requirements
    const reqMatch = body.match(/\*\*Requirements\*\*:\s*(.+)/);
    const requirements = reqMatch
      ? reqMatch[1].split(",").map((r) => r.trim()).filter(Boolean)
      : [];

    // Success criteria
    const successCriteria: string[] = [];
    const scMatch = body.match(/\*\*Success Criteria\*\*[\s\S]*?(?=\*\*Plans\*\*|Plans:|$)/);
    if (scMatch) {
      const lines = scMatch[0].split("\n");
      for (const line of lines) {
        const scLine = line.match(/^\s+\d+\.\s+(.+)/);
        if (scLine) successCriteria.push(scLine[1].trim());
      }
    }

    // Plans
    const plans: GsdPlan[] = [];
    const plansMatch = body.match(/Plans:\n([\s\S]*?)$/);
    if (plansMatch) {
      const planLines = plansMatch[1].split("\n");
      for (const line of planLines) {
        const planMatch = line.match(/- \[(x| )\]\s+(\d+-\d+)(?:-PLAN\.md)?[:\s]+(.+)/);
        if (planMatch) {
          const planId = planMatch[2];
          const completed = planMatch[1] === "x";
          const description = planMatch[3].trim().replace(/\s*—.*$/, "");

          const phaseSlug = findPhaseSlug(phasesDir, num);
          const hasPlanFile = phaseSlug
            ? fs.existsSync(path.join(phasesDir, phaseSlug, `${planId}-PLAN.md`))
            : false;
          const hasSummaryFile = phaseSlug
            ? fs.existsSync(path.join(phasesDir, phaseSlug, `${planId}-SUMMARY.md`))
            : false;

          plans.push({ id: planId, description, completed, hasPlanFile, hasSummaryFile });
        }
      }
    }

    const statusInfo = statusMap.get(num) || { status: "not-started" as PhaseStatus, completedDate: null };
    const plansComplete = plans.filter((p) => p.completed).length;
    const phaseSlug = findPhaseSlug(phasesDir, num);

    phases.push({
      number: num,
      slug: phaseSlug || `${String(num).padStart(2, "0")}-${name.toLowerCase().replace(/\s+/g, "-")}`,
      name,
      goal,
      dependsOn,
      requirements,
      successCriteria,
      plans,
      status: statusInfo.status,
      completedDate: statusInfo.completedDate,
      plansComplete,
      plansTotal: plans.length,
      phaseDir: phaseSlug
        ? `${displayPathPrefix ?? ".planning"}/phases/${phaseSlug}`
        : "",
    });
  }

  return phases;
}
