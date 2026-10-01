"use client";

import { useEffect, useRef, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  KeyRound,
  RefreshCw,
  Terminal,
  X,
  XCircle,
} from "lucide-react";
import { createScriptRunnerSession, type ScriptRunnerSession } from "@/lib/script-runner-session";
import {
  hasUpdateTokenRequiredMarker,
  shouldRequestUpdateToken,
} from "@/lib/script-runner-auth";
import {
  cleanScriptOutput,
  getInitialShowOutput,
  getScriptRunnerViewState,
  UPDATE_PROGRESS_STEPS,
  type ScriptRunStatus,
  type UpdateProgressTone,
} from "@/lib/script-runner-display";

interface ScriptRunnerProps {
  executionId: string;
  scriptId: string;
  scriptLabel: string;
  args: Record<string, string>;
  onClose: () => void;
  onComplete: (success: boolean) => void;
}

interface OutputLine {
  type: "stdout" | "stderr";
  data: string;
}

const toneColors: Record<UpdateProgressTone, { bg: string; border: string; text: string; icon: string }> = {
  running: { bg: "#F4F4F4", border: "rgba(92, 92, 92, 0.16)", text: "#5C5C5C", icon: "#5C5C5C" },
  success: { bg: "#F6F6F6", border: "rgba(142, 142, 142, 0.2)", text: "#585858", icon: "#8E8E8E" },
  warning: { bg: "#F9F9F9", border: "rgba(177, 177, 177, 0.35)", text: "#464646", icon: "#909090" },
  error: { bg: "#F5F5F5", border: "rgba(114, 114, 114, 0.2)", text: "#4E4E4E", icon: "#727272" },
};

function statusText(status: ScriptRunStatus, needsUpdateToken: boolean): string {
  if (status === "running") return "Running";
  if (needsUpdateToken) return "Needs token";
  if (status === "success") return "Completed";
  return "Failed";
}

function statusColor(status: ScriptRunStatus, needsUpdateToken: boolean): string {
  if (needsUpdateToken) return "#909090";
  if (status === "success") return "#8E8E8E";
  if (status === "error") return "#727272";
  return "#5C5C5C";
}

function StatusIcon({
  status,
  needsUpdateToken,
}: {
  status: ScriptRunStatus;
  needsUpdateToken: boolean;
}) {
  if (needsUpdateToken) return <KeyRound size={16} color="#909090" />;
  if (status === "success") return <CheckCircle2 size={16} color="#8E8E8E" />;
  if (status === "error") return <XCircle size={16} color="#727272" />;
  return <RefreshCw size={16} color="#5C5C5C" style={{ animation: "spin 1.2s linear infinite" }} />;
}

function UpdateStatusPanel({
  tone,
  title,
  description,
  activeStep,
  running,
}: {
  tone: UpdateProgressTone;
  title: string;
  description: string;
  activeStep: number;
  running: boolean;
}) {
  const colors = toneColors[tone];
  const Icon = tone === "success" ? CheckCircle2 : tone === "error" ? AlertCircle : tone === "warning" ? KeyRound : RefreshCw;

  return (
    <div
      style={{
        margin: 16,
        padding: 16,
        border: `1px solid ${colors.border}`,
        borderRadius: 8,
        backgroundColor: colors.bg,
      }}
    >
      <div style={{ display: "flex", gap: 12, alignItems: "flex-start" }}>
        <div
          style={{
            width: 32,
            height: 32,
            borderRadius: 8,
            backgroundColor: "#FFFFFF",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            flexShrink: 0,
          }}
        >
          <Icon
            size={17}
            color={colors.icon}
            style={tone === "running" ? { animation: "spin 1.2s linear infinite" } : undefined}
          />
        </div>
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 14, fontWeight: 700, color: colors.text }}>
            {title}
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#5F5F5F", marginTop: 4 }}>
            {description}
          </div>
        </div>
      </div>

      {running && (
        <div
          style={{
            height: 6,
            borderRadius: 999,
            overflow: "hidden",
            backgroundColor: "rgba(92, 92, 92, 0.12)",
            marginTop: 14,
          }}
        >
          <div
            style={{
              width: "100%",
              height: "100%",
              background: "linear-gradient(90deg, transparent 0%, #5C5C5C 45%, #757575 55%, transparent 100%)",
              backgroundSize: "200% 100%",
              animation: "running-shimmer 1.4s linear infinite",
            }}
          />
        </div>
      )}

      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, minmax(0, 1fr))", gap: 8, marginTop: 14 }}>
        {UPDATE_PROGRESS_STEPS.map((step, index) => {
          const reached = index <= activeStep;
          return (
            <div
              key={step}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 6,
                minWidth: 0,
                color: reached ? "#5C5C5C" : "#9C9C9C",
                fontSize: 12,
                fontWeight: reached ? 600 : 500,
              }}
            >
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  backgroundColor: reached ? "#5C5C5C" : "#C6C6C6",
                  flexShrink: 0,
                }}
              />
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {step}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

export function ScriptRunner({
  executionId,
  scriptId,
  scriptLabel,
  args,
  onClose,
  onComplete,
}: ScriptRunnerProps) {
  const [lines, setLines] = useState<OutputLine[]>([]);
  const [status, setStatus] = useState<ScriptRunStatus>("running");
  const [exitCode, setExitCode] = useState<number | null>(null);
  const [runAttempt, setRunAttempt] = useState(0);
  const [envOverrides, setEnvOverrides] = useState<Record<string, string>>({});
  const [updateToken, setUpdateToken] = useState("");
  const [needsUpdateToken, setNeedsUpdateToken] = useState(false);
  const [showOutput, setShowOutput] = useState(() => getInitialShowOutput(scriptId));
  const outputRef = useRef<HTMLDivElement>(null);
  const sessionRef = useRef<ScriptRunnerSession | null>(null);
  const onCompleteRef = useRef(onComplete);
  const outputBufferRef = useRef("");

  if (!sessionRef.current) {
    sessionRef.current = createScriptRunnerSession();
  }

  onCompleteRef.current = onComplete;

  useEffect(() => {
    const session = sessionRef.current!;
    const shouldStart = session.begin();

    const completeOnce = (success: boolean, code: number) => {
      if (!session.complete()) return;
      if (session.isDisposed()) return;
      const tokenRequired = shouldRequestUpdateToken({
        scriptId,
        exitCode: code,
        output: outputBufferRef.current,
      });
      const finalSuccess = success && !tokenRequired;
      if (tokenRequired) {
        setNeedsUpdateToken(true);
        setShowOutput(false);
      }
      setStatus(finalSuccess ? "success" : "error");
      setExitCode(code);
      onCompleteRef.current(finalSuccess);
    };

    if (!shouldStart) {
      return () => {
        session.dispose();
      };
    }

    async function run() {
      const appendLine = (type: "stdout" | "stderr", data: string) => {
        if (session.isDisposed()) return;
        const cleanData = cleanScriptOutput(data);
        outputBufferRef.current += cleanData;
        if (scriptId === "update" && hasUpdateTokenRequiredMarker(cleanData)) {
          setNeedsUpdateToken(true);
        }
        setLines((prev) => [...prev, { type, data: cleanData }]);
      };

      try {
        const response = await fetch("/api/settings/scripts/run", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scriptId, args, env: envOverrides }),
        });

        if (!response.ok) {
          const text = await response.text();
          appendLine("stderr", `Error: ${response.status} - ${text}`);
          completeOnce(false, 1);
          return;
        }

        const reader = response.body!.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            if (!part.trim()) continue;
            try {
              const parsed = JSON.parse(part);
              if (parsed.type === "stdout" || parsed.type === "stderr") {
                appendLine(parsed.type, parsed.data || "");
              } else if (parsed.type === "exit") {
                const success = parsed.code === 0;
                completeOnce(success, parsed.code ?? 1);
              }
            } catch {
              // Skip malformed JSON lines.
            }
          }
        }

        if (buffer.trim()) {
          try {
            const parsed = JSON.parse(buffer);
            if (parsed.type === "exit") {
              const success = parsed.code === 0;
              completeOnce(success, parsed.code ?? 1);
            }
          } catch {
            // Ignore incomplete trailing data.
          }
        }
      } catch (err: unknown) {
        appendLine("stderr", `Connection error: ${err instanceof Error ? err.message : "Unknown error"}`);
        completeOnce(false, 1);
      }
    }

    run();

    return () => {
      session.dispose();
    };
  }, [args, envOverrides, executionId, runAttempt, scriptId]);

  const handleRetryUpdate = () => {
    const token = updateToken.trim();
    if (!token) return;

    sessionRef.current = createScriptRunnerSession();
    outputBufferRef.current = "";
    setLines([]);
    setStatus("running");
    setExitCode(null);
    setNeedsUpdateToken(false);
    setShowOutput(getInitialShowOutput(scriptId));
    setEnvOverrides({ AI_OS_UPDATE_TOKEN: token });
    setRunAttempt((attempt) => attempt + 1);
  };

  useEffect(() => {
    outputRef.current?.scrollTo({ top: outputRef.current.scrollHeight });
  }, [lines]);

  const viewState = getScriptRunnerViewState({
    scriptId,
    status,
    needsUpdateToken,
    output: outputBufferRef.current,
    lineCount: lines.length,
    showOutput,
  });
  const updateStatus = viewState.updateStatus;

  return (
    <div
      style={{
        backgroundColor: "var(--cc-surface)",
        border: "1px solid var(--cc-border-default)",
        borderRadius: 8,
        overflow: "hidden",
        margin: "0 20px 20px",
        boxShadow: "var(--cc-shadow-card)",
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 12,
          padding: "12px 16px",
          borderBottom: "1px solid var(--cc-border-default)",
          backgroundColor: "var(--cc-surface-muted)",
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ color: "var(--cc-text-primary)", fontSize: 13, fontWeight: 700 }}>
            {scriptLabel}
          </div>
          <div style={{ color: "var(--cc-text-secondary)", fontSize: 12, marginTop: 2 }}>
            {scriptId === "update" ? "System update" : "Script output"}
          </div>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 10, flexShrink: 0 }}>
          <div
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: statusColor(status, needsUpdateToken),
              fontSize: 12,
              fontWeight: 700,
            }}
          >
            <StatusIcon status={status} needsUpdateToken={needsUpdateToken} />
            {statusText(status, needsUpdateToken)}
          </div>

          {status !== "running" && (
            <button
              onClick={onClose}
              aria-label="Close script runner"
              style={{
                background: "transparent",
                border: "none",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                alignItems: "center",
              }}
            >
              <X size={16} color="var(--cc-text-secondary)" />
            </button>
          )}
        </div>
      </div>

      {viewState.showUpdateStatus && updateStatus && (
        <UpdateStatusPanel
          tone={updateStatus.tone}
          title={updateStatus.title}
          description={updateStatus.description}
          activeStep={updateStatus.activeStep}
          running={status === "running"}
        />
      )}

      {needsUpdateToken && (
        <div
          style={{
            margin: "0 16px 16px",
            padding: 16,
            border: "1px solid rgba(177, 177, 177, 0.35)",
            borderRadius: 8,
            backgroundColor: "#F9F9F9",
          }}
        >
          <div style={{ fontSize: 14, fontWeight: 700, color: "#464646" }}>
            Paste the new token
          </div>
          <div style={{ fontSize: 13, lineHeight: 1.5, color: "#5F5F5F", marginTop: 6 }}>
            Paste the latest token from the classroom. The token stays visible here so you can
            confirm it pasted correctly.
          </div>
          <div style={{ display: "flex", gap: 8, marginTop: 12, flexWrap: "wrap" }}>
            <input
              type="text"
              value={updateToken}
              onChange={(event) => setUpdateToken(event.target.value)}
              placeholder="Paste token here"
              style={{
                flex: "1 1 260px",
                minWidth: 0,
                padding: "9px 12px",
                border: "1px solid rgba(92, 92, 92, 0.35)",
                borderRadius: 6,
                fontSize: 13,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                outline: "none",
              }}
            />
            <button
              onClick={handleRetryUpdate}
              disabled={!updateToken.trim() || status === "running"}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 6,
                border: "none",
                borderRadius: 8,
                padding: "9px 14px",
                backgroundColor:
                  !updateToken.trim() || status === "running" ? "rgba(92, 92, 92, 0.5)" : "#5C5C5C",
                color: "#FFFFFF",
                fontSize: 13,
                fontWeight: 600,
                cursor: !updateToken.trim() || status === "running" ? "not-allowed" : "pointer",
              }}
            >
              <RefreshCw size={15} />
              Retry update
            </button>
          </div>
        </div>
      )}

      {viewState.detailsToggleVisible && (
        <div style={{ display: "flex", justifyContent: "flex-end", padding: "0 16px 12px" }}>
          <button
            onClick={() => setShowOutput((visible) => !visible)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              border: "1px solid var(--cc-border-brand)",
              borderRadius: 8,
              padding: "8px 12px",
              backgroundColor: "var(--cc-surface)",
              color: "var(--cc-brand-primary)",
              fontSize: 13,
              fontWeight: 600,
              cursor: "pointer",
            }}
          >
            {showOutput ? <ChevronUp size={15} /> : <ChevronDown size={15} />}
            {viewState.detailsToggleLabel}
          </button>
        </div>
      )}

      {viewState.terminalVisible && (
        <div
          style={{
            margin: viewState.showUpdateStatus ? "0 16px 16px" : 0,
            borderRadius: viewState.showUpdateStatus ? 8 : 0,
            overflow: "hidden",
            backgroundColor: "var(--cc-palette-code-bg)",
          }}
        >
          {viewState.showUpdateStatus && (
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "9px 12px",
                borderBottom: "1px solid rgba(255,255,255,0.08)",
                color: "var(--cc-palette-slate-soft)",
                fontSize: 12,
                fontWeight: 700,
              }}
            >
              <Terminal size={14} />
              Terminal details
            </div>
          )}
          <div
            ref={outputRef}
            style={{
              maxHeight: 400,
              overflowY: "auto",
              padding: 16,
              fontFamily: "'JetBrains Mono', monospace",
              fontSize: 12,
              lineHeight: 1.7,
            }}
          >
            {lines.map((line, i) => (
              <pre
                key={i}
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  color: line.type === "stderr" ? "var(--cc-status-warning-bright)" : "var(--cc-palette-slate-soft)",
                }}
              >
                {line.data}
              </pre>
            ))}
            {lines.length === 0 && status === "running" && (
              <span style={{ color: "var(--cc-text-secondary)", fontSize: 12 }}>Waiting for output...</span>
            )}
          </div>
        </div>
      )}

      {status !== "running" && exitCode !== null && (
        <div
          style={{
            padding: "9px 16px",
            borderTop: "1px solid var(--cc-border-default)",
            fontSize: 12,
            color: exitCode === 0 ? "var(--cc-status-success-bright)" : "var(--cc-status-danger-bright)",
            backgroundColor: "var(--cc-surface-muted)",
          }}
        >
          Exit code: {exitCode}
        </div>
      )}
    </div>
  );
}
