"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { X, ArrowLeft, ArrowUp, ArrowDown, Plus, Trash2 } from "lucide-react";
import type { ScopeResult } from "@/app/api/tasks/scope-goal/route";
import { LEVEL_COLORS, LEVEL_LABELS } from "@/lib/levels";
import { QuestionModal } from "@/components/shared/question-modal";
import {
  type QuestionAnswers,
  type QuestionSpec,
  serializeAnswersToProse,
  areAnswersComplete,
} from "@/types/question-spec";

/**
 * Screen C — L2 Planned Project scoping wizard.
 *
 * A modal that walks the user through three steps:
 *   1. Review routing decision + edit project name
 *   2. Edit / reorder / add / delete suggested subtasks
 *   3. Confirm and create the project + tasks
 *
 * On create it POSTs to /api/projects (level 2), then to
 * /api/projects/{slug}/tasks-from-scope with a rewritten ScopeResult
 * that reflects the user's edits.
 */

interface ScopingWizardPanelProps {
  open: boolean;
  scope: ScopeResult & { reasoning?: string };
  goal: string;
  clientId?: string;
  onClose: () => void;
  onCreated: (result: { projectSlug: string; taskIds: string[] }) => void;
}

type Step = 1 | 2 | 3;

interface EditableSubtask {
  // Stable editor id for React keys and dependency remapping
  uid: string;
  // The original index in scope.suggestedSubtasks (null for newly added rows)
  originalIndex: number | null;
  title: string;
  description: string;
  // Original dependsOn indices (into scope.suggestedSubtasks), preserved
  // verbatim from the scope. We remap them at submission time.
  dependsOn: number[];
  wave: number;
  acceptanceCriteria: string[];
}

// ── Helpers ──────────────────────────────────────────────────────────────

function slugifyName(name: string): string {
  return name
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60) || "project";
}

// Strip common request-filler prefixes so "help me connect up to the telegram
// channel" doesn't end up titled "Help Me Connect Up To". This is a fallback
// only — the scoping LLM produces a better title via scope.projectTitle.
function deriveProjectName(goal: string, scopeTitle?: string | null): string {
  if (scopeTitle && scopeTitle.trim().length > 0) {
    return scopeTitle.trim();
  }
  let cleaned = goal.trim().replace(/\s+/g, " ");
  if (!cleaned) return "New project";

  // Strip leading filler phrases (case-insensitive).
  const fillerRe =
    /^(?:please\s+|can\s+you\s+|could\s+you\s+|would\s+you\s+|i\s+(?:want|need|would\s+like)\s+(?:to\s+|you\s+to\s+)?|help\s+me\s+(?:to\s+)?|let's\s+|lets\s+)+/i;
  cleaned = cleaned.replace(fillerRe, "").trim();
  if (!cleaned) cleaned = goal.trim();

  const words = cleaned.split(" ").slice(0, 6);
  const titled = words
    .map((w) =>
      w.length > 0 ? w.charAt(0).toUpperCase() + w.slice(1) : w
    )
    .join(" ");
  return titled.replace(/[.?!]+$/, "");
}

function genUid(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2);
}

// ── Persistence ──────────────────────────────────────────────────────────
// Wizard state is saved to sessionStorage keyed on a hash of the goal so
// that accidental closes (overlay click, X button, tab nav) don't destroy
// progress. Re-opening the wizard with the same goal rehydrates edits.

const STORAGE_KEY_PREFIX = "scoping-wizard:v1:";

interface PersistedWizardState {
  projectName: string;
  clarificationAnswers: QuestionAnswers;
  rows: EditableSubtask[];
  step: Step;
  hasAutoPlanned: boolean;
  dynamicQuestions: QuestionSpec[];
}

function storageKeyForGoal(goal: string): string {
  // Short stable hash so the key is readable in devtools.
  let h = 0;
  for (let i = 0; i < goal.length; i++) {
    h = ((h << 5) - h + goal.charCodeAt(i)) | 0;
  }
  return `${STORAGE_KEY_PREFIX}${h}`;
}

function loadPersistedState(goal: string): PersistedWizardState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(storageKeyForGoal(goal));
    if (!raw) return null;
    return JSON.parse(raw) as PersistedWizardState;
  } catch {
    return null;
  }
}

function savePersistedState(goal: string, state: PersistedWizardState): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(
      storageKeyForGoal(goal),
      JSON.stringify(state),
    );
  } catch {
    /* quota exceeded or blocked — silent */
  }
}

function clearPersistedState(goal: string): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(storageKeyForGoal(goal));
  } catch {
    /* ignore */
  }
}

// ── Inline variant (for embedding in DetailPanel) ────────────────────────

export interface ScopingWizardInlineProps {
  scope: ScopeResult & { reasoning?: string };
  goal: string;
  clientId?: string;
  onClose: () => void;
  onCreated: (result: { projectSlug: string; taskIds: string[] }) => void;
}

/**
 * Inline version of the scoping wizard — renders wizard content directly
 * without a modal overlay. Designed to be embedded inside the DetailPanel
 * after a goal is routed to "project" level.
 */
export function ScopingWizardInline({
  scope,
  goal,
  clientId,
  onClose,
  onCreated,
}: ScopingWizardInlineProps) {
  return (
    <ScopingWizardCore
      variant="inline"
      open
      scope={scope}
      goal={goal}
      clientId={clientId}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

// ── Modal variant (standalone overlay) ───────────────────────────────────

export function ScopingWizardPanel({
  open,
  scope,
  goal,
  clientId,
  onClose,
  onCreated,
}: ScopingWizardPanelProps) {
  return (
    <ScopingWizardCore
      variant="modal"
      open={open}
      scope={scope}
      goal={goal}
      clientId={clientId}
      onClose={onClose}
      onCreated={onCreated}
    />
  );
}

// ── Core implementation (shared between inline and modal) ────────────────

function ScopingWizardCore({
  variant,
  open,
  scope,
  goal,
  clientId,
  onClose,
  onCreated,
}: {
  variant: "inline" | "modal";
  open: boolean;
  scope: ScopeResult & { reasoning?: string };
  goal: string;
  clientId?: string;
  onClose: () => void;
  onCreated: (result: { projectSlug: string; taskIds: string[] }) => void;
}) {
  const initialQuestions = scope.questions ?? [];
  const [dynamicQuestions, setDynamicQuestions] = useState<QuestionSpec[]>([]);
  // Full merged list shown in Step 1: upfront questions + anything Sonnet
  // has asked as a follow-up since the wizard opened.
  const questionSpecs = useMemo(
    () => [...initialQuestions, ...dynamicQuestions],
    [initialQuestions, dynamicQuestions]
  );
  const [isVisible, setIsVisible] = useState(false);
  const [step, setStep] = useState<Step>(1);
  const [projectName, setProjectName] = useState(() =>
    deriveProjectName(goal, scope.projectTitle)
  );
  const [clarificationAnswers, setClarificationAnswers] = useState<QuestionAnswers>(
    () => {
      const seed: QuestionAnswers = {};
      for (const q of initialQuestions) {
        seed[q.id] = q.type === "multiselect" ? [] : "";
      }
      return seed;
    }
  );
  const [planNote, setPlanNote] = useState<string | null>(null);
  const [planSource, setPlanSource] = useState<"ai" | "fallback" | null>(null);
  const [rows, setRows] = useState<EditableSubtask[]>(() =>
    (scope.suggestedSubtasks ?? []).map((s, i) => ({
      uid: genUid(),
      originalIndex: i,
      title: s.title ?? "",
      description: s.description ?? "",
      dependsOn: Array.isArray(s.dependsOn) ? [...s.dependsOn] : [],
      wave: typeof s.wave === "number" ? s.wave : 1,
      acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
        ? [...s.acceptanceCriteria]
        : [],
    }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planning, setPlanning] = useState(false);
  // Track whether we've auto-generated subtasks from answers for this
  // wizard session so moving back/forth doesn't re-run the LLM every time.
  const [hasAutoPlanned, setHasAutoPlanned] = useState(false);

  // Reset transient state whenever the modal is (re)opened.
  // If a persisted draft exists for this goal, hydrate from it instead of
  // seeding from scratch — this preserves progress when the user
  // accidentally dismisses the modal.
  useEffect(() => {
    if (!open) {
      setIsVisible(false);
      return;
    }
    const persisted = loadPersistedState(goal);
    if (persisted) {
      setStep(persisted.step);
      setProjectName(persisted.projectName);
      setDynamicQuestions(persisted.dynamicQuestions ?? []);
      setClarificationAnswers(persisted.clarificationAnswers ?? {});
      setRows(persisted.rows ?? []);
      setHasAutoPlanned(Boolean(persisted.hasAutoPlanned));
      setPlanNote(null);
      setPlanSource(null);
    } else {
      setStep(1);
      setProjectName(deriveProjectName(goal, scope.projectTitle));
      setDynamicQuestions([]);
      setPlanNote(null);
      setPlanSource(null);
      const seed: QuestionAnswers = {};
      for (const q of (scope.questions ?? [])) {
        seed[q.id] = q.type === "multiselect" ? [] : "";
      }
      setClarificationAnswers(seed);
      setRows(
        (scope.suggestedSubtasks ?? []).map((s, i) => ({
          uid: genUid(),
          originalIndex: i,
          title: s.title ?? "",
          description: s.description ?? "",
          dependsOn: Array.isArray(s.dependsOn) ? [...s.dependsOn] : [],
          wave: typeof s.wave === "number" ? s.wave : 1,
          acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
            ? [...s.acceptanceCriteria]
            : [],
        }))
      );
      setHasAutoPlanned(false);
    }
    setSubmitting(false);
    setError(null);
    setPlanning(false);
    requestAnimationFrame(() => setIsVisible(true));
  }, [open, goal, scope]);

  // Persist draft to sessionStorage on every change so accidental dismiss
  // doesn't lose progress. Keyed by goal hash.
  useEffect(() => {
    if (!open) return;
    savePersistedState(goal, {
      projectName,
      clarificationAnswers,
      rows,
      step,
      hasAutoPlanned,
      dynamicQuestions,
    });
  }, [
    open,
    goal,
    projectName,
    clarificationAnswers,
    rows,
    step,
    hasAutoPlanned,
    dynamicQuestions,
  ]);

  // ── Row helpers ──
  const updateRow = useCallback(
    (uid: string, patch: Partial<EditableSubtask>) => {
      setRows((prev) => prev.map((r) => (r.uid === uid ? { ...r, ...patch } : r)));
    },
    []
  );

  const moveRow = useCallback((uid: string, direction: -1 | 1) => {
    setRows((prev) => {
      const idx = prev.findIndex((r) => r.uid === uid);
      if (idx === -1) return prev;
      const target = idx + direction;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      const [moved] = next.splice(idx, 1);
      next.splice(target, 0, moved);
      return next;
    });
  }, []);

  const deleteRow = useCallback((uid: string) => {
    setRows((prev) => prev.filter((r) => r.uid !== uid));
  }, []);

  const addRow = useCallback(() => {
    setRows((prev) => [
      ...prev,
      {
        uid: genUid(),
        originalIndex: null,
        title: "",
        description: "",
        dependsOn: [],
        wave: 1,
        acceptanceCriteria: [],
      },
    ]);
  }, []);

  // Pre-compute a lookup of originalIndex → current position (for "depends on: #N" display)
  const positionsByOriginalIndex = useMemo(() => {
    const map = new Map<number, number>();
    rows.forEach((r, i) => {
      if (r.originalIndex !== null) map.set(r.originalIndex, i + 1);
    });
    return map;
  }, [rows]);

  // ── Auto-plan subtasks from Step 1 answers ──
  // Returns a discriminated result the caller uses to decide whether to
  // advance to Step 2 or stay on Step 1 (with new follow-up questions).
  const autoPlanFromAnswers = useCallback(async (): Promise<
    { kind: "subtasks" } | { kind: "followup" } | { kind: "error" }
  > => {
    if (planning) return { kind: "error" };
    setPlanning(true);
    setError(null);
    try {
      const contextSummary = (scope.contextSources ?? [])
        .map((s) => {
          const header = s.kind === "brand" ? `[brand_context/${s.label}]` : `[${s.label}]`;
          return `${header}\n${s.snippet}`;
        })
        .join("\n\n");
      const res = await fetch("/api/tasks/plan-subtasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          goal,
          questions: questionSpecs,
          answers: clarificationAnswers,
          level: scope.level,
          contextSummary,
        }),
      });
      if (!res.ok) throw new Error(`plan-subtasks failed: ${res.status}`);
      const data = (await res.json()) as {
        suggestedSubtasks?: Array<{
          title: string;
          description: string;
          dependsOn: number[];
          wave: number;
          acceptanceCriteria: string[];
        }>;
        followUpQuestions?: QuestionSpec[];
        source?: "ai" | "fallback";
        note?: string;
      };

      // Follow-up path: Sonnet needs more info before breaking down
      const followUps = data.followUpQuestions ?? [];
      if (followUps.length > 0) {
        // Append to dynamic list (dedup by id against everything already shown)
        const existingIds = new Set(questionSpecs.map((q) => q.id));
        const fresh = followUps.filter((q) => !existingIds.has(q.id));
        if (fresh.length > 0) {
          setDynamicQuestions((prev) => [...prev, ...fresh]);
          // Seed empty answers for the new questions so the form is controlled
          setClarificationAnswers((prev) => {
            const next = { ...prev };
            for (const q of fresh) {
              if (!(q.id in next)) {
                next[q.id] = q.type === "multiselect" ? [] : "";
              }
            }
            return next;
          });
          setPlanNote(
            `Claude needs a bit more info before breaking this down — ${fresh.length} more question${fresh.length === 1 ? "" : "s"} below.`
          );
          return { kind: "followup" };
        }
        // Fall through — Sonnet only repeated known questions
      }

      const planned = data.suggestedSubtasks ?? [];
      setRows(
        planned.map((s, i) => ({
          uid: genUid(),
          originalIndex: i,
          title: s.title ?? "",
          description: s.description ?? "",
          dependsOn: Array.isArray(s.dependsOn) ? [...s.dependsOn] : [],
          wave: typeof s.wave === "number" ? s.wave : 1,
          acceptanceCriteria: Array.isArray(s.acceptanceCriteria)
            ? [...s.acceptanceCriteria]
            : [],
        }))
      );
      setPlanSource(data.source ?? "ai");
      setPlanNote(data.note ?? null);
      setHasAutoPlanned(true);
      return { kind: "subtasks" };
    } catch (err) {
      console.error("[ScopingWizardPanel] auto-plan failed:", err);
      setError(
        err instanceof Error
          ? `Couldn't auto-generate subtasks: ${err.message}. Add them manually.`
          : "Couldn't auto-generate subtasks. Add them manually."
      );
      setHasAutoPlanned(true); // Don't retry on every Next click
      return { kind: "error" };
    } finally {
      setPlanning(false);
    }
  }, [planning, goal, questionSpecs, clarificationAnswers, scope.level]);

  // ── Submit ──
  const handleCreate = useCallback(async () => {
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const trimmedName = projectName.trim() || deriveProjectName(goal, scope.projectTitle);
    const slug = slugifyName(trimmedName);

    // Fold clarification Q&A into the goal so it lands in brief.md
    const qaBlock =
      questionSpecs.length > 0
        ? serializeAnswersToProse(questionSpecs, clarificationAnswers)
        : "";
    const enrichedGoal = qaBlock
      ? `${goal}\n\n## Clarifications\n\n${qaBlock}`
      : goal;

    try {
      // 1. Create the project (level 2 = Planned Project)
      // Pass deliverables so brief.md has them from the start
      const deliverables = rows.map((r) => ({
        title: r.title.trim() || "Untitled",
        description: r.description.trim() || undefined,
        acceptanceCriteria: r.acceptanceCriteria?.filter(Boolean) ?? [],
      }));
      const projectRes = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          name: trimmedName,
          level: 2,
          goal: enrichedGoal,
          clientId,
          deliverables,
        }),
      });

      if (!projectRes.ok) {
        const text = await projectRes.text().catch(() => "");
        throw new Error(
          `Failed to create project${text ? `: ${text}` : ""}`
        );
      }

      const projectData = (await projectRes.json()) as {
        slug: string;
      };
      const projectSlug = projectData.slug || slug;

      // 2. Remap dependsOn indices. Original indices reference
      // scope.suggestedSubtasks positions. The user may have reordered,
      // deleted, or added rows. Build a map from originalIndex → newIndex.
      const originalToNew = new Map<number, number>();
      rows.forEach((r, i) => {
        if (r.originalIndex !== null) originalToNew.set(r.originalIndex, i);
      });

      const remappedSubtasks = rows.map((r) => {
        const newDeps = r.dependsOn
          .map((oldIdx) => originalToNew.get(oldIdx))
          .filter((v): v is number => typeof v === "number");
        return {
          title: r.title.trim() || "Untitled",
          description: r.description.trim(),
          dependsOn: newDeps,
          wave: r.wave,
          acceptanceCriteria: r.acceptanceCriteria,
        };
      });

      const modifiedScope: ScopeResult = {
        level: scope.level,
        confidence: scope.confidence,
        overlaps: scope.overlaps ?? [],
        questions: questionSpecs,
        suggestedSubtasks: remappedSubtasks,
      };

      // 3. Materialise subtasks under the new project
      const tasksRes = await fetch(
        `/api/projects/${encodeURIComponent(projectSlug)}/tasks-from-scope`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ scope: modifiedScope, clientId }),
        }
      );

      if (!tasksRes.ok) {
        const text = await tasksRes.text().catch(() => "");
        throw new Error(
          `Failed to create tasks${text ? `: ${text}` : ""}`
        );
      }

      const tasksData = (await tasksRes.json()) as { taskIds: string[] };
      clearPersistedState(goal);
      onCreated({ projectSlug, taskIds: tasksData.taskIds ?? [] });
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
    } finally {
      setSubmitting(false);
    }
  }, [submitting, projectName, goal, clientId, rows, scope, questionSpecs, clarificationAnswers, onCreated, onClose]);

  if (!open) return null;

  const projectColor = LEVEL_COLORS.project;

  const stepTitle =
    step === 1
      ? questionSpecs.length > 0
        ? "A few questions first"
        : "Plan this project"
      : step === 2
        ? "Break it into tasks"
        : "Ready to create";

  // ── Shared wizard content (header, steps, body, footer) ──
  const wizardContent = (
    <>
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>

      {/* Header — only shown in modal variant; inline uses DetailPanel header */}
      {variant === "modal" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 24px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
            backgroundColor: "var(--muted)",
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "4px 12px",
                borderRadius: 6,
                backgroundColor: projectColor.bg,
                color: projectColor.text,
                fontSize: 11,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {LEVEL_LABELS.project}
            </span>
            <h2
              style={{
                margin: 0,
                fontSize: 16,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                color: "var(--foreground)",
              }}
            >
              {stepTitle}
            </h2>
          </div>
          <button
            onClick={() => !submitting && onClose()}
            disabled={submitting}
            aria-label="Close"
            style={{
              background: "none",
              border: "none",
              cursor: submitting ? "default" : "pointer",
              color: "var(--muted-foreground)",
              padding: 4,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              borderRadius: 4,
              opacity: submitting ? 0.4 : 1,
            }}
          >
            <X size={18} />
          </button>
        </div>
      )}

      {/* Inline header — compact step title for panel mode */}
      {variant === "inline" && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "12px 16px",
            borderBottom: "1px solid var(--border)",
            flexShrink: 0,
          }}
        >
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              padding: "3px 8px",
              borderRadius: 4,
              backgroundColor: projectColor.bg,
              color: projectColor.text,
              fontSize: 10,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
            }}
          >
            {LEVEL_LABELS.project}
          </span>
          <span
            style={{
              fontSize: 13,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--foreground)",
            }}
          >
            {stepTitle}
          </span>
        </div>
      )}

      {/* Step indicator */}
        <div
          style={{
            display: "flex",
            gap: 6,
            padding: "10px 24px",
            borderBottom: "1px solid var(--border)",
            backgroundColor: "var(--card)",
            flexShrink: 0,
          }}
        >
          {[1, 2, 3].map((n) => (
            <div
              key={n}
              style={{
                flex: 1,
                height: 3,
                borderRadius: 2,
                backgroundColor: step >= (n as Step) ? "var(--primary)" : "var(--border)",
                transition: "background-color 200ms ease",
              }}
            />
          ))}
        </div>

        {/* Sticky project name bar — visible and editable across all steps.
            Lifted out of Step 1 so the name is front and centre the moment
            the modal opens, and can be refined later without scrolling back. */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            padding: "12px 24px",
            borderBottom: "1px solid var(--border)",
            backgroundColor: "var(--card)",
            flexShrink: 0,
          }}
        >
          <label
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              flexShrink: 0,
            }}
          >
            Project name
          </label>
          <input
            type="text"
            value={projectName}
            onChange={(e) => setProjectName(e.target.value)}
            placeholder="Give this project a short name"
            disabled={submitting}
            style={{
              flex: 1,
              padding: "8px 12px",
              fontSize: 14,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              backgroundColor: "var(--muted)",
              border: "1px solid var(--border)",
              borderRadius: 6,
              outline: "none",
              color: "var(--foreground)",
              boxSizing: "border-box",
              transition: "border-color 150ms ease, background-color 150ms ease",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = "var(--primary)";
              e.currentTarget.style.backgroundColor = "var(--card)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = "var(--border)";
              e.currentTarget.style.backgroundColor = "var(--muted)";
            }}
          />
        </div>

        {/* Error banner */}
        {error && (
          <div
            style={{
              padding: "8px 24px",
              backgroundColor: "var(--muted)",
              borderBottom: "1px solid var(--muted)",
              color: "var(--destructive)",
              fontSize: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              flexShrink: 0,
            }}
          >
            {error}
          </div>
        )}

        {/* Body */}
        <div
          style={{
            flex: 1,
            overflowY: "auto",
            padding: "20px 24px",
          }}
        >
          {step === 1 && (
            <Step1Review
              goal={goal}
              scope={scope}
              questions={questionSpecs}
              clarificationAnswers={clarificationAnswers}
              onClarificationChange={setClarificationAnswers}
              planNote={planNote}
              contextSources={scope.contextSources ?? []}
            />
          )}
          {step === 2 && (
            planning ? (
              <PlanningState />
            ) : (
              <Step2Subtasks
                rows={rows}
                positionsByOriginalIndex={positionsByOriginalIndex}
                onUpdate={updateRow}
                onMove={moveRow}
                onDelete={deleteRow}
                onAdd={addRow}
                autoPlanned={hasAutoPlanned}
                planSource={planSource}
                planNote={planNote}
              />
            )
          )}
          {step === 3 && (
            <Step3Confirm
              projectName={projectName.trim() || deriveProjectName(goal, scope.projectTitle)}
              subtaskCount={rows.length}
            />
          )}
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "14px 24px",
            borderTop: "1px solid var(--border)",
            backgroundColor: "var(--muted)",
            flexShrink: 0,
          }}
        >
          <button
            onClick={() => {
              if (submitting) return;
              if (step === 1) onClose();
              else setStep((prev) => ((prev - 1) as Step));
            }}
            disabled={submitting}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 8,
              padding: "8px 16px",
              fontSize: 13,
              fontWeight: 500,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              border: "1px solid var(--border)",
              borderRadius: "0.375rem",
              backgroundColor: "transparent",
              color: "var(--muted-foreground)",
              cursor: submitting ? "default" : "pointer",
              opacity: submitting ? 0.5 : 1,
              transition: "all 150ms ease",
            }}
          >
            {step === 1 ? (
              "Cancel"
            ) : (
              <>
                <ArrowLeft size={14} />
                Back
              </>
            )}
          </button>

          <div
            style={{
              fontSize: 11,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--muted-foreground)",
            }}
          >
            Step {step} of 3
          </div>

          {step < 3 ? (() => {
            const requiredAnswered = areAnswersComplete(questionSpecs, clarificationAnswers);
            const step1Ok = Boolean(projectName.trim()) && requiredAnswered && !planning;
            // Step 2 no longer forces subtasks — empty is allowed (user can
            // create the project and queue work later). We just gate on not
            // being mid-generation.
            const step2Ok = !planning;
            const canAdvance = (step === 1 && step1Ok) || (step === 2 && step2Ok);
            const label = planning
              ? "Planning…"
              : step === 1 && !hasAutoPlanned && questionSpecs.length > 0
                ? "Generate subtasks"
                : "Next";
            return (
              <button
                onClick={async () => {
                  if (!canAdvance) return;
                  if (step === 1 && !hasAutoPlanned) {
                    const result = await autoPlanFromAnswers();
                    // If Sonnet asked for more info, stay on Step 1 —
                    // the new questions are now merged into questionSpecs.
                    if (result.kind !== "subtasks") return;
                  }
                  setStep((prev) => ((prev + 1) as Step));
                }}
                disabled={!canAdvance}
                title={
                  step === 1 && !requiredAnswered
                    ? "Answer the required questions to continue"
                    : undefined
                }
                style={{
                  background: canAdvance
                    ? "linear-gradient(135deg, var(--primary), var(--primary))"
                    : "var(--border)",
                  color: "var(--card)",
                  border: "none",
                  borderRadius: "0.375rem",
                  padding: "6px 16px",
                  fontSize: 13,
                  fontWeight: 600,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  cursor: canAdvance ? "pointer" : "default",
                  transition: "all 150ms ease",
                  display: "inline-flex",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                {planning && (
                  <span
                    style={{
                      width: 12,
                      height: 12,
                      borderRadius: "50%",
                      border: "2px solid color-mix(in srgb, var(--foreground) 35%, transparent)",
                      borderTopColor: "var(--card)",
                      animation: "spin 700ms linear infinite",
                      display: "inline-block",
                    }}
                  />
                )}
                {label}
              </button>
            );
          })() : (
            <button
              onClick={handleCreate}
              disabled={submitting}
              style={{
                background: !submitting
                  ? "linear-gradient(135deg, var(--primary), var(--primary))"
                  : "var(--border)",
                color: "var(--card)",
                border: "none",
                borderRadius: "0.375rem",
                padding: "6px 16px",
                fontSize: 13,
                fontWeight: 600,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                cursor: submitting ? "default" : "pointer",
                opacity: submitting ? 0.7 : 1,
                transition: "all 150ms ease",
              }}
            >
              {submitting ? "Creating..." : "Create project"}
            </button>
          )}
        </div>
    </>
  );

  // ── Inline: render content directly ──
  if (variant === "inline") {
    return (
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          flex: 1,
          overflow: "hidden",
          fontFamily: "var(--font-inter), Inter, sans-serif",
        }}
      >
        {wizardContent}
      </div>
    );
  }

  // ── Modal: wrap in overlay + centered dialog ──
  return (
    <>
      {/* Overlay — intentionally NOT click-to-close */}
      <div
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "color-mix(in srgb, var(--foreground) 25%, transparent)",
          zIndex: 200,
          opacity: isVisible ? 1 : 0,
          pointerEvents: isVisible ? "auto" : "none",
          transition: "opacity 200ms ease-out",
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        style={{
          position: "fixed",
          top: "50%",
          left: "50%",
          transform: isVisible
            ? "translate(-50%, -50%) scale(1)"
            : "translate(-50%, -50%) scale(0.97)",
          width: "min(720px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          backgroundColor: "var(--card)",
          borderRadius: 12,
          boxShadow: "0px 20px 48px color-mix(in srgb, var(--foreground) 18%, transparent)",
          zIndex: 201,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          opacity: isVisible ? 1 : 0,
          transition: "opacity 200ms ease-out, transform 200ms ease-out",
          fontFamily: "var(--font-inter), Inter, sans-serif",
        }}
      >
        {wizardContent}
      </div>
    </>
  );
}

// ── Step 1: Review ───────────────────────────────────────────────────────

function Step1Review({
  goal,
  scope,
  questions,
  clarificationAnswers,
  onClarificationChange,
  planNote,
  contextSources,
}: {
  goal: string;
  scope: ScopeResult & { reasoning?: string };
  questions: QuestionSpec[];
  clarificationAnswers: QuestionAnswers;
  onClarificationChange: (answers: QuestionAnswers) => void;
  planNote: string | null;
  contextSources: NonNullable<ScopeResult["contextSources"]>;
}) {
  const confidencePct = Math.round((scope.confidence ?? 0) * 100);
  const confidenceColor =
    confidencePct >= 75 ? "var(--muted-foreground)" : confidencePct >= 50 ? "var(--muted-foreground)" : "var(--muted-foreground)";

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {contextSources.length > 0 && (
        <LoadedContextCard sources={contextSources} />
      )}
      {planNote && (
        <div
          style={{
            padding: "10px 14px",
            borderRadius: 8,
            backgroundColor: "var(--card)",
            border: "1px solid var(--muted)",
            color: "var(--muted-foreground)",
            fontSize: 12,
            lineHeight: 1.5,
            fontFamily: "var(--font-inter), Inter, sans-serif",
          }}
        >
          {planNote}
        </div>
      )}
      {/* Clarifying questions — typed form, top of the step */}
      {questions.length > 0 && (
        <section>
          <SectionLabel>Answer these to shape the plan</SectionLabel>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              marginBottom: 12,
              lineHeight: 1.5,
            }}
          >
            Claude needs a bit more context before breaking this into subtasks. Answer what you can — blanks get sensible defaults.
          </div>
          <QuestionModal
            variant="inline"
            questions={questions}
            value={clarificationAnswers}
            onChange={onClarificationChange}
            hideFooter
          />
        </section>
      )}

      {/* Goal */}
      <section>
        <SectionLabel>Your goal</SectionLabel>
        <div
          style={{
            padding: "12px 16px",
            borderRadius: 8,
            backgroundColor: "var(--muted)",
            border: "1px solid var(--border)",
            fontSize: 14,
            lineHeight: 1.5,
            color: "var(--foreground)",
            whiteSpace: "pre-wrap",
          }}
        >
          {goal}
        </div>
      </section>

      {/* Routing */}
      <section>
        <SectionLabel>Why this is a planned project</SectionLabel>
        <div
          style={{
            padding: "12px 14px",
            borderRadius: 8,
            border: "1px solid var(--border)",
            backgroundColor: "var(--card)",
            display: "flex",
            flexDirection: "column",
            gap: 10,
          }}
        >
          {scope.reasoning && (
            <div
              style={{
                fontSize: 13,
                lineHeight: 1.5,
                color: "var(--muted-foreground)",
              }}
            >
              {scope.reasoning}
            </div>
          )}
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span
              style={{
                display: "inline-flex",
                alignItems: "center",
                padding: "3px 8px",
                borderRadius: 4,
                backgroundColor: "color-mix(in srgb, var(--foreground) 8%, transparent)",
                color: confidenceColor,
                fontSize: 11,
                fontWeight: 600,
                fontFamily:
                  "var(--font-inter), Inter, sans-serif",
                textTransform: "uppercase",
                letterSpacing: "0.06em",
              }}
            >
              {confidencePct}% confidence
            </span>
            {scope.overlaps && scope.overlaps.length > 0 && (
              <span
                style={{
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                }}
              >
                {scope.overlaps.length} possible overlap
                {scope.overlaps.length === 1 ? "" : "s"} detected
              </span>
            )}
          </div>
        </div>
      </section>

    </div>
  );
}

// ── Step 2: Subtasks ─────────────────────────────────────────────────────

function PlanningState() {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "60px 24px",
        gap: 14,
        minHeight: 220,
      }}
    >
      <div
        style={{
          width: 28,
          height: 28,
          borderRadius: "50%",
          border: "3px solid color-mix(in srgb, var(--foreground) 15%, transparent)",
          borderTopColor: "var(--primary)",
          animation: "spin 800ms linear infinite",
        }}
      />
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          color: "var(--foreground)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
        }}
      >
        Planning subtasks from your answers…
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--muted-foreground)",
          textAlign: "center",
          maxWidth: 360,
          lineHeight: 1.5,
          fontFamily: "var(--font-inter), Inter, sans-serif",
        }}
      >
        Claude is breaking the project into actionable steps based on the goal
        and the clarifications you just filled in. You&apos;ll be able to edit,
        reorder, or add more before creating the project.
      </div>
    </div>
  );
}

function Step2Subtasks({
  rows,
  positionsByOriginalIndex,
  onUpdate,
  onMove,
  onDelete,
  onAdd,
  autoPlanned,
  planSource,
  planNote,
}: {
  rows: EditableSubtask[];
  positionsByOriginalIndex: Map<number, number>;
  onUpdate: (uid: string, patch: Partial<EditableSubtask>) => void;
  onMove: (uid: string, direction: -1 | 1) => void;
  onDelete: (uid: string) => void;
  onAdd: () => void;
  autoPlanned: boolean;
  planSource: "ai" | "fallback" | null;
  planNote: string | null;
}) {
  const isFallback = planSource === "fallback";
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      {autoPlanned && rows.length > 0 && !isFallback && (
        <div
          style={{
            fontSize: 12,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            lineHeight: 1.5,
            padding: "12px 12px",
            borderRadius: 6,
            backgroundColor: "var(--muted)",
            border: "1px solid var(--border)",
          }}
        >
          Here&apos;s a first-pass breakdown based on your answers. Edit,
          reorder, or add more before creating the project — or just hit
          Next to go with this plan.
        </div>
      )}
      {autoPlanned && isFallback && (
        <div
          style={{
            fontSize: 12,
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            lineHeight: 1.5,
            padding: "10px 12px",
            borderRadius: 6,
            backgroundColor: "var(--card)",
            border: "1px solid var(--muted)",
          }}
        >
          {planNote ??
            "Planner was unavailable — showing a generic scaffold. Edit or replace these before creating the project."}
        </div>
      )}
      {rows.length === 0 && (
        <div
          style={{
            padding: "20px",
            textAlign: "center",
            fontSize: 13,
            color: "var(--muted-foreground)",
            border: "1px dashed var(--border)",
            borderRadius: 8,
          }}
        >
          {autoPlanned
            ? "No subtasks were generated. Add some manually or just hit Next to create the project without a breakdown."
            : "No subtasks yet. Add one below, or hit Next to skip."}
        </div>
      )}

      {rows.map((row, idx) => {
        const depLabels = row.dependsOn
          .map((origIdx) => positionsByOriginalIndex.get(origIdx))
          .filter((v): v is number => typeof v === "number");

        return (
          <div
            key={row.uid}
            style={{
              border: "1px solid var(--border)",
              borderRadius: 8,
              padding: "12px 14px",
              backgroundColor: "var(--card)",
              display: "flex",
              flexDirection: "column",
              gap: 8,
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "var(--primary)",
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                  minWidth: 24,
                }}
              >
                #{idx + 1}
              </span>
              <input
                type="text"
                value={row.title}
                onChange={(e) => onUpdate(row.uid, { title: e.target.value })}
                placeholder="Subtask title"
                style={{
                  flex: 1,
                  padding: "8px 12px",
                  fontSize: 13,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  backgroundColor: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: 6,
                  outline: "none",
                  color: "var(--foreground)",
                  fontWeight: 500,
                  boxSizing: "border-box",
                }}
                onFocus={(e) => {
                  e.currentTarget.style.borderColor = "var(--primary)";
                }}
                onBlur={(e) => {
                  e.currentTarget.style.borderColor = "var(--border)";
                }}
              />
              <div style={{ display: "flex", gap: 4 }}>
                <IconButton
                  label="Move up"
                  disabled={idx === 0}
                  onClick={() => onMove(row.uid, -1)}
                >
                  <ArrowUp size={14} />
                </IconButton>
                <IconButton
                  label="Move down"
                  disabled={idx === rows.length - 1}
                  onClick={() => onMove(row.uid, 1)}
                >
                  <ArrowDown size={14} />
                </IconButton>
                <IconButton label="Delete" onClick={() => onDelete(row.uid)}>
                  <Trash2 size={14} />
                </IconButton>
              </div>
            </div>

            <textarea
              value={row.description}
              onChange={(e) =>
                onUpdate(row.uid, { description: e.target.value })
              }
              placeholder="Optional description"
              rows={2}
              style={{
                width: "100%",
                padding: "8px 12px",
                fontSize: 12,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                backgroundColor: "var(--muted)",
                border: "1px solid var(--border)",
                borderRadius: 6,
                outline: "none",
                color: "var(--muted-foreground)",
                resize: "vertical",
                minHeight: 40,
                maxHeight: 120,
                lineHeight: 1.4,
                boxSizing: "border-box",
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--primary)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--border)";
              }}
            />

            {depLabels.length > 0 && (
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  fontFamily:
                    "var(--font-inter), Inter, sans-serif",
                }}
              >
                depends on: {depLabels.map((p) => `#${p}`).join(", ")}
              </div>
            )}
          </div>
        );
      })}

      <button
        onClick={onAdd}
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          gap: 6,
          padding: "10px 14px",
          border: "1px dashed color-mix(in srgb, var(--foreground) 35%, transparent)",
          borderRadius: 8,
          backgroundColor: "transparent",
          color: "var(--primary)",
          fontSize: 12,
          fontWeight: 500,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          cursor: "pointer",
          transition: "all 150ms ease",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "color-mix(in srgb, var(--foreground) 4%, transparent)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
      >
        <Plus size={14} />
        Add subtask
      </button>
    </div>
  );
}

// ── Step 3: Confirm ──────────────────────────────────────────────────────

function Step3Confirm({
  projectName,
  subtaskCount,
}: {
  projectName: string;
  subtaskCount: number;
}) {
  const noSubtasks = subtaskCount === 0;
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div
        style={{
          padding: "16px 18px",
          borderRadius: 8,
          border: "1px solid var(--border)",
          backgroundColor: "var(--muted)",
          fontSize: 14,
          lineHeight: 1.5,
          color: "var(--foreground)",
        }}
      >
        Creating project{" "}
        <strong style={{ color: "var(--primary)" }}>&ldquo;{projectName}&rdquo;</strong>
        {noSubtasks ? (
          <> with no pre-defined subtasks.</>
        ) : (
          <>
            {" "}
            with{" "}
            <strong>
              {subtaskCount} subtask{subtaskCount === 1 ? "" : "s"}
            </strong>
            .
          </>
        )}
      </div>
      <div
        style={{
          fontSize: 12,
          color: "var(--muted-foreground)",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          lineHeight: 1.5,
        }}
      >
        A brief will be written to
        <code
          style={{
            margin: "0 4px",
            padding: "1px 6px",
            borderRadius: 4,
            backgroundColor: "var(--muted)",
            color: "var(--muted-foreground)",
            fontFamily: "var(--font-geist-mono, ui-monospace), monospace",
            fontSize: 11,
          }}
        >
          projects/briefs/{slugifyName(projectName)}/brief.md
        </code>
        {noSubtasks ? (
          <>
            {" "}
            containing your goal and every clarification you just answered.
            Because there&apos;s no predefined breakdown, the first time you
            run work against this project Claude will read the brief and plan
            the subtasks itself — you can start that from the project page
            any time.
          </>
        ) : (
          <> and the subtasks will be queued up ready to run.</>
        )}
      </div>
    </div>
  );
}

// ── Loaded context card ──────────────────────────────────────────────────

function LoadedContextCard({
  sources,
}: {
  sources: NonNullable<ScopeResult["contextSources"]>;
}) {
  const [expanded, setExpanded] = useState(false);
  const brandCount = sources.filter((s) => s.kind === "brand").length;
  const urlCount = sources.filter((s) => s.kind === "url").length;
  const summaryParts: string[] = [];
  if (brandCount > 0) summaryParts.push(`${brandCount} brand file${brandCount === 1 ? "" : "s"}`);
  if (urlCount > 0) summaryParts.push(`${urlCount} link${urlCount === 1 ? "" : "s"}`);

  return (
    <section
      style={{
        padding: "12px 14px",
        borderRadius: 8,
        border: "1px solid var(--muted)",
        backgroundColor: "var(--card)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 10,
        }}
      >
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 2,
          }}
        >
          <div
            style={{
              fontSize: 11,
              fontWeight: 700,
              color: "var(--muted-foreground)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            Context loaded
          </div>
          <div
            style={{
              fontSize: 12,
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              lineHeight: 1.5,
            }}
          >
            Read {summaryParts.join(" + ")} before drafting questions — answers will reflect what we already know.
          </div>
        </div>
        <button
          onClick={() => setExpanded((v) => !v)}
          style={{
            background: "transparent",
            border: "1px solid var(--muted)",
            color: "var(--muted-foreground)",
            borderRadius: 6,
            padding: "4px 10px",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            cursor: "pointer",
            flexShrink: 0,
          }}
        >
          {expanded ? "Hide" : "Show"}
        </button>
      </div>

      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: 6,
          marginTop: 10,
        }}
      >
        {sources.map((s) => (
          <span
            key={`${s.kind}:${s.origin}`}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              padding: "3px 8px",
              borderRadius: 999,
              backgroundColor: "var(--card)",
              border: "1px solid var(--muted)",
              fontSize: 11,
              color: "var(--muted-foreground)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontWeight: 500,
            }}
          >
            {s.kind === "brand" ? "📄" : "🔗"} {s.label}
          </span>
        ))}
      </div>

      {expanded && (
        <div
          style={{
            marginTop: 12,
            display: "flex",
            flexDirection: "column",
            gap: 10,
            maxHeight: 240,
            overflowY: "auto",
          }}
        >
          {sources.map((s) => (
            <div
              key={`exp:${s.kind}:${s.origin}`}
              style={{
                padding: "8px 10px",
                backgroundColor: "var(--card)",
                border: "1px solid var(--muted)",
                borderRadius: 6,
              }}
            >
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  color: "var(--muted-foreground)",
                  marginBottom: 4,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                }}
              >
                {s.kind === "brand" ? `brand_context/${s.label}` : s.label}
              </div>
              <div
                style={{
                  fontSize: 11,
                  color: "var(--muted-foreground)",
                  lineHeight: 1.45,
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  whiteSpace: "pre-wrap",
                }}
              >
                {s.snippet}
              </div>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

// ── Shared small components ──────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <label
      style={{
        display: "block",
        fontSize: 11,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        color: "var(--muted-foreground)",
        marginBottom: 6,
        fontWeight: 600,
      }}
    >
      {children}
    </label>
  );
}

function IconButton({
  children,
  label,
  onClick,
  disabled,
}: {
  children: React.ReactNode;
  label: string;
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      style={{
        width: 26,
        height: 26,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: "1px solid var(--border)",
        borderRadius: 4,
        backgroundColor: "var(--card)",
        color: disabled ? "var(--border)" : "var(--muted-foreground)",
        cursor: disabled ? "default" : "pointer",
        transition: "all 120ms ease",
      }}
      onMouseEnter={(e) => {
        if (disabled) return;
        e.currentTarget.style.backgroundColor = "var(--muted)";
        e.currentTarget.style.color = "var(--primary)";
      }}
      onMouseLeave={(e) => {
        if (disabled) return;
        e.currentTarget.style.backgroundColor = "var(--card)";
        e.currentTarget.style.color = "var(--muted-foreground)";
      }}
    >
      {children}
    </button>
  );
}
