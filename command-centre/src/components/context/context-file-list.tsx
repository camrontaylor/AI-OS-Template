"use client";

import { useState, useEffect, useCallback } from "react";
import {
  FileText,
  ChevronUp,
  ChevronDown,
  FolderOpen,
  ChevronRight,
} from "lucide-react";
import type { FileNode } from "@/types/file";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import { profileStorageKey } from "@/lib/profile-storage";

interface ContextFileListProps {
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
  onFilesLoaded?: (firstPath: string | null) => void;
}

const STORAGE_KEY = "context-file-order";

const iconMap: Record<string, React.ReactNode> = {
  SOUL: <FileText size={18} style={{ color: "var(--cc-brand-primary)" }} />,
  USER: <FileText size={18} style={{ color: "var(--cc-brand-primary)" }} />,
  learnings: <FileText size={18} style={{ color: "var(--cc-brand-primary)" }} />,
};

function toDisplayName(name: string): string {
  return name.replace(/\.md$/, "");
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function getIcon(name: string): React.ReactNode {
  const base = name.replace(/\.md$/, "");
  return iconMap[base] || <FileText size={18} style={{ color: "var(--cc-brand-primary)" }} />;
}

function loadOrder(): string[] | null {
  try {
    const stored = localStorage.getItem(profileStorageKey(STORAGE_KEY));
    return stored ? JSON.parse(stored) : null;
  } catch {
    return null;
  }
}

function saveOrder(paths: string[]) {
  try {
    localStorage.setItem(profileStorageKey(STORAGE_KEY), JSON.stringify(paths));
  } catch {
    // Ignore storage errors
  }
}

export function ContextFileList({
  onSelectFile,
  selectedPath,
  onFilesLoaded,
}: ContextFileListProps) {
  const clientId = useClientId();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [memoryFiles, setMemoryFiles] = useState<FileNode[]>([]);
  const [memoryExpanded, setMemoryExpanded] = useState(false);
  const [memoryLimit, setMemoryLimit] = useState(30);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(appendClientId("/api/files?dir=context", clientId))
      .then((r) => r.json())
      .then((nodes: FileNode[]) => {
        const topFiles = nodes.filter((n) => n.type === "file");
        const savedOrder = loadOrder();
        if (savedOrder) {
          // Sort files by saved order, putting unknown files at the end
          topFiles.sort((a, b) => {
            const ai = savedOrder.indexOf(a.path);
            const bi = savedOrder.indexOf(b.path);
            if (ai === -1 && bi === -1) return 0;
            if (ai === -1) return 1;
            if (bi === -1) return -1;
            return ai - bi;
          });
        }
        setFiles(topFiles);
        setLoading(false);
        if (topFiles.length > 0) {
          onFilesLoaded?.(topFiles[0].path);
        } else {
          onFilesLoaded?.(null);
        }
      })
      .catch(() => setLoading(false));
  }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const moveFile = useCallback(
    (index: number, direction: "up" | "down") => {
      setFiles((prev) => {
        const next = [...prev];
        const targetIndex = direction === "up" ? index - 1 : index + 1;
        if (targetIndex < 0 || targetIndex >= next.length) return prev;
        [next[index], next[targetIndex]] = [next[targetIndex], next[index]];
        saveOrder(next.map((f) => f.path));
        return next;
      });
    },
    []
  );

  const loadMemory = useCallback(
    (limit: number) => {
      fetch(
        appendClientId(
          `/api/files?dir=context/memory&limit=${limit}`,
          clientId
        )
      )
        .then((r) => r.json())
        .then((children: FileNode[]) => {
          setMemoryFiles(children);
          setMemoryLimit(limit);
        });
    },
    [clientId]
  );

  const toggleMemory = useCallback(() => {
    setMemoryExpanded((prev) => {
      if (!prev && memoryFiles.length === 0) {
        loadMemory(30);
      }
      return !prev;
    });
  }, [memoryFiles.length, loadMemory]);

  if (loading) {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 8,
          padding: 16,
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              height: 56,
              backgroundColor: "var(--cc-control-bg)",
              borderRadius: "0.5rem",
              animation: "pulse-dot 1.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <FileText
          size={48}
          style={{ color: "var(--cc-text-secondary)", margin: "0 auto 16px", display: "block" }}
        />
        <h4
          style={{
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 600,
            fontSize: 16,
            color: "var(--cc-text-primary)",
            margin: "0 0 8px 0",
          }}
        >
          No context files found
        </h4>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
            maxWidth: 320,
            margin: "0 auto",
          }}
        >
          Context files like SOUL.md and USER.md will appear here.
        </p>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {files.map((file, index) => {
        const isSelected = file.path === selectedPath;
        return (
          <div
            key={file.path}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
            }}
          >
            {/* Reorder buttons */}
            <div
              style={{
                display: "flex",
                flexDirection: "column",
                gap: 0,
                flexShrink: 0,
              }}
            >
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveFile(index, "up");
                }}
                disabled={index === 0}
                style={{
                  background: "none",
                  border: "none",
                  cursor: index === 0 ? "default" : "pointer",
                  padding: 2,
                  color: index === 0 ? "var(--cc-palette-slate-soft)" : "var(--cc-text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  transition: "color 150ms ease",
                }}
                title="Move up"
              >
                <ChevronUp size={14} />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  moveFile(index, "down");
                }}
                disabled={index === files.length - 1}
                style={{
                  background: "none",
                  border: "none",
                  cursor: index === files.length - 1 ? "default" : "pointer",
                  padding: 2,
                  color: index === files.length - 1 ? "var(--cc-palette-slate-soft)" : "var(--cc-text-secondary)",
                  display: "flex",
                  alignItems: "center",
                  transition: "color 150ms ease",
                }}
                title="Move down"
              >
                <ChevronDown size={14} />
              </button>
            </div>

            {/* File row */}
            <button
              onClick={() => onSelectFile(file.path)}
              style={{
                flex: 1,
                display: "flex",
                alignItems: "center",
                gap: 12,
                padding: "14px 16px",
                border: "none",
                borderRadius: "0.5rem",
                background: isSelected ? "var(--cc-brand-soft)" : "var(--cc-surface)",
                cursor: "pointer",
                textAlign: "left",
                transition: "background 150ms ease, box-shadow 200ms ease",
              }}
              onMouseEnter={(e) => {
                if (!isSelected)
                  e.currentTarget.style.boxShadow =
                    "0px 4px 16px var(--cc-brand-alpha-06)";
              }}
              onMouseLeave={(e) => {
                e.currentTarget.style.boxShadow = "none";
              }}
            >
              {getIcon(file.name)}
              <div style={{ flex: 1, minWidth: 0 }}>
                <div
                  style={{
                    fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                    fontWeight: 600,
                    fontSize: 14,
                    color: isSelected ? "var(--cc-brand-strong)" : "var(--cc-text-primary)",
                  }}
                >
                  {toDisplayName(file.name)}
                </div>
                <div
                  style={{
                    display: "flex",
                    gap: 12,
                    alignItems: "center",
                    marginTop: 2,
                  }}
                >
                  <span
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), Space Grotesk, sans-serif",
                      fontSize: 11,
                      color: isSelected ? "var(--cc-brand-primary)" : "var(--cc-text-secondary)",
                    }}
                  >
                    {formatRelativeTime(file.lastModified)}
                  </span>
                  <span
                    style={{
                      fontFamily:
                        "var(--font-space-grotesk), Space Grotesk, sans-serif",
                      fontSize: 11,
                      color: isSelected ? "var(--cc-brand-primary)" : "var(--cc-text-tertiary)",
                    }}
                  >
                    {(file.size / 1024).toFixed(1)}KB
                  </span>
                </div>
              </div>
            </button>
          </div>
        );
      })}

      {/* Memory section */}
      <div style={{ marginTop: 8 }}>
        <button
          onClick={toggleMemory}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "10px 16px",
            marginLeft: 22,
            border: "none",
            borderRadius: "0.5rem",
            background: "transparent",
            cursor: "pointer",
            textAlign: "left",
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 600,
            fontSize: 13,
            color: "var(--cc-text-secondary)",
            transition: "background 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--cc-surface-muted)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background = "transparent";
          }}
        >
          <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
          <span style={{ flex: 1 }}>Memory</span>
          <ChevronRight
            size={14}
            style={{
              color: "var(--cc-text-secondary)",
              transform: memoryExpanded ? "rotate(90deg)" : "none",
              transition: "transform 150ms ease",
            }}
          />
        </button>

        {memoryExpanded && (
          <div
            style={{
              marginLeft: 22,
              marginTop: 4,
              display: "flex",
              flexDirection: "column",
              gap: 2,
            }}
          >
            {memoryFiles.map((mf) => {
              const isSelected = mf.path === selectedPath;
              return (
                <button
                  key={mf.path}
                  onClick={() => onSelectFile(mf.path)}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                    padding: "8px 16px",
                    border: "none",
                    borderRadius: "0.375rem",
                    background: isSelected ? "var(--cc-brand-soft)" : "transparent",
                    cursor: "pointer",
                    textAlign: "left",
                    fontFamily: "var(--font-inter), Inter, sans-serif",
                    fontSize: 13,
                    color: isSelected ? "var(--cc-brand-strong)" : "var(--cc-text-primary)",
                    transition: "background 150ms ease",
                  }}
                  onMouseEnter={(e) => {
                    if (!isSelected) e.currentTarget.style.background = "var(--cc-surface-muted)";
                  }}
                  onMouseLeave={(e) => {
                    if (!isSelected)
                      e.currentTarget.style.background = "transparent";
                  }}
                >
                  <FileText
                    size={14}
                    style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }}
                  />
                  <span
                    style={{
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {mf.name}
                  </span>
                </button>
              );
            })}
            {memoryFiles.length >= memoryLimit && (
              <button
                onClick={() => loadMemory(memoryLimit + 30)}
                style={{
                  padding: "6px 16px",
                  border: "none",
                  background: "none",
                  color: "var(--cc-brand-primary)",
                  fontFamily:
                    "var(--font-space-grotesk), Space Grotesk, sans-serif",
                  fontSize: 11,
                  fontWeight: 500,
                  cursor: "pointer",
                  textAlign: "left",
                }}
              >
                Load more...
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
