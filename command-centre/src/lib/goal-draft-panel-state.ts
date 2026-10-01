export interface GoalDraftPanelState {
  sessionCounter: number;
  panelKey: string;
  activeDraftId: string | null;
}

export function buildGoalDraftPanelKey(sessionCounter: number): string {
  return `goal-panel-${sessionCounter}`;
}

export function createGoalDraftPanelState(): GoalDraftPanelState {
  return {
    sessionCounter: 0,
    panelKey: buildGoalDraftPanelKey(0),
    activeDraftId: null,
  };
}

export function openBlankGoalDraftPanel(
  current: GoalDraftPanelState,
): GoalDraftPanelState {
  const nextSessionCounter = current.sessionCounter + 1;
  return {
    sessionCounter: nextSessionCounter,
    panelKey: buildGoalDraftPanelKey(nextSessionCounter),
    activeDraftId: null,
  };
}

export function openSavedGoalDraftPanel(
  current: GoalDraftPanelState,
  draftId: string,
): GoalDraftPanelState {
  const nextSessionCounter = current.sessionCounter + 1;
  return {
    sessionCounter: nextSessionCounter,
    panelKey: buildGoalDraftPanelKey(nextSessionCounter),
    activeDraftId: draftId,
  };
}

export function saveDraftInOpenGoalPanel(
  current: GoalDraftPanelState,
  draftId: string,
): GoalDraftPanelState {
  return {
    ...current,
    activeDraftId: draftId,
  };
}

export function clearActiveGoalDraftPanel(
  current: GoalDraftPanelState,
): GoalDraftPanelState {
  return {
    ...current,
    activeDraftId: null,
  };
}
