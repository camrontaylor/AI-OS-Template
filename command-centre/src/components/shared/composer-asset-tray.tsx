"use client";

import type { ReactNode } from "react";

const MONO = "'DM Mono', monospace";

export function ComposerAssetTray({
  children,
  error,
  compact,
}: {
  children?: ReactNode;
  error?: string | null;
  compact?: boolean;
}) {
  if (!children && !error) return null;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 8,
        padding: compact ? "10px 10px 4px" : "12px 14px 4px",
      }}
    >
      {children}
      {error ? (
        <div
          style={{
            fontSize: 11,
            color: "var(--cc-status-danger)",
            fontFamily: MONO,
          }}
        >
          {error}
        </div>
      ) : null}
    </div>
  );
}
