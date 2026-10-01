"use client";

import { useCallback, useLayoutEffect, useState, type RefObject } from "react";
import { shouldShowComposerExpansion } from "@/lib/composer-expansion";

function numericStyle(value: string): number {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export function useComposerExpansionTrigger(
  textareaRef: RefObject<HTMLTextAreaElement | null>,
  value: string,
  minimumLines = 3,
  measurementKey?: unknown,
): boolean {
  const [visible, setVisible] = useState(false);

  const measure = useCallback(() => {
    const textarea = textareaRef.current;
    if (!textarea || !value.trim()) {
      setVisible(false);
      return;
    }

    const computed = window.getComputedStyle(textarea);
    const previous = {
      height: textarea.style.height,
      minHeight: textarea.style.minHeight,
      maxHeight: textarea.style.maxHeight,
      overflowY: textarea.style.overflowY,
      paddingRight: textarea.style.paddingRight,
    };

    // Read the content's natural wrapped height instead of the visible control
    // height. This keeps large, minimum-height composers from always qualifying.
    textarea.style.height = "0px";
    textarea.style.minHeight = "0px";
    textarea.style.maxHeight = "none";
    textarea.style.overflowY = "hidden";
    textarea.style.paddingRight = "0px";
    const scrollHeight = textarea.scrollHeight;
    textarea.style.height = previous.height;
    textarea.style.minHeight = previous.minHeight;
    textarea.style.maxHeight = previous.maxHeight;
    textarea.style.overflowY = previous.overflowY;
    textarea.style.paddingRight = previous.paddingRight;

    setVisible(shouldShowComposerExpansion({
      hasText: true,
      scrollHeight,
      lineHeight: numericStyle(computed.lineHeight),
      paddingTop: numericStyle(computed.paddingTop),
      paddingBottom: numericStyle(computed.paddingBottom),
      minimumLines,
    }));
  }, [measurementKey, minimumLines, textareaRef, value]);

  useLayoutEffect(() => {
    measure();
    const textarea = textareaRef.current;
    if (!textarea || typeof ResizeObserver === "undefined") return;

    const observer = new ResizeObserver(measure);
    observer.observe(textarea);
    return () => observer.disconnect();
  }, [measure, textareaRef]);

  return visible;
}
