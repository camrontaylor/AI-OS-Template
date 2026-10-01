"use client";

import {
  ChevronRight,
  Download,
  ExternalLink,
  File,
  Folder,
  FolderOpen,
  Pencil,
  RefreshCw,
  Save,
  Search,
  X,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { FileNode, TaskFileSearchResponse } from "@/types/file";
import type { LogEntry, Task } from "@/types/task";
import type { FeedCanvasPanel } from "./feed-canvas-state";
import { extractApprovedPlanVersionsFromLogs } from "@/lib/plan-brief";
import type { TaskChange } from "@/lib/task-changes";
import { MarkdownPreview } from "@/components/shared/markdown-preview";
import {
  captureDocumentAnchor,
  captureTextareaAnchor,
  restoreDocumentAnchor,
  restoreTextareaAnchor,
  type DocumentScrollAnchor,
} from "@/components/shared/document-scroll-anchor";
import { FeedPanelHeaderActions } from "./feed-canvas";
import { buildDirectoryChain, buildFileAncestorChain } from "./feed-files-navigation";
import { useWorkspaceFileEvents } from "@/hooks/use-workspace-file-events";

const panelBody = { flex: 1, minWidth: 0, minHeight: 0, overflow: "auto", background: "var(--cc-surface)" } as const;
const labelStyle = { color: "var(--cc-text-tertiary)", font: "600 9.5px/1 var(--cc-font-label)", textTransform: "uppercase" as const, letterSpacing: ".08em" };

function PanelState({ children }: { children: React.ReactNode }) {
  return <div style={{ ...panelBody, display: "grid", placeItems: "center", padding: 24, color: "var(--cc-text-tertiary)", font: "400 12.5px/1.5 var(--cc-font-body)", textAlign: "center" }}>{children}</div>;
}

export function FeedFilesPanel({
  taskId,
  targetDirectory,
  navigationKey,
  activeFilePath,
  activeFileNavigationKey,
  onOpenFile,
}: {
  taskId: string;
  targetDirectory?: string;
  navigationKey?: string;
  activeFilePath?: string;
  activeFileNavigationKey?: string;
  onOpenFile: (path: string) => void;
}) {
  const [children, setChildren] = useState<Record<string, FileNode[]>>({});
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [hoveredPath, setHoveredPath] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchTree, setSearchTree] = useState<FileNode[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [searchTruncated, setSearchTruncated] = useState(false);
  const [searchRequestVersion, setSearchRequestVersion] = useState(0);
  const selectedRowRef = useRef<HTMLElement | null>(null);
  const childrenRef = useRef<Record<string, FileNode[]>>({});
  const loadedDirectoriesRef = useRef<Set<string>>(new Set());
  const inFlightLoadsRef = useRef<Map<string, Promise<boolean>>>(new Map());
  const loadControllersRef = useRef<Map<string, AbortController>>(new Map());
  const currentTaskIdRef = useRef(taskId);
  const normalizedQuery = query.trim();
  const searchActive = normalizedQuery.length > 0;
  const normalizedQueryRef = useRef(normalizedQuery);
  currentTaskIdRef.current = taskId;
  normalizedQueryRef.current = normalizedQuery;

  const loadDirectory = useCallback((dir = "", options: { force?: boolean } = {}) => {
    if (!options.force && loadedDirectoriesRef.current.has(dir)) return Promise.resolve(true);
    const existing = inFlightLoadsRef.current.get(dir);
    if (existing) return existing;

    const controller = new AbortController();
    const requestTaskId = taskId;
    loadControllersRef.current.set(dir, controller);
    let request!: Promise<boolean>;
    request = (async () => {
      try {
        const response = await fetch(`/api/tasks/${requestTaskId}/files${dir ? `?dir=${encodeURIComponent(dir)}` : ""}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to load files");
        if (currentTaskIdRef.current !== requestTaskId) return false;
        const nodes = Array.isArray(data) ? data as FileNode[] : [];
        const nextChildren = { ...childrenRef.current, [dir]: nodes };
        childrenRef.current = nextChildren;
        loadedDirectoriesRef.current.add(dir);
        setChildren(nextChildren);
        setError(null);
        return true;
      } catch (reason) {
        if (reason instanceof Error && reason.name === "AbortError") return false;
        if (currentTaskIdRef.current === requestTaskId) {
          setError(reason instanceof Error ? reason.message : "Unable to load files");
        }
        return false;
      } finally {
        if (inFlightLoadsRef.current.get(dir) === request) inFlightLoadsRef.current.delete(dir);
        if (loadControllersRef.current.get(dir) === controller) loadControllersRef.current.delete(dir);
      }
    })();
    inFlightLoadsRef.current.set(dir, request);
    return request;
  }, [taskId]);

  useEffect(() => {
    for (const controller of loadControllersRef.current.values()) controller.abort();
    loadControllersRef.current.clear();
    inFlightLoadsRef.current.clear();
    loadedDirectoriesRef.current.clear();
    childrenRef.current = {};
    setChildren({});
    setExpanded(new Set());
    setSelectedPath(null);
    setHoveredPath(null);
    setQuery("");
    setLoading(true);
    setError(null);
    let active = true;
    void loadDirectory("", { force: true }).finally(() => {
      if (active && currentTaskIdRef.current === taskId) setLoading(false);
    });
    return () => {
      active = false;
      for (const controller of loadControllersRef.current.values()) controller.abort();
    };
  }, [loadDirectory, taskId]);

  useEffect(() => {
    let active = true;
    const directoryChain = buildDirectoryChain(targetDirectory);
    const activeFileDirectoryChain = buildFileAncestorChain(activeFilePath);
    const revealDirectories = [...new Set([...directoryChain, ...activeFileDirectoryChain])];
    setExpanded((current) => new Set([...current, ...revealDirectories]));
    setSelectedPath(activeFilePath ?? targetDirectory ?? null);
    setHoveredPath(null);
    setQuery("");

    (async () => {
      await loadDirectory();
      for (const directory of revealDirectories) {
        if (!active) return;
        const slashIndex = directory.lastIndexOf("/");
        const parentDirectory = slashIndex >= 0 ? directory.slice(0, slashIndex) : "";
        const parentWasLoaded = loadedDirectoriesRef.current.has(parentDirectory);
        await loadDirectory(parentDirectory);
        if (parentWasLoaded && !childrenRef.current[parentDirectory]?.some((node) => node.path === directory)) {
          await loadDirectory(parentDirectory, { force: true });
        }
        await loadDirectory(directory);
      }

      if (activeFilePath && active) {
        const slashIndex = activeFilePath.lastIndexOf("/");
        const parentDirectory = slashIndex >= 0 ? activeFilePath.slice(0, slashIndex) : "";
        await loadDirectory(parentDirectory);
        if (!childrenRef.current[parentDirectory]?.some((node) => node.path === activeFilePath)) {
          await loadDirectory(parentDirectory, { force: true });
        }
      }
    })();

    return () => { active = false; };
  }, [activeFileNavigationKey, activeFilePath, loadDirectory, navigationKey, targetDirectory]);

  const handleWorkspaceDirectoryChanged = useCallback((directory: string) => {
    if (loadedDirectoriesRef.current.has(directory)) {
      void loadDirectory(directory, { force: true });
    }
    if (normalizedQueryRef.current) setSearchRequestVersion((value) => value + 1);
  }, [loadDirectory]);

  const handleWorkspaceEventsReconnect = useCallback(() => {
    const loadedDirectories = [...loadedDirectoriesRef.current];
    void Promise.allSettled(loadedDirectories.map((directory) => loadDirectory(directory, { force: true })));
    if (normalizedQueryRef.current) setSearchRequestVersion((value) => value + 1);
  }, [loadDirectory]);

  useWorkspaceFileEvents({
    taskId,
    onDirectoryChanged: handleWorkspaceDirectoryChanged,
    onReconnect: handleWorkspaceEventsReconnect,
  });

  useEffect(() => {
    setSearchError(null);
    setSearchTruncated(false);
    if (!normalizedQuery) {
      setSearchTree([]);
      setSearchLoading(false);
      return;
    }

    let active = true;
    const controller = new AbortController();
    setSearchLoading(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/tasks/${taskId}/files?query=${encodeURIComponent(normalizedQuery)}`, {
          signal: controller.signal,
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || "Unable to search files");
        if (!active) return;
        const result = data as TaskFileSearchResponse;
        setSearchTree(Array.isArray(result.nodes) ? result.nodes : []);
        setSearchTruncated(result.truncated === true);
      } catch (reason) {
        if (reason instanceof Error && reason.name === "AbortError") return;
        if (!active) return;
        setSearchTree([]);
        setSearchError(reason instanceof Error ? reason.message : "Unable to search files");
      } finally {
        if (active) setSearchLoading(false);
      }
    }, 150);

    return () => {
      active = false;
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, searchRequestVersion, taskId]);

  const toggle = async (node: FileNode) => {
    if (node.type !== "directory") return onOpenFile(node.path);
    if (!activeFilePath) setSelectedPath(node.path);
    const opening = !expanded.has(node.path);
    setExpanded((current) => {
      const next = new Set(current);
      opening ? next.add(node.path) : next.delete(node.path);
      return next;
    });
    if (opening) await loadDirectory(node.path);
  };
  const browseRows = useMemo(() => {
    const result: Array<{ node: FileNode; depth: number }> = [];
    const walk = (dir: string, depth: number) => {
      for (const node of children[dir] ?? []) {
        result.push({ node, depth });
        if (node.type === "directory" && expanded.has(node.path)) walk(node.path, depth + 1);
      }
    };
    walk("", 0);
    return result;
  }, [children, expanded]);
  const searchRows = useMemo(() => {
    const result: Array<{ node: FileNode; depth: number }> = [];
    const walk = (nodes: FileNode[], depth: number) => {
      for (const node of nodes) {
        result.push({ node, depth });
        if (node.type === "directory" && node.children?.length) walk(node.children, depth + 1);
      }
    };
    walk(searchTree, 0);
    return result;
  }, [searchTree]);
  const rows = searchActive ? searchRows : browseRows;
  const viewLoading = searchActive ? searchLoading : loading;
  const viewError = searchActive ? searchError : error;

  useLayoutEffect(() => {
    selectedRowRef.current?.scrollIntoView({ block: "nearest" });
  }, [rows, selectedPath]);

  return (
    <div style={{ ...panelBody, display: "flex", flexDirection: "column", overflow: "hidden" }}>
      <div style={{ padding: "9px 10px", borderBottom: "1px solid var(--cc-line-alpha-20)", flex: "0 0 auto" }}>
        <label style={{ height: 30, display: "flex", alignItems: "center", gap: 7, padding: "0 9px", border: "1px solid var(--cc-line-alpha-35)", borderRadius: 6, background: "var(--cc-control-bg)" }}>
          <Search size={12} style={{ color: "var(--cc-text-tertiary)" }} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter workspace files" style={{ flex: 1, minWidth: 0, border: 0, outline: 0, background: "transparent", color: "var(--cc-text-primary)", font: "400 11.5px/1 var(--cc-font-body)" }} />
        </label>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: "auto", padding: "6px" }}>
        {viewLoading && rows.length === 0 ? <PanelState>{searchActive ? "Searching workspace files…" : "Loading workspace files…"}</PanelState> : null}
        {!viewLoading && viewError && rows.length === 0 ? <PanelState>{viewError}<button type="button" onClick={() => searchActive ? setSearchRequestVersion((value) => value + 1) : void loadDirectory("", { force: true })} style={{ marginTop: 10 }}><RefreshCw size={12} /> Retry</button></PanelState> : null}
        {!viewLoading && viewError && rows.length > 0 ? <div role="status" style={{ margin: "0 2px 6px", padding: "7px 8px", borderRadius: 5, background: "var(--cc-status-warning-bg-soft)", color: "var(--cc-text-secondary)", font: "500 10.5px/1.4 var(--cc-font-body)" }}>{viewError}</div> : null}
        {!viewLoading && !viewError && rows.length === 0 ? <PanelState>{searchActive ? "No files match this search." : "No files match this view."}</PanelState> : null}
        {!viewLoading && (!viewError || rows.length > 0) ? rows.map(({ node, depth }) => {
          const directory = node.type === "directory";
          const open = searchActive ? directory : expanded.has(node.path);
          const selected = node.path === selectedPath;
          const interactive = !(searchActive && directory);
          const hovered = interactive && hoveredPath === node.path;
          const rowStyle = { width: "100%", height: 30, display: "flex", alignItems: "center", gap: 6, padding: `0 8px 0 ${8 + depth * 14}px`, border: 0, borderRadius: 5, background: selected ? "var(--cc-brand-alpha-06)" : hovered ? "var(--cc-brand-alpha-04)" : "transparent", color: selected ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)", textAlign: "left" as const, cursor: interactive ? "pointer" : "default", font: "500 11.5px/1 var(--cc-font-body)", transition: "background 120ms ease, color 120ms ease" };
          const content = <>
            {directory ? <ChevronRight size={11} style={{ transform: open ? "rotate(90deg)" : "none", transition: "transform 120ms ease" }} /> : <span style={{ width: 11 }} />}
            {directory ? open ? <FolderOpen size={13} style={{ color: "var(--cc-brand-primary)" }} /> : <Folder size={13} style={{ color: "var(--cc-text-tertiary)" }} /> : <File size={13} style={{ color: "var(--cc-text-tertiary)" }} />}
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{node.name}</span>
          </>;
          return searchActive && directory
            ? <div key={node.path} ref={selected ? (element) => { selectedRowRef.current = element; } : undefined} title={node.path} style={rowStyle}>{content}</div>
            : <button key={node.path} ref={selected ? (element) => { selectedRowRef.current = element; } : undefined} type="button" onMouseEnter={() => setHoveredPath(node.path)} onMouseLeave={() => setHoveredPath((current) => current === node.path ? null : current)} onClick={() => void toggle(node)} title={node.path} style={rowStyle}>{content}</button>;
        }) : null}
        {searchActive && !viewLoading && !viewError && searchTruncated ? <div style={{ padding: "8px 10px", color: "var(--cc-text-tertiary)", font: "500 10.5px/1.4 var(--cc-font-body)", textAlign: "center" }}>Showing the first 30 matching files. Refine your search to narrow the results.</div> : null}
      </div>
    </div>
  );
}

interface FileResponse { content: string | null; truncated: boolean; extension: string; size: number; lastModified: string }
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg", "ico"]);

export function FeedFileViewerPanel({ taskId, relativePath, readOnly, onOpenFile }: { taskId: string; relativePath?: string; readOnly: boolean; onOpenFile: (path: string) => void }) {
  const [file, setFile] = useState<FileResponse | null>(null);
  const [content, setContent] = useState("");
  const [editing, setEditing] = useState(false);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const pendingAnchorRef = useRef<DocumentScrollAnchor | null>(null);
  const rawUrl = relativePath ? `/api/tasks/${taskId}/file?path=${encodeURIComponent(relativePath)}&raw=1` : "";
  const load = useCallback(async () => {
    if (!relativePath) return;
    setLoading(true); setError(null); setEditing(false);
    try {
      const response = await fetch(`/api/tasks/${taskId}/file?path=${encodeURIComponent(relativePath)}`);
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to open file");
      setFile(data); setContent(data.content ?? "");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to open file"); }
    finally { setLoading(false); }
  }, [relativePath, taskId]);
  useEffect(() => {
    pendingAnchorRef.current = null;
    if (scrollRef.current) scrollRef.current.scrollTop = 0;
    setFile(null);
    setContent("");
    if (relativePath) void load();
  }, [load, relativePath]);
  useLayoutEffect(() => {
    const anchor = pendingAnchorRef.current;
    if (!anchor) return;
    const frame = requestAnimationFrame(() => {
      if (editing && textareaRef.current) {
        restoreTextareaAnchor(textareaRef.current, anchor);
        pendingAnchorRef.current = null;
      } else if (!editing && scrollRef.current) {
        restoreDocumentAnchor(scrollRef.current, anchor);
        pendingAnchorRef.current = null;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [editing]);
  if (!relativePath) return <PanelState>Select a file from Files or Changes to open it here.</PanelState>;
  if (loading) return <PanelState>Loading {relativePath}…</PanelState>;
  if (error) return <PanelState>{error}</PanelState>;
  const extension = file?.extension ?? relativePath.split(".").pop()?.toLowerCase() ?? "";
  const raw = IMAGE_EXTENSIONS.has(extension) || extension === "pdf" || extension === "html" || extension === "htm";
  const beginEditing = () => {
    pendingAnchorRef.current = scrollRef.current ? captureDocumentAnchor(scrollRef.current) : { line: 1, offset: 0 };
    setEditing(true);
  };
  const captureEditorPosition = () => {
    pendingAnchorRef.current = textareaRef.current ? captureTextareaAnchor(textareaRef.current) : { line: 1, offset: 0 };
  };
  const save = async () => {
    if (!file) return;
    setSaving(true); setError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/file?path=${encodeURIComponent(relativePath)}`, { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ content, lastModified: file.lastModified }) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Unable to save file");
      captureEditorPosition();
      setFile({ ...file, content, lastModified: data.lastModified }); setEditing(false);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to save file"); }
    finally { setSaving(false); }
  };
  const cancelEditing = () => {
    captureEditorPosition();
    setContent(file?.content ?? "");
    setEditing(false);
    setError(null);
  };
  const actionStyle = { height: 24, display: "inline-flex", alignItems: "center", gap: 4, padding: "0 6px", border: 0, borderRadius: 5, background: "transparent", color: "var(--cc-text-tertiary)", font: "600 10.5px/1 var(--cc-font-label)", cursor: "pointer", textDecoration: "none" } as const;
  return <div style={{ ...panelBody, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <FeedPanelHeaderActions>
      <div style={{ display: "flex", alignItems: "center", gap: 1 }} onPointerDown={(event) => event.stopPropagation()}>
        {!raw && !readOnly && file?.content !== null ? editing ? <>
          <button type="button" onClick={cancelEditing} disabled={saving} title="Cancel editing" style={{ ...actionStyle, opacity: saving ? .45 : 1 }}><X size={12} /> Cancel</button>
          <button type="button" onClick={() => void save()} disabled={saving || content === (file?.content ?? "")} title="Save file" style={{ ...actionStyle, color: "var(--cc-brand-primary)", opacity: saving || content === (file?.content ?? "") ? .45 : 1 }}><Save size={12} /> {saving ? "Saving…" : "Save"}</button>
        </> : <button type="button" onClick={beginEditing} title="Edit file" style={{ ...actionStyle, color: "var(--cc-brand-primary)" }}><Pencil size={12} /> Edit</button> : null}
        <a href={`/api/tasks/${taskId}/file?path=${encodeURIComponent(relativePath)}&download=1`} title="Download" aria-label={`Download ${relativePath}`} style={{ ...actionStyle, width: 24, padding: 0, justifyContent: "center" }}><Download size={12} /></a>
        <button type="button" title="Reveal in file explorer" aria-label={`Reveal ${relativePath} in file explorer`} onClick={() => void fetch(`/api/tasks/${taskId}/file`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ path: relativePath, action: "reveal" }) })} style={{ ...actionStyle, width: 24, padding: 0, justifyContent: "center" }}><ExternalLink size={12} /></button>
      </div>
    </FeedPanelHeaderActions>
    {error ? <div style={{ padding: 8, color: "var(--cc-status-danger)", font: "500 11px/1.4 var(--cc-font-body)" }}>{error}</div> : null}
    <div style={{ flex: 1, minHeight: 0, overflow: "hidden", display: "flex", flexDirection: "column" }}>
      <div title={relativePath} style={{ flex: "0 0 auto", padding: "10px 18px 0", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: "var(--cc-text-tertiary)", font: "400 10.5px/1.2 var(--cc-font-mono)" }}>{relativePath}</div>
      <div ref={scrollRef} style={{ flex: 1, minHeight: 0, overflow: editing ? "hidden" : "auto", paddingTop: 10 }}>
        {raw ? (IMAGE_EXTENSIONS.has(extension) ? <div style={{ minHeight: "100%", display: "grid", placeItems: "center", padding: "0 16px 16px" }}><img src={rawUrl} alt={relativePath} style={{ maxWidth: "100%", maxHeight: "100%", objectFit: "contain" }} /></div> : <iframe src={rawUrl} title={relativePath} sandbox={extension === "html" || extension === "htm" ? "allow-same-origin" : undefined} style={{ width: "100%", height: "100%", minHeight: 320, border: 0 }} />)
          : file?.truncated ? <PanelState>This file is too large to preview.</PanelState>
            : editing ? <textarea ref={textareaRef} value={content} onChange={(event) => setContent(event.target.value)} style={{ width: "100%", height: "100%", resize: "none", border: 0, outline: 0, padding: "0 18px 16px", background: "var(--cc-surface)", color: "var(--cc-text-primary)", font: "400 12px/1.6 var(--cc-font-mono)" }} />
              : extension === "md" || extension === "mdx" ? <div className="cc-feed-document" style={{ maxWidth: 760, margin: "0 auto", padding: "0 20px 20px", color: "var(--cc-text-primary)", font: "400 13px/1.65 var(--cc-font-body)" }}><MarkdownPreview content={content} variant="panel" sourcePath={relativePath} onOpenFile={onOpenFile} /></div>
                : <pre style={{ margin: 0, padding: "0 18px 16px", whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--cc-text-primary)", font: "400 12px/1.65 var(--cc-font-mono)" }}>{content.split("\n").map((line, index) => <span key={index} data-source-line={index + 1} style={{ display: "block" }}>{line || "\u00a0"}</span>)}</pre>}
      </div>
    </div>
  </div>;
}

export function FeedPlanPanel({ task, logs, panel, readOnly, onSelectVersion, onOpenFile }: { task: Task; logs: LogEntry[]; panel: FeedCanvasPanel; readOnly: boolean; onSelectVersion: (id: string) => void; onOpenFile: (path: string) => void }) {
  const versions = useMemo(() => extractApprovedPlanVersionsFromLogs(logs), [logs]);
  const [tab, setTab] = useState<"brief" | "plan">("plan");
  const selected = versions.find((version) => version.id === panel.resource?.planVersionId) ?? versions.at(-1) ?? null;
  const briefPath = task.projectSlug ? `projects/briefs/${task.projectSlug}/brief.md` : null;
  return <div style={{ ...panelBody, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <div style={{ padding: "8px 10px", borderBottom: "1px solid var(--cc-line-alpha-20)", flex: "0 0 auto" }}>
      <div style={{ height: 30, display: "flex", padding: 2, borderRadius: 7, background: "var(--cc-control-bg)" }}>
        {(["brief", "plan"] as const).map((value) => <button key={value} type="button" onClick={() => setTab(value)} style={{ flex: 1, border: 0, borderRadius: 5, background: tab === value ? "var(--cc-surface)" : "transparent", color: tab === value ? "var(--cc-text-primary)" : "var(--cc-text-tertiary)", font: "600 11.5px/1 var(--cc-font-label)", cursor: "pointer", boxShadow: tab === value ? "0 1px 2px var(--cc-brand-alpha-06)" : "none" }}>{value === "brief" ? "Goal brief" : "Plans"}</button>)}
      </div>
      {tab === "plan" ? <div style={{ display: "flex", alignItems: "center", gap: 6, paddingTop: 8, overflowX: "auto" }}>
        {versions.map((version, index) => <button key={version.id} type="button" onClick={() => onSelectVersion(version.id)} style={{ height: 24, flex: "0 0 auto", padding: "0 9px", border: version.id === selected?.id ? "1px solid var(--cc-brand-alpha-35)" : "1px solid var(--cc-line-alpha-35)", borderRadius: 999, background: version.id === selected?.id ? "var(--cc-brand-alpha-06)" : "var(--cc-surface)", color: version.id === selected?.id ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)", font: "600 10.5px/1 var(--cc-font-label)", cursor: "pointer" }}>v{index + 1} · {version.status}</button>)}
        <span style={{ flex: 1 }} />
      </div> : null}
    </div>
    {tab === "brief" ? (
      briefPath ? <FeedFileViewerPanel taskId={task.id} relativePath={briefPath} readOnly={readOnly} onOpenFile={onOpenFile} /> : <PanelState>No project Brief is attached to this Goal.</PanelState>
    ) : (
      <div style={{ flex: 1, minHeight: 0, overflow: "auto" }}>
        {selected?.content ? <div className="cc-feed-document" style={{ maxWidth: 760, margin: "0 auto", padding: "18px 20px", color: "var(--cc-text-primary)", font: "400 13px/1.65 var(--cc-font-body)" }}><div style={{ ...labelStyle, marginBottom: 12 }}>Chat plan · {selected.status}</div><MarkdownPreview content={selected.content} variant="panel" onOpenFile={onOpenFile} /></div> : <PanelState>No Chat plan has been created yet.</PanelState>}
      </div>
    )}
  </div>;
}

export function FeedChangesPanel({ taskId, onOpenFile }: { taskId: string; onOpenFile: (path: string) => void }) {
  const [changes, setChanges] = useState<TaskChange[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try { const response = await fetch(`/api/tasks/${taskId}/changes`); const data = await response.json(); if (!response.ok) throw new Error(data.error || "Unable to load changes"); setChanges(data.changes ?? []); setSelectedPath((current) => current ?? data.changes?.find((item: TaskChange) => item.status !== "unchanged")?.relativePath ?? data.changes?.[0]?.relativePath ?? null); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Unable to load changes"); }
    finally { setLoading(false); }
  }, [taskId]);
  useEffect(() => { void load(); }, [load]);
  const selected = changes.find((change) => change.relativePath === selectedPath) ?? null;
  if (loading) return <PanelState>Comparing project files…</PanelState>;
  if (error) return <PanelState>{error}</PanelState>;
  if (!changes.length) return <PanelState>No project changes are available for this Goal.</PanelState>;
  return <div style={{ ...panelBody, display: "flex", flexDirection: "column", overflow: "hidden" }}>
    <div style={{ maxHeight: "42%", overflow: "auto", padding: 6, borderBottom: "1px solid var(--cc-line-alpha-25)" }}>{changes.map((change) => <button key={change.relativePath} type="button" onClick={() => setSelectedPath(change.relativePath)} onDoubleClick={() => onOpenFile(change.relativePath)} style={{ width: "100%", minHeight: 30, display: "flex", alignItems: "center", gap: 8, padding: "5px 8px", border: 0, borderRadius: 5, background: selectedPath === change.relativePath ? "var(--cc-brand-alpha-06)" : "transparent", color: "var(--cc-text-secondary)", textAlign: "left", cursor: "pointer" }}><span style={{ width: 9, color: change.status === "added" ? "var(--cc-status-success)" : change.status === "deleted" ? "var(--cc-status-danger)" : change.status === "modified" ? "var(--cc-status-warning)" : "var(--cc-text-disabled)", font: "700 10px/1 var(--cc-font-mono)" }}>{change.status[0].toUpperCase()}</span><span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", font: "500 10.5px/1 var(--cc-font-mono)" }}>{change.projectRelativePath}</span><span style={{ ...labelStyle, fontSize: 8.5 }}>{change.status}</span></button>)}</div>
    <div style={{ flex: 1, minHeight: 0, overflow: "auto", background: "var(--cc-canvas-subtle)" }}>{selected?.diff ? <pre style={{ margin: 0, padding: 12, whiteSpace: "pre-wrap", wordBreak: "break-word", color: "var(--cc-text-secondary)", font: "400 11px/1.6 var(--cc-font-mono)" }}>{selected.diff.split("\n").map((line, index) => <span key={index} style={{ display: "block", color: line.startsWith("+") ? "var(--cc-status-success)" : line.startsWith("-") ? "var(--cc-status-danger)" : undefined, background: line.startsWith("+") ? "var(--cc-status-success-bg-soft)" : line.startsWith("-") ? "var(--cc-status-danger-bg-soft)" : undefined }}>{line || " "}</span>)}</pre> : <PanelState>{selected?.unavailableReason ? `Text diff unavailable: ${selected.unavailableReason}.` : "No textual difference for this file."}<button type="button" onClick={() => selected && onOpenFile(selected.relativePath)} style={{ marginTop: 10 }}>Open file</button></PanelState>}</div>
  </div>;
}
