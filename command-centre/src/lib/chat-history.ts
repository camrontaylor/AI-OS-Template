import type { Task } from "@/types/task";
import type { TeamNavigationScopeLabels } from "@/store/team-navigation-store";

export const ALL_CHAT_SCOPES = "__all__";
export const SOLO_CHAT_SCOPE = "__solo__";

export function taskTeamId(
  task: Pick<Task, "workScope"> | { workScope?: Task["workScope"] | null },
): string | null {
  return task.workScope?.mode === "team" ? task.workScope.scope.teamId : null;
}

export function taskClientFilterKey(task: Pick<Task, "workScope" | "clientId">): string {
  const teamId = taskTeamId(task) ?? SOLO_CHAT_SCOPE;
  return `${teamId}\n${task.clientId ?? "root"}`;
}

export function shouldShowTaskTeamBadge(
  task: Pick<Task, "workScope">,
  selectedTeamId: string | null,
  activeTeamIds?: string[],
): boolean {
  const teamId = taskTeamId(task);
  return teamId !== null && (
    teamId !== selectedTeamId
    || (activeTeamIds !== undefined && !activeTeamIds.includes(teamId))
  );
}

export function resolveTaskTeamLabel(
  task: Pick<Task, "workScope">,
  scopeLabels: TeamNavigationScopeLabels,
  activeTeams: Array<{ id: string; name: string | null; slug: string | null }>,
): string | null {
  const teamId = taskTeamId(task);
  if (!teamId) return null;
  const active = activeTeams.find((team) => team.id === teamId);
  const known = scopeLabels.teams.find((team) => team.id === teamId);
  return active?.name
    ?? active?.slug
    ?? known?.name
    ?? known?.slug
    ?? `${teamId.slice(0, 8)}…`;
}

export function matchesChatHistoryFilters(
  task: Pick<Task, "title" | "description" | "workScope" | "clientId">,
  filters: { query: string; teamId: string; clientKey: string },
): boolean {
  const query = filters.query.trim().toLocaleLowerCase();
  if (query) {
    const haystack = `${task.title}\n${task.description ?? ""}`.toLocaleLowerCase();
    if (!haystack.includes(query)) return false;
  }
  if (filters.teamId !== ALL_CHAT_SCOPES) {
    const teamId = taskTeamId(task) ?? SOLO_CHAT_SCOPE;
    if (teamId !== filters.teamId) return false;
  }
  if (
    filters.clientKey !== ALL_CHAT_SCOPES
    && taskClientFilterKey(task) !== filters.clientKey
  ) {
    return false;
  }
  return true;
}
