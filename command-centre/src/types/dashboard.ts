export interface DashboardSummary {
  userName: string | null;
  weekStats: {
    sessionsCount: number;
    messagesCount: number;
    tasksCompleted: number;
    totalCostUsd: number;
  };
  claudeUsage: {
    todayTokens: number;
    weekTokens: number;
    monthTokens: number;
    todaySessions: number;
    weekSessions: number;
    todayMessages: number;
    weekMessages: number;
    byModel: Array<{ model: string; tokens: number }>;
    dailyTokenBudget: number;
    lastUpdated: string | null;
  };
  awaitingReview: {
    reviewCount: number;
    needsInputCount: number;
    errorCount: number;
    tasks: Array<{ id: string; title: string; status: string }>;
  };
  activeProjects: Array<{
    name: string;
    slug: string;
    level: number;
    goal: string;
    completedItems: number;
    totalItems: number;
    boardTaskCount: number;
    hasPlanning: boolean;
  }>;
  recentTasks: Array<{
    id: string;
    title: string;
    completedAt: string;
    durationMs: number | null;
    costUsd: number | null;
    level: string;
  }>;
  system: {
    cronActive: number;
    cronTotal: number;
    cronLastRun: { jobName: string; time: string; result: string } | null;
    skillsInstalled: number;
    brandContextFiles: number;
  };
}

export interface ClientStats {
  slug: string;
  name: string;
  color: string;
  activeTasks: number;
  completedTasks: number;
  totalCostUsd: number;
  activeProjects: number;
  reviewCount: number;
}
