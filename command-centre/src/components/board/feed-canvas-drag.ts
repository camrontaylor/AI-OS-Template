import type { FeedCanvasDropTarget } from "./feed-canvas-state";

export const FEED_CANVAS_COLUMN_SNAP_RADIUS = 26;

export interface FeedCanvasDragPanelGeometry {
  id: string;
  top: number;
  bottom: number;
}

export interface FeedCanvasDragColumnGeometry {
  id: string;
  left: number;
  right: number;
  top: number;
  bottom: number;
  panels: FeedCanvasDragPanelGeometry[];
}

export interface FeedCanvasDragGeometry {
  columns: FeedCanvasDragColumnGeometry[];
  boundaries: number[];
}

export interface FeedCanvasDragSource {
  columnId: string;
  columnIndex: number;
  panelIndex: number;
  columnPanelCount: number;
}

export function isNoOpFeedCanvasDrop(
  target: FeedCanvasDropTarget,
  source: FeedCanvasDragSource,
): boolean {
  if (target.kind === "column") {
    return source.columnPanelCount === 1
      && (target.index === source.columnIndex || target.index === source.columnIndex + 1);
  }
  return target.columnId === source.columnId
    && (target.index === source.panelIndex || target.index === source.panelIndex + 1);
}

export function computeFeedCanvasDropTarget({
  x,
  y,
  geometry,
  source,
  columnSnapRadius = FEED_CANVAS_COLUMN_SNAP_RADIUS,
}: {
  x: number;
  y: number;
  geometry: FeedCanvasDragGeometry;
  source: FeedCanvasDragSource;
  columnSnapRadius?: number;
}): FeedCanvasDropTarget | null {
  let nearestBoundary = -1;
  let nearestDistance = Number.POSITIVE_INFINITY;
  geometry.boundaries.forEach((boundary, index) => {
    const distance = Math.abs(x - boundary);
    if (distance < nearestDistance) {
      nearestBoundary = index;
      nearestDistance = distance;
    }
  });

  if (nearestBoundary >= 0 && nearestDistance <= columnSnapRadius) {
    const target: FeedCanvasDropTarget = { kind: "column", index: nearestBoundary };
    return isNoOpFeedCanvasDrop(target, source) ? null : target;
  }

  const column = geometry.columns.find((candidate) => x >= candidate.left && x <= candidate.right)
    ?? geometry.columns.reduce<FeedCanvasDragColumnGeometry | null>((nearest, candidate) => {
      if (!nearest) return candidate;
      const candidateDistance = Math.min(Math.abs(x - candidate.left), Math.abs(x - candidate.right));
      const nearestDistanceToColumn = Math.min(Math.abs(x - nearest.left), Math.abs(x - nearest.right));
      return candidateDistance < nearestDistanceToColumn ? candidate : nearest;
    }, null);
  if (!column) return null;

  let index = column.panels.length;
  for (let panelIndex = 0; panelIndex < column.panels.length; panelIndex += 1) {
    const panel = column.panels[panelIndex];
    if (y < panel.top + (panel.bottom - panel.top) / 2) {
      index = panelIndex;
      break;
    }
  }
  const target: FeedCanvasDropTarget = { kind: "stack", columnId: column.id, index };
  return isNoOpFeedCanvasDrop(target, source) ? null : target;
}
