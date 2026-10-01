export interface FeedShortcutEvent {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  altKey?: boolean;
  repeat?: boolean;
}

export function isNewFeedChatShortcut(
  event: FeedShortcutEvent,
  options: { archived: boolean; overlayOpen: boolean },
): boolean {
  return event.key === "\\"
    && (event.ctrlKey || event.metaKey)
    && !event.altKey
    && !event.repeat
    && !options.archived
    && !options.overlayOpen;
}

export function getFeedMenuNavigationIndex(
  key: string,
  currentIndex: number,
  itemCount: number,
): number | null {
  if (itemCount <= 0) return null;
  const safeIndex = currentIndex >= 0 ? currentIndex : 0;
  if (key === "ArrowDown") return (safeIndex + 1) % itemCount;
  if (key === "ArrowUp") return (safeIndex - 1 + itemCount) % itemCount;
  if (key === "Home") return 0;
  if (key === "End") return itemCount - 1;
  return null;
}

export function hasOpenFeedOverlay(root: ParentNode): boolean {
  return Boolean(root.querySelector('[role="dialog"], [role="menu"]'));
}

export function focusFeedPanel(root: ParentNode, panelId: string): boolean {
  const panel = Array.from(root.querySelectorAll<HTMLElement>("[data-feed-panel]"))
    .find((candidate) => candidate.dataset.feedPanel === panelId);
  if (!panel) return false;
  panel.focus({ preventScroll: true });
  return true;
}
