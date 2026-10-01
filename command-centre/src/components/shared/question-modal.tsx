"use client";

import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import {
  type QuestionSpec,
  type QuestionAnswers,
  areAnswersComplete,
} from "@/types/question-spec";

/**
 * Reusable structured-question form.
 *
 * When the component manages its own footer (uncontrolled, hideFooter=false)
 * and there are multiple questions, it renders a **stepped wizard** — one
 * question at a time with keyboard navigation (arrow-up/down for options,
 * left/right or prev/next buttons between questions).
 *
 * Select and multiselect fields always show a "Notes" textarea so the user
 * can add free-text alongside (or instead of) a predefined option.
 *
 * In **controlled mode** (value prop + hideFooter) the component falls back
 * to showing all questions at once, matching the scoping wizard's flow.
 */

interface QuestionModalProps {
  questions: QuestionSpec[];
  /** Controlled answer map (optional — component manages internal state if absent) */
  value?: QuestionAnswers;
  onChange?: (answers: QuestionAnswers) => void;
  /** Only meaningful for overlay variant */
  open?: boolean;
  title?: string;
  subtitle?: string;
  submitLabel?: string;
  cancelLabel?: string;
  onSubmit?: (answers: QuestionAnswers) => void | Promise<void>;
  onCancel?: () => void;
  initialAnswers?: QuestionAnswers;
  variant?: "inline" | "overlay";
  /** Hide the footer / submit button (inline mode: parent provides its own Next button) */
  hideFooter?: boolean;
}

// ── Helpers ─────────────────────────────────────────────────────────────

function buildInitialAnswers(
  questions: QuestionSpec[],
  seed?: QuestionAnswers,
): QuestionAnswers {
  const out: QuestionAnswers = {};
  for (const q of questions) {
    if (seed && q.id in seed) {
      out[q.id] = seed[q.id];
    } else if (q.type === "multiselect") {
      out[q.id] = [];
    } else {
      out[q.id] = "";
    }
  }
  return out;
}

type NotesMap = Record<string, string>;

/** Merge answer selections + notes into the final answers for submission. */
function buildMergedAnswers(
  questions: QuestionSpec[],
  answers: QuestionAnswers,
  notes: NotesMap,
): QuestionAnswers {
  const merged: QuestionAnswers = {};
  for (const q of questions) {
    const note = notes[q.id]?.trim() ?? "";
    const raw = answers[q.id];
    if (q.type === "select") {
      const sel = typeof raw === "string" ? raw : "";
      if (sel && note) {
        merged[q.id] = `${sel} (Notes: ${note})`;
      } else if (note) {
        merged[q.id] = note;
      } else {
        merged[q.id] = sel;
      }
    } else if (q.type === "multiselect") {
      const sel = Array.isArray(raw) ? raw : [];
      merged[q.id] = note ? [...sel, note] : sel;
    } else {
      merged[q.id] = raw;
    }
  }
  return merged;
}

const FONT = "var(--font-inter), Inter, sans-serif";
const FONT_SG = "var(--font-space-grotesk), Space Grotesk, sans-serif";
const ACCENT = "var(--cc-brand-primary)";
const MUTED = "var(--cc-text-secondary)";
const BORDER = "var(--cc-line-alpha-40)";

// ── Main component ──────────────────────────────────────────────────────

export function QuestionModal({
  questions,
  value,
  onChange,
  open = true,
  title,
  subtitle,
  submitLabel = "Submit",
  cancelLabel = "Cancel",
  onSubmit,
  onCancel,
  initialAnswers,
  variant = "overlay",
  hideFooter = false,
}: QuestionModalProps) {
  const controlled = value !== undefined;
  const [internalAnswers, setInternalAnswers] = useState<QuestionAnswers>(() =>
    buildInitialAnswers(questions, initialAnswers),
  );
  const [notes, setNotes] = useState<NotesMap>({});
  const [submitting, setSubmitting] = useState(false);
  const [isVisible, setIsVisible] = useState(variant === "inline");
  const [step, setStep] = useState(0);

  const answers = controlled ? value : internalAnswers;

  // Stepped mode: multiple questions, self-managed footer, not controlled
  const useStepper = !controlled && !hideFooter && questions.length > 1;

  // Re-seed on question list change — compare by content (JSON key) to avoid
  // resetting state when the parent creates a new array with identical contents.
  const questionsKey = useMemo(
    () => JSON.stringify(questions.map((q) => q.id)),
    [questions],
  );

  useEffect(() => {
    if (controlled) return;
    setInternalAnswers(buildInitialAnswers(questions, initialAnswers));
    setNotes({});
    setStep(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questionsKey]);

  useEffect(() => {
    if (variant !== "overlay") return;
    if (open) {
      requestAnimationFrame(() => setIsVisible(true));
    } else {
      setIsVisible(false);
    }
  }, [open, variant]);

  const updateAnswer = useCallback(
    (id: string, next: string | string[]) => {
      if (controlled) {
        onChange?.({ ...(value ?? {}), [id]: next });
      } else {
        setInternalAnswers((prev) => {
          const updated = { ...prev, [id]: next };
          onChange?.(updated);
          return updated;
        });
      }
    },
    [controlled, value, onChange],
  );

  const updateNote = useCallback((id: string, text: string) => {
    setNotes((prev) => ({ ...prev, [id]: text }));
  }, []);

  const mergedAnswers = useMemo(
    () => buildMergedAnswers(questions, answers, notes),
    [questions, answers, notes],
  );

  // In stepper mode, always allow submit — unanswered questions serialize as "(no answer)".
  // In all-at-once mode, require all required fields.
  const canSubmit = useStepper ? !submitting : areAnswersComplete(questions, mergedAnswers) && !submitting;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit || !onSubmit) return;
    setSubmitting(true);
    try {
      await onSubmit(mergedAnswers);
    } finally {
      setSubmitting(false);
    }
  }, [canSubmit, onSubmit, mergedAnswers]);

  // Keyboard shortcuts (overlay only)
  useEffect(() => {
    if (variant !== "overlay" || !open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape" && onCancel && !submitting) {
        e.preventDefault();
        onCancel();
      } else if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        handleSubmit();
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [variant, open, onCancel, submitting, handleSubmit]);

  if (variant === "overlay" && !open) return null;

  // Build the body content
  const body = useStepper ? (
    <SteppedBody
      questions={questions}
      answers={answers}
      notes={notes}
      step={step}
      onStep={setStep}
      onAnswer={updateAnswer}
      onNote={updateNote}
      onSubmit={onSubmit ? handleSubmit : undefined}
      canSubmit={canSubmit}
      submitting={submitting}
      submitLabel={submitLabel}
      subtitle={subtitle}
    />
  ) : (
    <AllAtOnceBody
      questions={questions}
      answers={answers}
      notes={controlled ? undefined : notes}
      onAnswer={updateAnswer}
      onNote={controlled ? undefined : updateNote}
      subtitle={subtitle}
    />
  );

  // ── Inline variant ──
  if (variant === "inline") {
    return (
      <div>
        {body}
        {/* Footer — only shown in non-stepped mode (stepper has its own nav) */}
        {!hideFooter && onSubmit && !useStepper && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              marginTop: 14,
            }}
          >
            {onCancel && (
              <ModalButton onClick={onCancel} disabled={submitting} secondary>
                {cancelLabel}
              </ModalButton>
            )}
            <ModalButton onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? "Submitting..." : submitLabel}
            </ModalButton>
          </div>
        )}
      </div>
    );
  }

  // ── Overlay variant ──
  return (
    <>
      <div
        onClick={() => !submitting && onCancel?.()}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "var(--cc-neutral-alpha-35)",
          zIndex: 300,
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
          width: "min(560px, calc(100vw - 32px))",
          maxHeight: "calc(100vh - 48px)",
          backgroundColor: "var(--cc-surface)",
          borderRadius: 12,
          boxShadow: "0px 24px 56px var(--cc-neutral-alpha-20)",
          zIndex: 301,
          display: "flex",
          flexDirection: "column",
          overflow: "hidden",
          opacity: isVisible ? 1 : 0,
          transition: "opacity 200ms ease-out, transform 200ms ease-out",
          fontFamily: FONT,
        }}
      >
        {/* Header */}
        <div
          style={{
            padding: "16px 24px 12px",
            borderBottom: "1px solid var(--cc-control-bg)",
            flexShrink: 0,
            backgroundColor: "var(--cc-canvas-subtle)",
          }}
        >
          <h2
            style={{
              margin: 0,
              fontSize: 15,
              fontWeight: 600,
              color: "var(--cc-text-primary)",
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            }}
          >
            {title ?? "A few questions"}
          </h2>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflowY: "auto", padding: "18px 24px" }}>
          {body}
        </div>

        {/* Footer — only in non-stepped overlay */}
        {!hideFooter && !useStepper && (
          <div
            style={{
              display: "flex",
              justifyContent: "flex-end",
              gap: 10,
              padding: "14px 24px",
              borderTop: "1px solid var(--cc-control-bg)",
              backgroundColor: "var(--cc-canvas-subtle)",
              flexShrink: 0,
            }}
          >
            {onCancel && (
              <ModalButton onClick={onCancel} disabled={submitting} secondary>
                {cancelLabel}
              </ModalButton>
            )}
            <ModalButton onClick={handleSubmit} disabled={!canSubmit}>
              {submitting ? "Submitting..." : submitLabel}
            </ModalButton>
          </div>
        )}
      </div>
    </>
  );
}

// ── Button helper ───────────────────────────────────────────────────────

function ModalButton({
  children,
  onClick,
  disabled,
  secondary,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  secondary?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      style={{
        padding: secondary ? "6px 14px" : "6px 16px",
        fontSize: 13,
        fontWeight: secondary ? 500 : 600,
        border: secondary ? "1px solid var(--cc-line-alpha-35)" : "none",
        borderRadius: 6,
        backgroundColor: secondary
          ? "transparent"
          : disabled
          ? "var(--cc-control-border)"
          : undefined,
        background:
          secondary || disabled
            ? undefined
            : "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))",
        color: secondary ? MUTED : "var(--cc-surface)",
        cursor: disabled ? "default" : "pointer",
        fontFamily: FONT_SG,
      }}
    >
      {children}
    </button>
  );
}

// ── Stepped body (one question at a time) ───────────────────────────────

function SteppedBody({
  questions,
  answers,
  notes,
  step,
  onStep,
  onAnswer,
  onNote,
  onSubmit,
  canSubmit,
  submitting,
  submitLabel,
  subtitle,
}: {
  questions: QuestionSpec[];
  answers: QuestionAnswers;
  notes: NotesMap;
  step: number;
  onStep: (n: number) => void;
  onAnswer: (id: string, v: string | string[]) => void;
  onNote: (id: string, text: string) => void;
  onSubmit?: () => void;
  canSubmit: boolean;
  submitting: boolean;
  submitLabel: string;
  subtitle?: string;
}) {
  const total = questions.length;
  const q = questions[step];
  const isFirst = step === 0;
  const isLast = step === total - 1;
  const containerRef = useRef<HTMLDivElement>(null);

  // Focus the container on step change so keyboard events work
  useEffect(() => {
    containerRef.current?.focus();
  }, [step]);

  const goNext = useCallback(() => {
    if (!isLast) onStep(step + 1);
  }, [isLast, onStep, step]);

  const goPrev = useCallback(() => {
    if (!isFirst) onStep(step - 1);
  }, [isFirst, onStep, step]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const isInput =
        target.tagName === "INPUT" || target.tagName === "TEXTAREA";

      // Left/Right for question navigation — only when not typing in an input
      if (!isInput) {
        if (e.key === "ArrowRight" && !isLast) {
          e.preventDefault();
          goNext();
          return;
        }
        if (e.key === "ArrowLeft" && !isFirst) {
          e.preventDefault();
          goPrev();
          return;
        }
      }
    },
    [isFirst, isLast, goNext, goPrev],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleKeyDown}
      style={{ outline: "none" }}
    >
      {/* Progress indicator */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          marginBottom: 14,
        }}
      >
        <div style={{ display: "flex", gap: 4 }}>
          {questions.map((_, i) => (
            <button
              key={i}
              type="button"
              onClick={() => onStep(i)}
              style={{
                width: i === step ? 16 : 6,
                height: 6,
                borderRadius: 3,
                border: "none",
                backgroundColor: i === step ? ACCENT : "var(--cc-brand-alpha-20)",
                cursor: "pointer",
                padding: 0,
                transition: "all 200ms ease",
              }}
              aria-label={`Question ${i + 1}`}
            />
          ))}
        </div>
        <span
          style={{
            fontSize: 11,
            fontFamily: FONT_SG,
            color: MUTED,
            fontWeight: 500,
          }}
        >
          {step + 1} of {total}
        </span>
      </div>

      {subtitle && step === 0 && (
        <div
          style={{
            fontSize: 12,
            color: MUTED,
            fontFamily: FONT,
            lineHeight: 1.5,
            marginBottom: 10,
          }}
        >
          {subtitle}
        </div>
      )}

      {/* Current question */}
      <SteppedQuestionField
        key={q.id}
        index={step}
        question={q}
        value={answers[q.id]}
        noteValue={notes[q.id] ?? ""}
        onChange={(v) => onAnswer(q.id, v)}
        onNoteChange={(t) => onNote(q.id, t)}
      />

      {/* Navigation */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          marginTop: 14,
        }}
      >
        <button
          type="button"
          onClick={goPrev}
          disabled={isFirst}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 4,
            fontSize: 12,
            fontFamily: FONT_SG,
            fontWeight: 500,
            color: isFirst ? "var(--cc-control-border)" : MUTED,
            background: "none",
            border: "none",
            cursor: isFirst ? "default" : "pointer",
            padding: "4px 0",
          }}
        >
          <ChevronLeft size={14} />
          Previous
        </button>

        {isLast ? (
          <ModalButton
            onClick={onSubmit}
            disabled={!canSubmit}
          >
            {submitting ? "Submitting..." : submitLabel}
          </ModalButton>
        ) : (
          <button
            type="button"
            onClick={goNext}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 4,
              fontSize: 12,
              fontFamily: FONT_SG,
              fontWeight: 500,
              color: ACCENT,
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "4px 0",
            }}
          >
            Next
            <ChevronRight size={14} />
          </button>
        )}
      </div>
    </div>
  );
}

// ── All-at-once body (controlled / single question / hideFooter) ────────

function AllAtOnceBody({
  questions,
  answers,
  notes,
  onAnswer,
  onNote,
  subtitle,
}: {
  questions: QuestionSpec[];
  answers: QuestionAnswers;
  notes?: NotesMap;
  onAnswer: (id: string, v: string | string[]) => void;
  onNote?: (id: string, text: string) => void;
  subtitle?: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      {subtitle && (
        <div
          style={{
            fontSize: 12,
            color: MUTED,
            fontFamily: FONT,
            lineHeight: 1.5,
          }}
        >
          {subtitle}
        </div>
      )}
      {questions.map((q, i) => (
        <SteppedQuestionField
          key={q.id}
          index={i}
          question={q}
          value={answers[q.id]}
          noteValue={notes?.[q.id] ?? ""}
          onChange={(v) => onAnswer(q.id, v)}
          onNoteChange={onNote ? (t) => onNote(q.id, t) : undefined}
        />
      ))}
    </div>
  );
}

// ── Single question field with keyboard nav + notes ─────────────────────

function SteppedQuestionField({
  index,
  question,
  value,
  noteValue,
  onChange,
  onNoteChange,
}: {
  index: number;
  question: QuestionSpec;
  value: string | string[] | undefined;
  noteValue: string;
  onChange: (next: string | string[]) => void;
  onNoteChange?: (text: string) => void;
}) {
  const options = question.options ?? [];
  const hasOptions =
    (question.type === "select" || question.type === "multiselect") &&
    options.length > 0;
  const [focused, setFocused] = useState(0);
  const optionRefs = useRef<(HTMLLabelElement | null)[]>([]);

  // Reset focused index when question changes
  useEffect(() => {
    setFocused(0);
  }, [question.id]);

  // Keyboard navigation within options
  const handleOptionsKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasOptions) return;

      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocused((f) => {
          const next = Math.min(f + 1, options.length - 1);
          optionRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocused((f) => {
          const next = Math.max(f - 1, 0);
          optionRefs.current[next]?.scrollIntoView({ block: "nearest" });
          return next;
        });
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const opt = options[focused];
        if (!opt) return;

        if (question.type === "select") {
          onChange(opt);
        } else {
          // multiselect toggle
          const sel = Array.isArray(value) ? value : [];
          if (sel.includes(opt)) {
            onChange(sel.filter((s) => s !== opt));
          } else {
            onChange([...sel, opt]);
          }
        }
      }
    },
    [hasOptions, options, focused, question.type, value, onChange],
  );

  const containerStyle: React.CSSProperties = {
    padding: "12px 14px",
    borderRadius: 8,
    backgroundColor: "var(--cc-brand-softer)",
    border: "1px solid var(--cc-brand-alpha-20)",
  };

  const inputBaseStyle: React.CSSProperties = {
    width: "100%",
    padding: "8px 12px",
    fontSize: 13,
    fontFamily: FONT,
    backgroundColor: "var(--cc-surface)",
    border: `1px solid ${BORDER}`,
    borderRadius: 6,
    outline: "none",
    color: "var(--cc-text-primary)",
    boxSizing: "border-box",
    transition: "border-color 150ms ease",
  };

  const label = (
    <div
      style={{
        fontSize: 13,
        color: "var(--cc-text-primary)",
        lineHeight: 1.5,
        marginBottom: 8,
        fontWeight: 500,
      }}
    >
      <span style={{ color: ACCENT, marginRight: 6, fontWeight: 700 }}>
        {index + 1}.
      </span>
      {question.prompt}
      {question.required && (
        <span style={{ color: ACCENT, marginLeft: 4 }}>*</span>
      )}
    </div>
  );

  // ── Text input ──
  if (question.type === "text") {
    return (
      <div style={containerStyle}>
        {label}
        <input
          type="text"
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? "Your answer..."}
          style={inputBaseStyle}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = ACCENT;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = BORDER;
          }}
        />
      </div>
    );
  }

  // ── Multiline input ──
  if (question.type === "multiline") {
    return (
      <div style={containerStyle}>
        {label}
        <textarea
          value={typeof value === "string" ? value : ""}
          onChange={(e) => onChange(e.target.value)}
          placeholder={question.placeholder ?? "Your answer..."}
          rows={3}
          style={{
            ...inputBaseStyle,
            minHeight: 60,
            maxHeight: 160,
            resize: "vertical",
            lineHeight: 1.4,
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = ACCENT;
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = BORDER;
          }}
        />
      </div>
    );
  }

  // ── Select / Multiselect with keyboard nav + notes ──
  const isSelect = question.type === "select";
  const selected = isSelect
    ? typeof value === "string"
      ? value
      : ""
    : Array.isArray(value)
    ? value
    : [];

  return (
    <div style={containerStyle}>
      {label}
      {/* Options list — keyboard navigable */}
      <div
        role="listbox"
        tabIndex={0}
        onKeyDown={handleOptionsKeyDown}
        style={{
          display: "flex",
          flexDirection: "column",
          gap: 4,
          outline: "none",
        }}
      >
        {options.map((opt, i) => {
          const isChecked = isSelect
            ? selected === opt
            : (selected as string[]).includes(opt);
          const isFocused = i === focused;

          return (
            <label
              key={opt}
              ref={(el) => { optionRefs.current[i] = el; }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                padding: "8px 10px",
                fontSize: 13,
                backgroundColor: isChecked
                  ? "var(--cc-surface)"
                  : isFocused
                  ? "var(--cc-brand-alpha-04)"
                  : "transparent",
                border: isChecked
                  ? `1px solid ${ACCENT}`
                  : isFocused
                  ? "1px solid var(--cc-brand-alpha-30)"
                  : `1px solid ${BORDER}`,
                borderRadius: 6,
                cursor: "pointer",
                color: "var(--cc-text-primary)",
                transition: "all 100ms ease",
              }}
              onClick={() => {
                setFocused(i);
                if (isSelect) {
                  onChange(opt);
                } else {
                  const sel = selected as string[];
                  if (sel.includes(opt)) {
                    onChange(sel.filter((s) => s !== opt));
                  } else {
                    onChange([...sel, opt]);
                  }
                }
              }}
            >
              <input
                type={isSelect ? "radio" : "checkbox"}
                name={question.id}
                checked={isChecked}
                onChange={() => {}}
                onClick={(e) => e.stopPropagation()}
                tabIndex={-1}
                style={{ accentColor: ACCENT, pointerEvents: "none" }}
              />
              <span style={{ flex: 1 }}>{opt}</span>
              {isFocused && (
                <span
                  style={{
                    fontSize: 10,
                    color: "var(--cc-brand-alpha-40)",
                    fontFamily: FONT_SG,
                  }}
                >
                  {isChecked ? "" : "Enter to select"}
                </span>
              )}
            </label>
          );
        })}
      </div>

      {/* Notes — always visible */}
      {onNoteChange && (
        <div style={{ marginTop: 8 }}>
          <textarea
            value={noteValue}
            onChange={(e) => onNoteChange(e.target.value)}
            placeholder="Notes (optional) — add context or type your own answer..."
            rows={2}
            style={{
              ...inputBaseStyle,
              minHeight: 44,
              maxHeight: 100,
              resize: "vertical",
              lineHeight: 1.4,
              fontSize: 12,
              color: "var(--cc-text-secondary)",
            }}
            onFocus={(e) => {
              e.currentTarget.style.borderColor = ACCENT;
              e.currentTarget.style.color = "var(--cc-text-primary)";
            }}
            onBlur={(e) => {
              e.currentTarget.style.borderColor = BORDER;
              if (!e.currentTarget.value) {
                e.currentTarget.style.color = "var(--cc-text-secondary)";
              }
            }}
          />
        </div>
      )}
    </div>
  );
}
