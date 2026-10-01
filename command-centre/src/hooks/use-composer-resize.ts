"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { clampComposerHeight } from "@/lib/composer";

interface UseComposerResizeOptions {
  minHeight: number;
  maxHeight: number;
  initialHeight?: number;
}

interface DragState {
  startY: number;
  startHeight: number;
}

export function useComposerResize({
  minHeight,
  maxHeight,
  initialHeight = minHeight,
}: UseComposerResizeOptions) {
  const [composerHeight, setComposerHeight] = useState(() =>
    clampComposerHeight(initialHeight, minHeight, maxHeight),
  );
  const [hasUserResized, setHasUserResized] = useState(false);
  const dragStateRef = useRef<DragState | null>(null);

  const stopDragging = useCallback(() => {
    dragStateRef.current = null;
    document.body.style.cursor = "";
    document.body.style.userSelect = "";
    window.removeEventListener("pointermove", handlePointerMove);
    window.removeEventListener("pointerup", stopDragging);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePointerMove = useCallback((event: PointerEvent) => {
    const dragState = dragStateRef.current;
    if (!dragState) return;

    const delta = dragState.startY - event.clientY;
    setHasUserResized(true);
    setComposerHeight(
      clampComposerHeight(dragState.startHeight + delta, minHeight, maxHeight),
    );
  }, [maxHeight, minHeight]);

  useEffect(() => {
    return () => {
      dragStateRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", stopDragging);
    };
  }, [handlePointerMove, stopDragging]);

  useEffect(() => {
    setComposerHeight((current) => clampComposerHeight(current, minHeight, maxHeight));
  }, [maxHeight, minHeight]);

  const handleResizePointerDown = useCallback((event: ReactPointerEvent<HTMLElement>) => {
    event.preventDefault();
    dragStateRef.current = {
      startY: event.clientY,
      startHeight: composerHeight,
    };
    document.body.style.cursor = "ns-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", stopDragging);
  }, [composerHeight, handlePointerMove, stopDragging]);

  return {
    composerHeight,
    hasUserResized,
    handleResizePointerDown,
  };
}
