"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  FEED_CANVAS_STORAGE_PREFIX,
  LEGACY_PANE_STORAGE_PREFIX,
  createDefaultFeedCanvasLayout,
  createMainChatPanel,
  feedCanvasReducer,
  flattenFeedCanvasPanels,
  isSingletonFeedPanelType,
  migrateLegacyPaneState,
  sanitizeFeedCanvasLayout,
  type FeedCanvasDropTarget,
  type FeedCanvasLayoutV1,
  type FeedCanvasPanel,
  type FeedPanelResource,
  type FeedPanelType,
} from "@/components/board/feed-canvas-state";
import { getFeedPanelTitle } from "@/components/board/feed-panel-registry";

let panelSequence = Date.now();

function nextPanelId(type: FeedPanelType): string {
  panelSequence += 1;
  return `${type}-${panelSequence}`;
}

function nextNavigationKey(): string {
  panelSequence += 1;
  return `nav-${panelSequence.toString(36)}`;
}

function stableResourceId(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

function loadLayout(
  goalId: string,
  mainLabel: string,
  validTaskIds: string[],
  goalLineageTaskIds: string[],
  taskIdAliases: Readonly<Record<string, string>>,
): FeedCanvasLayoutV1 {
  if (typeof window === "undefined") return createDefaultFeedCanvasLayout(goalId, mainLabel);
  try {
    const current = window.localStorage.getItem(FEED_CANVAS_STORAGE_PREFIX + goalId);
    if (current) {
      return sanitizeFeedCanvasLayout(
        JSON.parse(current),
        goalId,
        validTaskIds,
        mainLabel,
        goalLineageTaskIds,
        taskIdAliases,
      );
    }
    const legacy = window.localStorage.getItem(LEGACY_PANE_STORAGE_PREFIX + goalId);
    if (legacy) {
      const migrated = migrateLegacyPaneState(JSON.parse(legacy), goalId, mainLabel);
      if (migrated) {
        return sanitizeFeedCanvasLayout(
          migrated,
          goalId,
          validTaskIds,
          mainLabel,
          goalLineageTaskIds,
          taskIdAliases,
        );
      }
    }
  } catch {
    // Invalid persisted state falls through to a safe default.
  }
  return createDefaultFeedCanvasLayout(goalId, mainLabel);
}

export function useFeedCanvasLayout({
  goalId,
  mainLabel,
  validTaskIds,
  goalLineageTaskIds,
  taskIdAliases,
}: {
  goalId: string;
  mainLabel: string;
  validTaskIds: string[];
  goalLineageTaskIds: string[];
  taskIdAliases: Readonly<Record<string, string>>;
}) {
  const validTaskKey = useMemo(() => [...validTaskIds].sort().join("\u0000"), [validTaskIds]);
  const goalLineageKey = useMemo(
    () => [...goalLineageTaskIds].sort().join("\u0000"),
    [goalLineageTaskIds],
  );
  const taskAliasKey = useMemo(
    () => Object.entries(taskIdAliases)
      .sort(([first], [second]) => first.localeCompare(second))
      .map(([taskId, canonicalId]) => `${taskId}:${canonicalId}`)
      .join("\u0000"),
    [taskIdAliases],
  );
  const goalLineage = useMemo(
    () => new Set([goalId, ...goalLineageTaskIds]),
    [goalId, goalLineageKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const canonicalTaskId = useCallback(
    (taskId: string) => taskIdAliases[taskId] ?? taskId,
    [taskAliasKey], // eslint-disable-line react-hooks/exhaustive-deps
  );
  const loadedGoalRef = useRef(goalId);
  const [layout, setLayout] = useState<FeedCanvasLayoutV1>(() =>
    loadLayout(goalId, mainLabel, validTaskIds, goalLineageTaskIds, taskIdAliases),
  );

  useEffect(() => {
    loadedGoalRef.current = goalId;
    setLayout(loadLayout(
      goalId,
      mainLabel,
      validTaskIds,
      goalLineageTaskIds,
      taskIdAliases,
    ));
    // The serialized keys deliberately reload only when persisted-resource routing changes.
  }, [goalId, mainLabel, validTaskKey, goalLineageKey, taskAliasKey]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (typeof window === "undefined" || loadedGoalRef.current !== goalId || layout.goalId !== goalId) return;
    try {
      window.localStorage.setItem(FEED_CANVAS_STORAGE_PREFIX + goalId, JSON.stringify(layout));
    } catch {
      // Canvas remains usable when storage is unavailable.
    }
  }, [goalId, layout]);

  const update = useCallback((action: Parameters<typeof feedCanvasReducer>[1]) => {
    setLayout((current) => feedCanvasReducer(current, action));
  }, []);

  const addPanel = useCallback((type: FeedPanelType) => {
    if (type === "chat") {
      const existing = flattenFeedCanvasPanels(layout).find((panel) =>
        panel.type === "chat" && panel.resource?.primary);
      if (existing) {
        update({ type: "focus-panel", panelId: existing.id });
        return existing.id;
      }
      const panel = createMainChatPanel(goalId, mainLabel);
      const activeColumn = layout.columns.find((column) =>
        column.panels.some((candidate) => candidate.id === layout.activePanelId),
      );
      update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
      return panel.id;
    }
    if (isSingletonFeedPanelType(type)) {
      const existing = flattenFeedCanvasPanels(layout).find((panel) => panel.type === type);
      if (existing) {
        update({ type: "focus-panel", panelId: existing.id });
        return existing.id;
      }
    }
    const panel: FeedCanvasPanel = {
      id: nextPanelId(type),
      type,
      label: getFeedPanelTitle(type),
      heightWeight: 1,
    };
    const activeColumn = layout.columns.find((column) =>
      column.panels.some((candidate) => candidate.id === layout.activePanelId),
    );
    update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
    return panel.id;
  }, [goalId, layout, mainLabel, update]);

  const primaryPanel = useCallback(() =>
    flattenFeedCanvasPanels(layout).find((panel) => panel.type === "chat" && panel.resource?.primary),
  [layout]);

  const openTaskInPrimary = useCallback((taskId: string, label: string) => {
    const canonicalId = canonicalTaskId(taskId);
    const isGoalTask = goalLineage.has(taskId) || goalLineage.has(canonicalId);
    const assignedTaskId = isGoalTask ? goalId : canonicalId;
    const assignedLabel = isGoalTask ? mainLabel : label;
    const panel = primaryPanel();
    if (!panel) {
      const primary = createMainChatPanel(goalId, mainLabel);
      update({ type: "add-panel", panel: primary });
      update({ type: "assign-task", panelId: primary.id, taskId: assignedTaskId, label: assignedLabel });
      update({ type: "focus-panel", panelId: primary.id });
      return primary.id;
    }
    update({ type: "assign-task", panelId: panel.id, taskId: assignedTaskId, label: assignedLabel });
    update({ type: "focus-panel", panelId: panel.id });
    return panel.id;
  }, [canonicalTaskId, goalId, goalLineage, mainLabel, primaryPanel, update]);

  const openTaskPanel = useCallback((taskId: string, label: string) => {
    const canonicalId = canonicalTaskId(taskId);
    if (goalLineage.has(taskId) || goalLineage.has(canonicalId)) {
      return openTaskInPrimary(goalId, mainLabel);
    }
    const existing = flattenFeedCanvasPanels(layout).find((panel) =>
      panel.type === "chat"
      && panel.resource?.taskId
      && canonicalTaskId(panel.resource.taskId) === canonicalId);
    if (existing) {
      update({ type: "focus-panel", panelId: existing.id });
      return existing.id;
    }
    const panel: FeedCanvasPanel = {
      id: nextPanelId("chat"),
      type: "chat",
      label,
      heightWeight: 1,
      resource: { taskId: canonicalId },
    };
    const activeColumn = layout.columns.find((column) =>
      column.panels.some((candidate) => candidate.id === layout.activePanelId),
    );
    update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
    return panel.id;
  }, [canonicalTaskId, goalId, goalLineage, layout, mainLabel, openTaskInPrimary, update]);

  const restoreMainChat = useCallback(() => {
    const existing = primaryPanel();
    if (existing) {
      update({ type: "assign-task", panelId: existing.id, taskId: goalId, label: mainLabel });
      update({ type: "focus-panel", panelId: existing.id });
      return existing.id;
    }
    const panel = createMainChatPanel(goalId, mainLabel);
    const activeColumn = layout.columns.find((column) =>
      column.panels.some((candidate) => candidate.id === layout.activePanelId),
    );
    update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
    return panel.id;
  }, [goalId, layout.activePanelId, layout.columns, mainLabel, primaryPanel, update]);

  const openBlankInPrimary = useCallback((label = "New subchat") => {
    const existing = primaryPanel();
    const panelId = existing?.id ?? addPanel("chat");
    update({ type: "assign-task", panelId, label });
    update({ type: "focus-panel", panelId });
    return panelId;
  }, [addPanel, primaryPanel, update]);

  const pinnedTaskPanel = useCallback((taskId: string) =>
    flattenFeedCanvasPanels(layout).find((panel) =>
      panel.type === "chat"
      && !panel.resource?.primary
      && panel.resource?.taskId
      && canonicalTaskId(panel.resource.taskId) === canonicalTaskId(taskId)),
  [canonicalTaskId, layout]);

  const pinTaskPanel = useCallback((taskId: string, label: string) => {
    const existing = pinnedTaskPanel(taskId);
    if (existing) {
      update({ type: "focus-panel", panelId: existing.id });
      return existing.id;
    }
    const canonicalId = canonicalTaskId(taskId);
    const panel: FeedCanvasPanel = {
      id: `chat-task-${canonicalId}`,
      type: "chat",
      label,
      heightWeight: 1,
      resource: { taskId: canonicalId },
    };
    const activeColumn = layout.columns.find((column) =>
      column.panels.some((candidate) => candidate.id === layout.activePanelId),
    );
    update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
    return panel.id;
  }, [canonicalTaskId, layout.activePanelId, layout.columns, pinnedTaskPanel, update]);

  const unpinTaskPanel = useCallback((taskId: string) => {
    const existing = pinnedTaskPanel(taskId);
    if (existing) update({ type: "remove-panel", panelId: existing.id, mainLabel });
  }, [mainLabel, pinnedTaskPanel, update]);

  const openFilePanel = useCallback((relativePath: string, label: string) => {
    const resource = { relativePath, navigationKey: nextNavigationKey() };
    const existing = flattenFeedCanvasPanels(layout).find((panel) =>
      panel.type === "file");
    if (existing) {
      update({ type: "set-panel-resource", panelId: existing.id, resource });
      update({ type: "rename-panel", panelId: existing.id, label });
      update({ type: "focus-panel", panelId: existing.id });
      return existing.id;
    }
    const panel: FeedCanvasPanel = {
      id: `file-${stableResourceId(relativePath)}`,
      type: "file",
      label,
      heightWeight: 1,
      resource,
    };
    const activeColumn = layout.columns.find((column) =>
      column.panels.some((candidate) => candidate.id === layout.activePanelId),
    );
    update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
    return panel.id;
  }, [layout, update]);

  const openFilesPanel = useCallback((relativePath: string) => {
    const resource = { relativePath, navigationKey: nextNavigationKey() };
    const existing = flattenFeedCanvasPanels(layout).find((panel) => panel.type === "files");
    if (existing) {
      update({ type: "set-panel-resource", panelId: existing.id, resource });
      update({ type: "focus-panel", panelId: existing.id });
      return existing.id;
    }
    const panel: FeedCanvasPanel = {
      id: nextPanelId("files"),
      type: "files",
      label: getFeedPanelTitle("files"),
      heightWeight: 1,
      resource,
    };
    const activeColumn = layout.columns.find((column) =>
      column.panels.some((candidate) => candidate.id === layout.activePanelId),
    );
    update({ type: "add-panel", panel, afterColumnId: activeColumn?.id });
    return panel.id;
  }, [layout, update]);

  const movePanel = useCallback((
    panelId: string,
    target: FeedCanvasDropTarget,
  ) => update({ type: "move-panel", panelId, target }), [update]);

  return {
    layout,
    panels: flattenFeedCanvasPanels(layout),
    addPanel,
    openTaskPanel,
    openTaskInPrimary,
    restoreMainChat,
    openBlankInPrimary,
    pinTaskPanel,
    unpinTaskPanel,
    getPinnedTaskPanelId: (taskId: string) => pinnedTaskPanel(taskId)?.id ?? null,
    openFilePanel,
    openFilesPanel,
    resetToMain: () => setLayout(createDefaultFeedCanvasLayout(goalId, mainLabel)),
    removePanel: (panelId: string) => update({ type: "remove-panel", panelId, mainLabel }),
    focusPanel: (panelId: string) => update({ type: "focus-panel", panelId }),
    movePanel,
    setColumnWeights: (
      firstColumnId: string,
      firstWeight: number,
      secondColumnId: string,
      secondWeight: number,
    ) => update({ type: "set-column-weights", firstColumnId, firstWeight, secondColumnId, secondWeight }),
    setPanelWeights: (
      columnId: string,
      firstPanelId: string,
      firstWeight: number,
      secondPanelId: string,
      secondWeight: number,
    ) => update({
      type: "set-panel-weights",
      columnId,
      firstPanelId,
      firstWeight,
      secondPanelId,
      secondWeight,
    }),
    renamePanel: (panelId: string, label: string) => update({ type: "rename-panel", panelId, label }),
    assignTaskToPanel: (panelId: string, taskId?: string, label?: string) =>
      update({ type: "assign-task", panelId, taskId, label }),
    updatePanelResource: (panelId: string, resource: Partial<FeedPanelResource>) =>
      update({ type: "set-panel-resource", panelId, resource }),
  };
}
