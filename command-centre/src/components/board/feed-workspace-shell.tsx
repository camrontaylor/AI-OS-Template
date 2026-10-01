"use client";

import type { MouseEvent, ReactNode } from "react";
import styles from "./feed-workspace-shell.module.css";

export function FeedWorkspaceShell({
  navigation,
  workspace,
  marginRight,
  resizing,
  onDragEnd,
  onMouseDown,
}: {
  navigation: ReactNode;
  workspace?: ReactNode;
  marginRight?: number;
  resizing?: boolean;
  onDragEnd?: () => void;
  onMouseDown?: (event: MouseEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      data-feed-workspace-shell
      className={styles.root}
      style={{
        display: "flex",
        flexDirection: "row",
        minWidth: 0,
        minHeight: 0,
        height: "calc(100vh - 52px)",
        overflow: "hidden",
        background: "var(--cc-canvas)",
        marginRight: marginRight || undefined,
        transition: resizing ? undefined : "margin-right 200ms ease",
      }}
      onDragEnd={onDragEnd}
      onMouseDown={onMouseDown}
    >
      <section
        data-feed-goal-navigation
        style={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", flex: "0 0 auto" }}
      >
        {navigation}
      </section>
      {workspace ? (
        <section data-feed-goal-workspace style={{ minWidth: 0, minHeight: 0, flex: 1, display: "flex", overflow: "hidden" }}>
          {workspace}
        </section>
      ) : null}
    </div>
  );
}
