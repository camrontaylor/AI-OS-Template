"use client";

import { useState, useEffect, Fragment, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Task } from "@/types/task";
import type { GoalDraftPayload } from "@/types/goal-draft";

const MONO = "'DM Mono', 'JetBrains Mono', 'SF Mono', ui-monospace, monospace";
const PAGE_SIZE = 5;

type ColKey = "goals" | "done";

export interface SwimLane {
  /** null = root / general */
  clientSlug: string | null;
  clientName: string;
  clientColor: string;
  goalDrafts: GoalDraftPayload[];
  goals: Task[];
  done: Task[];
}

export type DoneFilter = "1d" | "7d" | "30d" | "90d";

export interface KanbanBoardProps {
  lanes: SwimLane[];
  singleLane: boolean;
  renderCard: (task: Task, column: ColKey) => ReactNode;
  renderDraftCard?: (draft: GoalDraftPayload, laneClientSlug: string | null) => ReactNode;
  draggingId: string | null;
  onDropColumn: (column: ColKey, e: React.DragEvent) => void;
  onDragOverColumn: (column: ColKey, e: React.DragEvent) => void;
  onDragLeaveColumn: (column: ColKey) => void;
  dropOverColumn: ColKey | null;
  isEmpty: boolean;
  /** When true, hide the Done column entirely (e.g. when drawer is wide) */
  hideDone?: boolean;
  /** Active time filter for the Done column */
  doneFilter?: DoneFilter;
  /** Callback when user changes the done filter */
  onDoneFilterChange?: (filter: DoneFilter) => void;
  /** Group cards by tag in all columns */
  groupByTag?: boolean;
  onToggleGroupByTag?: () => void;
}

const COL_META: { key: ColKey; label: string; emptyText: string }[] = [
  { key: "goals", label: "Goals", emptyText: "No active tasks" },
  { key: "done", label: "Done", emptyText: "No completed tasks" },
];

const STACK_BREAKPOINT = 768;

function useIsNarrow() {
  const [narrow, setNarrow] = useState(false);
  useEffect(() => {
    if (typeof window === "undefined") return;
    const mq = window.matchMedia(`(max-width: ${STACK_BREAKPOINT}px)`);
    setNarrow(mq.matches);
    const handler = (e: MediaQueryListEvent) => setNarrow(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);
  return narrow;
}

const DONE_FILTER_OPTIONS: { key: DoneFilter; label: string }[] = [
  { key: "1d", label: "24h" },
  { key: "7d", label: "7d" },
  { key: "30d", label: "30d" },
  { key: "90d", label: "90d" },
];

export function KanbanBoard({
  lanes,
  singleLane,
  renderCard,
  renderDraftCard,
  draggingId,
  onDropColumn,
  onDragOverColumn,
  onDragLeaveColumn,
  dropOverColumn,
  isEmpty,
  hideDone,
  doneFilter,
  onDoneFilterChange,
  groupByTag,
  onToggleGroupByTag,
}: KanbanBoardProps) {
  const isDragging = !!draggingId;
  const isNarrow = useIsNarrow();
  const visibleCols = hideDone ? COL_META.filter((c) => c.key !== "done") : COL_META;

  // Build grid template with 1px divider columns between content columns
  // e.g. "minmax(0,1fr) 1px minmax(0,1fr) 1px minmax(0,1fr)" for 3 content columns
  // minmax(0,1fr) forces truly equal widths regardless of content
  const gridTemplate = isNarrow
    ? undefined
    : visibleCols.map(() => "minmax(0,1fr)").join(" 1px ");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 0 }}>
      {/* Column headers — desktop only */}
      {!isNarrow && (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: gridTemplate,
            marginBottom: 0,
          }}
        >
          {visibleCols.map((col, i) => {
            const count = lanes.reduce((sum, lane) => {
              if (col.key === "goals") {
                return sum + lane.goals.length + lane.goalDrafts.length;
              }
              return sum + lane.done.length;
            }, 0);
            return (
              <Fragment key={col.key}>
                {i > 0 && <div />}
                <div
                  style={{
                    fontSize: 11,
                    fontFamily: MONO,
                    fontWeight: 600,
                    color: "var(--cc-text-tertiary)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "6px 4px",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                    borderBottom: "1px solid var(--cc-line-alpha-35)",
                  }}
                >
                  {col.label}
                  {count > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: MONO,
                        color: "var(--cc-text-disabled)",
                        backgroundColor: "var(--cc-line-alpha-15)",
                        padding: "1px 6px",
                        borderRadius: 8,
                      }}
                    >
                      {count}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 2, marginLeft: "auto" }}>
                    {col.key === "done" && doneFilter && onDoneFilterChange && (
                      <>
                        {DONE_FILTER_OPTIONS.map((opt) => (
                          <button
                            key={opt.key}
                            onClick={() => onDoneFilterChange(opt.key)}
                            style={{
                              fontSize: 9,
                              fontFamily: MONO,
                              fontWeight: doneFilter === opt.key ? 600 : 400,
                              color: doneFilter === opt.key ? "var(--cc-brand-primary)" : "var(--cc-text-disabled)",
                              backgroundColor: doneFilter === opt.key ? "var(--cc-brand-alpha-08)" : "transparent",
                              border: "none",
                              borderRadius: 4,
                              padding: "2px 6px",
                              cursor: "pointer",
                              transition: "all 120ms ease",
                              textTransform: "none",
                              letterSpacing: 0,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <div style={{ width: 1, background: "var(--cc-line-alpha-40)", margin: "0 2px" }} />
                      </>
                    )}
                    {onToggleGroupByTag && (
                      <button
                        onClick={onToggleGroupByTag}
                        style={{
                          fontSize: 9,
                          fontFamily: MONO,
                          fontWeight: groupByTag ? 600 : 400,
                          color: groupByTag ? "var(--cc-brand-primary)" : "var(--cc-text-disabled)",
                          backgroundColor: groupByTag ? "var(--cc-brand-alpha-08)" : "transparent",
                          border: "none",
                          borderRadius: 4,
                          padding: "2px 6px",
                          cursor: "pointer",
                          transition: "all 120ms ease",
                          textTransform: "none",
                          letterSpacing: 0,
                        }}
                      >
                        By tag
                      </button>
                    )}
                  </div>
                </div>
              </Fragment>
            );
          })}
        </div>
      )}

      {/* Empty state */}
      {lanes.length === 0 && isEmpty && (
        <div
          style={{
            display: isNarrow ? "flex" : "grid",
            flexDirection: isNarrow ? "column" : undefined,
            gridTemplateColumns: gridTemplate,
          }}
        >
          {visibleCols.map((col, i) => (
            <Fragment key={col.key}>
              {!isNarrow && i > 0 && <div style={{ backgroundColor: "var(--cc-line-alpha-35)" }} />}
              <EmptyColumn text="No goals yet — enter one above to get started" />
            </Fragment>
          ))}
        </div>
      )}

      {/* Swim lanes */}
      {lanes.map((lane) => (
        <LaneRow
          key={lane.clientSlug ?? "_root"}
          lane={lane}
          singleLane={singleLane}
          renderCard={renderCard}
          renderDraftCard={renderDraftCard}
          isDragging={isDragging}
          dropOverColumn={dropOverColumn}
          onDropColumn={onDropColumn}
          onDragOverColumn={onDragOverColumn}
          onDragLeaveColumn={onDragLeaveColumn}
          isNarrow={isNarrow}
          visibleCols={visibleCols}
          gridTemplate={gridTemplate}
          groupByTag={groupByTag}
        />
      ))}
    </div>
  );
}

function LaneRow({
  lane,
  singleLane,
  renderCard,
  renderDraftCard,
  groupByTag,
  isDragging,
  dropOverColumn,
  onDropColumn,
  onDragOverColumn,
  onDragLeaveColumn,
  isNarrow,
  visibleCols,
  gridTemplate,
}: {
  lane: SwimLane;
  singleLane: boolean;
  renderCard: (task: Task, column: ColKey) => ReactNode;
  renderDraftCard?: (draft: GoalDraftPayload, laneClientSlug: string | null) => ReactNode;
  isDragging: boolean;
  dropOverColumn: ColKey | null;
  onDropColumn: (column: ColKey, e: React.DragEvent) => void;
  onDragOverColumn: (column: ColKey, e: React.DragEvent) => void;
  onDragLeaveColumn: (column: ColKey) => void;
  isNarrow: boolean;
  visibleCols: typeof COL_META;
  gridTemplate: string | undefined;
  groupByTag?: boolean;
}) {
  const [laneCollapsed, setLaneCollapsed] = useState(false);
  const totalTasks = lane.goalDrafts.length + lane.goals.length + lane.done.length;

  return (
    <div style={{ marginBottom: singleLane ? 0 : 4 }}>
      {/* Swim lane header — only when multiple clients */}
      {!singleLane && (
        <button
          onClick={() => setLaneCollapsed((v) => !v)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 8px 6px",
            margin: 0,
            background: "none",
            border: "none",
            borderBottom: "1px solid var(--cc-line-alpha-20)",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
          }}
        >
          <ChevronRight
            size={12}
            color="var(--cc-text-tertiary)"
            style={{
              transition: "transform 150ms ease",
              transform: laneCollapsed ? "rotate(0deg)" : "rotate(90deg)",
              flexShrink: 0,
            }}
          />
          <span
            style={{
              fontSize: 12,
              fontFamily: MONO,
              fontWeight: 600,
              color: "var(--cc-text-link-muted)",
            }}
          >
            {lane.clientName}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: "var(--cc-text-disabled)",
              marginLeft: 2,
            }}
          >
            {totalTasks}
          </span>
        </button>
      )}

      {/* Lane content */}
      {!laneCollapsed && (
        <div
          style={{
            display: isNarrow ? "flex" : "grid",
            flexDirection: isNarrow ? "column" : undefined,
            gridTemplateColumns: gridTemplate,
            alignItems: "start",
            paddingTop: singleLane ? 0 : 8,
          }}
        >
          {visibleCols.map((col, i) => (
            <Fragment key={col.key}>
              {!isNarrow && i > 0 && (
                <div style={{ backgroundColor: "var(--cc-line-alpha-35)", alignSelf: "stretch" }} />
              )}
                <ColumnCell
                  col={col}
                  laneClientSlug={lane.clientSlug}
                  tasks={lane[col.key]}
                  drafts={col.key === "goals" ? lane.goalDrafts : []}
                  isNarrow={isNarrow}
                  isDragging={isDragging}
                  dropOverColumn={dropOverColumn}
                  onDropColumn={onDropColumn}
                  groupByTag={!!groupByTag}
                  onDragOverColumn={onDragOverColumn}
                  onDragLeaveColumn={onDragLeaveColumn}
                  renderCard={renderCard}
                  renderDraftCard={renderDraftCard}
                />
              </Fragment>
            ))}
        </div>
      )}
    </div>
  );
}

/** Column cell — shows PAGE_SIZE tasks, with expand/collapse when more exist */
function ColumnCell({
  col,
  laneClientSlug,
  tasks: allTasks,
  drafts,
  isNarrow,
  isDragging,
  dropOverColumn,
  onDropColumn,
  onDragOverColumn,
  onDragLeaveColumn,
  renderCard,
  renderDraftCard,
  groupByTag,
}: {
  col: { key: ColKey; label: string; emptyText: string };
  laneClientSlug: string | null;
  tasks: Task[];
  drafts: GoalDraftPayload[];
  isNarrow: boolean;
  isDragging: boolean;
  dropOverColumn: ColKey | null;
  onDropColumn: (column: ColKey, e: React.DragEvent) => void;
  onDragOverColumn: (column: ColKey, e: React.DragEvent) => void;
  onDragLeaveColumn: (column: ColKey) => void;
  renderCard: (task: Task, column: ColKey) => ReactNode;
  renderDraftCard?: (draft: GoalDraftPayload, laneClientSlug: string | null) => ReactNode;
  groupByTag?: boolean;
}) {
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const hasOverflow = allTasks.length > visibleCount;
  const canCollapse = visibleCount > PAGE_SIZE;
  const visibleTasks = allTasks.slice(0, visibleCount);
  const hiddenCount = allTasks.length - visibleCount;

  const isDoneCol = col.key === "done";
  const isOver = dropOverColumn === col.key;
  const borderColor = isDragging
    ? isOver
      ? isDoneCol ? "var(--cc-palette-success-light)" : "var(--cc-border-brand-strong)"
      : isDoneCol ? "var(--cc-border-success)" : "var(--cc-line-alpha-30)"
    : "transparent";
  const bgColor = isDragging
    ? isOver
      ? isDoneCol ? "var(--cc-status-success-bg-soft)" : "var(--cc-status-purple-bg)"
      : "transparent"
    : "transparent";

  return (
    <div style={{ minWidth: 0, maxWidth: "100%" }}>
      {/* Narrow-mode column label */}
      {isNarrow && (
        <div
          style={{
            fontSize: 10,
            fontFamily: MONO,
            fontWeight: 600,
            color: "var(--cc-text-tertiary)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "8px 8px 4px",
            display: "flex",
            alignItems: "center",
            gap: 6,
            minWidth: 0,
            maxWidth: "100%",
            boxSizing: "border-box",
          }}
        >
          {col.label}
          {allTasks.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontFamily: MONO,
                color: "var(--cc-text-disabled)",
                backgroundColor: "var(--cc-line-alpha-15)",
                padding: "1px 6px",
                borderRadius: 8,
              }}
            >
              {allTasks.length}
            </span>
          )}
        </div>
      )}

      {/* Column drop zone + cards */}
      <div
        onDrop={(e) => { e.preventDefault(); onDropColumn(col.key, e); }}
        onDragOver={(e) => { e.preventDefault(); e.dataTransfer.dropEffect = "move"; onDragOverColumn(col.key, e); }}
        onDragLeave={() => onDragLeaveColumn(col.key)}
        style={{
          minHeight: isNarrow ? 40 : 80,
          borderRadius: 10,
          border: isDragging
            ? isOver
              ? `2px solid ${borderColor}`
              : `2px dashed ${borderColor}`
            : "2px solid transparent",
          backgroundColor: bgColor,
          padding: 4,
          transition: "all 150ms ease",
          display: "flex",
          flexDirection: "column",
          gap: 0,
          minWidth: 0,
          maxWidth: "100%",
          boxSizing: "border-box",
        }}
      >
        {allTasks.length === 0 && drafts.length === 0 ? (
          <EmptyColumn text={col.emptyText} compact={isNarrow} />
        ) : (
          <>
            {drafts.length > 0 && renderDraftCard ? (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 0,
                  borderRadius: 10,
                  overflow: "hidden",
                  borderBottom: "1px solid var(--cc-status-info-bg)",
                  marginBottom: allTasks.length > 0 ? 8 : 0,
                  minWidth: 0,
                  maxWidth: "100%",
                }}
              >
                {drafts.map((draft) => renderDraftCard(draft, laneClientSlug))}
              </div>
            ) : null}
            {(() => {
              if (groupByTag) {
                // Group tasks by tag
                const tagGroups = new Map<string, Task[]>();
                for (const t of visibleTasks) {
                  const key = t.tag || "_none";
                  if (!tagGroups.has(key)) tagGroups.set(key, []);
                  tagGroups.get(key)!.push(t);
                }
                // Sort: named tags alphabetically, "No tag" last
                const sorted = [...tagGroups.entries()].sort((a, b) => {
                  if (a[0] === "_none") return 1;
                  if (b[0] === "_none") return -1;
                  return a[0].localeCompare(b[0]);
                });
                return (
                  <div style={{ display: "flex", flexDirection: "column", gap: 10, minWidth: 0, maxWidth: "100%" }}>
                    {sorted.map(([tag, tasks]) => (
                      <div key={tag} style={{ minWidth: 0, maxWidth: "100%" }}>
                        <div style={{
                          fontSize: 9, fontFamily: MONO, fontWeight: 600, color: "var(--cc-text-disabled)",
                          textTransform: "uppercase", letterSpacing: "0.06em",
                          padding: "4px 6px 2px", display: "flex", alignItems: "center", gap: 6,
                        }}>
                          {tag === "_none" ? "No tag" : tag}
                          <span style={{ fontSize: 9, color: "var(--cc-palette-neutral-450)", fontWeight: 400 }}>{tasks.length}</span>
                        </div>
                        <div style={{
                          display: "flex", flexDirection: "column", gap: 0,
                          borderRadius: 10, overflow: "hidden",
                          borderBottom: "1px solid var(--cc-line-alpha-35)",
                          minWidth: 0,
                          maxWidth: "100%",
                        }}>
                          {tasks.map((task) => renderCard(task, col.key))}
                        </div>
                      </div>
                    ))}
                  </div>
                );
              }
              // Default: split pinned from unpinned for visual grouping
              const pinnedTasks = visibleTasks.filter((t) => !!t.pinnedAt);
              const unpinnedTasks = visibleTasks.filter((t) => !t.pinnedAt);
              const hasBothGroups = pinnedTasks.length > 0 && unpinnedTasks.length > 0;
              return (
                <div style={{ display: "flex", flexDirection: "column", gap: hasBothGroups ? 8 : 0, minWidth: 0, maxWidth: "100%" }}>
                  {pinnedTasks.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 0,
                        borderRadius: 10,
                        overflow: "hidden",
                        borderBottom: "1px solid var(--cc-line-alpha-35)",
                        minWidth: 0,
                        maxWidth: "100%",
                      }}
                    >
                      {pinnedTasks.map((task) => renderCard(task, col.key))}
                    </div>
                  )}
                  {unpinnedTasks.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 0,
                        borderRadius: 10,
                        overflow: "hidden",
                        borderBottom: "1px solid var(--cc-line-alpha-35)",
                        minWidth: 0,
                        maxWidth: "100%",
                      }}
                    >
                      {unpinnedTasks.map((task) => renderCard(task, col.key))}
                    </div>
                  )}
                </div>
              );
            })()}

            {/* Expand / Collapse toggles */}
            {(hasOverflow || canCollapse) && (
              <div style={{ display: "flex", gap: 4, marginTop: 6 }}>
                {hasOverflow && (
                  <button
                    onClick={() => setVisibleCount((v) => Math.min(v + PAGE_SIZE, allTasks.length))}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px dashed var(--cc-line-alpha-35)",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: MONO,
                      color: "var(--cc-text-tertiary)",
                      transition: "all 120ms ease",
                      flex: 1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--cc-line-alpha-08)";
                      e.currentTarget.style.color = "var(--cc-text-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--cc-text-tertiary)";
                    }}
                  >
                    <ChevronDown size={11} />
                    +{Math.min(hiddenCount, PAGE_SIZE)} more
                  </button>
                )}
                {canCollapse && (
                  <button
                    onClick={() => setVisibleCount(PAGE_SIZE)}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 4,
                      padding: "6px 12px",
                      borderRadius: 6,
                      border: "1px dashed var(--cc-line-alpha-35)",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: MONO,
                      color: "var(--cc-text-tertiary)",
                      transition: "all 120ms ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "var(--cc-line-alpha-08)";
                      e.currentTarget.style.color = "var(--cc-text-secondary)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--cc-text-tertiary)";
                    }}
                  >
                    <ChevronDown size={11} style={{ transform: "rotate(180deg)" }} />
                    Show less
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function EmptyColumn({ text, compact }: { text: string; compact?: boolean }) {
  return (
    <div
      style={{
        borderRadius: 10,
        border: "1.5px dashed var(--cc-line-alpha-35)",
        padding: compact ? "14px 12px" : "28px 16px",
        textAlign: "center",
        color: "var(--cc-text-disabled)",
        fontSize: 12,
        fontFamily: MONO,
      }}
    >
      {text}
    </div>
  );
}
