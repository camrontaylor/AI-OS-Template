"use client";

import { CheckCircle2, Copy, MoreHorizontal, RotateCcw, Terminal } from "lucide-react";
import { useState } from "react";
import { useTaskStore } from "@/store/task-store";
import type { Task } from "@/types/task";
import { useFeedMenuNavigation } from "./use-feed-menu-navigation";
import menuStyles from "./feed-menu.module.css";

export function FeedPanelActions({ task, readOnly = false }: { task?: Task; readOnly?: boolean }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const updateTask = useTaskStore((state) => state.updateTask);
  const {
    triggerRef,
    menuRef,
    registerItem,
    closeMenu,
    onMenuKeyDown,
    onTriggerKeyDown,
  } = useFeedMenuNavigation({ open, setOpen });

  if (!task || readOnly) return null;
  const canResume = Boolean(task.claudeSessionId && task.status !== "done");
  const canComplete = task.status !== "backlog" && task.status !== "done";
  const canReopen = task.status === "done";
  if (!canResume && !canComplete && !canReopen) return null;

  const itemStyle = {
    width: "100%",
    height: 30,
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 9px",
    border: 0,
    borderRadius: 5,
    background: "transparent",
    color: "var(--cc-text-primary)",
    font: "500 11px/1 var(--cc-font-label)",
    cursor: "pointer",
    textAlign: "left" as const,
  };

  return (
    <div
      style={{ position: "relative" }}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        ref={triggerRef}
        className={menuStyles.trigger}
        type="button"
        aria-label="Chat actions"
        title="Chat actions"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((value) => !value)}
        onKeyDown={onTriggerKeyDown}
        style={{
          width: 24,
          height: 24,
          display: "grid",
          placeItems: "center",
          border: 0,
          borderRadius: 5,
          background: "transparent",
          color: "var(--cc-text-muted)",
          cursor: "pointer",
        }}
      >
        <MoreHorizontal size={13} />
      </button>
      {open ? (
        <div
          ref={menuRef}
          role="menu"
          aria-label="Chat actions"
          onKeyDown={onMenuKeyDown}
          style={{
            position: "absolute",
            top: 27,
            right: 0,
            zIndex: 120,
            width: 166,
            padding: 4,
            border: "1px solid var(--cc-line-alpha-20)",
            borderRadius: 7,
            background: "var(--cc-surface)",
            boxShadow: "var(--cc-shadow-popover)",
          }}
        >
          {canResume ? (
            <button
              ref={registerItem(0)}
              className={menuStyles.item}
              type="button"
              role="menuitem"
              style={itemStyle}
              onClick={async () => {
                await navigator.clipboard.writeText(`claude --resume ${task.claudeSessionId}`);
                setCopied(true);
                window.setTimeout(() => setCopied(false), 1800);
              }}
            >
              {copied ? <Copy size={12} /> : <Terminal size={12} />}
              {copied ? "Resume copied" : "Copy resume command"}
            </button>
          ) : null}
          {canComplete ? (
            <button
              ref={registerItem(canResume ? 1 : 0)}
              className={menuStyles.item}
              type="button"
              role="menuitem"
              style={itemStyle}
              onClick={() => {
                void updateTask(task.id, { status: "done", needsInput: false });
                closeMenu();
              }}
            >
              <CheckCircle2 size={12} /> Mark complete
            </button>
          ) : null}
          {canReopen ? (
            <button
              ref={registerItem(canResume ? 1 : 0)}
              className={menuStyles.item}
              type="button"
              role="menuitem"
              style={itemStyle}
              onClick={() => {
                void updateTask(task.id, { status: "review" });
                closeMenu();
              }}
            >
              <RotateCcw size={12} /> Reopen
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
