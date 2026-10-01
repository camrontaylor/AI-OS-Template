"use client";

import {
  Files,
  GitCompareArrows,
  ListTree,
  MessageSquare,
  PanelsTopLeft,
  ScrollText,
  TerminalSquare,
  X,
} from "lucide-react";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import {
  FEED_CANVAS_GAP,
  FEED_CANVAS_DROP_INDICATOR_SIZE,
  type FeedCanvasColumn,
  type FeedCanvasDropTarget,
  type FeedCanvasLayoutV1,
  type FeedCanvasPanel,
} from "./feed-canvas-state";
import {
  computeFeedCanvasDropTarget,
  type FeedCanvasDragGeometry,
  type FeedCanvasDragSource,
} from "./feed-canvas-drag";
import { computeFeedCanvasResizePair } from "./feed-canvas-resize";
import { FEED_PANEL_REGISTRY } from "./feed-panel-registry";
import { flattenFeedCanvasPanels } from "./feed-canvas-state";

const PANEL_ICONS = {
  chat: MessageSquare,
  terminal: TerminalSquare,
  subchats: ListTree,
  file: ScrollText,
  files: Files,
  plan: PanelsTopLeft,
  changes: GitCompareArrows,
};

const FeedPanelHeaderActionsContext = createContext<HTMLElement | null>(null);

interface FrozenDocumentWidth {
  element: HTMLElement;
  width: string;
  minWidth: string;
  maxWidth: string;
  contain: string;
}

function freezeColumnDocuments(root: HTMLElement, columnIds: Set<string>): FrozenDocumentWidth[] {
  const documents = Array.from(root.querySelectorAll<HTMLElement>("[data-feed-column-slot]"))
    .filter((slot) => columnIds.has(slot.dataset.feedColumnSlot ?? ""))
    .flatMap((slot) => Array.from(slot.querySelectorAll<HTMLElement>(".cc-feed-document")));
  return [...new Set(documents)].map((element) => {
    const frozen = {
      element,
      width: element.style.width,
      minWidth: element.style.minWidth,
      maxWidth: element.style.maxWidth,
      contain: element.style.contain,
    };
    const width = element.getBoundingClientRect().width;
    element.style.width = `${width}px`;
    element.style.minWidth = `${width}px`;
    element.style.maxWidth = "none";
    element.style.contain = "layout paint style";
    return frozen;
  });
}

function restoreFrozenDocuments(documents: FrozenDocumentWidth[]) {
  for (const frozen of documents) {
    frozen.element.style.width = frozen.width;
    frozen.element.style.minWidth = frozen.minWidth;
    frozen.element.style.maxWidth = frozen.maxWidth;
    frozen.element.style.contain = frozen.contain;
  }
}

export function FeedPanelHeaderActions({ children }: { children: ReactNode }) {
  const host = useContext(FeedPanelHeaderActionsContext);
  return host ? createPortal(children, host) : null;
}

interface FeedCanvasProps {
  layout: FeedCanvasLayoutV1;
  onClosePanel: (panelId: string) => void;
  onFocusPanel: (panelId: string) => void;
  onMovePanel: (
    panelId: string,
    target: FeedCanvasDropTarget,
  ) => void;
  onSetColumnWeights: (
    firstColumnId: string,
    firstWeight: number,
    secondColumnId: string,
    secondWeight: number,
  ) => void;
  onSetPanelWeights: (
    columnId: string,
    firstPanelId: string,
    firstWeight: number,
    secondPanelId: string,
    secondWeight: number,
  ) => void;
  renderPanel: (panel: FeedCanvasPanel, active: boolean) => ReactNode;
  renderPanelActions?: (panel: FeedCanvasPanel) => ReactNode;
  flashPanelId?: string | null;
  readOnly?: boolean;
}

function CanvasPanel({
  panel,
  active,
  onFocus,
  onClose,
  children,
  headerActions,
  flashing = false,
  readOnly = false,
  dragging = false,
  onDragPointerDown,
}: {
  panel: FeedCanvasPanel;
  active: boolean;
  onFocus: () => void;
  onClose: () => void;
  children: ReactNode;
  headerActions?: ReactNode;
  flashing?: boolean;
  readOnly?: boolean;
  dragging?: boolean;
  onDragPointerDown?: (event: PointerEvent<HTMLElement>) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const [portalActionsHost, setPortalActionsHost] = useState<HTMLDivElement | null>(null);
  const descriptor = FEED_PANEL_REGISTRY[panel.type];
  const Icon = PANEL_ICONS[descriptor.icon];
  return (
    <article
      data-feed-panel={panel.id}
      tabIndex={-1}
      aria-label={`${panel.label} panel`}
      style={{
        display: "flex",
        flexDirection: "column",
        minWidth: 0,
        minHeight: 0,
        height: "100%",
        overflow: "hidden",
        position: "relative",
        background: "var(--cc-surface)",
        border: flashing ? "1px solid var(--cc-brand-alpha-45)" : "1px solid var(--cc-line-alpha-40)",
        borderRadius: 10,
        opacity: dragging ? 0.35 : 1,
        transition: dragging ? undefined : "border-color 120ms ease, background 120ms ease, box-shadow 120ms ease",
        outline: focusWithin && active ? "2px solid var(--cc-brand-alpha-35)" : "none",
        outlineOffset: -2,
        boxShadow: flashing ? "0 0 0 3px var(--cc-brand-alpha-12)" : "none",
      }}
      onPointerDown={onFocus}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <header
        aria-label={`Move ${panel.label}`}
        title={readOnly ? panel.label : `Drag to move ${panel.label}`}
        onPointerDown={readOnly ? undefined : onDragPointerDown}
        style={{
          height: 34,
          flex: "0 0 34px",
          display: "flex",
          alignItems: "center",
          gap: 7,
          padding: "0 5px 0 12px",
          borderBottom: "1px solid var(--cc-line-alpha-25)",
          background: "var(--cc-surface-raised)",
          cursor: readOnly ? "default" : dragging ? "grabbing" : "grab",
          userSelect: "none",
          touchAction: "none",
        }}
      >
        <Icon size={13} aria-hidden style={{ color: "var(--cc-text-tertiary)", flex: "0 0 auto" }} />
        <span
          title={panel.label}
          style={{
            flex: 1,
            minWidth: 0,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            fontFamily: "var(--cc-font-label)",
            fontSize: "var(--cc-feed-type-panel)",
            fontWeight: 600,
            letterSpacing: ".02em",
            color: "var(--cc-text-secondary)",
            cursor: readOnly ? "default" : "grab",
          }}
        >
          {panel.label}
        </span>
        {headerActions ? (
          <div style={{ display: "flex", alignItems: "center", opacity: hovered || focusWithin ? 1 : 0, transition: "opacity 120ms ease" }}>
            {headerActions}
          </div>
        ) : null}
        <div
          ref={setPortalActionsHost}
          style={{ display: "flex", alignItems: "center", gap: 2 }}
          onPointerDown={(event) => event.stopPropagation()}
        />
        {!readOnly ? <button
          type="button"
          aria-label={`Close ${panel.label}`}
          title={`Close ${panel.label}`}
          onClick={(event) => {
            event.stopPropagation();
            onClose();
          }}
          onPointerDown={(event) => event.stopPropagation()}
          style={{
            width: 24,
            height: 24,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--cc-text-disabled)",
            background: "transparent",
            border: 0,
            borderRadius: 4,
            cursor: "pointer",
          }}
        >
          <X size={13} />
        </button> : null}
      </header>
      <div
        data-feed-panel-body
        style={{
          flex: 1,
          minHeight: 0,
          minWidth: 0,
          overflow: "hidden",
          display: "flex",
          flexDirection: "column",
        }}
      >
        <FeedPanelHeaderActionsContext.Provider value={portalActionsHost}>
          {children}
        </FeedPanelHeaderActionsContext.Provider>
      </div>
    </article>
  );
}

function ResizeHandle({ orientation, onPointerDown }: {
  orientation: "horizontal" | "vertical";
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      role="separator"
      aria-orientation={horizontal ? "vertical" : "horizontal"}
      aria-label={horizontal ? "Resize columns" : "Resize panels"}
      tabIndex={0}
      onPointerDown={onPointerDown}
      style={{
        flex: horizontal ? "0 0 8px" : "0 0 8px",
        width: horizontal ? 8 : "100%",
        height: horizontal ? "100%" : 8,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        cursor: horizontal ? "col-resize" : "row-resize",
        touchAction: "none",
        zIndex: 5,
      }}
    >
      <span
        style={{
          width: horizontal ? 2 : 28,
          height: horizontal ? 28 : 2,
          borderRadius: 2,
          background: "var(--cc-line-alpha-40)",
        }}
      />
    </div>
  );
}

export function FeedCanvas({
  layout,
  onClosePanel,
  onFocusPanel,
  onMovePanel,
  onSetColumnWeights,
  onSetPanelWeights,
  renderPanel,
  renderPanelActions,
  flashPanelId = null,
  readOnly = false,
}: FeedCanvasProps) {
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement>(null);
  const innerCanvasRef = useRef<HTMLDivElement>(null);
  const dragGhostRef = useRef<HTMLDivElement>(null);
  const dropIndicatorRef = useRef<HTMLSpanElement>(null);
  const dragFrameRef = useRef<number | null>(null);
  const dragCleanupRef = useRef<(() => void) | null>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const dragRuntimeRef = useRef<{
    panelId: string;
    source: FeedCanvasDragSource;
    geometry: FeedCanvasDragGeometry;
    target: FeedCanvasDropTarget | null;
  } | null>(null);
  const panels = useMemo(() => layout.columns.flatMap((column) => column.panels), [layout.columns]);
  const allPanels = useMemo(() => flattenFeedCanvasPanels(layout), [layout]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section || readOnly) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      const activePanel = layout.activePanelId;
      const currentIndex = allPanels.findIndex((p) => p.id === activePanel);

      if (event.key === "Escape") {
        event.preventDefault();
        if (activePanel) {
          const panel = allPanels.find((p) => p.id === activePanel);
          if (panel) {
            onClosePanel(activePanel);
          }
        }
      }
    };

    section.addEventListener("keydown", handleKeyDown);
    return () => section.removeEventListener("keydown", handleKeyDown);
  }, [layout.activePanelId, allPanels, readOnly, onClosePanel]);

  const geometry = useMemo(() => {
    let columnOffset = 0;
    return layout.columns.flatMap((column, columnIndex) => {
      let panelOffset = 0;
      const items = column.panels.map((panel, panelIndex) => {
        const item = {
          column,
          columnIndex,
          panel,
          panelIndex,
          left: columnOffset,
          top: panelOffset,
        };
        panelOffset += panel.heightWeight;
        return item;
      });
      columnOffset += column.widthWeight;
      return items;
    });
  }, [layout.columns]);

  const captureDragGeometry = useCallback((panelId: string) => {
    const inner = innerCanvasRef.current;
    if (!inner) return null;
    const innerRect = inner.getBoundingClientRect();
    const columns = layout.columns.map((column) => {
      const panelRects = column.panels.flatMap((panel) => {
        const element = inner.querySelector<HTMLElement>(`[data-feed-panel="${panel.id}"]`);
        if (!element) return [];
        const rect = element.getBoundingClientRect();
        return [{ id: panel.id, top: rect.top, bottom: rect.bottom, left: rect.left, right: rect.right }];
      });
      return {
        id: column.id,
        left: panelRects[0]?.left ?? innerRect.left,
        right: panelRects[0]?.right ?? innerRect.right,
        top: innerRect.top,
        bottom: innerRect.bottom,
        panels: panelRects.map(({ id, top, bottom }) => ({ id, top, bottom })),
      };
    });
    const sourceColumnIndex = layout.columns.findIndex((column) => column.panels.some((panel) => panel.id === panelId));
    if (sourceColumnIndex < 0 || columns.length === 0) return null;
    const sourceColumn = layout.columns[sourceColumnIndex];
    const source: FeedCanvasDragSource = {
      columnId: sourceColumn.id,
      columnIndex: sourceColumnIndex,
      panelIndex: sourceColumn.panels.findIndex((panel) => panel.id === panelId),
      columnPanelCount: sourceColumn.panels.length,
    };
    const boundaries = [columns[0].left];
    for (let index = 0; index < columns.length - 1; index += 1) {
      boundaries.push((columns[index].right + columns[index + 1].left) / 2);
    }
    boundaries.push(columns[columns.length - 1].right);
    return { geometry: { columns, boundaries }, source };
  }, [layout.columns]);

  const hideDragDecorations = useCallback(() => {
    if (dragGhostRef.current) dragGhostRef.current.style.display = "none";
    if (dropIndicatorRef.current) dropIndicatorRef.current.style.display = "none";
  }, []);

  const paintDragFrame = useCallback((clientX: number, clientY: number) => {
    const runtime = dragRuntimeRef.current;
    const inner = innerCanvasRef.current;
    if (!runtime || !inner) return;
    const ghost = dragGhostRef.current;
    if (ghost) {
      ghost.style.display = "block";
      ghost.style.transform = `translate3d(${clientX + 12}px, ${clientY + 8}px, 0)`;
    }
    const target = computeFeedCanvasDropTarget({
      x: clientX,
      y: clientY,
      geometry: runtime.geometry,
      source: runtime.source,
    });
    runtime.target = target;
    const indicator = dropIndicatorRef.current;
    if (!indicator || !target) {
      if (indicator) indicator.style.display = "none";
      return;
    }
    const innerRect = inner.getBoundingClientRect();
    indicator.style.display = "block";
    if (target.kind === "column") {
      const left = runtime.geometry.boundaries[target.index] - innerRect.left;
      indicator.style.left = `${left - FEED_CANVAS_DROP_INDICATOR_SIZE / 2}px`;
      indicator.style.top = "0px";
      indicator.style.width = `${FEED_CANVAS_DROP_INDICATOR_SIZE}px`;
      indicator.style.height = `${innerRect.height}px`;
    } else {
      const column = runtime.geometry.columns.find((candidate) => candidate.id === target.columnId);
      if (!column) {
        indicator.style.display = "none";
        return;
      }
      const top = target.index === 0
        ? column.top
        : target.index === column.panels.length
          ? column.bottom
          : (column.panels[target.index - 1].bottom + column.panels[target.index].top) / 2;
      indicator.style.left = `${column.left - innerRect.left}px`;
      indicator.style.top = `${top - innerRect.top - FEED_CANVAS_DROP_INDICATOR_SIZE / 2}px`;
      indicator.style.width = `${column.right - column.left}px`;
      indicator.style.height = `${FEED_CANVAS_DROP_INDICATOR_SIZE}px`;
    }
  }, []);

  const beginPanelDrag = useCallback((panelId: string, event: PointerEvent<HTMLElement>) => {
    if (readOnly || event.button !== 0) return;
    const startX = event.clientX;
    const startY = event.clientY;
    let active = false;
    let lastX = startX;
    let lastY = startY;
    const panel = panels.find((candidate) => candidate.id === panelId);

    const schedulePaint = () => {
      if (dragFrameRef.current !== null) return;
      dragFrameRef.current = requestAnimationFrame(() => {
        dragFrameRef.current = null;
        paintDragFrame(lastX, lastY);
      });
    };
    const removeListeners = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      dragCleanupRef.current = null;
    };
    const finish = (commit: boolean) => {
      removeListeners();
      if (dragFrameRef.current !== null) {
        cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      const runtime = dragRuntimeRef.current;
      dragRuntimeRef.current = null;
      hideDragDecorations();
      if (active) setDraggingPanelId(null);
      if (commit && runtime?.target) onMovePanel(runtime.panelId, runtime.target);
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      lastX = moveEvent.clientX;
      lastY = moveEvent.clientY;
      if (!active && Math.hypot(lastX - startX, lastY - startY) >= 6) {
        const captured = captureDragGeometry(panelId);
        if (!captured) return;
        active = true;
        dragRuntimeRef.current = { panelId, ...captured, target: null };
        if (dragGhostRef.current) dragGhostRef.current.textContent = panel?.label ?? "Panel";
        setDraggingPanelId(panelId);
      }
      if (active) {
        moveEvent.preventDefault();
        schedulePaint();
      }
    };
    const onUp = () => {
      if (active) paintDragFrame(lastX, lastY);
      finish(active);
    };
    const onCancel = () => finish(false);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };
    event.preventDefault();
    onFocusPanel(panelId);
    dragCleanupRef.current?.();
    dragCleanupRef.current = () => finish(false);
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    window.addEventListener("keydown", onKeyDown);
  }, [captureDragGeometry, hideDragDecorations, onFocusPanel, onMovePanel, paintDragFrame, panels, readOnly]);

  useEffect(() => () => {
    dragCleanupRef.current?.();
    resizeCleanupRef.current?.();
  }, []);

  const beginColumnResize = useCallback((event: PointerEvent<HTMLDivElement>, index: number) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const first = layout.columns[index];
    const second = layout.columns[index + 1];
    const inner = innerCanvasRef.current;
    if (!inner || !first || !second) return;
    const availableWidth = inner.clientWidth
      - Math.max(0, layout.columns.length - 1) * FEED_CANVAS_GAP;
    if (availableWidth <= 0) return;
    const startX = event.clientX;
    const firstWidth = availableWidth * first.widthWeight;
    const secondWidth = availableWidth * second.widthWeight;
    const combinedWidth = firstWidth + secondWidth;
    const combinedWeight = first.widthWeight + second.widthWeight;
    const weightBefore = layout.columns.slice(0, index).reduce((sum, column) => sum + column.widthWeight, 0);
    const horizontalGap = Math.max(0, layout.columns.length - 1) * FEED_CANVAS_GAP;
    const frozenDocuments = freezeColumnDocuments(inner, new Set([first.id, second.id]));
    let lastX = startX;
    let frameId: number | null = null;
    let latest = computeFeedCanvasResizePair({ startFirstSize: firstWidth, combinedSize: combinedWidth, combinedWeight, delta: 0 });

    const paintColumn = (column: FeedCanvasColumn, columnIndex: number, left: number, width: number) => {
      inner.querySelectorAll<HTMLElement>(`[data-feed-column-slot="${column.id}"]`).forEach((slot) => {
        slot.style.left = `calc((100% - ${horizontalGap}px) * ${left} + ${columnIndex * FEED_CANVAS_GAP}px)`;
        slot.style.width = `calc((100% - ${horizontalGap}px) * ${width})`;
      });
      inner.querySelectorAll<HTMLElement>(`[data-feed-panel-resize-column="${column.id}"]`).forEach((handle) => {
        handle.style.left = `calc((100% - ${horizontalGap}px) * ${left} + ${columnIndex * FEED_CANVAS_GAP}px)`;
        handle.style.width = `calc((100% - ${horizontalGap}px) * ${width})`;
      });
    };
    const paint = () => {
      frameId = null;
      latest = computeFeedCanvasResizePair({
        startFirstSize: firstWidth,
        combinedSize: combinedWidth,
        combinedWeight,
        delta: lastX - startX,
      });
      paintColumn(first, index, weightBefore, latest.firstWeight);
      paintColumn(second, index + 1, weightBefore + latest.firstWeight, latest.secondWeight);
      const handle = inner.querySelector<HTMLElement>(`[data-feed-column-resize="${first.id}"]`);
      if (handle) {
        handle.style.left = `calc((100% - ${horizontalGap}px) * ${weightBefore + latest.firstWeight} + ${index * FEED_CANVAS_GAP}px)`;
      }
    };
    const schedulePaint = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(paint);
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      lastX = moveEvent.clientX;
      schedulePaint();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      inner.removeAttribute("data-feed-resizing");
      restoreFrozenDocuments(frozenDocuments);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeCleanupRef.current = null;
    };
    const finish = (commit: boolean) => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (commit) paint();
      else {
        latest = computeFeedCanvasResizePair({ startFirstSize: firstWidth, combinedSize: combinedWidth, combinedWeight, delta: 0 });
        paintColumn(first, index, weightBefore, first.widthWeight);
        paintColumn(second, index + 1, weightBefore + first.widthWeight, second.widthWeight);
        const handle = inner.querySelector<HTMLElement>(`[data-feed-column-resize="${first.id}"]`);
        if (handle) handle.style.left = `calc((100% - ${horizontalGap}px) * ${weightBefore + first.widthWeight} + ${index * FEED_CANVAS_GAP}px)`;
      }
      cleanup();
      if (commit) onSetColumnWeights(first.id, latest.firstWeight, second.id, latest.secondWeight);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = () => finish(false);
    inner.setAttribute("data-feed-resizing", "columns");
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    window.addEventListener("keydown", onKeyDown);
  }, [layout.columns, onSetColumnWeights]);

  const beginPanelResize = useCallback((
    event: PointerEvent<HTMLDivElement>,
    column: FeedCanvasColumn,
    index: number,
  ) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const first = column.panels[index];
    const second = column.panels[index + 1];
    const firstElement = canvasRef.current?.querySelector<HTMLElement>(`[data-feed-panel="${first.id}"]`);
    const secondElement = canvasRef.current?.querySelector<HTMLElement>(`[data-feed-panel="${second.id}"]`);
    if (!firstElement || !secondElement) return;
    const startY = event.clientY;
    const firstHeight = firstElement.offsetHeight;
    const secondHeight = secondElement.offsetHeight;
    const combinedHeight = firstHeight + secondHeight;
    const combinedWeight = first.heightWeight + second.heightWeight;
    const inner = innerCanvasRef.current;
    if (!inner) return;
    const startWeight = column.panels.slice(0, index).reduce((sum, panel) => sum + panel.heightWeight, 0);
    const verticalGap = Math.max(0, column.panels.length - 1) * FEED_CANVAS_GAP;
    let lastY = startY;
    let frameId: number | null = null;
    let latest = computeFeedCanvasResizePair({ startFirstSize: firstHeight, combinedSize: combinedHeight, combinedWeight, delta: 0 });

    const paint = () => {
      frameId = null;
      latest = computeFeedCanvasResizePair({
        startFirstSize: firstHeight,
        combinedSize: combinedHeight,
        combinedWeight,
        delta: lastY - startY,
      });
      const firstSlot = inner.querySelector<HTMLElement>(`[data-feed-panel-slot="${first.id}"]`);
      const secondSlot = inner.querySelector<HTMLElement>(`[data-feed-panel-slot="${second.id}"]`);
      const handle = inner.querySelector<HTMLElement>(`[data-feed-panel-resize="${first.id}"]`);
      if (firstSlot) {
        firstSlot.style.top = `calc((100% - ${verticalGap}px) * ${startWeight} + ${index * FEED_CANVAS_GAP}px)`;
        firstSlot.style.height = `calc((100% - ${verticalGap}px) * ${latest.firstWeight})`;
      }
      if (secondSlot) {
        secondSlot.style.top = `calc((100% - ${verticalGap}px) * ${startWeight + latest.firstWeight} + ${(index + 1) * FEED_CANVAS_GAP}px)`;
        secondSlot.style.height = `calc((100% - ${verticalGap}px) * ${latest.secondWeight})`;
      }
      if (handle) {
        handle.style.top = `calc((100% - ${verticalGap}px) * ${startWeight + latest.firstWeight} + ${index * FEED_CANVAS_GAP}px)`;
      }
    };
    const schedulePaint = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(paint);
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      lastY = moveEvent.clientY;
      schedulePaint();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      if (frameId !== null) cancelAnimationFrame(frameId);
      frameId = null;
      inner.removeAttribute("data-feed-resizing");
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeCleanupRef.current = null;
    };
    const finish = (commit: boolean) => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (commit) paint();
      else {
        lastY = startY;
        paint();
      }
      cleanup();
      if (commit) onSetPanelWeights(column.id, first.id, latest.firstWeight, second.id, latest.secondWeight);
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = () => finish(false);
    inner.setAttribute("data-feed-resizing", "panels");
    document.body.style.cursor = "row-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    window.addEventListener("keydown", onKeyDown);
  }, [onSetPanelWeights]);

  return (
    <section
      ref={sectionRef}
      data-feed-canvas
      style={{
        flex: 1,
        minWidth: 0,
        minHeight: 0,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        background: "var(--cc-canvas)",
      }}
    >
      <div ref={canvasRef} style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "hidden", padding: 12 }}>
          <div
            ref={innerCanvasRef}
            style={{
              position: "relative",
              width: "100%",
              height: "100%",
              minWidth: 0,
              minHeight: 0,
            }}
          >
            {geometry.map(({ column, columnIndex, panel, panelIndex, left, top }) => {
              const horizontalGap = Math.max(0, layout.columns.length - 1) * FEED_CANVAS_GAP;
              const verticalGap = Math.max(0, column.panels.length - 1) * FEED_CANVAS_GAP;
              return (
                <div
                  key={panel.id}
                  data-feed-panel-slot={panel.id}
                  data-feed-column-slot={column.id}
                  style={{
                    position: "absolute",
                    left: `calc((100% - ${horizontalGap}px) * ${left} + ${columnIndex * 8}px)`,
                    width: `calc((100% - ${horizontalGap}px) * ${column.widthWeight})`,
                    top: `calc((100% - ${verticalGap}px) * ${top} + ${panelIndex * 8}px)`,
                    height: `calc((100% - ${verticalGap}px) * ${panel.heightWeight})`,
                    minWidth: 0,
                    minHeight: 0,
                  }}
                >
                  <CanvasPanel
                    panel={panel}
                    active={layout.activePanelId === panel.id}
                    onFocus={() => onFocusPanel(panel.id)}
                    onClose={() => onClosePanel(panel.id)}
                    readOnly={readOnly}
                    dragging={draggingPanelId === panel.id}
                    onDragPointerDown={(event) => beginPanelDrag(panel.id, event)}
                    flashing={flashPanelId === panel.id}
                    headerActions={renderPanelActions?.(panel)}
                  >
                    {renderPanel(panel, layout.activePanelId === panel.id)}
                  </CanvasPanel>
                </div>
              );
            })}
            <span
              ref={dropIndicatorRef}
              data-feed-drop-indicator
              aria-hidden
              style={{
                display: "none",
                position: "absolute",
                zIndex: 50,
                borderRadius: 4,
                background: "var(--cc-brand-alpha-45)",
                pointerEvents: "none",
              }}
            />
            {!readOnly && !draggingPanelId ? layout.columns.slice(0, -1).map((column, columnIndex) => {
              const cumulative = layout.columns
                .slice(0, columnIndex + 1)
                .reduce((sum, candidate) => sum + candidate.widthWeight, 0);
              const gapCount = Math.max(0, layout.columns.length - 1);
              return (
                <div
                  key={`column-resize-${column.id}`}
                  data-feed-column-resize={column.id}
                  style={{
                    position: "absolute",
                    top: 0,
                    bottom: 0,
                    left: `calc((100% - ${gapCount * FEED_CANVAS_GAP}px) * ${cumulative} + ${columnIndex * FEED_CANVAS_GAP}px)`,
                    width: FEED_CANVAS_GAP,
                  }}
                >
                  <ResizeHandle
                    orientation="horizontal"
                    onPointerDown={(event) => beginColumnResize(event, columnIndex)}
                  />
                </div>
              );
            }) : null}
            {!readOnly && !draggingPanelId ? layout.columns.flatMap((column) => column.panels.slice(0, -1).map((panel, panelIndex) => {
              const item = geometry.find((candidate) => candidate.panel.id === panel.id)!;
              const cumulative = column.panels
                .slice(0, panelIndex + 1)
                .reduce((sum, candidate) => sum + candidate.heightWeight, 0);
              const horizontalGap = Math.max(0, layout.columns.length - 1) * FEED_CANVAS_GAP;
              const verticalGap = Math.max(0, column.panels.length - 1) * FEED_CANVAS_GAP;
              return (
                <div
                  key={`panel-resize-${panel.id}`}
                  data-feed-panel-resize={panel.id}
                  data-feed-panel-resize-column={column.id}
                  style={{
                    position: "absolute",
                    left: `calc((100% - ${horizontalGap}px) * ${item.left} + ${item.columnIndex * 8}px)`,
                    width: `calc((100% - ${horizontalGap}px) * ${column.widthWeight})`,
                    top: `calc((100% - ${verticalGap}px) * ${cumulative} + ${panelIndex * 8}px)`,
                    height: FEED_CANVAS_GAP,
                  }}
                >
                  <ResizeHandle
                    orientation="vertical"
                    onPointerDown={(event) => beginPanelResize(event, column, panelIndex)}
                  />
                </div>
              );
            })) : null}
          </div>
      </div>
      {typeof document !== "undefined" ? createPortal(
        <div
          ref={dragGhostRef}
          data-feed-drag-label
          aria-hidden
          style={{
            display: "none",
            position: "fixed",
            zIndex: 1000,
            top: 0,
            left: 0,
            width: "fit-content",
            maxWidth: 180,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            padding: "6px 12px",
            border: "1px solid var(--cc-brand-alpha-40)",
            borderRadius: 7,
            background: "var(--cc-surface)",
            color: "var(--cc-brand-primary)",
            fontFamily: "var(--cc-font-label)",
            fontSize: 11.5,
            fontWeight: 600,
            boxShadow: "0 4px 12px rgba(0,0,0,.08)",
            pointerEvents: "none",
            willChange: "transform",
          }}
        />,
        document.body,
      ) : null}
    </section>
  );
}
