"use client";

import type { ReactNode } from "react";

export function KanbanColumnActive({
  children,
  isEmpty,
}: {
  children: ReactNode;
  isEmpty: boolean;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12, minWidth: 0 }}>
      {children}

      {isEmpty && (
        <div style={{
          background: "var(--cc-surface)",
          borderRadius: 10,
          border: "1.5px dashed var(--cc-palette-neutral-400)",
          padding: "40px 24px",
          textAlign: "center",
          color: "var(--cc-text-tertiary)",
          fontSize: 13,
        }}>
          No goals yet — enter one above to get started
        </div>
      )}
    </div>
  );
}
