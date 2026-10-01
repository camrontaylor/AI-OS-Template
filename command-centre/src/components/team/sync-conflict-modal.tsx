"use client";

import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { createPortal } from "react-dom";
import { AlertTriangle, ChevronDown, ChevronRight, X } from "lucide-react";
import { diffContentsForConflict, diffLines, type SyncDiffLineKind } from "@/lib/sync-diff";

export interface SyncConflict {
  path: string;
  operation?: "write-local" | "write-remote" | "delete-local" | "delete-remote";
  secret?: boolean;
  encoding?: "utf-8" | "base64";
  localSha256?: string;
  remoteSha256?: string;
  localSize?: number;
  remoteSize?: number;
  localContent?: string;
  remoteContent?: string;
}

interface SyncConflictModalProps {
  title: string;
  direction: "pull" | "push";
  conflicts: SyncConflict[];
  busy?: boolean;
  confirmLabel?: string;
  onCancel: () => void;
  onOverwrite: () => void;
}

function operationLabel(conflict: SyncConflict, direction: "pull" | "push"): string {
  if (conflict.operation === "delete-local") return "Server deleted this file. Pull would delete your local copy.";
  if (conflict.operation === "delete-remote") return "Local file is deleted. Push would delete the server copy.";
  if (direction === "pull") return "Pull would replace your local file with the server version.";
  return "Push would replace the server file with your local version.";
}

export function SyncConflictModal({
  title,
  direction,
  conflicts,
  busy,
  confirmLabel,
  onCancel,
  onOverwrite,
}: SyncConflictModalProps) {
  const conflictRows = useMemo(
    () => conflicts.map((conflict, index) => ({
      conflict,
      key: `${conflict.operation ?? "change"}-${conflict.path}-${index}`,
    })),
    [conflicts],
  );
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => new Set(conflictRows.length > 3 ? conflictRows.slice(0, 1).map((row) => row.key) : conflictRows.map((row) => row.key)));

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [onCancel]);

  useEffect(() => {
    setExpandedKeys(new Set(conflictRows.length > 3 ? conflictRows.slice(0, 1).map((row) => row.key) : conflictRows.map((row) => row.key)));
  }, [conflictRows]);

  if (typeof document === "undefined") return null;

  const allExpanded = expandedKeys.size === conflictRows.length;
  const toggleExpanded = (key: string) => {
    setExpandedKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const expandAll = () => setExpandedKeys(new Set(conflictRows.map((row) => row.key)));
  const collapseAll = () => setExpandedKeys(new Set());

  return createPortal(
    <div style={overlayStyle} onMouseDown={onCancel}>
      <div role="dialog" aria-modal="true" aria-labelledby="sync-conflict-title" style={modalStyle} onMouseDown={(event) => event.stopPropagation()}>
        <div style={headerStyle}>
          <div style={titleWrapStyle}>
            <AlertTriangle size={20} />
            <div>
              <h3 id="sync-conflict-title" style={titleStyle}>{title}</h3>
              <div style={metaStyle}>
                {conflicts.length} file{conflicts.length === 1 ? "" : "s"} need review before {direction === "pull" ? "pulling" : "pushing"}.
              </div>
            </div>
          </div>
          <button type="button" onClick={onCancel} style={iconButtonStyle} aria-label="Close conflict review">
            <X size={16} />
          </button>
        </div>

        <div style={bodyStyle}>
          {conflictRows.length > 1 && (
            <div style={summaryPanelStyle}>
              <div style={summaryHeaderStyle}>
                <div style={summaryTitleStyle}>Files with changes</div>
                <div style={summaryActionsStyle}>
                  <button type="button" onClick={expandAll} disabled={allExpanded} style={secondaryButtonStyle}>Expand all</button>
                  <button type="button" onClick={collapseAll} disabled={expandedKeys.size === 0} style={secondaryButtonStyle}>Collapse all</button>
                </div>
              </div>
              <div style={summaryListStyle}>
                {conflictRows.map(({ conflict, key }) => {
                  const expanded = expandedKeys.has(key);
                  return (
                    <button key={key} type="button" onClick={() => toggleExpanded(key)} style={summaryFileButtonStyle(expanded)}>
                      {expanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                      <span style={summaryFilePathStyle}>{conflict.path}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          )}

          {conflictRows.map(({ conflict, key }) => {
            const textDiff = conflict.localContent != null || conflict.remoteContent != null;
            const expanded = expandedKeys.has(key);
            const diffContent = diffContentsForConflict(conflict, direction);
            return (
              <div key={key} style={conflictCardStyle}>
                <button type="button" style={conflictHeaderStyle} onClick={() => toggleExpanded(key)}>
                  <div>
                    <div style={pathStyle}>
                      {expanded ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                      <span>{conflict.path}</span>
                    </div>
                    <div style={metaStyle}>{operationLabel(conflict, direction)}</div>
                  </div>
                  {conflict.secret && <span style={secretBadgeStyle}>Secret</span>}
                </button>
                {expanded && (
                  textDiff ? (
                    <pre style={diffStyle}>
                      {diffLines(diffContent.beforeContent, diffContent.afterContent).map((line, index) => (
                        <div key={`${index}-${line.kind}`} style={diffLineStyle(line.kind)}>
                          <span style={diffPrefixStyle}>{line.kind === "remove" ? "-" : line.kind === "add" ? "+" : " "}</span>
                          <span>{line.value || " "}</span>
                        </div>
                      ))}
                    </pre>
                  ) : (
                    <div style={binaryStyle}>
                      <div>Local: {conflict.localSize ?? 0} bytes {conflict.localSha256 ? `(${conflict.localSha256.slice(0, 12)})` : ""}</div>
                      <div>Server: {conflict.remoteSize ?? 0} bytes {conflict.remoteSha256 ? `(${conflict.remoteSha256.slice(0, 12)})` : ""}</div>
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>

        <div style={footerStyle}>
          <button type="button" onClick={onCancel} disabled={busy} style={secondaryButtonStyle}>
            Cancel
          </button>
          <button type="button" onClick={onOverwrite} disabled={busy} style={dangerButtonStyle}>
            {busy ? "Applying..." : confirmLabel ?? (direction === "pull" ? "Overwrite local files" : "Overwrite server files")}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

const overlayStyle: CSSProperties = {
  position: "fixed",
  inset: 0,
  zIndex: 2500,
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  padding: 20,
  background: "rgba(24, 24, 24, 0.46)",
  backdropFilter: "blur(10px)",
  WebkitBackdropFilter: "blur(10px)",
};

const modalStyle: CSSProperties = {
  width: "min(1180px, calc(100vw - 32px))",
  maxHeight: "calc(100vh - 32px)",
  display: "flex",
  flexDirection: "column",
  border: "1px solid var(--cc-line-alpha-15)",
  borderRadius: 8,
  background: "var(--cc-surface)",
  boxShadow: "0 24px 72px var(--cc-neutral-alpha-24)",
};

const headerStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 14,
  padding: 16,
  borderBottom: "1px solid var(--cc-line-alpha-10)",
};

const titleWrapStyle: CSSProperties = {
  display: "flex",
  alignItems: "flex-start",
  gap: 10,
  color: "var(--cc-status-warning-bright)",
};

const titleStyle: CSSProperties = {
  margin: 0,
  color: "var(--cc-text-primary)",
  fontSize: 18,
  fontWeight: 800,
};

const metaStyle: CSSProperties = {
  marginTop: 3,
  color: "var(--cc-text-tertiary)",
  fontSize: 12,
  lineHeight: 1.4,
};

const iconButtonStyle: CSSProperties = {
  width: 30,
  height: 30,
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  border: "1px solid var(--cc-line-alpha-15)",
  borderRadius: 6,
  background: "var(--cc-surface-muted)",
  color: "var(--cc-text-secondary)",
  cursor: "pointer",
};

const bodyStyle: CSSProperties = {
  overflow: "auto",
  padding: 16,
  display: "flex",
  flexDirection: "column",
  gap: 12,
};

const summaryPanelStyle: CSSProperties = {
  border: "1px solid var(--cc-line-alpha-15)",
  borderRadius: 8,
  background: "var(--cc-surface-muted)",
  padding: 12,
  display: "grid",
  gap: 10,
};

const summaryHeaderStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "space-between",
  gap: 12,
};

const summaryTitleStyle: CSSProperties = {
  color: "var(--cc-text-primary)",
  fontSize: 13,
  fontWeight: 800,
};

const summaryActionsStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 8,
  flexWrap: "wrap",
};

const summaryListStyle: CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
  gap: 8,
};

function summaryFileButtonStyle(active: boolean): CSSProperties {
  return {
    minWidth: 0,
    minHeight: 32,
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "6px 8px",
    border: `1px solid ${active ? "var(--cc-status-info)" : "var(--cc-line-alpha-15)"}`,
    borderRadius: 6,
    background: active ? "var(--cc-surface-info)" : "var(--cc-surface)",
    color: "var(--cc-text-secondary)",
    cursor: "pointer",
    textAlign: "left",
    fontSize: 12,
    fontWeight: 700,
  };
}

const summaryFilePathStyle: CSSProperties = {
  minWidth: 0,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
};

const conflictCardStyle: CSSProperties = {
  border: "1px solid var(--cc-line-alpha-15)",
  borderRadius: 8,
  overflow: "hidden",
  background: "var(--cc-surface-muted)",
};

const conflictHeaderStyle: CSSProperties = {
  width: "100%",
  display: "flex",
  alignItems: "flex-start",
  justifyContent: "space-between",
  gap: 12,
  padding: 12,
  border: "none",
  borderBottom: "1px solid var(--cc-line-alpha-10)",
  background: "transparent",
  color: "inherit",
  cursor: "pointer",
  textAlign: "left",
};

const pathStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  gap: 6,
  color: "var(--cc-text-primary)",
  fontSize: 13,
  fontWeight: 800,
  overflowWrap: "anywhere",
};

const secretBadgeStyle: CSSProperties = {
  flexShrink: 0,
  padding: "2px 7px",
  borderRadius: 999,
  background: "var(--cc-status-warning-bg)",
  color: "var(--cc-status-warning-bright)",
  fontSize: 11,
  fontWeight: 800,
};

const diffStyle: CSSProperties = {
  margin: 0,
  padding: 0,
  maxHeight: 320,
  overflow: "auto",
  background: "var(--cc-surface)",
  color: "var(--cc-text-secondary)",
  fontSize: 12,
  lineHeight: 1.45,
};

const diffPrefixStyle: CSSProperties = {
  display: "inline-block",
  width: 18,
  color: "var(--cc-text-tertiary)",
};

function diffLineStyle(kind: SyncDiffLineKind): CSSProperties {
  return {
    padding: "1px 10px",
    background: kind === "remove" ? "rgba(112, 112, 112, 0.12)" : kind === "add" ? "rgba(111, 111, 111, 0.12)" : "transparent",
    color: kind === "remove" ? "var(--cc-status-danger-bright)" : kind === "add" ? "#6F6F6F" : "var(--cc-text-secondary)",
    whiteSpace: "pre-wrap",
    overflowWrap: "anywhere",
  };
}

const binaryStyle: CSSProperties = {
  display: "grid",
  gap: 6,
  padding: 12,
  color: "var(--cc-text-secondary)",
  fontSize: 12,
  lineHeight: 1.5,
};

const footerStyle: CSSProperties = {
  display: "flex",
  alignItems: "center",
  justifyContent: "flex-end",
  gap: 8,
  padding: 16,
  borderTop: "1px solid var(--cc-line-alpha-10)",
};

const secondaryButtonStyle: CSSProperties = {
  minHeight: 34,
  padding: "0 12px",
  border: "1px solid var(--cc-line-alpha-25)",
  borderRadius: 6,
  background: "var(--cc-surface-muted)",
  color: "var(--cc-text-secondary)",
  cursor: "pointer",
  fontSize: 13,
  fontWeight: 700,
};

const dangerButtonStyle: CSSProperties = {
  ...secondaryButtonStyle,
  border: "none",
  background: "var(--cc-status-danger-bright)",
  color: "var(--cc-surface)",
};
