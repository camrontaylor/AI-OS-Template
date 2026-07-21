"use client";

import { useEffect, useState, useCallback, useRef, useMemo } from "react";
import { useTaskStore } from "@/store/task-store";
import type { LogEntry, OutputFile } from "@/types/task";
import { ModalHeader } from "./modal-header";
import { ModalChat } from "./modal-chat";
import { ReplyInput } from "./reply-input";
import { ModalFilePreview } from "./modal-file-preview";
import { ModalNewTaskForm } from "./modal-new-task-form";
import { ProjectDashboard } from "./project-dashboard";
import { ChatList } from "./chat-list";
import { PaneContainer } from "./pane-container";
import { PanelOutputs } from "../panel/panel-outputs";
import { QuestionModal } from "@/components/shared/question-modal";
import {
  DraftPlanPreviewModal,
  DraftPlanPreviewPanel,
} from "@/components/shared/draft-plan-preview";
import { usePaneState } from "@/hooks/use-pane-state";
import {
  parseQuestionSpecs,
  type QuestionSpec,
  type QuestionAnswers,
} from "@/types/question-spec";
import {
  extractPendingApprovedBriefFromLogs,
  getPendingPlanApprovalQuestion,
} from "@/lib/plan-brief";
import { getInheritedPermissionModes } from "@/lib/permission-mode";

// Stable reference to avoid infinite re-render loop in Zustand selector
const EMPTY_LOG_ENTRIES: LogEntry[] = [];

type ModalTab = "conversation" | "plan" | "files";

const TAB_CONFIG: { key: ModalTab; getLabel?: (count: number) => string; label?: string }[] = [
  { key: "conversation", label: "Chat" },
  { key: "files", getLabel: (count: number) => `Files (${count})` },
  { key: "plan", label: "Plan" },
];

export function TaskModal() {
  const selectedTaskId = useTaskStore((s) => s.selectedTaskId);
  const closePanel = useTaskStore((s) => s.closePanel);
  const tasks = useTaskStore((s) => s.tasks);
  const fetchLogEntries = useTaskStore((s) => s.fetchLogEntries);
  const updateTask = useTaskStore((s) => s.updateTask);

  const [isVisible, setIsVisible] = useState(false);
  const [activeFile, setActiveFile] = useState<OutputFile | null>(null);
  const [activeTab, setActiveTab] = useState<ModalTab>("conversation");
  const [newTaskAttachment, setNewTaskAttachment] = useState<{ fileName: string; relativePath: string } | null>(null);
  const [showDraftPlanModal, setShowDraftPlanModal] = useState(false);
  // Tracks which HTML outputs we've already auto-previewed for each task so we
  // don't re-open them if the user navigates away. Keyed by `${taskId}:${id}`.
  const autoPreviewedRef = useRef<Set<string>>(new Set());
  // Tracks whether the user has manually interacted with the file preview for
  // a given task — if so, we stop auto-opening new HTML outputs for that task.
  const userDismissedAutoPreviewRef = useRef<Set<string>>(new Set());

  // Resizable panel
  const [panelWidth, setPanelWidth] = useState(580);
  const panelRef = useRef<HTMLDivElement>(null);
  const [measuredPanelWidth, setMeasuredPanelWidth] = useState(0);
  useEffect(() => {
    const el = panelRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      if (w > 0) setMeasuredPanelWidth(w);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  // Track the real viewport width so the panel can go full-width on phones and
  // tablets. A resize listener is used (not 100vw) so the panel never exceeds
  // the device width, which also stops the layout viewport from inflating.
  const [windowWidth, setWindowWidth] = useState(() =>
    typeof window !== "undefined" ? window.innerWidth : 0,
  );
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onResize = () => setWindowWidth(window.innerWidth);
    onResize();
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const isNarrowViewport = windowWidth > 0 && windowWidth <= 768;
  // Auto-collapse the conversation sidebar when the panel is too narrow for a
  // comfortable chat + sidebar, or whenever we are on a narrow viewport. The
  // user can still toggle it open when there is room.
  const autoCollapseSidebar = isNarrowViewport || (measuredPanelWidth || panelWidth) < 720;
  const isResizing = useRef(false);
  const startX = useRef(0);
  const startWidth = useRef(580);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizing.current = true;
    startX.current = e.clientX;
    startWidth.current = panelWidth;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const handleMouseMove = (ev: MouseEvent) => {
      if (!isResizing.current) return;
      const delta = startX.current - ev.clientX;
      const newWidth = Math.min(Math.max(startWidth.current + delta, 360), window.innerWidth - 40);
      setPanelWidth(newWidth);
    };

    const handleMouseUp = () => {
      isResizing.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", handleMouseMove);
      document.removeEventListener("mouseup", handleMouseUp);
    };

    document.addEventListener("mousemove", handleMouseMove);
    document.addEventListener("mouseup", handleMouseUp);
  }, [panelWidth]);

  // Navigation stack for viewing subtasks within the modal
  const [navStack, setNavStack] = useState<string[]>([]);
  const viewingTaskId = navStack.length > 0 ? navStack[navStack.length - 1] : selectedTaskId;

  const task = viewingTaskId
    ? tasks.find((t) => t.id === viewingTaskId)
    : null;

  // Get child tasks for parent-level tasks OR any task that has children.
  // Match GoalCard's join: any task whose parentId === viewingTaskId, OR any
  // task that shares the same projectSlug (catches legacy wizard children
  // that were created with parentId: null before the backfill landed).
  const childTasks = task
    ? tasks
        .filter(
          (t) =>
            t.parentId === viewingTaskId ||
            (task!.projectSlug && t.projectSlug === task!.projectSlug && t.id !== task!.id)
        )
        .sort((a, b) => a.columnOrder - b.columnOrder)
    : [];
  const isParentTask = task && (task.level !== "task" || childTasks.length > 0);

  // Navigate into a subtask without closing the modal
  const navigateToChild = useCallback((childId: string) => {
    setNavStack((prev) => [...prev, childId]);
    // Clear the auto-preview dismissal for the child so its HTML outputs can
    // auto-open when we land on it.
    userDismissedAutoPreviewRef.current.delete(childId);
    setActiveFile(null);
    setActiveTab("conversation");
  }, []);

  // Navigate back to parent
  const navigateBack = useCallback(() => {
    setNavStack((prev) => prev.slice(0, -1));
    setActiveFile(null);
    setActiveTab("conversation");
  }, []);

  const hasNavHistory = navStack.length > 0;

  // ── VS Code-style pane state (extracted hook) ────────────────────
  const {
    paneState,
    visiblePanes,
    hasPanesOpen,
    isMainChatSolo,
    handleOpenChat,
    handleOpenTerminal,
    handleOpenSubtaskPane,
    handleAddToViewport,
    handleClosePane,
    handleRemovePane,
    handleFocusPane,
    handleFocusMainChat,
    handleSplitWithNew,
    handleSetLayout,
    handleToggleSidebar,
    handleCloseAllPanes,
    handleRenamePane,
    handleAssignTaskToPane,
    resetPaneState,
  } = usePaneState(viewingTaskId ?? undefined);

  // Track whether we've auto-expanded for this modal open
  const hasAutoExpanded = useRef(false);

  // Auto-expand modal when multiple panes become visible
  useEffect(() => {
    if (visiblePanes.length >= 2 && !hasAutoExpanded.current) {
      hasAutoExpanded.current = true;
      const target = Math.min(panelWidth * 1.5, window.innerWidth - 40);
      if (target > panelWidth) {
        setPanelWidth(Math.round(target));
      }
    }
  }, [visiblePanes.length, panelWidth]);

  // Reset pane state when modal closes or task changes
  useEffect(() => {
    resetPaneState();
    hasAutoExpanded.current = false;
  }, [selectedTaskId, resetPaneState]);

  // Fetch log entries into the store when task changes
  useEffect(() => {
    if (!selectedTaskId) {
      setIsVisible(false);
      setActiveFile(null);
      setActiveTab("conversation");
      setNewTaskAttachment(null);
      setNavStack([]);
      return;
    }

    setActiveFile(null);
    setActiveTab("conversation");
    setNewTaskAttachment(null);
    setNavStack([]);

    // Animate in
    requestAnimationFrame(() => {
      setIsVisible(true);
    });

    // Load persisted logs into the store (SSE will append to the same store entry)
    fetchLogEntries(selectedTaskId);
  }, [selectedTaskId, fetchLogEntries]);

  // needsInput is cleared when the user sends a reply, not on view

  // Fetch log entries for all child tasks
  useEffect(() => {
    if (childTasks.length === 0) return;
    for (const child of childTasks) {
      fetchLogEntries(child.id);
    }
    // Only re-fetch when the set of child IDs changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [childTasks.map((c) => c.id).join(","), fetchLogEntries]);

  // Auto-preview: when the currently-viewed task produces an HTML output,
  // automatically open it in the file preview (Vibe Kanban-style). We only
  // do this once per output, and we stop auto-previewing for a task if the
  // user has manually closed a preview for that task.
  const allOutputFiles = useTaskStore((s) => s.outputFiles);
  const currentOutputs = viewingTaskId ? allOutputFiles[viewingTaskId] : undefined;
  useEffect(() => {
    if (!viewingTaskId || !currentOutputs || currentOutputs.length === 0) return;
    if (userDismissedAutoPreviewRef.current.has(viewingTaskId)) return;
    if (activeFile) return; // Don't override a file the user is already viewing

    // Find the most recent HTML output we haven't auto-previewed yet
    const htmlOutputs = currentOutputs.filter((f) =>
      /\.(html?|htm)$/i.test(f.fileName)
    );
    if (htmlOutputs.length === 0) return;

    // Sort newest first — OutputFile has createdAt
    const sorted = [...htmlOutputs].sort((a, b) => {
      const ta = new Date(a.createdAt).getTime();
      const tb = new Date(b.createdAt).getTime();
      return tb - ta;
    });
    const latest = sorted[0];
    const key = `${viewingTaskId}:${latest.id}`;
    if (autoPreviewedRef.current.has(key)) return;

    autoPreviewedRef.current.add(key);
    setActiveFile(latest);
  }, [viewingTaskId, currentOutputs, activeFile]);

  // Read logs directly from the store — single source of truth
  const allLogEntries = useTaskStore((s) => s.logEntries);
  const logEntries = (viewingTaskId ? allLogEntries[viewingTaskId] : undefined) ?? EMPTY_LOG_ENTRIES;

  // Build child log entries record — always build for any task with children
  const childLogEntries: Record<string, LogEntry[]> = {};
  for (const child of childTasks) {
    childLogEntries[child.id] = allLogEntries[child.id] ?? EMPTY_LOG_ENTRIES;
  }

  // Escape to close (or go back through nav stack) + pane shortcuts
  useEffect(() => {
    if (!selectedTaskId) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Close panes first
        if (hasPanesOpen) {
          handleCloseAllPanes();
          return;
        }
        if (activeFile) {
          if (viewingTaskId) {
            userDismissedAutoPreviewRef.current.add(viewingTaskId);
          }
          setActiveFile(null);
        } else if (newTaskAttachment) {
          setNewTaskAttachment(null);
        } else if (hasNavHistory) {
          navigateBack();
        } else {
          closePanel();
        }
      }
      // Cmd+\ — split with new chat
      if (e.key === "\\" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        handleSplitWithNew();
      }
      // Cmd+1/2/3/4 — switch pane focus by position
      if (["1", "2", "3", "4"].includes(e.key) && (e.metaKey || e.ctrlKey) && visiblePanes.length > 1) {
        e.preventDefault();
        const idx = parseInt(e.key) - 1;
        const target = visiblePanes[idx];
        if (target) handleFocusPane(target.id);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [selectedTaskId, closePanel, activeFile, newTaskAttachment, hasNavHistory, navigateBack, viewingTaskId, hasPanesOpen, handleCloseAllPanes, visiblePanes, handleFocusPane, handleSplitWithNew]);

  // Optimistic reply handler
  const appendLogEntry = useTaskStore((s) => s.appendLogEntry);
  const handleOptimisticReply = useCallback((entry: LogEntry) => {
    if (viewingTaskId) {
      appendLogEntry(viewingTaskId, entry);
    }
  }, [viewingTaskId, appendLogEntry]);

  const handleFileClick = useCallback((file: OutputFile) => {
    setActiveFile(file);
  }, []);

  const handleNewTaskFromOutput = useCallback(
    (fileName: string, relativePath: string) => {
      setNewTaskAttachment({ fileName, relativePath });
      setActiveFile(null);
    },
    []
  );

  const handleNewTaskCancel = useCallback(() => {
    setNewTaskAttachment(null);
  }, []);

  const handleNewTaskCreated = useCallback(() => {
    setNewTaskAttachment(null);
    closePanel();
  }, [closePanel]);

  // Detect a pending structured-question block on the currently viewed task.
  // We look at the most recent structured_question log entry and show the
  // QuestionModal overlay if it hasn't been answered yet and needsInput=1.
  const pendingStructured: { entryId: string; specs: QuestionSpec[] } | null =
    (() => {
      if (!task || task.needsInput !== true) return null;
      for (let i = logEntries.length - 1; i >= 0; i--) {
        const e = logEntries[i];
        if (e.type === "structured_question") {
          if (e.questionAnswers) return null; // already answered
          try {
            const specs = e.questionSpec
              ? parseQuestionSpecs(JSON.parse(e.questionSpec))
              : [];
            if (specs.length > 0) return { entryId: e.id, specs };
          } catch {
            /* fall through */
          }
          return null;
        }
      }
      return null;
    })();

  const [structuredAnswers, setStructuredAnswers] = useState<QuestionAnswers>({});
  const [structuredSubmitting, setStructuredSubmitting] = useState(false);
  const pendingEntryId = pendingStructured?.entryId ?? null;
  const planApprovalQuestion =
    getPendingPlanApprovalQuestion(logEntries)
    ?? pendingStructured?.specs.find(
      (question) => question.intent === "plan_approval" || question.id === "plan_action",
    ) ?? null;
  const pendingApprovedBrief = extractPendingApprovedBriefFromLogs(logEntries);

  // Reset answers when a new pending structured question appears
  useEffect(() => {
    if (!pendingStructured) {
      setStructuredAnswers({});
      return;
    }
    const seed: QuestionAnswers = {};
    for (const q of pendingStructured.specs) {
      seed[q.id] = q.type === "multiselect" ? [] : "";
    }
    setStructuredAnswers(seed);
  }, [pendingEntryId]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleStructuredSubmit = useCallback(async () => {
    if (!pendingStructured || !viewingTaskId || structuredSubmitting) return;
    setStructuredSubmitting(true);
    try {
      const res = await fetch(`/api/tasks/${viewingTaskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ structuredAnswers }),
      });
      if (!res.ok) {
        console.error("[TaskModal] structured reply failed:", res.status);
      }
    } catch (err) {
      console.error("[TaskModal] structured reply error:", err);
    } finally {
      setStructuredSubmitting(false);
    }
  }, [pendingStructured, viewingTaskId, structuredAnswers, structuredSubmitting]);

  if (!selectedTaskId || !task) return null;

  const isRunning = task.status === "running";
  const hasBeenExecuted = task.status === "running" || task.status === "review" || task.status === "done";
  const showReplyInput = hasBeenExecuted || task.needsInput === true;

  // Filter "Working directory:" from description
  const displayDescription = task.description
    ? task.description.replace(/^Working directory:\s*.+$/m, "").trim() || null
    : null;

  return (
    <>
      {/* Overlay */}
      <div
        onClick={closePanel}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "color-mix(in srgb, var(--foreground) 15%, transparent)",
          zIndex: 100,
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? "auto" : "none",
          transition: "opacity 250ms ease-out",
        }}
      />

      {/* Side panel */}
      <div
        ref={panelRef}
        style={{
          position: "fixed",
          top: 0,
          bottom: 0,
          ...(isNarrowViewport
            ? { left: 0, right: 0, width: "auto", maxWidth: "100%" }
            : { right: 0, width: panelWidth, maxWidth: "100vw" }),
          backgroundColor: "var(--card)",
          borderRadius: "0.75rem 0 0 0.75rem",
          boxShadow: "0px 12px 32px color-mix(in srgb, var(--foreground) 6%, transparent)",
          zIndex: 101,
          display: "flex",
          flexDirection: "row",
          overflow: "hidden",
          transform: isVisible ? "translateX(0)" : "translateX(100%)",
          transition: isResizing.current ? "none" : "transform 250ms ease-out",
        }}
      >
        {/* Resize handle */}
        <div
          onMouseDown={handleResizeStart}
          style={{
            width: 6,
            cursor: "col-resize",
            flexShrink: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget.firstChild as HTMLElement).style.backgroundColor = "var(--primary)";
            (e.currentTarget.firstChild as HTMLElement).style.opacity = "0.4";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget.firstChild as HTMLElement).style.backgroundColor = "var(--border)";
            (e.currentTarget.firstChild as HTMLElement).style.opacity = "0";
          }}
        >
          <div style={{
            width: 3,
            height: 40,
            borderRadius: 2,
            backgroundColor: "var(--border)",
            opacity: 0,
            transition: "opacity 150ms ease, background-color 150ms ease",
          }} />
        </div>

        {/* Panel content */}
        <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
        {/* Header */}
        <ModalHeader task={task} onClose={closePanel} />

        {/* Back bar for nav stack (subtask → parent) */}
        {hasNavHistory && !activeFile && !newTaskAttachment && (
          <button
            onClick={navigateBack}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 24px",
              border: "none",
              borderBottom: "1px solid var(--border)",
              background: "transparent",
              color: "var(--primary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              fontWeight: 500,
              cursor: "pointer",
              flexShrink: 0,
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "color-mix(in srgb, var(--foreground) 4%, transparent)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            &larr; Back to parent task
          </button>
        )}

        {/* Description (if exists and not just working directory) */}
        {displayDescription && !isParentTask && !activeFile && !newTaskAttachment && (
          <div
            style={{
              padding: "8px 24px",
              borderBottom: "1px solid var(--border)",
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--muted-foreground)",
              lineHeight: 1.5,
            }}
          >
            {displayDescription}
          </div>
        )}

        {/* Tab bar — Chat / Files / Plan */}
        {!activeFile && !newTaskAttachment && (
          <div
            style={{
              display: "flex",
              gap: 0,
              padding: "0 24px",
              borderBottom: "1px solid var(--border)",
              flexShrink: 0,
            }}
          >
            {TAB_CONFIG.map((tab) => (
              <TabButton
                key={tab.key}
                label={tab.getLabel ? tab.getLabel(currentOutputs?.length ?? 0) : tab.label!}
                tabKey={tab.key}
                activeTab={activeTab}
                onClick={() => setActiveTab(tab.key)}
              />
            ))}
          </div>
        )}

        {/* Content area */}
        <div
          style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            overflow: "hidden",
            minHeight: 0,
          }}
        >
          {newTaskAttachment ? (
            <ModalNewTaskForm
              attachedFile={newTaskAttachment}
              projectSlug={task.projectSlug ?? null}
              onCancel={handleNewTaskCancel}
              onCreated={handleNewTaskCreated}
            />
          ) : activeFile ? (
            <ModalFilePreview
              fileName={activeFile.fileName}
              relativePath={activeFile.relativePath}
              clientId={task?.clientId ?? null}
              onBack={() => {
                if (viewingTaskId) {
                  userDismissedAutoPreviewRef.current.add(viewingTaskId);
                }
                setActiveFile(null);
              }}
              onNewTask={handleNewTaskFromOutput}
              onSelectFile={(path) => {
                const name = path.split("/").pop() ?? path;
                setActiveFile({
                  ...activeFile,
                  fileName: name,
                  relativePath: path,
                  filePath: path,
                  extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
                });
              }}
            />
          ) : activeTab === "conversation" ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", position: "relative", minWidth: 0, minHeight: 0 }}>
                {/* Main content: panes when active, otherwise project dashboard / chat */}
                <div style={{ flex: 1, display: "flex", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
                <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", minWidth: 0, minHeight: 0 }}>
                  <PaneContainer
                    visiblePanes={visiblePanes}
                    allTasks={tasks}
                    logEntriesByTask={childLogEntries}
                    activePaneId={paneState.activePaneId}
                    layout={paneState.layout}
                    parentTask={task}
                    mainPaneLabel={task.title}
                    onFocusPane={handleFocusPane}
                    onClosePane={handleClosePane}
                    onSetLayout={handleSetLayout}
                    onDropPane={handleAddToViewport}
                    onPreviewFile={(f) => {
                      setActiveFile({
                        id: `pane-preview-${f.relativePath}`,
                        taskId: task.id,
                        fileName: f.fileName,
                        filePath: f.relativePath,
                        relativePath: f.relativePath,
                        extension: f.extension,
                        sizeBytes: null,
                        createdAt: new Date().toISOString(),
                      });
                    }}
                    onRenamePane={handleRenamePane}
                    onAssignTaskToPane={handleAssignTaskToPane}
                    subtasks={childTasks.map((s) => ({ id: s.id, title: s.title, status: s.status, phaseNumber: s.phaseNumber, gsdStep: s.gsdStep, needsInput: s.needsInput === true }))}
                    onMarkTaskDone={(taskId) => updateTask(taskId, { status: "done", needsInput: false })}
                    onMarkSubtaskDone={(id) => updateTask(id, { status: "done", needsInput: false })}
                    onRunSubtaskInNewChat={(id, title) => {
                      handleOpenSubtaskPane(id, title);
                      useTaskStore.getState().fetchLogEntries(id);
                      updateTask(id, {
                        status: "running",
                        ...getInheritedPermissionModes(
                          task.permissionMode,
                          task.executionPermissionMode,
                          task.status,
                        ),
                      });
                      fetch(`/api/tasks/${id}/execute`, { method: "POST" });
                    }}
                    availablePanes={[
                      { id: "main-chat", label: "Main chat", isMain: true },
                      ...paneState.openPanes.filter((p) => p.type === "chat").map((p) => ({ id: p.id, label: p.label })),
                    ]}
                    onRunSubtaskInPane={(subtaskId, paneId) => {
                      if (paneId !== "main-chat") {
                        handleAssignTaskToPane(paneId, subtaskId);
                        handleFocusPane(paneId);
                      }
                      updateTask(subtaskId, {
                        status: "running",
                        ...getInheritedPermissionModes(
                          task.permissionMode,
                          task.executionPermissionMode,
                          task.status,
                        ),
                      });
                      useTaskStore.getState().fetchLogEntries(subtaskId);
                      fetch(`/api/tasks/${subtaskId}/execute`, { method: "POST" });
                    }}
                    renderMainPane={() => (
                      isParentTask ? (
                      <ProjectDashboard
                        task={task}
                        childTasks={childTasks}
                        childLogEntries={childLogEntries}
                        logEntries={logEntries}
                        isRunning={isRunning}
                        needsInput={task.needsInput === true}
                        status={task.status}
                        showReplyInput={showReplyInput}
                        onViewSubtask={navigateToChild}
                        onOptimisticReply={handleOptimisticReply}
                        onPreviewFile={(f) => {
                          setActiveFile({
                            id: `chat-preview-${f.relativePath}`,
                            taskId: task.id,
                            fileName: f.fileName,
                            filePath: f.relativePath,
                            relativePath: f.relativePath,
                            extension: f.extension,
                            sizeBytes: null,
                            createdAt: new Date().toISOString(),
                          });
                        }}
                        briefDescription={displayDescription}
                        openPanes={paneState.openPanes}
                        onOpenSubtaskPane={handleOpenSubtaskPane}
                        onFocusPane={handleFocusPane}
                        onAssignSubtaskToPane={handleAssignTaskToPane}
                        onOpenBrief={
                          task.projectSlug && task.level === "gsd"
                            ? () => {
                                const briefPath = `projects/briefs/${task.projectSlug}/brief.md`;
                                setActiveFile({
                                  id: `brief-${task.projectSlug}`,
                                  taskId: task.id,
                                  fileName: "brief.md",
                                  filePath: briefPath,
                                  relativePath: briefPath,
                                  extension: "md",
                                  sizeBytes: null,
                                  createdAt: new Date().toISOString(),
                                });
                              }
                            : undefined
                        }
                        onOpenPlan={
                          task.projectSlug
                            ? () => {
                                const isGsd = task.level === "gsd";
                                const planPath = isGsd
                                  ? `projects/briefs/${task.projectSlug}/.planning/ROADMAP.md`
                                  : `projects/briefs/${task.projectSlug}/brief.md`;
                                const fileName = isGsd ? "ROADMAP.md" : "brief.md";
                                setActiveFile({
                                  id: `plan-${task.projectSlug}`,
                                  taskId: task.id,
                                  fileName,
                                  filePath: planPath,
                                  relativePath: planPath,
                                  extension: "md",
                                  sizeBytes: null,
                                  createdAt: new Date().toISOString(),
                                });
                              }
                            : undefined
                        }
                      />
                      ) : (
                        <>
                          <ModalChat
                            taskId={task.id}
                            logEntries={logEntries}
                            isRunning={isRunning}
                            needsInput={task.needsInput === true}
                            status={task.status}
                            childTasks={childTasks}
                            childLogEntries={childLogEntries}
                            activePreviewPath={null}
                            onPreviewFile={(f) => {
                              setActiveFile({
                                id: `chat-preview-${f.relativePath}`,
                                taskId: task.id,
                                fileName: f.fileName,
                                filePath: f.relativePath,
                                relativePath: f.relativePath,
                                extension: f.extension,
                                sizeBytes: null,
                                createdAt: new Date().toISOString(),
                              });
                            }}
                            activityLabel={task.activityLabel}
                            startedAt={task.startedAt}
                            lastReplyAt={task.lastReplyAt}
                            costUsd={task.costUsd}
                            tokensUsed={task.tokensUsed}
                            errorMessage={task.errorMessage}
                            durationMs={task.durationMs}
                            onRefresh={() => fetchLogEntries(task.id)}
                          />
                          <ReplyInput
                            taskId={task.id}
                            isVisible={showReplyInput}
                            needsInput={task.needsInput === true}
                            taskStatus={task.status}
                            initialPermissionMode={task.permissionMode ?? "bypassPermissions"}
                            initialExecutionPermissionMode={task.executionPermissionMode ?? null}
                            initialModel={task.model ?? null}
                            initialThinkingEffort={task.thinkingEffort ?? null}
                            onOptimisticReply={handleOptimisticReply}
                            projectSlug={task.projectSlug}
                            hideTasksPopover={task.level === "task"}
                          />
                        </>
                      )
                    )}
                  />
                </div>

                {/* Pane sidebar — shows open panes, + to add chat/terminal */}
                <ChatList
                  openPanes={paneState.openPanes}
                  activePaneId={paneState.activePaneId}
                  visiblePaneIds={paneState.visiblePaneIds}
                  parentTaskTitle={task.title}
                  collapsed={paneState.sidebarCollapsed || autoCollapseSidebar}
                  onToggleCollapse={handleToggleSidebar}
                  onFocusPane={handleFocusPane}
                  onFocusMainChat={handleFocusMainChat}
                  onRemovePane={handleRemovePane}
                  onAddToViewport={handleAddToViewport}
                  onRenamePane={handleRenamePane}
                  onOpenChat={handleOpenChat}
                  onOpenTerminal={handleOpenTerminal}
                  mainTaskId={task.id}
                  childTasks={childTasks}
                  onOpenSubtaskPane={handleOpenSubtaskPane}
                />
                </div>
              </div>
          ) : activeTab === "plan" ? (
            task.projectSlug ? (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden" }}>
                {task.level !== "gsd" && pendingApprovedBrief ? (
                  <div style={{ flex: 1, display: "flex", flexDirection: "column", overflow: "hidden", padding: 20 }}>
                    <DraftPlanPreviewPanel
                      content={pendingApprovedBrief}
                      onExpand={() => setShowDraftPlanModal(true)}
                    />
                  </div>
                ) : (
                  <ModalFilePreview
                    fileName={task.level === "gsd" ? "ROADMAP.md" : "brief.md"}
                    relativePath={
                      task.level === "gsd"
                        ? `projects/briefs/${task.projectSlug}/.planning/ROADMAP.md`
                        : `projects/briefs/${task.projectSlug}/brief.md`
                    }
                    clientId={task.clientId}
                    onBack={() => setActiveTab("conversation")}
                    onNewTask={handleNewTaskFromOutput}
                    onSelectFile={(path) => {
                      const name = path.split("/").pop() ?? path;
                      setActiveFile({
                        id: `plan-nav-${path}`,
                        taskId: task.id,
                        fileName: name,
                        relativePath: path,
                        filePath: path,
                        extension: name.includes(".") ? name.split(".").pop() ?? "" : "",
                        sizeBytes: null,
                        createdAt: new Date().toISOString(),
                      });
                    }}
                  />
                )}
                <SyncDeliverablesBar
                  projectSlug={task.projectSlug}
                  parentId={task.id}
                  clientId={task.clientId}
                  onSynced={() => fetchLogEntries(task.id)}
                />
              </div>
            ) : (
              <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", gap: 12, color: "var(--muted-foreground)", fontSize: 13, fontFamily: "var(--font-inter), Inter, sans-serif", padding: 24 }}>
                <span>No plan linked to this task yet</span>
                <span style={{ fontSize: 11, lineHeight: 1.5, textAlign: "center", maxWidth: 280 }}>
                  Set a <strong style={{ color: "var(--muted-foreground)" }}>projectSlug</strong> on this task to link it to a brief in <code style={{ fontSize: 10, background: "var(--muted)", padding: "1px 4px", borderRadius: 3 }}>projects/briefs/</code>
                </span>
              </div>
            )
          ) : activeTab === "files" ? (
            <div style={{ flex: 1, overflowY: "auto" }}>
              <PanelOutputs taskId={task.id} clientId={task.clientId} projectSlug={task.projectSlug} taskLevel={task.level} onFileClick={handleFileClick} />
            </div>
          ) : null}
        </div>
        </div>
      </div>

      {/* Structured-question overlay — blocks the task panel until answered */}
      {pendingStructured && !planApprovalQuestion && (
        <QuestionModal
          open
          variant="overlay"
          questions={pendingStructured.specs}
          value={structuredAnswers}
          onChange={setStructuredAnswers}
          title="Claude has a few questions"
          subtitle="Answer these so Claude can continue the task."
          submitLabel={structuredSubmitting ? "Sending…" : "Send answers"}
          onSubmit={handleStructuredSubmit}
        />
      )}
      {showDraftPlanModal && pendingApprovedBrief && (
        <DraftPlanPreviewModal
          content={pendingApprovedBrief}
          onClose={() => setShowDraftPlanModal(false)}
        />
      )}
    </>
  );
}

/* ─── Sync deliverables bar ────────────────────────────────────── */

function SyncDeliverablesBar({ projectSlug, parentId, clientId, onSynced }: {
  projectSlug: string;
  parentId: string;
  clientId?: string | null;
  onSynced: () => void;
}) {
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const handleSync = async () => {
    setSyncing(true);
    setResult(null);
    try {
      const res = await fetch("/api/briefs/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "sync-deliverables-to-tasks",
          projectSlug,
          parentId,
          clientId,
        }),
      });
      const data = await res.json();
      if (data.created?.length > 0) {
        setResult(`Created ${data.created.length} subtask${data.created.length > 1 ? "s" : ""}`);
        fetchTasks();
        onSynced();
      } else {
        setResult(data.message || "Already in sync");
      }
      setTimeout(() => setResult(null), 3000);
    } catch {
      setResult("Sync failed");
      setTimeout(() => setResult(null), 3000);
    } finally {
      setSyncing(false);
    }
  };

  return (
    <div style={{
      display: "flex",
      alignItems: "center",
      justifyContent: "flex-end",
      gap: 8,
      padding: "8px 16px",
      borderTop: "1px solid var(--border)",
      flexShrink: 0,
      backgroundColor: "var(--card)",
    }}>
      {result && (
        <span style={{
          fontSize: 11,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: result.startsWith("Created") ? "var(--muted-foreground)" : "var(--muted-foreground)",
        }}>
          {result}
        </span>
      )}
      <button
        onClick={handleSync}
        disabled={syncing}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 4,
          padding: "4px 12px",
          border: "none",
          borderRadius: 4,
          backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
          color: "var(--muted-foreground)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 11,
          fontWeight: 600,
          cursor: syncing ? "wait" : "pointer",
          opacity: syncing ? 0.6 : 1,
        }}
        onMouseEnter={(e) => { if (!syncing) e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 14%, transparent)"; }}
        onMouseLeave={(e) => { e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 8%, transparent)"; }}
      >
        {syncing ? "Syncing..." : "Sync deliverables → subtasks"}
      </button>
    </div>
  );
}

/* ─── Tab button helper ────────────────────────────────────────── */

function TabButton({ label, tabKey, activeTab, onClick }: {
  label: string;
  tabKey: string;
  activeTab: string;
  onClick: () => void;
}) {
  const isActive = activeTab === tabKey;
  return (
    <button
      onClick={onClick}
      style={{
        padding: "10px 16px",
        fontSize: 12,
        fontWeight: isActive ? 600 : 500,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        border: "none",
        borderBottom: isActive ? "2px solid var(--primary)" : "2px solid transparent",
        backgroundColor: "transparent",
        color: isActive ? "var(--primary)" : "var(--muted-foreground)",
        cursor: "pointer",
        transition: "all 120ms ease",
        marginBottom: -1,
      }}
    >
      {label}
    </button>
  );
}
