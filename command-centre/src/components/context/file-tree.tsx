"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Folder, FolderOpen } from "lucide-react";
import type { FileNode } from "@/types/file";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import { getFileIcon, getFileIconColor } from "@/lib/file-icons";
import { FileTreeSkeleton } from "@/components/shared/file-tree-skeleton";

interface FileTreeProps {
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
}

export function FileTree({ onSelectFile, selectedPath }: FileTreeProps) {
  const clientId = useClientId();
  const [rootNodes, setRootNodes] = useState<FileNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, FileNode[]>>({});
  const [memoryLimit, setMemoryLimit] = useState(30);
  const [memoryTotal, setMemoryTotal] = useState(0);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(appendClientId("/api/files?dir=context", clientId))
      .then((r) => r.json())
      .then((nodes: FileNode[]) => {
        setRootNodes(nodes);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId]);

  const toggleDir = useCallback(
    (dirPath: string) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          // Fetch children if not already loaded
          if (!childrenMap[dirPath]) {
            const isMemory = dirPath === "context/memory" || dirPath.endsWith("/memory");
            const url = appendClientId(`/api/files?dir=${encodeURIComponent(dirPath)}${isMemory ? "&limit=30" : ""}`, clientId);
            fetch(url)
              .then((r) => r.json())
              .then((children: FileNode[]) => {
                setChildrenMap((prev) => ({ ...prev, [dirPath]: children }));
                if (isMemory) {
                  setMemoryTotal(children.length >= 30 ? 999 : children.length);
                }
              });
          }
        }
        return next;
      });
    },
    [childrenMap, clientId]
  );

  const loadMoreMemory = useCallback(
    (dirPath: string) => {
      const newLimit = memoryLimit + 30;
      fetch(appendClientId(`/api/files?dir=${encodeURIComponent(dirPath)}&limit=${newLimit}`, clientId))
        .then((r) => r.json())
        .then((children: FileNode[]) => {
          setChildrenMap((prev) => ({ ...prev, [dirPath]: children }));
          setMemoryLimit(newLimit);
          if (children.length < newLimit) setMemoryTotal(children.length);
        });
    },
    [memoryLimit, clientId]
  );

  const renderNode = (node: FileNode, depth: number = 0) => {
    const isDir = node.type === "directory";
    const isExpanded = expandedDirs.has(node.path);
    const isSelected = node.path === selectedPath;
    const isMemoryDir = node.name === "memory";
    const children = childrenMap[node.path] || node.children || [];

    return (
      <div key={node.path}>
        <button
          onClick={() => (isDir ? toggleDir(node.path) : onSelectFile(node.path))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 12px",
            paddingLeft: 12 + depth * 16,
            border: "none",
            background: isSelected ? "var(--cc-brand-soft)" : "transparent",
            color: isSelected ? "var(--cc-brand-strong)" : "var(--cc-text-primary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            cursor: "pointer",
            borderRadius: "0.25rem",
            textAlign: "left",
            transition: "background 150ms ease",
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.background = "var(--cc-surface-muted)";
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.background = "transparent";
          }}
        >
          {isDir ? (
            isExpanded ? (
              <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
            ) : (
              <Folder size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
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
        </button>

        {isDir && isExpanded && (
          <div>
            {children.map((child) => renderNode(child, depth + 1))}
            {isMemoryDir && children.length >= memoryLimit && (
              <button
                onClick={() => loadMoreMemory(node.path)}
                style={{
                  display: "block",
                  width: "100%",
                  padding: "6px 12px",
                  paddingLeft: 12 + (depth + 1) * 16,
                  border: "none",
                  background: "none",
                  color: "var(--cc-brand-primary)",
                  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 11,
                  cursor: "pointer",
                  textAlign: "left",
                  fontWeight: 500,
                }}
              >
                Load more...
              </button>
            )}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return <FileTreeSkeleton />;
  }

  if (rootNodes.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <FileText size={32} style={{ color: "var(--cc-text-secondary)", margin: "0 auto 8px" }} />
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--cc-text-secondary)" }}>
          No context files found
        </p>
      </div>
    );
  }

  return (
    <div style={{ padding: "8px 0" }}>
      {rootNodes.map((node) => renderNode(node, 0))}
    </div>
  );
}
