"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { AlertCircle, Check, Save, Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

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
      const data = await res.json();
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
      <div className="p-4 sm:p-6">
        <Skeleton className="h-[500px] w-full" />
      </div>
    );
  }

  if (!exists && !content) {
    return (
      <div className="flex flex-col items-center gap-4 p-8 sm:p-10">
        <div className="text-center text-sm text-muted-foreground">
          {emptyMessage}
        </div>
        <Button size="sm" onClick={handleCreateFile}>
          Create File
        </Button>
      </div>
    );
  }

  return (
    <div>
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-4 sm:px-6">
        <div className="min-w-0">
          <div className="text-base font-semibold text-foreground">{title}</div>
          <div className="mt-1 text-xs text-muted-foreground">{description}</div>
        </div>
        <Button size="sm" onClick={handleSave} disabled={saveDisabled}>
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
        </Button>
      </div>

      {/* Editor */}
      <div className="p-4 sm:p-6">
        {maskSecrets && (
          <div className="mb-2 flex justify-end">
            <Button
              variant="outline"
              size="sm"
              className="h-7 gap-2 px-3 text-[11px] text-muted-foreground"
              onClick={() => setSecretsRevealed(!secretsRevealed)}
            >
              {secretsRevealed ? <EyeOff size={12} /> : <Eye size={12} />}
              {secretsRevealed ? "hide secrets" : "reveal secrets"}
            </Button>
          </div>
        )}
        <textarea
          value={focused ? content : displayContent}
          onChange={(e) => handleChange(e.target.value)}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          spellCheck={false}
          autoComplete="off"
          className={cn(
            "block min-h-[500px] w-full resize-y rounded-lg border bg-card p-4 font-mono text-[13px] leading-relaxed text-foreground outline-none sm:p-5",
            error
              ? "border-destructive"
              : focused
                ? "border-foreground/40 ring-2 ring-foreground/10"
                : "border-border",
          )}
        />

        {/* Error display */}
        {error && (
          <div className="mt-2 flex items-center gap-2 py-2 font-mono text-xs text-destructive">
            <AlertCircle size={14} className="shrink-0" />
            <span>{error}</span>
          </div>
        )}
      </div>
    </div>
  );
}
