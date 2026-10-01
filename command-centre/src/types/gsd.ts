export type PhaseStatus = "complete" | "in-progress" | "not-started";

export interface GsdPlan {
  id: string;
  description: string;
  completed: boolean;
  hasPlanFile: boolean;
  hasSummaryFile: boolean;
}

export interface GsdPhase {
  number: number;
  slug: string;
  name: string;
  goal: string;
  dependsOn: string;
  requirements: string[];
  successCriteria: string[];
  plans: GsdPlan[];
  status: PhaseStatus;
  completedDate: string | null;
  plansComplete: number;
  plansTotal: number;
  phaseDir: string;
}

export interface GsdProject {
  name: string;
  coreValue: string;
  currentPhaseNumber: number;
  totalPhases: number;
  completedPhases: number;
  milestone: string;
  lastUpdated: string;
  phases: GsdPhase[];
  hasPlanning: boolean;
  briefSlug: string | null;
}
