"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AlertCircle, Check, Save, Eye, EyeOff } from "lucide-react";

interface JsonEditorProps {
  apiEndpoint: string;
  title: string;
  description: string;
  emptyMessage: string;
  /** When true, mask values that look like API keys/secrets in the display */
  maskSecrets?: boolean;
}

/** Patterns that indicate a value is a secret */
const SECRET_KEY_PATTERNS = /(?:api[_-]?key|secret|token|password|credential|auth)/i;

/** Mask secret values in JSON text for display. Only masks string values whose key looks secret. */
function maskJsonSecrets(json: string): string {
  try {
    const obj = JSON.parse(json);
    const masked = maskObject(obj);
    return JSON.stringify(masked, null, 2);
  } catch {
    // If not valid JSON, do a regex-based mask on common patterns
    return json.replace(
      /("(?:[^"]*(?:api[_-]?key|secret|token|password|credential|auth)[^"]*)":\s*")([^"]{4,})(")/gi,
      (_, pre, val, post) => `${pre}${"•".repeat(Math.min(val.length, 20))}${post}`
    );
  }
}

function maskObject(obj: unknown): unknown {
  if (Array.isArray(obj)) return obj.map(maskObject);
  if (obj && typeof obj === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof val === "string" && val.length >= 4 && SECRET_KEY_PATTERNS.test(key)) {
        result[key] = "•".repeat(Math.min(val.length, 20));
      } else if (typeof val === "object" && val !== null) {
        result[key] = maskObject(val);
      } else {
        result[key] = val;
      }
    }
    return result;
  }
  return obj;
}

function validateJson(text: string): string | null {
  try {
    JSON.parse(text);
    return null;
  } catch (e) {
    const msg = (e as Error).message;
    const posMatch = msg.match(/position (\d+)/);
    if (posMatch) {
      const pos = parseInt(posMatch[1], 10);
      const lineNum = text.slice(0, pos).split("\n").length;
      return `Invalid JSON (line ~${lineNum}): ${msg}`;
    }
    return `Invalid JSON: ${msg}`;
  }
}

export function JsonEditor({ apiEndpoint, title, description, emptyMessage, maskSecrets }: JsonEditorProps) {
  const [content, setContent] = useState("");
  const [originalContent, setOriginalContent] = useState("");
  const [lastModified, setLastModified] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [exists, setExists] = useState(false);
  const [focused, setFocused] = useState(false);
  const [secretsRevealed, setSecretsRevealed] = useState(false);

  // Masked display value — only used when maskSecrets is on and secrets aren't revealed
  const displayContent = useMemo(() => {
    if (!maskSecrets || secretsRevealed || focused) return content;
    return maskJsonSecrets(content);
  }, [content, maskSecrets, secretsRevealed, focused]);

  const loadContent = useCallback(async () => {
    try {
      const res = await fetch(apiEndpoint);
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        throw new Error(data.error || "Failed to load file");
      }
      setExists(data.exists);
      setLastModified(data.lastModified || null);

      if (data.exists && data.content) {
        let formatted = data.content;
        try {
          formatted = JSON.stringify(JSON.parse(data.content), null, 2);
        } catch {
          // Use raw content if not valid JSON
        }
        setContent(formatted);
        setOriginalContent(formatted);
      } else {
        setContent("");
        setOriginalContent("");
      }
    } catch {
      setError("Failed to load file");
    } finally {
      setLoading(false);
    }
  }, [apiEndpoint]);

  useEffect(() => {
    setLoading(true);
    setError(null);
    setContent("");
    setOriginalContent("");
    setSaveSuccess(false);
    setExists(false);
    loadContent();
  }, [loadContent]);

  const handleChange = (value: string) => {
    setContent(value);
    if (value.trim() === "") {
      setError(null);
    } else {
      setError(validateJson(value));
    }
  };

  const handleSave = async () => {
    if (error || saving) return;

    setSaving(true);
    try {
      const res = await fetch(apiEndpoint, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content, lastModified }),
      });

      if (res.status === 400) {
        const data = await res.json();
        setError(data.error || "Invalid JSON");
        return;
      }

      if (res.status === 409) {
        setError("File was modified externally. Reload the page to see changes.");
        return;
      }

      if (!res.ok) {
        setError("Failed to save file");
        return;
      }

      const data = await res.json();
      setLastModified(data.lastModified);
      setOriginalContent(content);
      setExists(true);
      setSaveSuccess(true);
      setTimeout(() => setSaveSuccess(false), 2000);
    } catch {
      setError("Failed to save file");
    } finally {
      setSaving(false);
    }
  };

  const handleCreateFile = () => {
    const initial = "{}";
    setContent(initial);
    setOriginalContent("");
    setExists(true);
    setError(null);
  };

  const isDirty = content !== originalContent;
  const saveDisabled = !isDirty || saving || !!error;

  if (loading) {
    return (
      <div style={{ padding: 20 }}>
        <div
          style={{
            height: 500,
            backgroundColor: "var(--cc-surface-muted)",
            borderRadius: 8,
            animation: "pulse-badge 2s ease-in-out infinite",
          }}
        />
      </div>
    );
  }

  if (error && !content) {
    return (
      <div>
        <div
          style={{
            padding: "16px 20px",
            borderBottom: "1px solid var(--cc-line-alpha-20)",
          }}
        >
          <div
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text-primary)",
            }}
          >
            {title}
          </div>
          <div style={{ fontSize: 12, color: "var(--cc-text-secondary)", marginTop: 4 }}>
            {description}
          </div>
        </div>
        <div
          style={{
            margin: 20,
            padding: 16,
            borderRadius: 8,
            border: "1px solid var(--cc-line-alpha-20)",
            background: "var(--cc-surface-muted)",
            color: "var(--cc-text-secondary)",
            fontSize: 13,
            lineHeight: 1.5,
          }}
        >
          <div style={{ color: "var(--cc-text-primary)", fontWeight: 700, marginBottom: 4 }}>
            This setting is local only
          </div>
          {error}
        </div>
      </div>
    );
  }

  if (!exists && !content) {
    return (
      <div
        style={{
          padding: 40,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 16,
        }}
      >
        <div
          style={{
            color: "var(--cc-text-secondary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            textAlign: "center",
          }}
        >
          {emptyMessage}
        </div>
        <button
          onClick={handleCreateFile}
          style={{
            padding: "8px 20px",
            backgroundColor: "var(--cc-brand-primary)",
            color: "var(--cc-surface)",
            border: "none",
            borderRadius: 8,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            cursor: "pointer",
            transition: "background-color 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.backgroundColor = "var(--cc-brand-primary)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.backgroundColor = "var(--cc-brand-primary)";
          }}
        >
          Create File
        </button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "16px 20px",
          borderBottom: "1px solid var(--cc-line-alpha-20)",
        }}
      >
        <div>
          <div
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text-primary)",
            }}
          >
            {title}
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--cc-text-secondary)",
              marginTop: 4,
            }}
          >
            {description}
          </div>
        </div>
        <button
          onClick={handleSave}
          disabled={saveDisabled}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 6,
            padding: "8px 20px",
            backgroundColor: saveDisabled ? "var(--cc-control-border)" : "var(--cc-brand-primary)",
            color: "var(--cc-surface)",
            border: "none",
            borderRadius: 8,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            fontWeight: 500,
            cursor: saveDisabled ? "not-allowed" : "pointer",
            transition: "background-color 150ms ease",
            opacity: saveDisabled ? 0.6 : 1,
          }}
          onMouseEnter={(e) => {
            if (!saveDisabled) {
              e.currentTarget.style.backgroundColor = "var(--cc-brand-primary)";
            }
          }}
          onMouseLeave={(e) => {
            if (!saveDisabled) {
              e.currentTarget.style.backgroundColor = "var(--cc-brand-primary)";
            }
          }}
        >
          {saveSuccess ? (
            <>
              <Check size={14} />
              Saved
            </>
          ) : saving ? (
            "Saving..."
          ) : (
            <>
              <Save size={14} />
              Save
            </>
          )}
        </button>
      </div>

      {/* Editor */}
      <div style={{ padding: 20 }}>
        {maskSecrets && (
          <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 6 }}>
            <button
              onClick={() => setSecretsRevealed(!secretsRevealed)}
              style={{
                display: "inline-flex", alignItems: "center", gap: 5,
                background: "none", border: "1px solid var(--cc-control-bg-active)", borderRadius: 6,
                padding: "4px 10px", fontSize: 11, color: "var(--cc-text-tertiary)",
                fontFamily: "'DM Mono', monospace", cursor: "pointer",
                transition: "all 150ms ease",
              }}
              onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--cc-brand-primary)"; e.currentTarget.style.color = "var(--cc-brand-primary)"; }}
              onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--cc-control-bg-active)"; e.currentTarget.style.color = "var(--cc-text-tertiary)"; }}
            >
              {secretsRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
              {secretsRevealed ? "hide secrets" : "reveal secrets"}
            </button>
          </div>
        )}
        <textarea
          value={focused ? content : displayContent}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          autoComplete="off"
          style={{
            width: "100%",
            minHeight: 500,
            padding: 20,
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            color: "var(--cc-text-primary)",
            backgroundColor: "var(--cc-surface-raised)",
            border: error
              ? "1px solid var(--cc-status-danger-bright)"
              : focused
                ? "1px solid var(--cc-brand-primary)"
                : "1px solid var(--cc-line-alpha-30)",
            borderRadius: 8,
            resize: "vertical",
            outline: "none",
            boxShadow: focused && !error ? "0 0 0 2px var(--cc-brand-alpha-10)" : "none",
            boxSizing: "border-box",
            display: "block",
          }}
        />

        {/* Error display */}
        {error && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 8,
              color: "var(--cc-status-danger-bright)",
              fontSize: 12,
              fontFamily: "monospace",
              padding: "8px 0",
              marginTop: 8,
            }}
          >
            <AlertCircle size={14} style={{ flexShrink: 0 }} />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
