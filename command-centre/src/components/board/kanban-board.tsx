"use client";

import { useState, useEffect, Fragment, type ReactNode } from "react";
import { ChevronRight, ChevronDown } from "lucide-react";
import type { Task } from "@/types/task";
import type { GoalDraftPayload } from "@/types/goal-draft";

const MONO = "var(--font-inter), Inter, sans-serif";
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
  const [narrow, setNarrow] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth <= STACK_BREAKPOINT : false,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    // Use innerWidth on resize (not only matchMedia 'change'), so the board
    // reliably re-stacks even when the viewport changes without crossing the
    // breakpoint cleanly. This avoids a stale 2-column board on narrow widths.
    const check = () => setNarrow(window.innerWidth <= STACK_BREAKPOINT);
    check();
    const mq = window.matchMedia(`(max-width: ${STACK_BREAKPOINT}px)`);
    mq.addEventListener("change", check);
    window.addEventListener("resize", check);
    return () => {
      mq.removeEventListener("change", check);
      window.removeEventListener("resize", check);
    };
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
                    color: "var(--muted-foreground)",
                    textTransform: "uppercase",
                    letterSpacing: "0.06em",
                    padding: "8px 4px",
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    borderBottom: "1px solid var(--border)",
                  }}
                >
                  {col.label}
                  {count > 0 && (
                    <span
                      style={{
                        fontSize: 10,
                        fontFamily: MONO,
                        color: "var(--muted-foreground)",
                        backgroundColor: "color-mix(in srgb, var(--foreground) 15%, transparent)",
                        padding: "0px 8px",
                        borderRadius: 8,
                      }}
                    >
                      {count}
                    </span>
                  )}
                  <div style={{ display: "flex", gap: 4, marginLeft: "auto" }}>
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
                              color: doneFilter === opt.key ? "var(--primary)" : "var(--border)",
                              backgroundColor: doneFilter === opt.key ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "transparent",
                              border: "none",
                              borderRadius: 4,
                              padding: "4px 8px",
                              cursor: "pointer",
                              transition: "all 120ms ease",
                              textTransform: "none",
                              letterSpacing: 0,
                            }}
                          >
                            {opt.label}
                          </button>
                        ))}
                        <div style={{ width: 1, background: "var(--border)", margin: "0 4px" }} />
                      </>
                    )}
                    {onToggleGroupByTag && (
                      <button
                        onClick={onToggleGroupByTag}
                        style={{
                          fontSize: 9,
                          fontFamily: MONO,
                          fontWeight: groupByTag ? 600 : 400,
                          color: groupByTag ? "var(--primary)" : "var(--border)",
                          backgroundColor: groupByTag ? "color-mix(in srgb, var(--foreground) 8%, transparent)" : "transparent",
                          border: "none",
                          borderRadius: 4,
                          padding: "4px 8px",
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
              {!isNarrow && i > 0 && <div style={{ backgroundColor: "var(--border)" }} />}
              <EmptyColumn text="No goals yet - enter one above to get started" />
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
            gap: 8,
            padding: "8px 8px 8px",
            margin: 0,
            background: "none",
            border: "none",
            borderBottom: "1px solid var(--border)",
            cursor: "pointer",
            width: "100%",
            textAlign: "left",
          }}
        >
          <ChevronRight
            size={12}
            color="var(--muted-foreground)"
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
              color: "var(--muted-foreground)",
            }}
          >
            {lane.clientName}
          </span>
          <span
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: "var(--muted-foreground)",
              marginLeft: 4,
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
                <div style={{ backgroundColor: "var(--border)", alignSelf: "stretch" }} />
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
      ? isDoneCol ? "var(--muted-foreground)" : "color-mix(in srgb, var(--foreground) 50%, transparent)"
      : isDoneCol ? "var(--border)" : "color-mix(in srgb, var(--foreground) 30%, transparent)"
    : "transparent";
  const bgColor = isDragging
    ? isOver
      ? isDoneCol ? "color-mix(in srgb, var(--foreground) 6%, transparent)" : "color-mix(in srgb, var(--foreground) 3%, transparent)"
      : "transparent"
    : "transparent";

  return (
    <div>
      {/* Narrow-mode column label */}
      {isNarrow && (
        <div
          style={{
            fontSize: 10,
            fontFamily: MONO,
            fontWeight: 600,
            color: "var(--muted-foreground)",
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            padding: "8px 8px 4px",
            display: "flex",
            alignItems: "center",
            gap: 8,
          }}
        >
          {col.label}
          {allTasks.length > 0 && (
            <span
              style={{
                fontSize: 10,
                fontFamily: MONO,
                color: "var(--muted-foreground)",
                backgroundColor: "color-mix(in srgb, var(--foreground) 15%, transparent)",
                padding: "0px 8px",
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
                  gap: 8,
                  marginBottom: allTasks.length > 0 ? 8 : 0,
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
                  <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
                    {sorted.map(([tag, tasks]) => (
                      <div key={tag}>
                        <div style={{
                          fontSize: 9, fontFamily: MONO, fontWeight: 600, color: "var(--muted-foreground)",
                          textTransform: "uppercase", letterSpacing: "0.06em",
                          padding: "4px 8px 4px", display: "flex", alignItems: "center", gap: 8,
                        }}>
                          {tag === "_none" ? "No tag" : tag}
                          <span style={{ fontSize: 9, color: "var(--muted-foreground)", fontWeight: 400 }}>{tasks.length}</span>
                        </div>
                        <div style={{
                          display: "flex", flexDirection: "column", gap: 8,
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
                <div style={{ display: "flex", flexDirection: "column", gap: hasBothGroups ? 8 : 0 }}>
                  {pinnedTasks.length > 0 && (
                    <div
                      style={{
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
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
                        gap: 8,
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
              <div style={{ display: "flex", gap: 4, marginTop: 8 }}>
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
                      border: "1px dashed var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: MONO,
                      color: "var(--muted-foreground)",
                      transition: "all 120ms ease",
                      flex: 1,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)";
                      e.currentTarget.style.color = "var(--muted-foreground)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--muted-foreground)";
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
                      border: "1px dashed var(--border)",
                      background: "transparent",
                      cursor: "pointer",
                      fontSize: 11,
                      fontFamily: MONO,
                      color: "var(--muted-foreground)",
                      transition: "all 120ms ease",
                      flexShrink: 0,
                    }}
                    onMouseEnter={(e) => {
                      e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)";
                      e.currentTarget.style.color = "var(--muted-foreground)";
                    }}
                    onMouseLeave={(e) => {
                      e.currentTarget.style.backgroundColor = "transparent";
                      e.currentTarget.style.color = "var(--muted-foreground)";
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
        border: "1.5px dashed var(--border)",
        padding: compact ? "16px 12px" : "28px 16px",
        textAlign: "center",
        color: "var(--muted-foreground)",
        fontSize: 12,
        fontFamily: MONO,
      }}
    >
      {text}
    </div>
  );
}
