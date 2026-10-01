export type PopoverPlacement = "above" | "below";

export const POPOVER_LAYER_Z_INDEX = 1100;

export interface PopoverAnchorRect {
  top: number;
  bottom: number;
  left: number;
  width: number;
}

interface ResolvePopoverPositionInput {
  anchor: PopoverAnchorRect;
  viewportWidth: number;
  viewportHeight: number;
  popoverWidth: number;
  contentHeight: number;
  maxHeight: number;
  preferredPlacement: PopoverPlacement;
  gap?: number;
  viewportPadding?: number;
}

export interface ResolvedPopoverPosition {
  placement: PopoverPlacement;
  top: number;
  left: number;
  width: number;
  maxHeight: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

export function resolvePopoverPosition({
  anchor,
  viewportWidth,
  viewportHeight,
  popoverWidth,
  contentHeight,
  maxHeight,
  preferredPlacement,
  gap = 4,
  viewportPadding = 8,
}: ResolvePopoverPositionInput): ResolvedPopoverPosition {
  const availableAbove = Math.max(0, anchor.top - viewportPadding - gap);
  const availableBelow = Math.max(0, viewportHeight - anchor.bottom - viewportPadding - gap);
  const preferredSpace = preferredPlacement === "above" ? availableAbove : availableBelow;
  const alternateSpace = preferredPlacement === "above" ? availableBelow : availableAbove;
  const desiredHeight = Math.min(Math.max(0, contentHeight), Math.max(0, maxHeight));
  const placement = preferredSpace >= desiredHeight || preferredSpace >= alternateSpace
    ? preferredPlacement
    : preferredPlacement === "above" ? "below" : "above";
  const availableHeight = placement === "above" ? availableAbove : availableBelow;
  const resolvedMaxHeight = Math.min(Math.max(0, maxHeight), availableHeight);
  const renderedHeight = Math.min(desiredHeight, resolvedMaxHeight);

  const usableWidth = Math.max(0, viewportWidth - viewportPadding * 2);
  const width = Math.min(Math.max(0, popoverWidth), usableWidth);
  const maxLeft = Math.max(viewportPadding, viewportWidth - viewportPadding - width);
  const left = clamp(anchor.left, viewportPadding, maxLeft);

  const naturalTop = placement === "above"
    ? anchor.top - gap - renderedHeight
    : anchor.bottom + gap;
  const maxTop = Math.max(viewportPadding, viewportHeight - viewportPadding - renderedHeight);
  const top = clamp(naturalTop, viewportPadding, maxTop);

  return { placement, top, left, width, maxHeight: resolvedMaxHeight };
}
