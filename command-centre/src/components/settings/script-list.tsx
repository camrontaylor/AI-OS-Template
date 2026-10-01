"use client";

import { useCallback, useEffect, useState } from "react";
import { Play, Check, XCircle, ChevronDown, ChevronUp, ExternalLink } from "lucide-react";
import { ScriptConfirmModal } from "@/components/settings/script-confirm-modal";
import { ScriptRunner } from "@/components/settings/script-runner";
import type { ScriptDefinition } from "@/lib/script-registry";

type MemorySetupMode = "check" | "local" | "postgres";
type MemoryDatabaseEnvKey = "MEMORY_DATABASE_URL" | "DATABASE_URL";

const MEMORY_SETUP_OPTIONS: Array<{
  mode: MemorySetupMode;
  label: string;
  description: string;
}> = [
  { mode: "check", label: "Check status", description: "Show current memory setup status." },
  { mode: "local", label: "Local PGLite", description: "Use this computer's local memory store." },
  { mode: "postgres", label: "Hosted Postgres", description: "Use a shared Postgres memory database." },
];

function isMemorySetupScript(script: ScriptDefinition): boolean {
  return script.id === "memory-setup";
}

function scriptHasForm(script: ScriptDefinition): boolean {
  return script.args.length > 0 || isMemorySetupScript(script);
}

function findMemoryDatabaseEnvKey(content: string): MemoryDatabaseEnvKey | null {
  for (const line of content.split(/\r?\n/)) {
    if (line.trim().startsWith("#")) continue;
    const match = line.match(/^\s*(?:export\s+)?(MEMORY_DATABASE_URL|DATABASE_URL)\s*=(.*)$/);
    if (!match) continue;

    const value = match[2].trim().replace(/^(['"])(.*)\1$/, "$2").trim();
    if (value) return match[1] as MemoryDatabaseEnvKey;
  }

  return null;
}

export function ScriptList() {
  const [scripts, setScripts] = useState<ScriptDefinition[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadMessage, setLoadMessage] = useState<string | null>(null);
  const [expandedScript, setExpandedScript] = useState<string | null>(null);
  const [argValues, setArgValues] = useState<Record<string, string>>({});
  const [memorySetupMode, setMemorySetupMode] = useState<MemorySetupMode>("check");
  const [memoryDatabaseUrl, setMemoryDatabaseUrl] = useState("");
  const [memoryEnvKey, setMemoryEnvKey] = useState<MemoryDatabaseEnvKey | null>(null);
  const [memoryEnvLoaded, setMemoryEnvLoaded] = useState(false);
  const [runningScript, setRunningScript] = useState<{
    executionId: string;
    id: string;
    label: string;
    args: Record<string, string>;
  } | null>(null);
  const [confirmScript, setConfirmScript] = useState<ScriptDefinition | null>(null);
  const [lastResult, setLastResult] = useState<Record<string, "success" | "error">>({});

  useEffect(() => {
    fetch("/api/settings/scripts")
      .then(async (r) => {
        const data: unknown = await r.json().catch(() => null);
        if (!r.ok) {
          const message =
            data && typeof data === "object" && "error" in data && typeof data.error === "string"
              ? data.error
              : "Scripts are not available right now.";
          setLoadMessage(message);
          return [];
        }
        if (!Array.isArray(data)) {
          setLoadMessage("Scripts are not available right now.");
          return [];
        }
        return data as ScriptDefinition[];
      })
      .then((data) => {
        setScripts(data);
        setLoading(false);
      })
      .catch(() => {
        setLoadMessage("Scripts are not available right now.");
        setLoading(false);
      });
  }, []);

  useEffect(() => {
    fetch("/api/settings/env")
      .then((r) => r.json())
      .then((data) => {
        setMemoryEnvKey(data.exists ? findMemoryDatabaseEnvKey(data.content || "") : null);
        setMemoryEnvLoaded(true);
      })
      .catch(() => {
        setMemoryEnvKey(null);
        setMemoryEnvLoaded(true);
      });
  }, []);

  const getScriptArgs = useCallback(
    (script: ScriptDefinition) => {
      if (isMemorySetupScript(script)) {
        const args: Record<string, string> = { mode: memorySetupMode };
        const trimmedUrl = memoryDatabaseUrl.trim();
        if (trimmedUrl) {
          args.memoryDatabaseUrl = trimmedUrl;
        }
        return args;
      }

      const args: Record<string, string> = {};
      for (const arg of script.args) {
        args[arg.name] = argValues[arg.name] || "";
      }
      return args;
    },
    [argValues, memoryDatabaseUrl, memorySetupMode],
  );

  const handleRunClick = useCallback(
    (script: ScriptDefinition) => {
      // If the script needs input and isn't expanded yet, expand the form.
      if (scriptHasForm(script) && expandedScript !== script.id) {
        setExpandedScript(script.id);
        if (!isMemorySetupScript(script)) {
          setArgValues({});
        }
        return;
      }

      const args = getScriptArgs(script);

      // If destructive, show confirmation
      if (script.destructive) {
        setConfirmScript(script);
        return;
      }

      // Start execution
      startExecution(script, args);
    },
    [expandedScript, getScriptArgs],
  );

  const handleExecuteFromForm = useCallback(
    (script: ScriptDefinition) => {
      const args = getScriptArgs(script);

      if (script.destructive) {
        setConfirmScript(script);
        return;
      }

      startExecution(script, args);
    },
    [getScriptArgs],
  );

  const startExecution = useCallback((script: ScriptDefinition, args: Record<string, string>) => {
    setRunningScript({
      executionId: crypto.randomUUID(),
      id: script.id,
      label: script.label,
      args,
    });
    setExpandedScript(null);
    setConfirmScript(null);
  }, []);

  const handleConfirm = useCallback(() => {
    if (!confirmScript) return;
    const args = getScriptArgs(confirmScript);
    startExecution(confirmScript, args);
  }, [confirmScript, getScriptArgs, startExecution]);

  const handleComplete = useCallback(
    (success: boolean) => {
      if (runningScript) {
        setLastResult((prev) => ({
          ...prev,
          [runningScript.id]: success ? "success" : "error",
        }));
      }
    },
    [runningScript],
  );

  const handleRunnerClose = useCallback(() => {
    setRunningScript(null);
  }, []);

  if (loading) {
    return (
      <div style={{ padding: 24, color: "var(--cc-text-secondary)", fontSize: 14 }}>
        Loading scripts...
      </div>
    );
  }

  const allArgsValid = (script: ScriptDefinition) =>
    isMemorySetupScript(script)
      ? memorySetupMode !== "postgres" ||
        memoryDatabaseUrl.trim() !== "" ||
        (memoryEnvLoaded && memoryEnvKey !== null)
      : script.args.every((arg) => !arg.required || (argValues[arg.name] || "").trim() !== "");

  return (
    <div>
      {/* Header */}
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
          }}
        >
          System Scripts
        </div>
        <div style={{ fontSize: 13, color: "var(--cc-text-secondary)", marginTop: 4 }}>
          Run maintenance and setup scripts for your AI-OS installation
        </div>
      </div>

      {/* Script cards */}
      {loadMessage && (
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
            Scripts are local only
          </div>
          {loadMessage}
        </div>
      )}

      {!loadMessage && scripts.map((script) => (
        <div
          key={script.id}
          style={{
            display: "flex",
            flexDirection: "column",
            padding: "16px 20px",
            borderBottom: "1px solid var(--cc-line-alpha-10)",
          }}
        >
          {/* Top row */}
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
            }}
          >
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 14, fontWeight: 600, color: "var(--cc-text-primary)" }}>
                {script.label}
              </div>
              <div style={{ fontSize: 13, color: "var(--cc-text-secondary)", marginTop: 2 }}>
                {script.description}
              </div>
              {script.helpUrl && (
                <a
                  href={script.helpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 4,
                    fontSize: 12,
                    color: "var(--cc-brand-primary)",
                    textDecoration: "none",
                    marginTop: 4,
                    fontWeight: 500,
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.textDecoration = "underline"; }}
                  onMouseLeave={(e) => { e.currentTarget.style.textDecoration = "none"; }}
                >
                  <ExternalLink size={12} />
                  Watch video guide
                </a>
              )}
            </div>

            <div style={{ display: "flex", alignItems: "center", gap: 8, marginLeft: 16, flexShrink: 0 }}>
              {script.destructive && (
                <span
                  style={{
                    display: "inline-flex",
                    padding: "2px 8px",
                    borderRadius: 4,
                    backgroundColor: "var(--cc-status-danger-bg)",
                    color: "var(--cc-status-danger-bright)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Destructive
                </span>
              )}
              {script.longRunning && (
                <span
                  style={{
                    display: "inline-flex",
                    padding: "2px 8px",
                    borderRadius: 4,
                    backgroundColor: "var(--cc-status-warning-bg)",
                    color: "var(--cc-status-warning-bright)",
                    fontSize: 11,
                    fontWeight: 600,
                  }}
                >
                  Long-running
                </span>
              )}
              {lastResult[script.id] === "success" && (
                <Check size={16} color="var(--cc-status-success-bright)" />
              )}
              {lastResult[script.id] === "error" && (
                <XCircle size={16} color="var(--cc-status-danger-bright)" />
              )}
              <button
                onClick={() => handleRunClick(script)}
                disabled={runningScript !== null}
                style={{
                  backgroundColor: runningScript !== null ? "var(--cc-brand-alpha-50)" : "var(--cc-brand-primary)",
                  color: "var(--cc-surface)",
                  border: "none",
                  borderRadius: 8,
                  padding: "8px 16px",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: runningScript !== null ? "not-allowed" : "pointer",
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  opacity: runningScript !== null ? 0.5 : 1,
                }}
              >
                {scriptHasForm(script) && expandedScript !== script.id ? (
                  <ChevronDown size={16} />
                ) : scriptHasForm(script) && expandedScript === script.id ? (
                  <ChevronUp size={16} />
                ) : (
                  <Play size={16} />
                )}
                Run
              </button>
            </div>
          </div>

          {/* Memory setup form */}
          {expandedScript === script.id && isMemorySetupScript(script) && (
            <div
              style={{
                marginTop: 12,
                padding: 16,
                backgroundColor: "var(--cc-surface-raised)",
                borderRadius: 8,
                border: "1px solid var(--cc-line-alpha-20)",
              }}
            >
              <div
                style={{
                  display: "block",
                  fontSize: 12,
                  fontWeight: 600,
                  color: "var(--cc-text-secondary)",
                  marginBottom: 8,
                }}
              >
                Memory setup action
              </div>

              <div
                role="radiogroup"
                aria-label="Memory setup action"
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(3, minmax(0, 1fr))",
                  gap: 8,
                }}
              >
                {MEMORY_SETUP_OPTIONS.map((option) => {
                  const selected = memorySetupMode === option.mode;
                  return (
                    <button
                      key={option.mode}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setMemorySetupMode(option.mode)}
                      style={{
                        minHeight: 74,
                        textAlign: "left",
                        border: selected
                          ? "1px solid var(--cc-brand-primary)"
                          : "1px solid var(--cc-line-alpha-30)",
                        borderRadius: 8,
                        backgroundColor: selected ? "var(--cc-brand-alpha-08)" : "var(--cc-surface)",
                        color: "var(--cc-text-primary)",
                        padding: 12,
                        cursor: "pointer",
                      }}
                    >
                      <span style={{ display: "block", fontSize: 13, fontWeight: 700 }}>
                        {option.label}
                      </span>
                      <span
                        style={{
                          display: "block",
                          fontSize: 12,
                          color: "var(--cc-text-secondary)",
                          lineHeight: 1.4,
                          marginTop: 4,
                        }}
                      >
                        {option.description}
                      </span>
                    </button>
                  );
                })}
              </div>

              {memorySetupMode === "postgres" && (
                <div style={{ marginTop: 14 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--cc-text-secondary)",
                      marginBottom: 4,
                    }}
                  >
                    MEMORY_DATABASE_URL
                    {!memoryEnvKey && (
                      <span style={{ color: "var(--cc-status-danger-bright)", marginLeft: 2 }}>*</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={memoryDatabaseUrl}
                    onChange={(e) => setMemoryDatabaseUrl(e.target.value)}
                    placeholder="postgres://user:password@host:5432/ai_memory"
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid var(--cc-line-alpha-40)",
                      borderRadius: 6,
                      fontSize: 13,
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "var(--cc-brand-primary)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--cc-line-alpha-40)";
                    }}
                  />
                  <div
                    style={{
                      fontSize: 12,
                      color: "var(--cc-text-secondary)",
                      lineHeight: 1.5,
                      marginTop: 6,
                    }}
                  >
                    {memoryEnvLoaded && memoryEnvKey
                      ? `Using ${memoryEnvKey} from .env unless you enter a new value.`
                      : memoryEnvLoaded
                        ? "Required for hosted Postgres. This will be saved to .env before setup runs."
                        : "Checking .env for an existing Postgres URL..."}
                  </div>
                </div>
              )}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 16 }}>
                <button
                  onClick={() => setExpandedScript(null)}
                  style={{
                    padding: "8px 16px",
                    border: "1px solid var(--cc-line-alpha-40)",
                    borderRadius: 8,
                    background: "transparent",
                    color: "var(--cc-text-secondary)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleExecuteFromForm(script)}
                  disabled={!allArgsValid(script) || runningScript !== null}
                  style={{
                    padding: "8px 16px",
                    border: "none",
                    borderRadius: 8,
                    backgroundColor:
                      !allArgsValid(script) || runningScript !== null
                        ? "var(--cc-brand-alpha-50)"
                        : "var(--cc-brand-primary)",
                    color: "var(--cc-surface)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor:
                      !allArgsValid(script) || runningScript !== null ? "not-allowed" : "pointer",
                    opacity: !allArgsValid(script) || runningScript !== null ? 0.5 : 1,
                  }}
                >
                  Execute
                </button>
              </div>
            </div>
          )}

          {/* Arg form */}
          {expandedScript === script.id && !isMemorySetupScript(script) && script.args.length > 0 && (
            <div
              style={{
                marginTop: 12,
                padding: 16,
                backgroundColor: "var(--cc-surface-raised)",
                borderRadius: 8,
                border: "1px solid var(--cc-line-alpha-20)",
              }}
            >
              {script.args.map((arg) => (
                <div key={arg.name} style={{ marginBottom: 12 }}>
                  <label
                    style={{
                      display: "block",
                      fontSize: 12,
                      fontWeight: 600,
                      color: "var(--cc-text-secondary)",
                      marginBottom: 4,
                    }}
                  >
                    {arg.label}
                    {arg.required && (
                      <span style={{ color: "var(--cc-status-danger-bright)", marginLeft: 2 }}>*</span>
                    )}
                  </label>
                  <input
                    type="text"
                    value={argValues[arg.name] || ""}
                    onChange={(e) =>
                      setArgValues((prev) => ({ ...prev, [arg.name]: e.target.value }))
                    }
                    placeholder={arg.placeholder || ""}
                    style={{
                      width: "100%",
                      padding: "8px 12px",
                      border: "1px solid var(--cc-line-alpha-40)",
                      borderRadius: 6,
                      fontSize: 13,
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      outline: "none",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) => {
                      e.currentTarget.style.borderColor = "var(--cc-brand-primary)";
                    }}
                    onBlur={(e) => {
                      e.currentTarget.style.borderColor = "var(--cc-line-alpha-40)";
                    }}
                  />
                </div>
              ))}

              <div style={{ display: "flex", justifyContent: "flex-end", gap: 8, marginTop: 12 }}>
                <button
                  onClick={() => {
                    setExpandedScript(null);
                    setArgValues({});
                  }}
                  style={{
                    padding: "8px 16px",
                    border: "1px solid var(--cc-line-alpha-40)",
                    borderRadius: 8,
                    background: "transparent",
                    color: "var(--cc-text-secondary)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor: "pointer",
                  }}
                >
                  Cancel
                </button>
                <button
                  onClick={() => handleExecuteFromForm(script)}
                  disabled={!allArgsValid(script) || runningScript !== null}
                  style={{
                    padding: "8px 16px",
                    border: "none",
                    borderRadius: 8,
                    backgroundColor:
                      !allArgsValid(script) || runningScript !== null
                        ? "var(--cc-brand-alpha-50)"
                        : "var(--cc-brand-primary)",
                    color: "var(--cc-surface)",
                    fontSize: 13,
                    fontWeight: 500,
                    cursor:
                      !allArgsValid(script) || runningScript !== null ? "not-allowed" : "pointer",
                    opacity: !allArgsValid(script) || runningScript !== null ? 0.5 : 1,
                  }}
                >
                  Execute
                </button>
              </div>
            </div>
          )}
        </div>
      ))}

      {/* Script runner */}
      {runningScript && (
        <ScriptRunner
          key={runningScript.executionId}
          executionId={runningScript.executionId}
          scriptId={runningScript.id}
          scriptLabel={runningScript.label}
          args={runningScript.args}
          onClose={handleRunnerClose}
          onComplete={handleComplete}
        />
      )}

      {/* Confirm modal */}
      {confirmScript && (
        <ScriptConfirmModal
          scriptLabel={confirmScript.label}
          scriptDescription={confirmScript.description}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmScript(null)}
        />
      )}
    </div>
  );
}
