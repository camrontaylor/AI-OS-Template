export const FEED_CANVAS_VERSION = 1 as const;
export const FEED_CANVAS_STORAGE_PREFIX = "feed-canvas:v1:";
export const LEGACY_PANE_STORAGE_PREFIX = "panes:";
export const FEED_CANVAS_GAP = 8;
export const FEED_CANVAS_DROP_HIT_SIZE = 52;
export const FEED_CANVAS_DROP_INDICATOR_SIZE = 6;

export type FeedPanelType =
  | "chat"
  | "subchats"
  | "terminal"
  | "file"
  | "files"
  | "plan"
  | "changes";

export interface FeedPanelResource {
  taskId?: string;
  relativePath?: string;
  navigationKey?: string;
  planVersionId?: string;
  clientId?: string | null;
  primary?: boolean;
}

export interface FeedCanvasPanel {
  id: string;
  type: FeedPanelType;
  label: string;
  heightWeight: number;
  resource?: FeedPanelResource;
}

export interface FeedCanvasColumn {
  id: string;
  widthWeight: number;
  panels: FeedCanvasPanel[];
}

export interface FeedCanvasLayoutV1 {
  version: typeof FEED_CANVAS_VERSION;
  goalId: string;
  columns: FeedCanvasColumn[];
  activePanelId: string;
}

export type FeedCanvasDropTarget =
  | { kind: "column"; index: number }
  | { kind: "stack"; columnId: string; index: number };

export type FeedCanvasAction =
  | { type: "add-panel"; panel: FeedCanvasPanel; afterColumnId?: string }
  | { type: "remove-panel"; panelId: string; mainLabel?: string }
  | { type: "focus-panel"; panelId: string }
  | {
      type: "move-panel";
      panelId: string;
      target: FeedCanvasDropTarget;
    }
  | {
      type: "set-column-weights";
      firstColumnId: string;
      firstWeight: number;
      secondColumnId: string;
      secondWeight: number;
    }
  | {
      type: "set-panel-weights";
      columnId: string;
      firstPanelId: string;
      firstWeight: number;
      secondPanelId: string;
      secondWeight: number;
    }
  | { type: "rename-panel"; panelId: string; label: string }
  | { type: "assign-task"; panelId: string; taskId?: string; label?: string }
  | { type: "set-panel-resource"; panelId: string; resource: Partial<FeedPanelResource> };

interface LegacyPaneItem {
  id: string;
  type: "chat" | "terminal";
  label?: string;
  taskId?: string;
}

interface LegacyPaneState {
  openPanes?: LegacyPaneItem[];
  visiblePaneIds?: string[];
  splitGroup?: [string, string] | null;
  activePaneId?: string;
  layout?: "horizontal" | "grid";
}

const PANEL_TYPES = new Set<FeedPanelType>([
  "chat",
  "subchats",
  "terminal",
  "file",
  "files",
  "plan",
  "changes",
]);

const SINGLETON_PANEL_TYPES = new Set<FeedPanelType>([
  "subchats",
  "file",
  "files",
  "plan",
  "changes",
]);

export function isSingletonFeedPanelType(type: FeedPanelType): boolean {
  return SINGLETON_PANEL_TYPES.has(type);
}

function positiveWeight(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 1;
}

function normalizeListWeights<T>(
  items: T[],
  read: (item: T) => number,
  write: (item: T, weight: number) => T,
): T[] {
  if (items.length === 0) return items;
  const total = items.reduce((sum, item) => sum + positiveWeight(read(item)), 0);
  return items.map((item) => write(item, positiveWeight(read(item)) / total));
}

export function normalizeFeedCanvasLayout(layout: FeedCanvasLayoutV1): FeedCanvasLayoutV1 {
  const columns = normalizeListWeights(
    layout.columns.map((column) => ({
      ...column,
      panels: normalizeListWeights(
        column.panels,
        (panel) => panel.heightWeight,
        (panel, heightWeight) => ({ ...panel, heightWeight }),
      ),
    })),
    (column) => column.widthWeight,
    (column, widthWeight) => ({ ...column, widthWeight }),
  );
  return { ...layout, columns };
}

export function createMainChatPanel(goalId: string, label = "Main chat"): FeedCanvasPanel {
  return {
    id: "main-chat",
    type: "chat",
    label,
    heightWeight: 1,
    resource: { taskId: goalId, primary: true },
  };
}

export function createDefaultFeedCanvasLayout(
  goalId: string,
  mainLabel = "Main chat",
): FeedCanvasLayoutV1 {
  const panel = createMainChatPanel(goalId, mainLabel);
  return {
    version: FEED_CANVAS_VERSION,
    goalId,
    columns: [{ id: "column-main", widthWeight: 1, panels: [panel] }],
    activePanelId: panel.id,
  };
}

function isSafeRelativePath(value: unknown): value is string {
  if (typeof value !== "string" || value.length === 0) return false;
  if (/^[a-zA-Z]:[\\/]/.test(value) || value.startsWith("/") || value.startsWith("\\")) return false;
  return !value.split(/[\\/]+/).includes("..");
}

function isSafeLayoutId(value: unknown): value is string {
  return typeof value === "string"
    && /^[a-zA-Z0-9][a-zA-Z0-9:._-]{0,127}$/.test(value);
}

export function sanitizeFeedCanvasLayout(
  value: unknown,
  goalId: string,
  validTaskIds?: Iterable<string>,
  mainLabel = "Main chat",
  goalLineageTaskIds?: Iterable<string>,
  taskIdAliases: Readonly<Record<string, string>> = {},
): FeedCanvasLayoutV1 {
  if (!value || typeof value !== "object") {
    return createDefaultFeedCanvasLayout(goalId, mainLabel);
  }

  const candidate = value as Partial<FeedCanvasLayoutV1>;
  if (candidate.version !== FEED_CANVAS_VERSION || candidate.goalId !== goalId || !Array.isArray(candidate.columns)) {
    return createDefaultFeedCanvasLayout(goalId, mainLabel);
  }

  const allowedTasks = validTaskIds ? new Set(validTaskIds) : null;
  const goalLineage = new Set([goalId, ...(goalLineageTaskIds ?? [])]);
  const seenColumns = new Set<string>();
  const seenPanels = new Set<string>();
  const seenSingletonTypes = new Set<FeedPanelType>();
  const seenChatTaskIds = new Set<string>();
  let seenPrimaryChat = false;
  const columns: FeedCanvasColumn[] = [];

  for (const rawColumn of candidate.columns) {
    if (!rawColumn || typeof rawColumn !== "object" || !isSafeLayoutId(rawColumn.id) || seenColumns.has(rawColumn.id)) continue;
    seenColumns.add(rawColumn.id);
    const panels: FeedCanvasPanel[] = [];
    for (const rawPanel of Array.isArray(rawColumn.panels) ? rawColumn.panels : []) {
      if (!rawPanel || typeof rawPanel !== "object") continue;
      if (!isSafeLayoutId(rawPanel.id) || seenPanels.has(rawPanel.id)) continue;
      if (!PANEL_TYPES.has(rawPanel.type as FeedPanelType)) continue;

      const rawResource = rawPanel.resource && typeof rawPanel.resource === "object"
        ? rawPanel.resource
        : null;
      let resource: FeedPanelResource | undefined = rawResource
        ? {
            ...(typeof rawResource.taskId === "string" ? { taskId: rawResource.taskId } : {}),
            ...(typeof rawResource.relativePath === "string" ? { relativePath: rawResource.relativePath } : {}),
            ...(typeof rawResource.navigationKey === "string" && isSafeLayoutId(rawResource.navigationKey)
              ? { navigationKey: rawResource.navigationKey }
              : {}),
            ...(typeof rawResource.planVersionId === "string" && isSafeLayoutId(rawResource.planVersionId)
              ? { planVersionId: rawResource.planVersionId }
              : {}),
            ...(typeof rawResource.clientId === "string" || rawResource.clientId === null
              ? { clientId: rawResource.clientId }
              : {}),
            ...(rawResource.primary === true ? { primary: true } : {}),
          }
        : undefined;
      const panelType = rawPanel.type as FeedPanelType;
      if (resource?.taskId && allowedTasks && !allowedTasks.has(resource.taskId)) continue;
      if (resource?.relativePath && !isSafeRelativePath(resource.relativePath)) continue;
      // Terminal remains visible in the add-panel menu as Coming soon, but is
      // intentionally unavailable inside Goals. Remove stale saved panels too.
      if (panelType === "terminal") continue;
      // Generic Chat panels from the old add-panel menu duplicate the main
      // conversation. Task-backed Chat panels are pinned subchats and remain valid.
      if (panelType === "chat" && !resource?.primary && !resource?.taskId) continue;
      if (panelType === "chat" && resource?.primary) {
        if (seenPrimaryChat) continue;
        seenPrimaryChat = true;
        if (resource.taskId) {
          const canonicalTaskId = taskIdAliases[resource.taskId] ?? resource.taskId;
          resource = {
            ...resource,
            taskId: goalLineage.has(resource.taskId) || goalLineage.has(canonicalTaskId)
              ? goalId
              : canonicalTaskId,
            primary: true,
          };
        }
      } else if (panelType === "chat" && resource?.taskId) {
        const canonicalTaskId = taskIdAliases[resource.taskId] ?? resource.taskId;
        if (goalLineage.has(resource.taskId) || goalLineage.has(canonicalTaskId)) continue;
        if (seenChatTaskIds.has(canonicalTaskId)) continue;
        seenChatTaskIds.add(canonicalTaskId);
        resource = { ...resource, taskId: canonicalTaskId };
      }
      if (isSingletonFeedPanelType(panelType)) {
        if (seenSingletonTypes.has(panelType)) continue;
        seenSingletonTypes.add(panelType);
      }

      seenPanels.add(rawPanel.id);
      panels.push({
        id: rawPanel.id,
        type: panelType,
        label: typeof rawPanel.label === "string" && rawPanel.label.trim()
          ? rawPanel.label.trim()
          : rawPanel.type === "terminal" ? "Terminal" : "Chat",
        heightWeight: positiveWeight(rawPanel.heightWeight),
        resource,
      });
    }
    if (panels.length > 0) {
      columns.push({ id: rawColumn.id, widthWeight: positiveWeight(rawColumn.widthWeight), panels });
    }
  }

  if (columns.length === 0) return createDefaultFeedCanvasLayout(goalId, mainLabel);
  const fallbackActive = columns
    .flatMap((column) => column.panels)
    .find((panel) => panel.type === "chat" && panel.resource?.primary)?.id
    ?? columns[0].panels[0].id;
  const activePanelId = typeof candidate.activePanelId === "string" && seenPanels.has(candidate.activePanelId)
    ? candidate.activePanelId
    : fallbackActive;
  return normalizeFeedCanvasLayout({
    version: FEED_CANVAS_VERSION,
    goalId,
    columns,
    activePanelId,
  });
}

function legacyPaneToCanvasPanel(
  paneId: string,
  legacy: LegacyPaneState,
  goalId: string,
  mainLabel: string,
): FeedCanvasPanel | null {
  if (paneId === "main-chat") return createMainChatPanel(goalId, mainLabel);
  const pane = legacy.openPanes?.find((candidate) => candidate.id === paneId);
  if (!pane || (pane.type !== "chat" && pane.type !== "terminal")) return null;
  if (pane.type === "terminal") return null;
  return {
    id: pane.id,
    type: "chat",
    label: pane.label?.trim() || "Chat",
    heightWeight: 1,
    resource: pane.taskId ? { taskId: pane.taskId } : undefined,
  };
}

export function migrateLegacyPaneState(
  value: unknown,
  goalId: string,
  mainLabel = "Main chat",
): FeedCanvasLayoutV1 | null {
  if (!value || typeof value !== "object") return null;
  const legacy = value as LegacyPaneState;
  const visibleIds = Array.isArray(legacy.visiblePaneIds)
    ? legacy.visiblePaneIds
    : legacy.splitGroup
      ? ["main-chat", ...legacy.splitGroup]
      : ["main-chat"];
  const panels = visibleIds
    .map((paneId) => legacyPaneToCanvasPanel(paneId, legacy, goalId, mainLabel))
    .filter((panel): panel is FeedCanvasPanel => Boolean(panel));
  if (panels.length === 0) return null;

  let columns: FeedCanvasColumn[];
  if (legacy.layout === "grid") {
    if (panels.length <= 2) {
      columns = [{ id: "column-legacy-1", widthWeight: 1, panels }];
    } else {
      columns = [
        { id: "column-legacy-1", widthWeight: 1, panels: panels.filter((_, index) => index % 2 === 0) },
        { id: "column-legacy-2", widthWeight: 1, panels: panels.filter((_, index) => index % 2 === 1) },
      ];
    }
  } else {
    columns = panels.map((panel, index) => ({
      id: `column-legacy-${index + 1}`,
      widthWeight: 1,
      panels: [panel],
    }));
  }

  const panelIds = new Set(panels.map((panel) => panel.id));
  return normalizeFeedCanvasLayout({
    version: FEED_CANVAS_VERSION,
    goalId,
    columns,
    activePanelId: legacy.activePaneId && panelIds.has(legacy.activePaneId)
      ? legacy.activePaneId
      : panels[0].id,
  });
}

function removePanelFromColumns(columns: FeedCanvasColumn[], panelId: string) {
  let removed: FeedCanvasPanel | null = null;
  const next = columns.flatMap((column) => {
    const panels = column.panels.filter((panel) => {
      if (panel.id !== panelId) return true;
      removed = panel;
      return false;
    });
    return panels.length > 0 ? [{ ...column, panels }] : [];
  });
  return { columns: next, removed: removed as FeedCanvasPanel | null };
}

export function feedCanvasReducer(
  layout: FeedCanvasLayoutV1,
  action: FeedCanvasAction,
): FeedCanvasLayoutV1 {
  if (action.type === "focus-panel") {
    const exists = layout.columns.some((column) => column.panels.some((panel) => panel.id === action.panelId));
    if (!exists || layout.activePanelId === action.panelId) return layout;
    return { ...layout, activePanelId: action.panelId };
  }

  if (action.type === "add-panel") {
    if (layout.columns.some((column) => column.panels.some((panel) => panel.id === action.panel.id))) return layout;
    if (action.panel.type === "chat" && action.panel.resource?.primary) {
      const existing = layout.columns
        .flatMap((column) => column.panels)
        .find((panel) => panel.type === "chat" && panel.resource?.primary);
      if (existing) {
        return layout.activePanelId === existing.id ? layout : { ...layout, activePanelId: existing.id };
      }
    }
    if (isSingletonFeedPanelType(action.panel.type)) {
      const existing = layout.columns
        .flatMap((column) => column.panels)
        .find((panel) => panel.type === action.panel.type);
      if (existing) {
        return layout.activePanelId === existing.id ? layout : { ...layout, activePanelId: existing.id };
      }
    }
    const afterIndex = action.afterColumnId
      ? layout.columns.findIndex((column) => column.id === action.afterColumnId)
      : layout.columns.length - 1;
    const insertAt = afterIndex >= 0 ? afterIndex + 1 : layout.columns.length;
    const columns = [...layout.columns];
    const averageWidth = layout.columns.length > 0
      ? layout.columns.reduce((sum, column) => sum + column.widthWeight, 0) / layout.columns.length
      : 1;
    columns.splice(insertAt, 0, {
      id: `column-${action.panel.id}`,
      widthWeight: averageWidth,
      panels: [{ ...action.panel, heightWeight: 1 }],
    });
    return normalizeFeedCanvasLayout({ ...layout, columns, activePanelId: action.panel.id });
  }

  if (action.type === "remove-panel") {
    const { columns, removed } = removePanelFromColumns(layout.columns, action.panelId);
    if (!removed) return layout;
    if (columns.length === 0) return createDefaultFeedCanvasLayout(layout.goalId, action.mainLabel);
    const activePanelId = layout.activePanelId === action.panelId
      ? columns[0].panels[0].id
      : layout.activePanelId;
    return normalizeFeedCanvasLayout({ ...layout, columns, activePanelId });
  }

  if (action.type === "move-panel") {
    const sourceColumnIndex = layout.columns.findIndex((column) =>
      column.panels.some((panel) => panel.id === action.panelId),
    );
    if (sourceColumnIndex < 0) return layout;
    const sourceColumn = layout.columns[sourceColumnIndex];
    const sourcePanelIndex = sourceColumn.panels.findIndex((panel) => panel.id === action.panelId);
    const sourceColumnWillBeRemoved = sourceColumn.panels.length === 1;

    if (action.target.kind === "column"
      && sourceColumnWillBeRemoved
      && (action.target.index === sourceColumnIndex || action.target.index === sourceColumnIndex + 1)) {
      return layout;
    }
    if (action.target.kind === "stack"
      && action.target.columnId === sourceColumn.id
      && (action.target.index === sourcePanelIndex || action.target.index === sourcePanelIndex + 1)) {
      return layout;
    }

    const { columns: withoutSource, removed } = removePanelFromColumns(layout.columns, action.panelId);
    if (!removed) return layout;
    const columns = withoutSource.map((column) => ({ ...column, panels: [...column.panels] }));

    if (action.target.kind === "column") {
      const adjustedIndex = sourceColumnWillBeRemoved && sourceColumnIndex < action.target.index
        ? action.target.index - 1
        : action.target.index;
      const insertAt = Math.max(0, Math.min(columns.length, adjustedIndex));
      const referenceColumn = columns[Math.min(insertAt, columns.length - 1)];
      columns.splice(insertAt, 0, {
        id: sourceColumnWillBeRemoved ? sourceColumn.id : `column-${removed.id}`,
        widthWeight: referenceColumn?.widthWeight ?? sourceColumn.widthWeight,
        panels: [{ ...removed, heightWeight: 1 }],
      });
    } else {
      const target = action.target;
      const targetColumnIndex = columns.findIndex((column) => column.id === target.columnId);
      if (targetColumnIndex < 0) return layout;
      const targetColumn = columns[targetColumnIndex];
      const adjustedIndex = target.columnId === sourceColumn.id && sourcePanelIndex < target.index
        ? target.index - 1
        : target.index;
      const insertAt = Math.max(0, Math.min(targetColumn.panels.length, adjustedIndex));
      targetColumn.panels.splice(insertAt, 0, { ...removed, heightWeight: 1 });
    }
    return normalizeFeedCanvasLayout({ ...layout, columns, activePanelId: removed.id });
  }

  if (action.type === "set-column-weights") {
    return normalizeFeedCanvasLayout({
      ...layout,
      columns: layout.columns.map((column) => {
        if (column.id === action.firstColumnId) return { ...column, widthWeight: positiveWeight(action.firstWeight) };
        if (column.id === action.secondColumnId) return { ...column, widthWeight: positiveWeight(action.secondWeight) };
        return column;
      }),
    });
  }

  if (action.type === "set-panel-weights") {
    return normalizeFeedCanvasLayout({
      ...layout,
      columns: layout.columns.map((column) => column.id === action.columnId
        ? {
            ...column,
            panels: column.panels.map((panel) => {
              if (panel.id === action.firstPanelId) return { ...panel, heightWeight: positiveWeight(action.firstWeight) };
              if (panel.id === action.secondPanelId) return { ...panel, heightWeight: positiveWeight(action.secondWeight) };
              return panel;
            }),
          }
        : column),
    });
  }

  if (action.type === "rename-panel") {
    const label = action.label.trim();
    if (!label) return layout;
    return {
      ...layout,
      columns: layout.columns.map((column) => ({
        ...column,
        panels: column.panels.map((panel) => panel.id === action.panelId ? { ...panel, label } : panel),
      })),
    };
  }

  if (action.type === "assign-task") {
    return {
      ...layout,
      columns: layout.columns.map((column) => ({
        ...column,
        panels: column.panels.map((panel) => panel.id === action.panelId
          ? {
              ...panel,
              ...(action.label?.trim() ? { label: action.label.trim() } : {}),
              resource: action.taskId
                ? { ...panel.resource, taskId: action.taskId }
                : Object.fromEntries(
                    Object.entries(panel.resource ?? {}).filter(([key]) => key !== "taskId"),
                  ),
            }
          : panel),
      })),
    };
  }

  if (action.type === "set-panel-resource") {
    return {
      ...layout,
      columns: layout.columns.map((column) => ({
        ...column,
        panels: column.panels.map((panel) => panel.id === action.panelId
          ? { ...panel, resource: { ...panel.resource, ...action.resource } }
          : panel),
      })),
    };
  }

  return layout;
}

export function flattenFeedCanvasPanels(layout: FeedCanvasLayoutV1): FeedCanvasPanel[] {
  return layout.columns.flatMap((column) => column.panels);
}
