"use client";

import { useState } from "react";

interface MarkdownEditorProps {
  content: string;
  onSave: (content: string) => void;
  onCancel: () => void;
  isSaving?: boolean;
}

export function MarkdownEditor({ content, onSave, onCancel, isSaving }: MarkdownEditorProps) {
  const [localContent, setLocalContent] = useState(content);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <textarea
        value={localContent}
        onChange={(e) => setLocalContent(e.target.value)}
        style={{
          width: "100%",
          minHeight: 400,
          padding: 16,
          backgroundColor: "var(--cc-surface)",
          border: "1px solid var(--cc-line-alpha-20)",
          borderRadius: 8,
          fontFamily: "var(--font-space-grotesk), 'Space Grotesk', monospace",
          fontSize: 13,
          lineHeight: 1.6,
          color: "var(--cc-text-primary)",
          resize: "vertical",
          outline: "none",
          transition: "border-color 200ms ease",
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--cc-brand-primary)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--cc-line-alpha-20)";
        }}
      />
      <div style={{ display: "flex", gap: 12, justifyContent: "flex-end" }}>
        <button
          onClick={onCancel}
          disabled={isSaving}
          style={{
            background: "none",
            border: "none",
            color: "var(--cc-text-secondary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            fontWeight: 500,
            cursor: isSaving ? "not-allowed" : "pointer",
            padding: "8px 16px",
            textDecoration: "none",
            transition: "text-decoration 150ms ease",
          }}
          onMouseEnter={(e) => {
            if (!isSaving) e.currentTarget.style.textDecoration = "underline";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = "none";
          }}
        >
          Cancel
        </button>
        <button
          onClick={() => onSave(localContent)}
          disabled={isSaving}
          style={{
            background: "linear-gradient(135deg, var(--cc-brand-primary) 0%, var(--cc-brand-hover) 100%)",
            color: "var(--cc-surface)",
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 600,
            fontSize: 14,
            padding: "8px 20px",
            borderRadius: 8,
            border: "none",
            cursor: isSaving ? "not-allowed" : "pointer",
            opacity: isSaving ? 0.7 : 1,
            transition: "opacity 150ms ease",
          }}
        >
          {isSaving ? "Saving..." : "Save"}
        </button>
      </div>
    </div>
  );
}
