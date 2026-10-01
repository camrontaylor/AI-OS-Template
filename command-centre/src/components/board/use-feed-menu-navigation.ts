"use client";

import { useCallback, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { getFeedMenuNavigationIndex } from "./feed-interactions";

export function useFeedMenuNavigation({
  open,
  setOpen,
}: {
  open: boolean;
  setOpen: (open: boolean) => void;
}) {
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const itemRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const closeMenu = useCallback((restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) requestAnimationFrame(() => triggerRef.current?.focus());
  }, [setOpen]);

  const getFocusableItems = useCallback(() => itemRefs.current.filter(
    (item): item is HTMLButtonElement => Boolean(
      item && !item.disabled && item.getAttribute("aria-disabled") !== "true",
    ),
  ), []);

  useEffect(() => {
    if (!open) return;
    const frame = requestAnimationFrame(() => getFocusableItems()[0]?.focus());
    return () => cancelAnimationFrame(frame);
  }, [getFocusableItems, open]);

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !menuRef.current?.contains(target)) {
        closeMenu(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [closeMenu, open]);

  const registerItem = useCallback((index: number) => (node: HTMLButtonElement | null) => {
    itemRefs.current[index] = node;
  }, []);

  const moveFocusOutsideMenu = useCallback((backward: boolean) => {
    const menu = menuRef.current;
    const trigger = triggerRef.current;
    if (!trigger) {
      closeMenu(false);
      return;
    }
    const candidates = Array.from(document.querySelectorAll<HTMLElement>(
      'a[href], button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
    )).filter((candidate) => !menu?.contains(candidate) && candidate.getClientRects().length > 0);
    const triggerIndex = candidates.indexOf(trigger);
    const next = candidates[triggerIndex + (backward ? -1 : 1)];
    closeMenu(false);
    requestAnimationFrame(() => next?.focus());
  }, [closeMenu]);

  const onMenuKeyDown = useCallback((event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeMenu();
      return;
    }
    if (event.key === "Tab") {
      event.preventDefault();
      moveFocusOutsideMenu(event.shiftKey);
      return;
    }
    const items = getFocusableItems();
    const currentIndex = items.indexOf(document.activeElement as HTMLButtonElement);
    const nextIndex = getFeedMenuNavigationIndex(event.key, currentIndex, items.length);
    if (nextIndex === null) return;
    event.preventDefault();
    items[nextIndex]?.focus();
  }, [closeMenu, getFocusableItems, moveFocusOutsideMenu]);

  const onTriggerKeyDown = useCallback((event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (open || (event.key !== "ArrowDown" && event.key !== "ArrowUp")) return;
    event.preventDefault();
    setOpen(true);
  }, [open, setOpen]);

  return {
    triggerRef,
    menuRef,
    registerItem,
    closeMenu,
    onMenuKeyDown,
    onTriggerKeyDown,
  };
}
