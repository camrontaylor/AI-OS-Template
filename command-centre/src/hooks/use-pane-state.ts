"use client";

import { useState, useCallback, useMemo, useEffect, useRef } from "react";

export const MAIN_PANE_ID = "main-chat";
export const MAX_VISIBLE = 4;

export type PaneLayout = "horizontal" | "grid";

export interface PaneItem {
  id: string;
  type: "chat" | "terminal";
  label: string;
  taskId?: string;
}

export interface PaneState {
  openPanes: PaneItem[];          // All extra panes (unlimited)
  visiblePaneIds: string[];       // Which are in the viewport (max 4, includes MAIN_PANE_ID)
  activePaneId: string;           // Which has focus
  layout: PaneLayout;
  sidebarCollapsed: boolean;
}

const INITIAL_STATE: PaneState = {
  openPanes: [],
  visiblePaneIds: [MAIN_PANE_ID],
  activePaneId: MAIN_PANE_ID,
  layout: "horizontal",
  sidebarCollapsed: false,
};

const STORAGE_PREFIX = "panes:";

function ensureNotEmpty(state: PaneState): PaneState {
  // Viewport must have at least one pane — fall back to main chat if empty
  if (state.visiblePaneIds.length === 0) {
    return { ...state, visiblePaneIds: [MAIN_PANE_ID], activePaneId: MAIN_PANE_ID };
  }
  return state;
}

function loadPersistedState(key: string): PaneState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed.openPanes)) return null;
    // Migrate from old splitGroup-based state
    if (!Array.isArray(parsed.visiblePaneIds)) {
      const sg = parsed.splitGroup as [string, string] | null;
      return ensureNotEmpty({
        openPanes: parsed.openPanes,
        visiblePaneIds: sg ? [MAIN_PANE_ID, ...sg] : [MAIN_PANE_ID],
        activePaneId: parsed.activePaneId ?? MAIN_PANE_ID,
        layout: parsed.layout ?? "horizontal",
        sidebarCollapsed: parsed.sidebarCollapsed ?? false,
      });
    }
    return ensureNotEmpty(parsed as PaneState);
  } catch {
    return null;
  }
}

function persistState(key: string, state: PaneState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(state));
  } catch {}
}

let paneCounter = Date.now();

export function usePaneState(persistKey?: string) {
  const [paneState, setPaneState] = useState<PaneState>(() => {
    if (persistKey) {
      return loadPersistedState(persistKey) ?? INITIAL_STATE;
    }
    return INITIAL_STATE;
  });

  const prevKeyRef = useRef(persistKey);
  useEffect(() => {
    if (persistKey !== prevKeyRef.current) {
      prevKeyRef.current = persistKey;
      if (persistKey) {
        setPaneState(loadPersistedState(persistKey) ?? INITIAL_STATE);
      } else {
        setPaneState(INITIAL_STATE);
      }
    }
  }, [persistKey]);

  useEffect(() => {
    if (persistKey) {
      persistState(persistKey, paneState);
    }
  }, [persistKey, paneState]);

  const openPaneIds = useMemo(
    () => paneState.openPanes.map((p) => p.id),
    [paneState.openPanes],
  );

  // Main chat is solo when it's the only visible pane
  const isMainChatSolo = paneState.visiblePaneIds.length === 1
    && paneState.visiblePaneIds[0] === MAIN_PANE_ID;

  // Resolved visible panes — MAIN_PANE_ID becomes a virtual PaneItem
  const visiblePanes = useMemo(
    () => paneState.visiblePaneIds
      .map((id) => {
        if (id === MAIN_PANE_ID) {
          return { id: MAIN_PANE_ID, type: "chat" as const, label: "" }; // label set by parent
        }
        return paneState.openPanes.find((p) => p.id === id);
      })
      .filter(Boolean) as PaneItem[],
    [paneState.visiblePaneIds, paneState.openPanes],
  );

  /** Add a pane to openPanes, or focus it if already open */
  const handleOpenPane = useCallback((paneItem: PaneItem) => {
    setPaneState((prev) => {
      if (prev.openPanes.some((p) => p.id === paneItem.id)) {
        return { ...prev, activePaneId: paneItem.id, sidebarCollapsed: false };
      }
      return {
        ...prev,
        openPanes: [...prev.openPanes, paneItem],
        activePaneId: paneItem.id,
        sidebarCollapsed: false,
      };
    });
  }, []);

  /** Open a new chat pane (added to list, NOT to viewport) */
  const handleOpenChat = useCallback((label = "Chat") => {
    const id = `chat-${++paneCounter}`;
    handleOpenPane({ id, type: "chat", label });
    return id;
  }, [handleOpenPane]);

  /** Open a new terminal pane — added to viewport alongside main chat */
  const handleOpenTerminal = useCallback((label = "Terminal") => {
    const id = `terminal-${++paneCounter}`;
    setPaneState((prev) => {
      const pane: PaneItem = { id, type: "terminal", label };
      let vis = prev.visiblePaneIds;
      if (!vis.includes(MAIN_PANE_ID)) {
        vis = [MAIN_PANE_ID, ...vis];
      }
      return {
        ...prev,
        openPanes: [...prev.openPanes, pane],
        visiblePaneIds: [...vis, id].slice(0, MAX_VISIBLE),
        activePaneId: id,
        sidebarCollapsed: false,
      };
    });
    return id;
  }, []);

  /** Open a chat pane for a specific subtask — always forces it into the viewport */
  const handleOpenSubtaskPane = useCallback((taskId: string, label: string) => {
    setPaneState((prev) => {
      const existing = prev.openPanes.find((p) => p.taskId === taskId);
      const paneId = existing?.id ?? `subtask-${++paneCounter}`;
      const pane: PaneItem = existing ?? { id: paneId, type: "chat", label, taskId };
      const newOpenPanes = existing ? prev.openPanes : [...prev.openPanes, pane];

      // Force the pane into the viewport — evict oldest non-main pane if full
      let newVisible = prev.visiblePaneIds;
      if (!newVisible.includes(paneId)) {
        if (newVisible.length >= MAX_VISIBLE) {
          // Evict the last non-main pane to make room
          const evictIdx = [...newVisible].reverse().findIndex((id) => id !== MAIN_PANE_ID);
          if (evictIdx >= 0) {
            const realIdx = newVisible.length - 1 - evictIdx;
            newVisible = [...newVisible.slice(0, realIdx), ...newVisible.slice(realIdx + 1), paneId];
          }
        } else {
          newVisible = [...newVisible, paneId];
        }
      }

      return {
        ...prev,
        openPanes: newOpenPanes,
        visiblePaneIds: newVisible,
        activePaneId: paneId,
        sidebarCollapsed: false,
      };
    });
  }, []);

  /** Add a pane to the viewport alongside whatever's already visible. */
  const handleAddToViewport = useCallback((paneId: string) => {
    setPaneState((prev) => {
      if (prev.visiblePaneIds.includes(paneId)) {
        return { ...prev, activePaneId: paneId };
      }
      // Must be MAIN_PANE_ID or in openPanes
      if (paneId !== MAIN_PANE_ID && !prev.openPanes.some((p) => p.id === paneId)) return prev;
      if (prev.visiblePaneIds.length >= MAX_VISIBLE) return prev;
      return {
        ...prev,
        visiblePaneIds: [...prev.visiblePaneIds, paneId],
        activePaneId: paneId,
      };
    });
  }, []);

  /** Click a pane in sidebar — show it solo in the viewport (alongside main chat if it IS main) */
  const handleFocusPane = useCallback((paneId: string) => {
    setPaneState((prev) => {
      if (prev.visiblePaneIds.includes(paneId)) {
        return { ...prev, activePaneId: paneId };
      }
      // Show solo — but if it's not the main chat, keep main chat visible too? No — solo means solo.
      return { ...prev, visiblePaneIds: [paneId], activePaneId: paneId };
    });
  }, []);

  /** Focus the main chat solo */
  const handleFocusMainChat = useCallback(() => {
    setPaneState((prev) => ({ ...prev, visiblePaneIds: [MAIN_PANE_ID], activePaneId: MAIN_PANE_ID }));
  }, []);

  /** Split: open a new empty chat alongside the current viewport */
  const handleSplitWithNew = useCallback(() => {
    setPaneState((prev) => {
      if (prev.visiblePaneIds.length >= MAX_VISIBLE) return prev;
      const id = `chat-${++paneCounter}`;
      const pane: PaneItem = { id, type: "chat", label: "Chat" };
      return {
        ...prev,
        openPanes: [...prev.openPanes, pane],
        visiblePaneIds: [...prev.visiblePaneIds, id],
        activePaneId: id,
        sidebarCollapsed: false,
      };
    });
  }, []);

  /** Toggle layout */
  const handleSetLayout = useCallback((layout: PaneLayout) => {
    setPaneState((prev) => ({ ...prev, layout }));
  }, []);

  /** Close pane from viewport X — remove from viewport, keep in openPanes.
   *  If it's the last pane, show main chat solo. */
  const handleClosePane = useCallback((paneId: string) => {
    setPaneState((prev) => {
      const newVisible = prev.visiblePaneIds.filter((id) => id !== paneId);
      // If viewport would be empty, fall back to main chat
      const safeVisible = newVisible.length > 0 ? newVisible : [MAIN_PANE_ID];
      const newActive = prev.activePaneId === paneId
        ? safeVisible[0]
        : prev.activePaneId;
      return { ...prev, visiblePaneIds: safeVisible, activePaneId: newActive };
    });
  }, []);

  /** Fully remove a pane from everything (sidebar trash action) */
  const handleRemovePane = useCallback((paneId: string) => {
    if (paneId === MAIN_PANE_ID) return;
    setPaneState((prev) => {
      const newOpen = prev.openPanes.filter((p) => p.id !== paneId);
      const newVisible = prev.visiblePaneIds.filter((id) => id !== paneId);
      const safeVisible = newVisible.length > 0 ? newVisible : [MAIN_PANE_ID];
      const newActive = prev.activePaneId === paneId
        ? safeVisible[0]
        : prev.activePaneId;
      return { ...prev, openPanes: newOpen, visiblePaneIds: safeVisible, activePaneId: newActive };
    });
  }, []);

  const handleToggleSidebar = useCallback(() => {
    setPaneState((prev) => ({ ...prev, sidebarCollapsed: !prev.sidebarCollapsed }));
  }, []);

  /** Collapse to main — keeps panes in the sidebar list */
  const handleCloseAllPanes = useCallback(() => {
    setPaneState((prev) => ({
      ...prev,
      visiblePaneIds: [MAIN_PANE_ID],
      activePaneId: MAIN_PANE_ID,
    }));
  }, []);

  const handleRenamePane = useCallback((paneId: string, newLabel: string) => {
    if (paneId === MAIN_PANE_ID) return;
    setPaneState((prev) => ({
      ...prev,
      openPanes: prev.openPanes.map((p) =>
        p.id === paneId ? { ...p, label: newLabel } : p,
      ),
    }));
  }, []);

  const handleAssignTaskToPane = useCallback((paneId: string, taskId: string) => {
    setPaneState((prev) => ({
      ...prev,
      openPanes: prev.openPanes.map((p) =>
        p.id === paneId ? { ...p, taskId } : p,
      ),
    }));
  }, []);

  const resetPaneState = useCallback(() => {
    setPaneState(INITIAL_STATE);
    if (persistKey) {
      try { localStorage.removeItem(STORAGE_PREFIX + persistKey); } catch {}
    }
  }, [persistKey]);

  return {
    paneState,
    openPaneIds,
    visiblePanes,
    isMainChatSolo,
    hasPanesOpen: paneState.openPanes.length > 0,
    handleOpenPane,
    handleOpenChat,
    handleOpenTerminal,
    handleOpenSubtaskPane,
    handleAddToViewport,
    handleClosePane,
    handleRemovePane,
    handleFocusPane,
    handleFocusMainChat,
    handleSplitWithNew,
    handleSetLayout,
    handleToggleSidebar,
    handleCloseAllPanes,
    handleRenamePane,
    handleAssignTaskToPane,
    resetPaneState,
  };
}
