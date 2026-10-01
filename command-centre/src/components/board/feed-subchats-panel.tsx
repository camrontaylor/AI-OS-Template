"use client";

import { Check, CheckCircle2, ChevronDown, Circle, Pin, PinOff, Play, Plus } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { FeedSubchatItem } from "./feed-subchats-state";
import type { Task } from "@/types/task";
import { useFeedMenuNavigation } from "./use-feed-menu-navigation";
import menuStyles from "./feed-menu.module.css";

function StatusDot({ task, unseen = false }: { task: Task; unseen?: boolean }) {
  const color = task.status === "running"
    ? "var(--cc-status-purple)"
    : unseen || task.status === "review"
      ? "var(--cc-status-warning)"
      : task.status === "done"
        ? "var(--cc-status-success)"
        : "var(--cc-text-disabled)";
  return <span aria-hidden style={{ width: 7, height: 7, borderRadius: 999, background: color, flex: "0 0 auto" }} />;
}

function RenameField({
  task,
  onCommit,
  onCancel,
}: {
  task: Task;
  onCommit: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(task.title);
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); inputRef.current?.select(); }, []);
  const commit = () => {
    const next = value.trim();
    if (!next) return onCancel();
    onCommit(next);
  };
  return (
    <input
      ref={inputRef}
      value={value}
      aria-label={`Rename ${task.title}`}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onClick={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Escape") { event.preventDefault(); onCancel(); }
      }}
      style={{
        minWidth: 0,
        width: "100%",
        height: 24,
        padding: "0 6px",
        border: "1px solid var(--cc-brand-alpha-35)",
        borderRadius: 5,
        background: "var(--cc-surface)",
        color: "var(--cc-text-primary)",
        font: "500 12px/1 var(--cc-font-body)",
        outline: "2px solid var(--cc-brand-alpha-08)",
      }}
    />
  );
}

function SubchatRow({
  item,
  editing,
  readOnly,
  onOpen,
  onPin,
  onUnpin,
  onBeginRename,
  onRename,
  onCancelRename,
  onMarkComplete,
}: {
  item: FeedSubchatItem;
  editing: boolean;
  readOnly: boolean;
  onOpen: () => void;
  onPin: () => void;
  onUnpin: () => void;
  onBeginRename: () => void;
  onRename: (value: string) => void;
  onCancelRename: () => void;
  onMarkComplete: () => void;
}) {
  const [hovered, setHovered] = useState(false);
  const [focusWithin, setFocusWithin] = useState(false);
  const pinned = Boolean(item.pinnedPanelId);
  const done = item.task.status === "done";
  const showActions = !readOnly && !editing && (hovered || focusWithin || pinned || done);
  return (
    <div
      style={{ position: "relative" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocusWithin(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false);
      }}
    >
      <button
        type="button"
        onClick={onOpen}
        onDoubleClick={(event) => { event.preventDefault(); if (!readOnly) onBeginRename(); }}
        style={{
          width: "100%",
          minHeight: 36,
          display: "flex",
          alignItems: "center",
          gap: 9,
          padding: "7px 62px 7px 9px",
          border: 0,
          borderRadius: 7,
          background: item.current ? "var(--cc-brand-alpha-08)" : hovered ? "var(--cc-brand-alpha-04)" : "transparent",
          color: "var(--cc-text-primary)",
          textAlign: "left",
          cursor: "pointer",
        }}
      >
        <StatusDot task={item.task} unseen={item.unseen} />
        <span style={{ flex: 1, minWidth: 0 }}>
          {editing ? (
            <RenameField task={item.task} onCommit={onRename} onCancel={onCancelRename} />
          ) : (
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: done ? "var(--cc-text-tertiary)" : undefined, textDecoration: done ? "line-through" : undefined, font: "500 12.5px/1.3 var(--cc-font-body)" }}>
              {item.task.title}
            </span>
          )}
        </span>
      </button>
      {showActions ? (
        <div style={{ position: "absolute", top: 5, right: 5, display: "flex", alignItems: "center", gap: 2 }}>
          <button
            type="button"
            disabled={done}
            aria-label={done ? `${item.task.title} completed` : `Mark ${item.task.title} complete`}
            title={done ? "Completed" : "Mark complete"}
            onClick={(event) => { event.stopPropagation(); if (!done) onMarkComplete(); }}
            style={{ width: 24, height: 24, display: "grid", placeItems: "center", border: 0, borderRadius: 5, background: done ? "var(--cc-status-success-bg-soft)" : "var(--cc-surface)", color: done ? "var(--cc-status-success)" : "var(--cc-text-tertiary)", cursor: done ? "default" : "pointer" }}
          >
            {done ? <CheckCircle2 size={13} /> : <Check size={13} />}
          </button>
          <button
            type="button"
            aria-label={pinned ? `Unpin ${item.task.title}` : `Pin ${item.task.title} to canvas`}
            title={pinned ? "Unpin from canvas" : "Pin to canvas"}
            onClick={(event) => { event.stopPropagation(); pinned ? onUnpin() : onPin(); }}
            style={{ width: 24, height: 24, display: "grid", placeItems: "center", border: 0, borderRadius: 5, background: pinned ? "var(--cc-brand-alpha-08)" : "var(--cc-surface)", color: pinned ? "var(--cc-brand-primary)" : "var(--cc-text-tertiary)", cursor: "pointer" }}
          >
            {pinned ? <PinOff size={12} /> : <Pin size={12} />}
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function FeedSubchatsPanel({
  rootTask,
  active,
  fromBrief,
  mainCurrent,
  readOnly,
  onOpenMain,
  onOpenTask,
  onPinTask,
  onUnpinTask,
  onStartScratch,
  onStartBrief,
  onRenameTask,
  onMarkComplete,
}: {
  rootTask: Task;
  active: FeedSubchatItem[];
  fromBrief: FeedSubchatItem[];
  mainCurrent: boolean;
  readOnly: boolean;
  onOpenMain: () => void;
  onOpenTask: (item: FeedSubchatItem) => void;
  onPinTask: (item: FeedSubchatItem) => void;
  onUnpinTask: (item: FeedSubchatItem) => void;
  onStartScratch: () => void;
  onStartBrief: (item: FeedSubchatItem) => void;
  onRenameTask: (taskId: string, title: string) => Promise<void> | void;
  onMarkComplete: (taskId: string) => Promise<void> | void;
}) {
  const [newOpen, setNewOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const {
    triggerRef,
    menuRef,
    registerItem,
    closeMenu,
    onMenuKeyDown,
    onTriggerKeyDown,
  } = useFeedMenuNavigation({ open: newOpen, setOpen: setNewOpen });
  const [menuPosition, setMenuPosition] = useState({ top: 0, left: 0, maxHeight: 320 });
  const positionMenu = useCallback(() => {
    const trigger = triggerRef.current;
    if (!trigger) return;
    const rect = trigger.getBoundingClientRect();
    const width = 230;
    const viewportGap = 8;
    const availableBelow = window.innerHeight - rect.bottom - viewportGap;
    const availableAbove = rect.top - viewportGap;
    const openAbove = availableBelow < 180 && availableAbove > availableBelow;
    const maxHeight = Math.max(120, Math.min(320, openAbove ? availableAbove - 4 : availableBelow - 4));
    setMenuPosition({
      top: openAbove ? Math.max(viewportGap, rect.top - Math.min(320, maxHeight) - 4) : rect.bottom + 4,
      left: Math.max(viewportGap, Math.min(rect.left, window.innerWidth - width - viewportGap)),
      maxHeight,
    });
  }, []);
  useEffect(() => {
    if (!newOpen) return;
    positionMenu();
    window.addEventListener("resize", positionMenu);
    window.addEventListener("scroll", positionMenu, true);
    return () => {
      window.removeEventListener("resize", positionMenu);
      window.removeEventListener("scroll", positionMenu, true);
    };
  }, [newOpen, positionMenu]);
  useEffect(() => {
    if (readOnly && newOpen) setNewOpen(false);
  }, [newOpen, readOnly]);
  const rename = async (taskId: string, title: string) => {
    setEditingId(null);
    await onRenameTask(taskId, title);
  };

  return (
    <div style={{ flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", padding: "10px 12px 14px", background: "var(--cc-surface)" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 4px 4px" }}>
        <span style={{ color: "var(--cc-text-secondary)", font: "600 10px/1 var(--cc-font-label)", textTransform: "uppercase", letterSpacing: ".12em" }}>Conversations</span>
        <button ref={triggerRef} className={menuStyles.trigger} type="button" disabled={readOnly} aria-haspopup="menu" aria-expanded={newOpen} onClick={() => setNewOpen((value) => !value)} onKeyDown={onTriggerKeyDown} style={{ height: 24, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 6px", border: 0, borderRadius: 7, background: "transparent", color: "var(--cc-brand-primary)", font: "600 11px/1 var(--cc-font-label)", cursor: readOnly ? "default" : "pointer", opacity: readOnly ? .45 : 1 }}>
          <Plus size={12} /> New <ChevronDown size={10} style={{ opacity: .6 }} />
        </button>
      </div>

      {newOpen ? createPortal(
        <div ref={menuRef} role="menu" aria-label="New subchat" onKeyDown={onMenuKeyDown} style={{ position: "fixed", top: menuPosition.top, left: menuPosition.left, zIndex: 400, width: 230, maxHeight: menuPosition.maxHeight, overflowY: "auto", padding: 4, border: "1px solid var(--cc-line-alpha-25)", borderRadius: 8, background: "var(--cc-surface)", boxShadow: "var(--cc-shadow-popover)" }}>
          <button ref={registerItem(0)} className={menuStyles.item} type="button" role="menuitem" onClick={() => { closeMenu(); onStartScratch(); }} style={{ width: "100%", minHeight: 32, display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", border: 0, borderRadius: 6, background: "transparent", color: "var(--cc-text-primary)", font: "600 12px/1.3 var(--cc-font-body)", textAlign: "left", cursor: "pointer" }}><Plus size={13} style={{ color: "var(--cc-brand-primary)" }} /> Start from scratch</button>
          {fromBrief.length ? <><div style={{ height: 1, margin: "5px 4px", background: "var(--cc-line-alpha-25)" }} /><div style={{ padding: "6px 8px 4px", color: "var(--cc-text-tertiary)", font: "600 9.5px/1 var(--cc-font-label)", textTransform: "uppercase", letterSpacing: ".1em" }}>From brief{rootTask.projectSlug ? ` · ${rootTask.projectSlug}` : ""}</div></> : null}
          {fromBrief.map((item, index) => <button key={item.task.id} ref={registerItem(index + 1)} className={menuStyles.item} type="button" role="menuitem" onClick={() => { closeMenu(); onStartBrief(item); }} style={{ width: "100%", minHeight: 32, display: "flex", alignItems: "center", gap: 8, padding: "6px 9px", border: 0, borderRadius: 6, background: "transparent", color: "var(--cc-text-primary)", font: "500 12px/1.3 var(--cc-font-body)", textAlign: "left", cursor: "pointer" }}><Play size={12} fill="var(--cc-status-success)" style={{ color: "var(--cc-status-success)" }} /><span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.task.title}</span></button>)}
        </div>,
        document.body,
      ) : null}

      <div>
        <button type="button" onClick={onOpenMain} style={{ width: "100%", minHeight: 42, display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", border: 0, borderRadius: 7, background: mainCurrent ? "var(--cc-brand-alpha-08)" : "transparent", color: "var(--cc-text-primary)", textAlign: "left", cursor: "pointer" }}>
          <StatusDot task={rootTask} />
          <span style={{ flex: 1, minWidth: 0 }}>
            <span style={{ display: "block", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "600 12.5px/1.3 var(--cc-font-body)" }}>Main chat</span>
            <span style={{ display: "block", marginTop: 2, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--cc-text-tertiary)", font: "400 10.5px/1.2 var(--cc-font-body)" }}>{rootTask.title}</span>
          </span>
        </button>
      </div>

      {active.length ? active.map((item) => (
        <SubchatRow key={item.task.id} item={item} editing={editingId === item.task.id} readOnly={readOnly} onOpen={() => onOpenTask(item)} onPin={() => onPinTask(item)} onUnpin={() => onUnpinTask(item)} onBeginRename={() => setEditingId(item.task.id)} onRename={(title) => void rename(item.task.id, title)} onCancelRename={() => setEditingId(null)} onMarkComplete={() => void onMarkComplete(item.task.id)} />
      )) : <div style={{ padding: "8px 9px", color: "var(--cc-text-tertiary)", font: "400 11.5px/1.5 var(--cc-font-body)" }}>No subchats yet. Start one from the brief below, or open a blank one.</div>}

      {fromBrief.length ? <>
        <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "15px 4px 6px" }}><span style={{ color: "var(--cc-text-secondary)", font: "600 10px/1 var(--cc-font-label)", textTransform: "uppercase", letterSpacing: ".12em" }}>From brief</span>{rootTask.projectSlug ? <span style={{ minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--cc-text-tertiary)", font: "400 10px/1 var(--cc-font-mono)" }}>{rootTask.projectSlug}</span> : null}</div>
        {fromBrief.map((item) => <button key={item.task.id} type="button" disabled={readOnly} onClick={() => onStartBrief(item)} style={{ width: "100%", minHeight: 36, display: "flex", alignItems: "center", gap: 9, padding: "7px 9px", marginBottom: 5, border: "1px dashed var(--cc-line-alpha-50)", borderRadius: 7, background: "var(--cc-surface-raised)", color: "var(--cc-text-secondary)", font: "500 12.5px/1.3 var(--cc-font-body)", textAlign: "left", cursor: readOnly ? "default" : "pointer", opacity: readOnly ? .55 : 1 }}><Circle size={14} style={{ color: "var(--cc-text-disabled)", flex: "0 0 auto" }} /><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{item.task.title}</span><span style={{ display: "inline-flex", alignItems: "center", gap: 4, color: "var(--cc-brand-primary)", font: "600 10.5px/1 var(--cc-font-label)" }}><Play size={11} fill="currentColor" /> Start</span></button>)}
      </> : null}
    </div>
  );
}
