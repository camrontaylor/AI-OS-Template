import fs from "fs";
import path from "path";
import { getConfig } from "@/lib/config";
import {
  buildMarketingAnalyticsSnapshot,
  type MarketingAnalyticsSnapshot,
} from "@/lib/marketing-analytics";

export const magisterAuditFile =
  "projects/briefs/magister-replication/magister-generated-docs/2026-07-27-light-audit.md";
export const magisterPlanFile =
  "projects/briefs/magister-replication/magister-generated-docs/PLAN.md";

export function readMarketingAnalyticsSnapshot(): MarketingAnalyticsSnapshot {
  const root = getConfig().agenticOsDir;
  const auditPath = path.join(root, magisterAuditFile);
  const planPath = path.join(root, magisterPlanFile);

  if (!fs.existsSync(auditPath) || !fs.existsSync(planPath)) {
    throw new Error("Magister analytics source files are missing");
  }

  return buildMarketingAnalyticsSnapshot({
    auditMarkdown: fs.readFileSync(auditPath, "utf-8"),
    planMarkdown: fs.readFileSync(planPath, "utf-8"),
    auditFile: magisterAuditFile,
    planFile: magisterPlanFile,
  });
}
