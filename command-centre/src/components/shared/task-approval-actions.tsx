"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { getApprovalRequestDisplay } from "@/lib/approval-request-format";
import {
  isPermissionBridgeFailureText,
} from "@/lib/task-permissions";
import type { ApprovalRequest, ApprovalDecision } from "@/types/approval";
import type { QuestionSpec } from "@/types/question-spec";

const APPROVAL_POLL_MS = 1500;
const BRIDGE_WARNING_POLLS = 3;
const BRIDGE_WARNING_COOLDOWN_MS = 4000;

const CARD_STYLE: React.CSSProperties = {
  padding: "10px 12px",
  borderRadius: 8,
  border: "1px solid var(--cc-line-alpha-25)",
  backgroundColor: "var(--cc-surface)AF8",
};

const LABEL_STYLE: React.CSSProperties = {
  fontSize: 11,
  fontWeight: 600,
  color: "var(--cc-brand-primary)",
  textTransform: "uppercase",
  letterSpacing: "0.04em",
  fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
};

const BODY_STYLE: React.CSSProperties = {
  fontSize: 13,
  color: "var(--cc-text-secondary)",
  lineHeight: 1.5,
  fontFamily: "var(--font-inter), Inter, sans-serif",
};

function ActionButton({
  label,
  onClick,
  disabled,
  primary = false,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: "7px 10px",
        borderRadius: 6,
        border: primary ? "none" : "1px solid var(--cc-line-alpha-35)",
        background: primary ? "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))" : "var(--cc-surface)",
        color: primary ? "var(--cc-surface)" : "var(--cc-text-secondary)",
        fontSize: 12,
        fontWeight: 600,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        cursor: disabled ? "default" : "pointer",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      {label}
    </button>
  );
}

export function PlanApprovalActions({
  taskId,
  question,
  message,
  onSubmitted,
}: {
  taskId: string;
  question: QuestionSpec;
  message?: string;
  onSubmitted?: () => void;
}) {
  const [submitting, setSubmitting] = useState<string | null>(null);
  const [isAskingForChanges, setIsAskingForChanges] = useState(false);
  const [changesMessage, setChangesMessage] = useState(message ?? "");
  const askInputRef = useRef<HTMLInputElement>(null);
  const options = question.options ?? [];
  const askForChangesOption = options.find((option) => option === "Ask for changes") ?? null;
  const quickOptions = options.filter((option) => option !== askForChangesOption);

  useEffect(() => {
    if (!isAskingForChanges) {
      setChangesMessage(message ?? "");
    }
  }, [isAskingForChanges, message]);

  useEffect(() => {
    if (isAskingForChanges) {
      askInputRef.current?.focus();
      askInputRef.current?.select();
    }
  }, [isAskingForChanges]);

  const submit = useCallback(async (option: string, note?: string) => {
    setSubmitting(option);
    try {
      await fetch(`/api/tasks/${taskId}/reply`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          structuredAnswers: { [question.id]: option },
          ...(note?.trim() ? { message: note.trim() } : {}),
        }),
      });
      if (option === "Ask for changes") {
        setChangesMessage("");
        setIsAskingForChanges(false);
      }
      onSubmitted?.();
    } finally {
      setSubmitting(null);
    }
  }, [onSubmitted, question.id, taskId]);

  if (options.length === 0) return null;

  return (
    <div style={CARD_STYLE}>
      <div style={LABEL_STYLE}>Plan ready</div>
      <div style={{ ...BODY_STYLE, marginTop: 4, marginBottom: 10 }}>{question.prompt}</div>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {quickOptions.map((option, index) => (
          <ActionButton
            key={option}
            label={option}
            onClick={() => submit(option)}
            disabled={submitting !== null}
            primary={index === 0}
          />
        ))}
        {askForChangesOption && (
          <ActionButton
            label={askForChangesOption}
            onClick={() => setIsAskingForChanges(true)}
            disabled={submitting !== null}
          />
        )}
      </div>
      {askForChangesOption && isAskingForChanges && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <input
            ref={askInputRef}
            type="text"
            value={changesMessage}
            onChange={(event) => setChangesMessage(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey && changesMessage.trim()) {
                event.preventDefault();
                void submit(askForChangesOption, changesMessage);
              }
              if (event.key === "Escape") {
                event.preventDefault();
                setIsAskingForChanges(false);
              }
            }}
            placeholder="What should change in the plan?"
            style={{
              width: "100%",
              padding: "8px 10px",
              borderRadius: 6,
              border: "1px solid var(--cc-line-alpha-35)",
              backgroundColor: "var(--cc-surface)",
              color: "var(--cc-text-primary)",
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          />
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label="Send changes request"
              onClick={() => submit(askForChangesOption, changesMessage)}
              disabled={submitting !== null || !changesMessage.trim()}
              primary
            />
            <ActionButton
              label="Never mind"
              onClick={() => setIsAskingForChanges(false)}
              disabled={submitting !== null}
            />
          </div>
        </div>
      )}
    </div>
  );
}

export function PermissionApprovalActions({
  taskId,
  isPermissionWaiting = false,
  activityLabel,
  errorMessage,
  onResolved,
}: {
  taskId: string;
  isPermissionWaiting?: boolean;
  activityLabel?: string | null;
  errorMessage?: string | null;
  onResolved?: () => void;
}) {
  const [requests, setRequests] = useState<ApprovalRequest[]>([]);
  const [decision, setDecision] = useState<ApprovalDecision | null>(null);
  const [decisionError, setDecisionError] = useState<string | null>(null);
  const [manualChecking, setManualChecking] = useState(false);
  const [bridgeMisses, setBridgeMisses] = useState(0);
  const [hasFetched, setHasFetched] = useState(false);
  const [sawRequestThisCycle, setSawRequestThisCycle] = useState(false);
  const [cooldownUntil, setCooldownUntil] = useState<number | null>(null);
  const [showDetails, setShowDetails] = useState(false);
  const [copiedDetails, setCopiedDetails] = useState(false);
  const previousWaitingRef = useRef(isPermissionWaiting);

  const fetchRequests = useCallback(async (mode: "background" | "manual" = "background") => {
    if (mode === "manual") {
      setManualChecking(true);
    }
    try {
      const res = await fetch(`/api/tasks/${taskId}/approval-requests`);
      if (!res.ok) return;
      const data = await res.json();
      const nextRequests = Array.isArray(data) ? data : [];
      const cooldownActive = cooldownUntil != null && cooldownUntil > Date.now();
      setRequests(nextRequests);
      setHasFetched(true);
      if (nextRequests.length > 0) {
        setSawRequestThisCycle(true);
        setBridgeMisses(0);
      } else if (!isPermissionWaiting || cooldownActive || sawRequestThisCycle) {
        setBridgeMisses(0);
      } else {
        setBridgeMisses((previous) => previous + 1);
      }
    } finally {
      if (mode === "manual") {
        setManualChecking(false);
      }
    }
  }, [cooldownUntil, isPermissionWaiting, sawRequestThisCycle, taskId]);

  useEffect(() => {
    const wasWaiting = previousWaitingRef.current;
    previousWaitingRef.current = isPermissionWaiting;

    if (isPermissionWaiting && !wasWaiting) {
      setBridgeMisses(0);
      setHasFetched(false);
      setSawRequestThisCycle(false);
      setShowDetails(false);
    }

    if (!isPermissionWaiting) {
      setBridgeMisses(0);
      setHasFetched(false);
      setSawRequestThisCycle(false);
      setCooldownUntil(null);
      setShowDetails(false);
    }
  }, [isPermissionWaiting]);

  useEffect(() => {
    void fetchRequests();
  }, [fetchRequests]);

  useEffect(() => {
    const interval = window.setInterval(() => {
      void fetchRequests();
    }, APPROVAL_POLL_MS);
    return () => window.clearInterval(interval);
  }, [fetchRequests]);

  const current = useMemo(() => requests[0] ?? null, [requests]);
  const display = useMemo(
    () => current ? getApprovalRequestDisplay(current) : null,
    [current],
  );
  const detailToggleLabel = showDetails
    ? `Hide ${display?.detailLabel ?? "details"}`
    : `Show ${display?.detailLabel ?? "details"}`;
  const explicitBridgeFailure =
    isPermissionBridgeFailureText(activityLabel) ||
    isPermissionBridgeFailureText(errorMessage);
  const cooldownActive = cooldownUntil != null && cooldownUntil > Date.now();
  const bridgeIssue =
    explicitBridgeFailure ||
    (
      isPermissionWaiting &&
      !current &&
      hasFetched &&
      !cooldownActive &&
      !sawRequestThisCycle &&
      bridgeMisses >= BRIDGE_WARNING_POLLS
    );

  const resolve = useCallback(async (nextDecision: ApprovalDecision) => {
    if (!current) return;
    setDecision(nextDecision);
    setDecisionError(null);
    try {
      const response = await fetch(`/api/tasks/${taskId}/approval-requests/${current.id}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision: nextDecision }),
      });
      const data = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) {
        throw new Error(data?.error || "The permission decision could not be saved.");
      }
      setBridgeMisses(0);
      setHasFetched(false);
      setSawRequestThisCycle(false);
      setCooldownUntil(Date.now() + BRIDGE_WARNING_COOLDOWN_MS);
      setShowDetails(false);
      await fetchRequests();
      onResolved?.();
    } catch (error) {
      setDecisionError(
        error instanceof Error ? error.message : "The permission decision could not be saved.",
      );
    } finally {
      setDecision(null);
    }
  }, [current, fetchRequests, onResolved, taskId]);

  useEffect(() => {
    if (!copiedDetails) return;
    const timeout = window.setTimeout(() => setCopiedDetails(false), 1800);
    return () => window.clearTimeout(timeout);
  }, [copiedDetails]);

  useEffect(() => {
    setShowDetails(false);
    setCopiedDetails(false);
    setDecisionError(null);
  }, [current?.id]);

  if (!current && !bridgeIssue) return null;

  if (!current && bridgeIssue) {
    return (
      <div style={CARD_STYLE}>
        <div style={LABEL_STYLE}>Permission bridge issue</div>
        <div style={{ ...BODY_STYLE, marginTop: 4 }}>
          Claude looks blocked on a permission request, but the approval bridge did not create a UI request.
          Retry the check below. If it stays empty, rerun the turn.
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
          <ActionButton
            label={manualChecking ? "Checking..." : "Retry check"}
            onClick={() => {
              void fetchRequests("manual");
            }}
            disabled={manualChecking || decision !== null}
            primary
          />
        </div>
      </div>
    );
  }

  return (
    <div style={CARD_STYLE}>
      <div style={LABEL_STYLE}>Needs permission</div>
      <div style={{ ...BODY_STYLE, marginTop: 4 }}>
        {display?.summary ?? current?.description ?? "Claude is waiting for permission to continue."}
      </div>
      {display?.detailText && (
        <div style={{ marginTop: 10, display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <ActionButton
              label={detailToggleLabel}
              onClick={() => setShowDetails((value) => !value)}
              disabled={decision !== null}
            />
            <ActionButton
              label={copiedDetails ? "Copied" : "Copy"}
              onClick={() => {
                if (!display.detailText) return;
                void navigator.clipboard.writeText(display.detailText);
                setCopiedDetails(true);
              }}
              disabled={decision !== null}
            />
          </div>
          {showDetails && (
            <div
              style={{
                borderRadius: 6,
                border: "1px solid var(--cc-line-alpha-25)",
                backgroundColor: "var(--cc-surface)",
                padding: "10px 12px",
              }}
            >
              {display.detailLabel && (
                <div style={{ ...LABEL_STYLE, marginBottom: 6 }}>
                  {display.detailLabel}
                </div>
              )}
              <pre
                style={{
                  margin: 0,
                  whiteSpace: "pre-wrap",
                  wordBreak: "break-word",
                  fontSize: 12,
                  lineHeight: 1.5,
                  color: "var(--cc-text-primary)",
                  fontFamily: "'DM Mono', monospace",
                }}
              >
                {display.detailText}
              </pre>
            </div>
          )}
        </div>
      )}
      {decisionError && (
        <div
          role="alert"
          style={{ ...BODY_STYLE, marginTop: 10, color: "var(--cc-danger, #5D5D5D)" }}
        >
          {decisionError}
        </div>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginTop: 10 }}>
        <ActionButton
          label="Approve once"
          onClick={() => resolve("allow_once")}
          disabled={!current || decision !== null}
          primary
        />
        <ActionButton
          label="Allow for subchat"
          onClick={() => resolve("allow_for_task")}
          disabled={!current || decision !== null}
        />
        <ActionButton
          label="Deny"
          onClick={() => resolve("deny")}
          disabled={!current || decision !== null}
        />
      </div>
    </div>
  );
}
