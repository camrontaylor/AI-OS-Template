"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { FileText, Folder, FolderOpen, Users } from "lucide-react";
import type { FileNode } from "@/types/file";
import type { Client } from "@/types/client";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import { getFileIcon, getFileIconColor } from "@/lib/file-icons";
import type { SyncItemStatus } from "@/lib/sync-state";
import { profileStorageKey } from "@/lib/profile-storage";
import { FileTreeSkeleton } from "@/components/shared/file-tree-skeleton";

interface DocsFileTreeProps {
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
  syncFiles?: Record<string, SyncItemStatus>;
}

const ROOT_FILES = ["AGENTS.md", "CLAUDE.md", "README.md"];

export const DOCS_SECTION_DEFS = [
  { label: "Context", dir: "context", defaultExpanded: true },
  { label: "Team Context", dir: "team_context", defaultExpanded: true },
  { label: "Brand Context", dir: "brand_context", defaultExpanded: true },
  { label: "Docs", dir: "docs", defaultExpanded: true },
  { label: "Projects", dir: "projects", defaultExpanded: true },
] as const;

const DOCS_ORDER_KEY = "docs-section-order";
const DOCS_NODE_ORDER_PREFIX = "docs-node-order-";

function loadOrder(key: string): string[] | null {
  try {
    const stored = typeof window !== "undefined" ? localStorage.getItem(profileStorageKey(key)) : null;
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveOrder(key: string, items: string[]) {
  try {
    if (typeof window !== "undefined") {
      localStorage.setItem(profileStorageKey(key), JSON.stringify(items));
    }
  } catch {
    // Ignore
  }
}

export function docsSurfaceUrl(url: string, clientId: string | null): string {
  const withClient = appendClientId(url, clientId);
  const separator = withClient.includes("?") ? "&" : "?";
  return `${withClient}${separator}surface=docs`;
}

function applySavedNodeOrder(nodes: FileNode[], parentDir: string): FileNode[] {
  const order = loadOrder(DOCS_NODE_ORDER_PREFIX + parentDir);
  if (!order) return nodes;
  const sorted = [...nodes];
  sorted.sort((a, b) => {
    const ai = order.indexOf(a.path);
    const bi = order.indexOf(b.path);
    if (ai === -1 && bi === -1) return 0;
    if (ai === -1) return 1;
    if (bi === -1) return -1;
    return ai - bi;
  });
  return sorted;
}

interface SectionData {
  label: string;
  dir: string;
  nodes: FileNode[];
  defaultExpanded: boolean;
}

export function DocsFileTree({ onSelectFile, selectedPath, syncFiles = {} }: DocsFileTreeProps) {
  const clientId = useClientId();
  const [sections, setSections] = useState<SectionData[]>([]);
  const [rootFiles, setRootFiles] = useState<FileNode[]>([]);
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, FileNode[]>>({});
  const [loading, setLoading] = useState(true);
  const [clients, setClients] = useState<Client[]>([]);
  const [expandedClients, setExpandedClients] = useState<Set<string>>(new Set());
  const [clientsExpanded, setClientsExpanded] = useState(true);
  const [clientChildren, setClientChildren] = useState<Record<string, FileNode[]>>({});

  // Drag state for file-to-folder moves
  const [dragOverDir, setDragOverDir] = useState<string | null>(null);
  const [draggingPath, setDraggingPath] = useState<string | null>(null);
  const dragCounter = useRef(0);

  // Drag state for section reordering
  const [dragSectionIndex, setDragSectionIndex] = useState<number | null>(null);
  const [dragOverSectionIndex, setDragOverSectionIndex] = useState<number | null>(null);

  // Drag state for node reordering within a section
  const [dragNodeKey, setDragNodeKey] = useState<string | null>(null); // "sectionDir:nodeIndex"
  const [dragOverNodeKey, setDragOverNodeKey] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function load() {
      const sectionDefs = DOCS_SECTION_DEFS;

      const [rootFileResults, ...dirResults] = await Promise.all([
        Promise.all(
          ROOT_FILES.map((f) =>
            fetch(docsSurfaceUrl(`/api/files/${encodeURIComponent(f)}`, clientId))
              .then((r) => (r.ok ? r.json() : null))
              .catch(() => null)
          )
        ),
        ...sectionDefs.map((s) =>
          fetch(docsSurfaceUrl(`/api/files?dir=${encodeURIComponent(s.dir)}`, clientId))
            .then((r) => (r.ok ? r.json() : []))
            .catch(() => [])
        ),
      ]);

      if (!mounted) return;

      const foundRootFiles: FileNode[] = [];
      for (let i = 0; i < ROOT_FILES.length; i++) {
        const data = rootFileResults[i];
        if (data && data.path) {
          foundRootFiles.push({
            name: ROOT_FILES[i],
            path: ROOT_FILES[i],
            type: "file" as const,
            lastModified: data.lastModified || new Date().toISOString(),
            size: data.content ? new Blob([data.content]).size : 0,
          });
        }
      }
      setRootFiles(foundRootFiles);

      const loadedSections: SectionData[] = [];
      const defaultExpanded = new Set<string>();
      for (let i = 0; i < sectionDefs.length; i++) {
        const nodes = dirResults[i] as FileNode[];
        if (nodes.length > 0) {
          loadedSections.push({
            ...sectionDefs[i],
            nodes: applySavedNodeOrder(nodes, sectionDefs[i].dir),
          });
          if (sectionDefs[i].defaultExpanded) {
            defaultExpanded.add(sectionDefs[i].dir);
          }
        }
      }

      // Apply saved section order
      const sectionOrder = loadOrder(DOCS_ORDER_KEY);
      if (sectionOrder) {
        loadedSections.sort((a, b) => {
          const ai = sectionOrder.indexOf(a.dir);
          const bi = sectionOrder.indexOf(b.dir);
          if (ai === -1 && bi === -1) return 0;
          if (ai === -1) return 1;
          if (bi === -1) return -1;
          return ai - bi;
        });
      }

      setSections(loadedSections);
      setExpandedSections(defaultExpanded);

      // Fetch clients for the clients section (only when viewing root workspace)
      if (!clientId) {
        try {
          const clientsRes = await fetch("/api/clients");
          if (clientsRes.ok) {
            const data = await clientsRes.json();
            if (mounted && data.clients?.length > 0) {
              setClients(data.clients);
            }
          }
        } catch { /* ignore */ }
      } else {
        setClients([]);
      }

      setLoading(false);
    }

    load();
    return () => { mounted = false; };
  }, [clientId]);

  const toggleSection = useCallback((dir: string) => {
    setExpandedSections((prev) => {
      const next = new Set(prev);
      if (next.has(dir)) next.delete(dir);
      else next.add(dir);
      return next;
    });
  }, []);

  // Auto-expand all ancestor directories (and their containing section)
  // whenever selectedPath changes so the tree scrolls/reveals the target.
  useEffect(() => {
    if (!selectedPath) return;
    const parts = selectedPath.split("/").filter(Boolean);
    if (parts.length === 0) return;

    // Expand the containing section (top-level dir like "projects", "docs")
    setExpandedSections((prev) => {
      if (prev.has(parts[0])) return prev;
      const next = new Set(prev);
      next.add(parts[0]);
      return next;
    });

    // Every ancestor directory of selectedPath
    const ancestors: string[] = [];
    for (let i = 1; i < parts.length; i++) {
      ancestors.push(parts.slice(0, i).join("/"));
    }
    // Also include the path itself if it's a directory (no extension)
    const looksLikeDir = !parts[parts.length - 1].includes(".");
    if (looksLikeDir) ancestors.push(parts.join("/"));

    if (ancestors.length === 0) return;

    setExpandedDirs((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const a of ancestors) {
        if (!next.has(a)) {
          next.add(a);
          changed = true;
        }
      }
      return changed ? next : prev;
    });

    // Lazy-load children for ancestors that don't have them yet
    for (const a of ancestors) {
      if (!childrenMap[a]) {
        fetch(docsSurfaceUrl(`/api/files?dir=${encodeURIComponent(a)}`, clientId))
          .then((r) => (r.ok ? r.json() : []))
          .then((children: FileNode[]) => {
            setChildrenMap((prev) => (prev[a] ? prev : { ...prev, [a]: children }));
          })
          .catch(() => {});
      }
    }
  }, [selectedPath, clientId, childrenMap]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          if (!childrenMap[dirPath]) {
            fetch(docsSurfaceUrl(`/api/files?dir=${encodeURIComponent(dirPath)}`, clientId))
              .then((r) => r.json())
              .then((children: FileNode[]) => {
                setChildrenMap((prev) => ({ ...prev, [dirPath]: children }));
              });
          }
        }
        return next;
      });
    },
    [childrenMap, clientId]
  );

  // ── Client section helpers ──

  const toggleClient = useCallback((slug: string) => {
    setExpandedClients((prev) => {
      const next = new Set(prev);
      if (next.has(slug)) {
        next.delete(slug);
      } else {
        next.add(slug);
        if (!clientChildren[slug]) {
          const dirs = ["brand_context", "context", "projects", "cron/jobs"];
          Promise.all(
            dirs.map((d) =>
              fetch(docsSurfaceUrl(`/api/files?dir=${encodeURIComponent(`clients/${slug}/${d}`)}`, null))
                .then((r) => (r.ok ? r.json() : []))
                .catch(() => [])
            )
          ).then((results) => {
            const nodes: FileNode[] = [];
            dirs.forEach((dir, i) => {
              const children = results[i] as FileNode[];
              if (children.length > 0) {
                nodes.push({
                  name: dir,
                  path: `clients/${slug}/${dir}`,
                  type: "directory",
                  children,
                  lastModified: new Date().toISOString(),
                  size: 0,
                });
              }
            });
            setClientChildren((prev) => ({ ...prev, [slug]: nodes }));
          });
        }
      }
      return next;
    });
  }, [clientChildren]);

  // ── File-to-folder drag handlers ──

  const handleFileDragStart = useCallback((e: React.DragEvent, nodePath: string) => {
    e.dataTransfer.setData("text/plain", nodePath);
    e.dataTransfer.setData("drag-type", "file");
    e.dataTransfer.effectAllowed = "move";
    setDraggingPath(nodePath);
  }, []);

  const handleFileDragEnd = useCallback(() => {
    setDraggingPath(null);
    setDragOverDir(null);
    dragCounter.current = 0;
  }, []);

  const handleDragEnterDir = useCallback((e: React.DragEvent, dirPath: string) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current++;
    setDragOverDir(dirPath);
  }, []);

  const handleDragLeaveDir = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    dragCounter.current--;
    if (dragCounter.current <= 0) {
      setDragOverDir(null);
      dragCounter.current = 0;
    }
  }, []);

  const handleDragOverGeneric = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const handleFileDrop = useCallback(
    async (e: React.DragEvent, targetDir: string) => {
      e.preventDefault();
      e.stopPropagation();
      setDragOverDir(null);
      dragCounter.current = 0;

      const sourcePath = e.dataTransfer.getData("text/plain");
      if (!sourcePath) return;

      const sourceDir = sourcePath.substring(0, sourcePath.lastIndexOf("/"));
      if (sourceDir === targetDir || sourcePath === targetDir) return;

      const fileName = sourcePath.split("/").pop();
      const destination = `${targetDir}/${fileName}`;

      try {
        const res = await fetch(
          docsSurfaceUrl(`/api/files/${encodeURIComponent(sourcePath)}`, clientId),
          {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ destination }),
          }
        );
        if (res.ok) {
          setChildrenMap((prev) => {
            const next = { ...prev };
            if (next[sourceDir]) {
              next[sourceDir] = next[sourceDir].filter((n) => n.path !== sourcePath);
            }
            delete next[targetDir];
            return next;
          });
          setSections((prev) =>
            prev.map((section) => {
              if (section.dir === sourceDir) {
                return { ...section, nodes: section.nodes.filter((n) => n.path !== sourcePath) };
              }
              return section;
            })
          );
          if (expandedDirs.has(targetDir)) {
            fetch(docsSurfaceUrl(`/api/files?dir=${encodeURIComponent(targetDir)}`, clientId))
              .then((r) => r.json())
              .then((children: FileNode[]) => {
                setChildrenMap((prev) => ({ ...prev, [targetDir]: children }));
              });
          }
          if (selectedPath === sourcePath) {
            onSelectFile(destination);
          }
        }
      } catch {
        // silently fail
      }
    },
    [clientId, expandedDirs, selectedPath, onSelectFile]
  );

  // ── Section reorder drag handlers ──

  const handleSectionDragStart = useCallback((e: React.DragEvent, index: number) => {
    e.dataTransfer.setData("drag-type", "section");
    e.dataTransfer.setData("text/plain", String(index));
    e.dataTransfer.effectAllowed = "move";
    setDragSectionIndex(index);
  }, []);

  const handleSectionDragOver = useCallback((e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverSectionIndex(index);
  }, []);

  const handleSectionDrop = useCallback((e: React.DragEvent, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (dragSectionIndex !== null && dragSectionIndex !== toIndex) {
      setSections((prev) => {
        const next = [...prev];
        const [moved] = next.splice(dragSectionIndex, 1);
        next.splice(toIndex, 0, moved);
        saveOrder(DOCS_ORDER_KEY, next.map((s) => s.dir));
        return next;
      });
    }
    setDragSectionIndex(null);
    setDragOverSectionIndex(null);
  }, [dragSectionIndex]);

  const handleSectionDragEnd = useCallback(() => {
    setDragSectionIndex(null);
    setDragOverSectionIndex(null);
  }, []);

  // ── Node reorder within section drag handlers ──

  const handleNodeDragStart = useCallback((e: React.DragEvent, sectionDir: string, nodeIndex: number) => {
    e.dataTransfer.setData("drag-type", "node-reorder");
    e.dataTransfer.setData("text/plain", `${sectionDir}:${nodeIndex}`);
    e.dataTransfer.effectAllowed = "move";
    setDragNodeKey(`${sectionDir}:${nodeIndex}`);
  }, []);

  const handleNodeDragOver = useCallback((e: React.DragEvent, sectionDir: string, nodeIndex: number) => {
    e.preventDefault();
    setDragOverNodeKey(`${sectionDir}:${nodeIndex}`);
  }, []);

  const handleNodeDrop = useCallback((e: React.DragEvent, sectionDir: string, toIndex: number) => {
    e.preventDefault();
    e.stopPropagation();
    if (!dragNodeKey) return;
    const [fromDir, fromIndexStr] = dragNodeKey.split(":");
    const fromIndex = parseInt(fromIndexStr, 10);
    if (fromDir === sectionDir && fromIndex !== toIndex) {
      setSections((prev) =>
        prev.map((section) => {
          if (section.dir !== sectionDir) return section;
          const nodes = [...section.nodes];
          const [moved] = nodes.splice(fromIndex, 1);
          nodes.splice(toIndex, 0, moved);
          saveOrder(DOCS_NODE_ORDER_PREFIX + sectionDir, nodes.map((n) => n.path));
          return { ...section, nodes };
        })
      );
    }
    setDragNodeKey(null);
    setDragOverNodeKey(null);
  }, [dragNodeKey]);

  const handleNodeDragEnd = useCallback(() => {
    setDragNodeKey(null);
    setDragOverNodeKey(null);
  }, []);

  // ── Render helpers ──

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isDir = node.type === "directory";
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.path === selectedPath;
    const isDragOver = dragOverDir === node.path;
    const isDragging = draggingPath === node.path;
    const children = childrenMap[node.path] || node.children || [];
    const syncStatus = syncStatusForPath(node.path, syncFiles, isDir);

    return (
      <div key={node.path}>
        <button
          draggable={!isDir}
          onDragStart={!isDir ? (e) => handleFileDragStart(e, node.path) : undefined}
          onDragEnd={!isDir ? handleFileDragEnd : undefined}
          onDragEnter={isDir ? (e) => handleDragEnterDir(e, node.path) : undefined}
          onDragLeave={isDir ? handleDragLeaveDir : undefined}
          onDragOver={isDir ? handleDragOverGeneric : undefined}
          onDrop={isDir ? (e) => handleFileDrop(e, node.path) : undefined}
          onClick={() => (isDir ? toggleDir(node.path) : onSelectFile(node.path))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 12px",
            paddingLeft: 12 + depth * 16,
            border: "none",
            background: isSelected
              ? "var(--cc-brand-soft)"
              : isDragOver
              ? "var(--cc-brand-alpha-08)"
              : "transparent",
            color: isSelected ? "var(--cc-brand-strong)" : "var(--cc-text-primary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            cursor: isDir ? "pointer" : isDragging ? "grabbing" : "pointer",
            borderRadius: "0.25rem",
            textAlign: "left",
            transition: "background 150ms ease",
            opacity: isDragging ? 0.4 : 1,
            outline: isDragOver ? "2px dashed var(--cc-brand-primary)" : "none",
            outlineOffset: -2,
          }}
          onMouseEnter={(e) => {
            if (!isSelected && !isDragOver) e.currentTarget.style.background = "var(--cc-surface-muted)";
          }}
          onMouseLeave={(e) => {
            if (!isSelected && !isDragOver) e.currentTarget.style.background = "transparent";
          }}
        >
          {isDir ? (
            isExpanded ? (
              <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
            ) : (
              <Folder size={16} style={{ color: isDragOver ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)", flexShrink: 0 }} />
            )
          ) : (
            (() => {
              const Icon = getFileIcon(node.name);
              return <Icon size={16} style={{ color: getFileIconColor(node.name), flexShrink: 0 }} />;
            })()
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {node.name}
          </span>
          {syncStatus && <span title={syncStatusLabel(syncStatus)} style={treeSyncDotStyle(syncStatus)} />}
        </button>

        {isDir && isExpanded && (
          <div>
            {children.map((child) => renderNode(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  const renderSectionHeader = (section: SectionData, sectionIndex: number) => {
    const isExpanded = expandedSections.has(section.dir);
    const isDragOverFolder = dragOverDir === section.dir;
    const isSectionDragOver = dragOverSectionIndex === sectionIndex;
    const isSectionDragging = dragSectionIndex === sectionIndex;
    const syncStatus = syncStatusForPath(section.dir, syncFiles, true);

    return (
      <button
        draggable
        onDragStart={(e) => handleSectionDragStart(e, sectionIndex)}
        onDragOver={(e) => { handleDragOverGeneric(e); handleSectionDragOver(e, sectionIndex); }}
        onDrop={(e) => {
          // Check if this is a section reorder or a file drop
          if (dragSectionIndex !== null) {
            handleSectionDrop(e, sectionIndex);
          } else {
            handleFileDrop(e, section.dir);
          }
        }}
        onDragEnd={handleSectionDragEnd}
        onDragEnter={(e) => handleDragEnterDir(e, section.dir)}
        onDragLeave={handleDragLeaveDir}
        onClick={() => toggleSection(section.dir)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          width: "100%",
          padding: "8px 12px",
          border: "none",
          background: isDragOverFolder ? "var(--cc-brand-alpha-08)" : "transparent",
          color: "var(--cc-text-primary)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          cursor: "grab",
          borderRadius: "0.25rem",
          textAlign: "left",
          transition: "background 150ms ease",
          outline: isDragOverFolder ? "2px dashed var(--cc-brand-primary)" : "none",
          outlineOffset: -2,
          opacity: isSectionDragging ? 0.4 : 1,
          borderTop: isSectionDragOver && !isSectionDragging ? "2px solid var(--cc-brand-primary)" : "2px solid transparent",
        }}
        onMouseEnter={(e) => {
          if (!isDragOverFolder) e.currentTarget.style.background = "var(--cc-surface-muted)";
        }}
        onMouseLeave={(e) => {
          if (!isDragOverFolder) e.currentTarget.style.background = "transparent";
        }}
      >
        {isExpanded ? (
          <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
        ) : (
          <Folder size={16} style={{ color: isDragOverFolder ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)", flexShrink: 0 }} />
        )}
        <span style={{ fontWeight: 500 }}>{section.label}</span>
        {syncStatus && <span title={syncStatusLabel(syncStatus)} style={treeSyncDotStyle(syncStatus)} />}
        <span
          style={{
            marginLeft: "auto",
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 10,
            color: "var(--cc-text-tertiary)",
          }}
        >
          {section.nodes.length}
        </span>
      </button>
    );
  };

  const renderSectionNode = (node: FileNode, section: SectionData, nodeIndex: number) => {
    const nodeKey = `${section.dir}:${nodeIndex}`;
    const isNodeDragging = dragNodeKey === nodeKey;
    const isNodeDragOver = dragOverNodeKey === nodeKey && !isNodeDragging;

    return (
      <div
        key={node.path}
        draggable
        onDragStart={(e) => handleNodeDragStart(e, section.dir, nodeIndex)}
        onDragOver={(e) => handleNodeDragOver(e, section.dir, nodeIndex)}
        onDrop={(e) => handleNodeDrop(e, section.dir, nodeIndex)}
        onDragEnd={handleNodeDragEnd}
        style={{
          opacity: isNodeDragging ? 0.4 : 1,
          borderTop: isNodeDragOver ? "2px solid var(--cc-brand-primary)" : "2px solid transparent",
          cursor: "grab",
        }}
      >
        {renderNode(node, 1)}
      </div>
    );
  };

  if (loading) {
    return <FileTreeSkeleton />;
  }

  const hasContent = rootFiles.length > 0 || sections.length > 0;

  if (!hasContent) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <FileText size={32} style={{ color: "var(--cc-text-secondary)", margin: "0 auto 8px" }} />
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--cc-text-secondary)" }}>
          No documentation files found
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {/* Root Files */}
      {rootFiles.length > 0 && (
        <div>
          <div
            style={{
              padding: "6px 12px",
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cc-text-tertiary)",
            }}
          >
            Root
          </div>
          {rootFiles.map((node) => renderNode(node, 0))}
        </div>
      )}

      {/* Directory Sections */}
      {sections.map((section, sectionIndex) => (
        <div key={section.dir} style={{ marginTop: 8 }}>
          {renderSectionHeader(section, sectionIndex)}
          {expandedSections.has(section.dir) && (
            <div>
              {section.nodes.map((node, nodeIndex) =>
                renderSectionNode(node, section, nodeIndex)
              )}
            </div>
          )}
        </div>
      ))}

      {/* Clients Section */}
      {clients.length > 0 && (
        <div style={{ marginTop: 8 }}>
          <button
            onClick={() => setClientsExpanded((v) => !v)}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              width: "100%",
              padding: "8px 12px",
              border: "none",
              background: "transparent",
              color: "var(--cc-text-primary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              cursor: "pointer",
              borderRadius: "0.25rem",
              textAlign: "left",
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-surface-muted)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
          >
            <Users size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
            <span style={{ fontWeight: 500 }}>Clients</span>
            <span
              style={{
                marginLeft: "auto",
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                color: "var(--cc-text-tertiary)",
              }}
            >
              {clients.length}
            </span>
          </button>
          {clientsExpanded && (
            <div>
              {clients.map((client) => {
                const isExpanded = expandedClients.has(client.slug);
                const children = clientChildren[client.slug] || [];
                return (
                  <div key={client.slug}>
                    <button
                      onClick={() => toggleClient(client.slug)}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                        width: "100%",
                        padding: "8px 12px",
                        paddingLeft: 28,
                        border: "none",
                        background: "transparent",
                        color: "var(--cc-text-primary)",
                        fontFamily: "var(--font-inter), Inter, sans-serif",
                        fontSize: 13,
                        cursor: "pointer",
                        borderRadius: "0.25rem",
                        textAlign: "left",
                        transition: "background 150ms ease",
                      }}
                      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-surface-muted)"; }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                    >
                      {isExpanded ? (
                        <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
                      ) : (
                        <Folder size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
                      )}
                      <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                        {client.name}
                      </span>
                    </button>
                    {isExpanded && children.map((dirNode) => (
                      <div key={dirNode.path}>
                        <button
                          onClick={() => toggleDir(dirNode.path)}
                          style={{
                            display: "flex",
                            alignItems: "center",
                            gap: 8,
                            width: "100%",
                            padding: "8px 12px",
                            paddingLeft: 44,
                            border: "none",
                            background: "transparent",
                            color: "var(--cc-text-primary)",
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            fontSize: 13,
                            cursor: "pointer",
                            borderRadius: "0.25rem",
                            textAlign: "left",
                            transition: "background 150ms ease",
                          }}
                          onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-surface-muted)"; }}
                          onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
                        >
                          {expandedDirs.has(dirNode.path) ? (
                            <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
                          ) : (
                            <Folder size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
                          )}
                          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
                            {dirNode.name}
                          </span>
                          <span style={{
                            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                            fontSize: 10,
                            color: "var(--cc-text-tertiary)",
                          }}>
                            {(dirNode.children || []).length}
                          </span>
                        </button>
                        {expandedDirs.has(dirNode.path) && (dirNode.children || []).map((child) =>
                          renderNode(child, 3)
                        )}
                      </div>
                    ))}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function syncStatusForPath(path: string, syncFiles: Record<string, SyncItemStatus>, isDirectory: boolean): SyncItemStatus | null {
  const direct = syncFiles[path];
  if (direct && direct !== "synced") return direct;
  if (!isDirectory) return null;
  const prefix = `${path}/`;
  const childStatuses = Object.entries(syncFiles)
    .filter(([filePath, status]) => filePath.startsWith(prefix) && status !== "synced")
    .map(([, status]) => status);
  return strongestSyncStatus(childStatuses);
}

function strongestSyncStatus(statuses: SyncItemStatus[]): SyncItemStatus | null {
  if (statuses.includes("diverged")) return "diverged";
  if (statuses.includes("not_synced")) return "not_synced";
  if (statuses.includes("local_changes") && statuses.includes("server_changes")) return "diverged";
  if (statuses.includes("local_changes")) return "local_changes";
  if (statuses.includes("server_changes")) return "server_changes";
  return null;
}

function syncStatusLabel(status: SyncItemStatus): string {
  if (status === "local_changes") return "Local changes";
  if (status === "server_changes") return "Server updates";
  if (status === "diverged") return "Both local and server changed";
  if (status === "not_synced") return "Not synced";
  return "Synced";
}

function treeSyncDotStyle(status: SyncItemStatus): React.CSSProperties {
  const color = status === "server_changes"
    ? "var(--cc-brand-primary)"
    : status === "local_changes"
      ? "#717171"
      : "var(--cc-status-warning-strong)";
  return {
    width: 8,
    height: 8,
    borderRadius: "50%",
    background: color,
    boxShadow: `0 0 0 2px color-mix(in srgb, ${color} 20%, transparent)`,
    flexShrink: 0,
  };
}
