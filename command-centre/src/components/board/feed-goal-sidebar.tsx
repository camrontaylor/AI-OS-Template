"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent, type PointerEvent as ReactPointerEvent } from "react";
import { Archive, Check, ChevronDown, ChevronRight, Globe2, PanelLeft, Pin, Plus, RotateCcw, Search } from "lucide-react";
import type { Client } from "@/types/client";
import type { GoalDraftPayload } from "@/types/goal-draft";
import type { Task } from "@/types/task";
import styles from "./feed-goal-sidebar.module.css";
import {
  FEED_SIDEBAR_DEFAULT_WIDTH,
  FEED_SIDEBAR_MIN_WIDTH,
  clampFeedSidebarWidth,
  getFeedSidebarMaximumWidth,
  groupFeedGoalSidebarItems,
  searchArchivedFeedGoals,
} from "./feed-goal-sidebar-state";
import { isPermanentFeedTaskId } from "./feed-workspace-state";
import { useFeedMenuNavigation } from "./use-feed-menu-navigation";
import menuStyles from "./feed-menu.module.css";

const SIDEBAR_STORAGE_KEY = "command-centre.feed-sidebar-collapsed";
const SIDEBAR_WIDTH_STORAGE_KEY = "command-centre.feed-sidebar-width";

function statusColor(task: Task, attention: boolean, unread: boolean): string | null {
  if (attention || unread) return "var(--cc-status-warning-bright)";
  if (task.status === "running") return "var(--cc-status-purple)";
  if (task.status === "done" || task.status === "review") return null;
  return "var(--cc-line-alpha-40)";
}

function relativeTime(task: Task): string {
  const value = task.archivedAt ?? task.lastReplyAt ?? task.updatedAt ?? task.createdAt;
  const elapsed = Math.max(0, Date.now() - new Date(value).getTime());
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

function draftRelativeTime(draft: GoalDraftPayload): string {
  const elapsed = Math.max(0, Date.now() - new Date(draft.updatedAt).getTime());
  if (elapsed < 60_000) return "now";
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)}m`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)}h`;
  return `${Math.floor(elapsed / 86_400_000)}d`;
}

export function FeedGoalSidebar({
  activeGoals,
  drafts,
  archivedGoals,
  clients,
  rootName,
  selectedClientId,
  selectedGoalId,
  selectedDraftId,
  onSelectWorkspace,
  onNewGoal,
  onSelectGoal,
  onSelectDraft,
  onPinGoal,
  onArchiveGoal,
  onRestoreGoal,
  attentionGoalIds = [],
  unreadGoalIds = [],
  archivePendingIds = [],
  restorePendingIds = [],
}: {
  activeGoals: Task[];
  drafts: GoalDraftPayload[];
  archivedGoals: Task[];
  clients: Client[];
  rootName: string;
  selectedClientId: string | null;
  selectedGoalId: string | null;
  selectedDraftId: string | null;
  onSelectWorkspace: (clientId: string | null) => void;
  onNewGoal: () => void;
  onSelectGoal: (goalId: string) => void;
  onSelectDraft: (draftId: string) => void;
  onPinGoal: (goal: Task) => void;
  onArchiveGoal: (goal: Task) => void;
  onRestoreGoal: (goal: Task) => void;
  attentionGoalIds?: string[];
  unreadGoalIds?: string[];
  archivePendingIds?: string[];
  restorePendingIds?: string[];
}) {
  const [collapsed, setCollapsed] = useState(false);
  const [workspaceOpen, setWorkspaceOpen] = useState(false);
  const [archiveView, setArchiveView] = useState(false);
  const [query, setQuery] = useState("");
  const [hoveredGoalId, setHoveredGoalId] = useState<string | null>(null);
  const [closedGroups, setClosedGroups] = useState<Set<string>>(new Set());
  const [sidebarWidth, setSidebarWidth] = useState(FEED_SIDEBAR_DEFAULT_WIDTH);
  const sidebarRef = useRef<HTMLElement>(null);
  const resizeCleanupRef = useRef<(() => void) | null>(null);
  const {
    triggerRef: workspaceTriggerRef,
    menuRef: workspaceMenuRef,
    registerItem: registerWorkspaceItem,
    closeMenu: closeWorkspaceMenu,
    onMenuKeyDown: onWorkspaceMenuKeyDown,
    onTriggerKeyDown: onWorkspaceTriggerKeyDown,
  } = useFeedMenuNavigation({ open: workspaceOpen, setOpen: setWorkspaceOpen });

  const openNewGoal = (event: MouseEvent<HTMLButtonElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setArchiveView(false);
    setWorkspaceOpen(false);
    onNewGoal();
  };

  useEffect(() => {
    try {
      setCollapsed(window.localStorage.getItem(SIDEBAR_STORAGE_KEY) === "true");
      const storedWidth = Number(window.localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
      if (Number.isFinite(storedWidth) && storedWidth > 0) {
        setSidebarWidth(clampFeedSidebarWidth(storedWidth, window.innerWidth));
      }
    } catch {}
  }, []);

  useEffect(() => {
    const onViewportResize = () => {
      setSidebarWidth((current) => clampFeedSidebarWidth(current, window.innerWidth));
    };
    window.addEventListener("resize", onViewportResize);
    return () => window.removeEventListener("resize", onViewportResize);
  }, []);

  useEffect(() => () => resizeCleanupRef.current?.(), []);

  const commitSidebarWidth = useCallback((width: number) => {
    const next = clampFeedSidebarWidth(width, window.innerWidth);
    if (sidebarRef.current) sidebarRef.current.style.width = `${next}px`;
    setSidebarWidth(next);
    try { window.localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(next)); } catch {}
  }, []);

  const beginSidebarResize = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarRef.current?.getBoundingClientRect().width ?? sidebarWidth;
    let lastX = startX;
    let frameId: number | null = null;
    let nextWidth = startWidth;
    const paint = () => {
      frameId = null;
      nextWidth = clampFeedSidebarWidth(startWidth + lastX - startX, window.innerWidth);
      if (sidebarRef.current) sidebarRef.current.style.width = `${nextWidth}px`;
    };
    const schedulePaint = () => {
      if (frameId !== null) return;
      frameId = requestAnimationFrame(paint);
    };
    const onMove = (moveEvent: globalThis.PointerEvent) => {
      moveEvent.preventDefault();
      lastX = moveEvent.clientX;
      schedulePaint();
    };
    const cleanup = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("keydown", onKeyDown);
      if (frameId !== null) cancelAnimationFrame(frameId);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      resizeCleanupRef.current = null;
    };
    const finish = (commit: boolean) => {
      if (frameId !== null) {
        cancelAnimationFrame(frameId);
        frameId = null;
      }
      if (commit) {
        paint();
        commitSidebarWidth(nextWidth);
      } else if (sidebarRef.current) {
        sidebarRef.current.style.width = `${sidebarWidth}px`;
      }
      cleanup();
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onKeyDown = (keyEvent: KeyboardEvent) => {
      if (keyEvent.key === "Escape") finish(false);
    };
    resizeCleanupRef.current?.();
    resizeCleanupRef.current = () => finish(false);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
    window.addEventListener("pointermove", onMove, { passive: false });
    window.addEventListener("pointerup", onUp, { once: true });
    window.addEventListener("pointercancel", onCancel, { once: true });
    window.addEventListener("keydown", onKeyDown);
  }, [commitSidebarWidth, sidebarWidth]);

  const updateCollapsed = (next: boolean) => {
    setCollapsed(next);
    if (next) setWorkspaceOpen(false);
    try { window.localStorage.setItem(SIDEBAR_STORAGE_KEY, String(next)); } catch {}
  };

  const selectedWorkspaceName = selectedClientId
    ? clients.find((client) => client.slug === selectedClientId)?.name ?? selectedClientId
    : rootName;

  const groups = useMemo(() => {
    return groupFeedGoalSidebarItems(activeGoals, drafts, clients, selectedClientId);
  }, [activeGoals, clients, drafts, selectedClientId]);

  const archivedRows = useMemo(() => {
    return searchArchivedFeedGoals({ goals: archivedGoals, clients, rootName, selectedClientId, query });
  }, [archivedGoals, clients, query, rootName, selectedClientId]);

  if (collapsed) {
    return (
      <aside className={styles.rail} aria-label="Goal navigation">
        <button className={styles.iconButton} onClick={() => updateCollapsed(false)} title="Expand sidebar" aria-label="Expand sidebar"><PanelLeft size={16} /></button>
        <button type="button" className={`${styles.iconButton} ${styles.iconButtonAccent}`} onMouseDown={(event) => event.stopPropagation()} onClick={openNewGoal} title="New Goal" aria-label="New Goal"><Plus size={15} /></button>
        <div className={styles.railSpacer} />
        <button className={styles.iconButton} onClick={() => { updateCollapsed(false); setArchiveView(true); }} title={`Archived (${archivedGoals.length})`} aria-label="Open Archived"><Archive size={15} /></button>
      </aside>
    );
  }

  return (
    <aside ref={sidebarRef} className={styles.sidebar} aria-label="Goal navigation" style={{ width: sidebarWidth }}>
      <div className={styles.workspaceWrap}>
        <div className={styles.workspaceHeader}>
          <span className={styles.sectionLabel}>Workspace</span>
          <button className={`${styles.iconButton} ${styles.collapseButton}`} onClick={() => updateCollapsed(true)} title="Collapse sidebar" aria-label="Collapse sidebar"><PanelLeft size={14} /></button>
        </div>
        <button ref={workspaceTriggerRef} className={`${styles.workspaceButton} ${menuStyles.trigger}`} onClick={() => setWorkspaceOpen((open) => !open)} onKeyDown={onWorkspaceTriggerKeyDown} aria-expanded={workspaceOpen} aria-haspopup="menu">
          <span className={styles.workspaceLabel}><Globe2 size={15} /><span className={styles.ellipsis}>{selectedWorkspaceName}</span></span>
          <ChevronDown size={14} />
        </button>
        {workspaceOpen ? (
          <div ref={workspaceMenuRef} className={styles.workspaceMenu} role="menu" aria-label="Workspace" onKeyDown={onWorkspaceMenuKeyDown}>
            <button
              ref={registerWorkspaceItem(0)}
              className={`${styles.menuOption} ${menuStyles.item} ${!selectedClientId ? styles.menuOptionSelected : ""}`}
              role="menuitem"
              aria-current={!selectedClientId ? "true" : undefined}
              onClick={() => { onSelectWorkspace(null); closeWorkspaceMenu(); }}
            >
              <span><strong>{rootName}</strong><span className={styles.menuHint}>All clients</span></span>
              {!selectedClientId ? <Check size={14} /> : null}
            </button>
            {clients.map((client, index) => (
              <button
                key={client.slug}
                ref={registerWorkspaceItem(index + 1)}
                className={`${styles.menuOption} ${menuStyles.item} ${selectedClientId === client.slug ? styles.menuOptionSelected : ""}`}
                role="menuitem"
                aria-current={selectedClientId === client.slug ? "true" : undefined}
                onClick={() => { onSelectWorkspace(client.slug); closeWorkspaceMenu(); }}
              >
                <span><strong>{client.name}</strong><span className={styles.menuHint}>clients/{client.slug}</span></span>
                {selectedClientId === client.slug ? <Check size={14} /> : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      <div className={styles.newGoalWrap}>
        <button type="button" className={styles.newGoal} onMouseDown={(event) => event.stopPropagation()} onClick={openNewGoal}><Plus size={14} /> New Goal</button>
      </div>

      <div className={styles.list}>
        {archiveView ? (
          <>
            <div className={styles.archiveHeader}>
              <button className={`${styles.iconButton} ${styles.collapseButton}`} onClick={() => setArchiveView(false)} title="Back to active Goals" aria-label="Back to active Goals"><ChevronRight size={15} style={{ transform: "rotate(180deg)" }} /></button>
              <span className={styles.archiveTitle}>Archived</span>
              <span className={styles.archiveCount}>{archivedGoals.length}</span>
            </div>
            <label className={styles.searchWrap}>
              <Search size={13} color="var(--cc-text-tertiary)" />
              <input className={styles.search} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search archived..." />
            </label>
            {archivedRows.length ? archivedRows.map((goal) => (
              <div
                key={goal.id}
                className={`${styles.goalRow} ${selectedGoalId === goal.id ? styles.goalRowSelected : ""}`}
                onMouseEnter={() => setHoveredGoalId(goal.id)}
                onMouseLeave={() => setHoveredGoalId(null)}
              >
                <button className={styles.goalMain} onClick={() => onSelectGoal(goal.id)}>
                  <span className={styles.goalText}><span className={styles.goalTitle}>{goal.title}</span><span className={styles.goalMeta}>{goal.clientId ? `clients/${goal.clientId}` : "AI-OS"} · {relativeTime(goal)}</span></span>
                </button>
                {hoveredGoalId === goal.id ? (
                  <button
                    type="button"
                    className={styles.restoreButton}
                    disabled={restorePendingIds.includes(goal.id)}
                    aria-busy={restorePendingIds.includes(goal.id)}
                    onClick={() => onRestoreGoal(goal)}
                  >
                    <RotateCcw size={11} /> {restorePendingIds.includes(goal.id) ? "Restoring…" : "Restore"}
                  </button>
                ) : null}
              </div>
            )) : <div className={styles.empty}>No archived Goals match.</div>}
          </>
        ) : groups.map((group) => {
          const closed = closedGroups.has(group.id);
          return (
            <div className={styles.group} key={group.id}>
              <button className={styles.groupButton} onClick={() => setClosedGroups((current) => {
                const next = new Set(current);
                if (next.has(group.id)) next.delete(group.id); else next.add(group.id);
                return next;
              })}>
                <ChevronRight size={11} style={{ transform: closed ? undefined : "rotate(90deg)" }} />
                <span className={styles.ellipsis}>{group.name}</span>
                <span className={styles.groupCount}>{group.goals.length + group.drafts.length}</span>
              </button>
              {!closed ? <>
                {group.drafts.map((draft) => {
                  const title = draft.title.trim() || "Untitled draft";
                  return (
                    <div key={draft.id} className={`${styles.goalRow} ${selectedDraftId === draft.id ? styles.goalRowSelected : ""}`}>
                      <button className={styles.goalMain} onClick={() => onSelectDraft(draft.id)}>
                        <span className={styles.draftBadge}>Draft</span>
                        <span className={styles.goalText}><span className={styles.goalTitle} title={title}>{title}</span></span>
                        <span className={styles.goalMeta}>{draftRelativeTime(draft)}</span>
                      </button>
                    </div>
                  );
                })}
                {group.goals.map((goal) => {
                  const attention = attentionGoalIds.includes(goal.id);
                  const unread = unreadGoalIds.includes(goal.id);
                  const dotColor = statusColor(goal, attention, unread);
                  return (
                    <div key={goal.id} className={`${styles.goalRow} ${selectedGoalId === goal.id ? styles.goalRowSelected : ""}`} onMouseEnter={() => setHoveredGoalId(goal.id)} onMouseLeave={() => setHoveredGoalId(null)}>
                      <button className={styles.goalMain} onClick={() => onSelectGoal(goal.id)}>
                        <span
                          className={`${styles.statusDot} ${dotColor ? "" : styles.statusDotHidden} ${attention || unread ? styles.statusDotAttention : ""}`}
                          style={{ background: dotColor ?? "transparent" }}
                          title={attention ? "Needs your attention" : unread ? "Unread result" : undefined}
                        />
                        <span className={styles.goalText}><span className={styles.goalTitle}>{goal.title}</span></span>
                        {hoveredGoalId !== goal.id ? <span className={styles.goalMeta}>{relativeTime(goal)}</span> : null}
                      </button>
                      {hoveredGoalId === goal.id && isPermanentFeedTaskId(goal.id) ? (
                        <>
                          <button className={styles.rowAction} title={goal.pinnedAt ? "Unpin Goal" : "Pin Goal"} onClick={() => onPinGoal(goal)}><Pin size={12} fill={goal.pinnedAt ? "currentColor" : "none"} /></button>
                          <button
                            type="button"
                            className={styles.rowAction}
                            title={archivePendingIds.includes(goal.id) ? "Archiving Goal" : "Archive Goal"}
                            aria-label={archivePendingIds.includes(goal.id) ? "Archiving Goal" : "Archive Goal"}
                            aria-busy={archivePendingIds.includes(goal.id)}
                            disabled={archivePendingIds.includes(goal.id)}
                            onClick={() => onArchiveGoal(goal)}
                          ><Archive size={13} /></button>
                        </>
                      ) : null}
                    </div>
                  );
                })}
              </> : null}
            </div>
          );
        })}
      </div>

      {!archiveView ? (
        <div className={styles.archiveFooter}>
          <button className={styles.archiveButton} onClick={() => setArchiveView(true)}><Archive size={14} /> Archived <span className={styles.archiveCount}>{archivedGoals.length}</span></button>
        </div>
      ) : null}
      <div
        className={styles.resizeHandle}
        role="separator"
        aria-label="Resize Goal navigation"
        aria-orientation="vertical"
        aria-valuemin={FEED_SIDEBAR_MIN_WIDTH}
        aria-valuemax={getFeedSidebarMaximumWidth(typeof window === "undefined" ? 1280 : window.innerWidth)}
        aria-valuenow={sidebarWidth}
        tabIndex={0}
        onPointerDown={beginSidebarResize}
        onDoubleClick={() => commitSidebarWidth(FEED_SIDEBAR_DEFAULT_WIDTH)}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") { event.preventDefault(); commitSidebarWidth(sidebarWidth - 8); }
          if (event.key === "ArrowRight") { event.preventDefault(); commitSidebarWidth(sidebarWidth + 8); }
          if (event.key === "Home") { event.preventDefault(); commitSidebarWidth(FEED_SIDEBAR_MIN_WIDTH); }
          if (event.key === "End") { event.preventDefault(); commitSidebarWidth(getFeedSidebarMaximumWidth(window.innerWidth)); }
        }}
      ><span /></div>
    </aside>
  );
}
