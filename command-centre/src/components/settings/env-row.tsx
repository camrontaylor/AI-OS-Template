"use client";

import { useState } from "react";
import { Eye, EyeOff, Copy, Check, Pencil, X } from "lucide-react";
import { DeleteConfirmButton } from "@/components/shared/delete-confirm-button";

interface EnvRowProps {
  entry: { key: string; value: string };
  isNew?: boolean;
  onUpdate: (key: string, value: string) => void;
  onDelete: (key: string) => void;
  onCancelNew?: () => void;
}

export function EnvRow({ entry, isNew, onUpdate, onDelete, onCancelNew }: EnvRowProps) {
  const [revealed, setRevealed] = useState(false);
  const [editing, setEditing] = useState(isNew ?? false);
  const [editKey, setEditKey] = useState(entry.key);
  const [editValue, setEditValue] = useState(entry.value);
  const [copied, setCopied] = useState(false);

  const iconBtnStyle: React.CSSProperties = {
    background: "none",
    border: "none",
    cursor: "pointer",
    color: "var(--cc-text-secondary)",
    padding: 4,
    display: "flex",
    alignItems: "center",
    borderRadius: 4,
  };

  const inputStyle: React.CSSProperties = {
    fontFamily: "monospace",
    fontSize: 13,
    padding: "6px 10px",
    border: "1px solid var(--cc-line-alpha-40)",
    borderRadius: 6,
    outline: "none",
    background: "var(--cc-surface)",
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(entry.value);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSave = () => {
    onUpdate(editKey, editValue);
    setEditing(false);
  };

  const handleCancel = () => {
    if (isNew) {
      onCancelNew?.();
    } else {
      setEditKey(entry.key);
      setEditValue(entry.value);
      setEditing(false);
    }
  };

  if (editing) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          padding: "10px 16px",
          gap: 12,
          borderBottom: "1px solid var(--cc-line-alpha-10)",
          background: "var(--cc-brand-alpha-02)",
        }}
      >
        <input
          style={{
            ...inputStyle,
            minWidth: 200,
            flexShrink: 0,
            fontWeight: 600,
            ...(isNew ? {} : { background: "var(--cc-surface-muted)", cursor: "default" }),
          }}
          value={editKey}
          onChange={(e) => setEditKey(e.target.value)}
          readOnly={!isNew}
          placeholder="KEY_NAME"
        />
        <input
          style={{ ...inputStyle, flex: 1 }}
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          placeholder="value"
        />
        <button
          style={{ ...iconBtnStyle, color: "var(--cc-status-success-bright)" }}
          onClick={handleSave}
          title="Save"
        >
          <Check size={16} />
        </button>
        <button
          style={iconBtnStyle}
          onClick={handleCancel}
          title="Cancel"
        >
          <X size={16} />
        </button>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        padding: "10px 16px",
        gap: 12,
        borderBottom: "1px solid var(--cc-line-alpha-10)",
      }}
      onMouseEnter={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "var(--cc-brand-alpha-02)";
      }}
      onMouseLeave={(e) => {
        (e.currentTarget as HTMLDivElement).style.background = "transparent";
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-space-grotesk), Space Grotesk, monospace",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--cc-text-primary)",
          minWidth: 200,
          flexShrink: 0,
        }}
      >
        {entry.key}
      </span>
      <span
        style={{
          flex: 1,
          fontFamily: "monospace",
          fontSize: 13,
          color: "var(--cc-text-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {revealed ? entry.value : "\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022\u2022"}
      </span>
      <button style={iconBtnStyle} onClick={() => setRevealed(!revealed)} title={revealed ? "Hide" : "Reveal"}>
        {revealed ? <Eye size={16} /> : <EyeOff size={16} />}
      </button>
      <button
        style={{ ...iconBtnStyle, ...(copied ? { color: "var(--cc-status-success-bright)" } : {}) }}
        onClick={handleCopy}
        title="Copy value"
      >
        {copied ? <Check size={16} /> : <Copy size={16} />}
      </button>
      <button
        style={iconBtnStyle}
        onClick={() => {
          setEditKey(entry.key);
          setEditValue(entry.value);
          setEditing(true);
        }}
        title="Edit"
      >
        <Pencil size={16} />
      </button>
      <DeleteConfirmButton
        ariaLabel={`Delete environment variable ${entry.key}`}
        onConfirm={() => onDelete(entry.key)}
        size="standard"
        idleColor="var(--cc-text-secondary)"
      />
    </div>
  );
}
