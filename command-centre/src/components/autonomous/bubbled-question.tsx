"use client";

import { useState, useRef, useEffect, useCallback, useMemo } from "react";
import { MessageCircleQuestion, Send, ChevronLeft, ChevronRight, Paperclip } from "lucide-react";
import type { Message } from "@/types/chat";
import type { ChatAttachment } from "@/types/chat-composer";
import type { QuestionSpec, QuestionAnswers } from "@/types/question-spec";
import { areAnswersComplete, serializeAnswersToProse } from "@/types/question-spec";
import { ChatAttachmentStrip } from "@/components/shared/chat-attachment-strip";
import { ComposerAssetTray } from "@/components/shared/composer-asset-tray";
import { useChatComposer } from "@/hooks/use-chat-composer";
import {
  insertTextareaNewline,
  shouldInsertModifierNewline,
  shouldSubmitOnPlainEnter,
  syncComposerTextareaHeight,
} from "@/lib/composer";

const FONT = "var(--font-inter), Inter, sans-serif";
const FONT_SG = "var(--font-space-grotesk), Space Grotesk, sans-serif";
const ACCENT = "var(--cc-brand-primary)";

type NotesMap = Record<string, string>;

/** Merge answer selections + notes into the final answers for submission. */
function buildMergedAnswers(
  specs: QuestionSpec[],
  answers: QuestionAnswers,
  notes: NotesMap,
): QuestionAnswers {
  const merged: QuestionAnswers = {};
  for (const q of specs) {
    const note = notes[q.id]?.trim() ?? "";
    const raw = answers[q.id];
    if (q.type === "select") {
      const sel = typeof raw === "string" ? raw : "";
      if (sel && note) merged[q.id] = `${sel} (Notes: ${note})`;
      else if (note) merged[q.id] = note;
      else merged[q.id] = sel;
    } else if (q.type === "multiselect") {
      const sel = Array.isArray(raw) ? raw : [];
      merged[q.id] = note ? [...sel, note] : sel;
    } else {
      merged[q.id] = raw;
    }
  }
  return merged;
}

interface BubbledQuestionProps {
  message: Message;
  onReply: (messageId: string, content: string, attachments?: ChatAttachment[]) => void;
}

export function BubbledQuestion({ message, onReply }: BubbledQuestionProps) {
  const specs = message.metadata?.questionSpecs;
  const hasStructured = specs && specs.length > 0;

  if (hasStructured) {
    return <StructuredBubble message={message} specs={specs} onReply={onReply} />;
  }

  return <PlainBubble message={message} onReply={onReply} />;
}

// ── Structured question bubble with stepped interaction ─────────────────

function StructuredBubble({
  message,
  specs,
  onReply,
}: {
  message: Message;
  specs: QuestionSpec[];
  onReply: (messageId: string, content: string, attachments?: ChatAttachment[]) => void;
}) {
  const [answers, setAnswers] = useState<QuestionAnswers>(() => {
    const init: QuestionAnswers = {};
    for (const q of specs) {
      init[q.id] = q.type === "multiselect" ? [] : "";
    }
    return init;
  });
  const [notes, setNotes] = useState<NotesMap>({});
  const [submitted, setSubmitted] = useState(false);
  const [step, setStep] = useState(0);

  const useStepper = specs.length > 1;
  const total = specs.length;
  const q = specs[step];
  const isFirst = step === 0;
  const isLast = step === total - 1;

  const mergedAnswers = useMemo(
    () => buildMergedAnswers(specs, answers, notes),
    [specs, answers, notes],
  );

  const canSubmit = areAnswersComplete(specs, mergedAnswers) && !submitted;

  const handleSubmit = useCallback(() => {
    if (!canSubmit) return;
    setSubmitted(true);
    const prose = serializeAnswersToProse(specs, mergedAnswers);
    onReply(message.id, prose);
  }, [canSubmit, specs, mergedAnswers, message.id, onReply]);

  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (useStepper) containerRef.current?.focus();
  }, [step, useStepper]);

  const handleContainerKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!useStepper) return;
      const target = e.target as HTMLElement;
      const isInput = target.tagName === "INPUT" || target.tagName === "TEXTAREA";
      if (!isInput) {
        if (e.key === "ArrowRight" && !isLast) {
          e.preventDefault();
          setStep((s) => s + 1);
        } else if (e.key === "ArrowLeft" && !isFirst) {
          e.preventDefault();
          setStep((s) => s - 1);
        }
      }
    },
    [useStepper, isFirst, isLast],
  );

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      onKeyDown={handleContainerKeyDown}
      style={{
        border: "1px solid var(--cc-line-alpha-30)",
        borderRadius: 10,
        padding: "12px 14px",
        backgroundColor: "var(--cc-brand-alpha-04)",
        maxWidth: 480,
        outline: "none",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
        <MessageCircleQuestion size={13} style={{ color: "var(--cc-status-warning-soft)" }} />
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            fontFamily: FONT_SG,
            textTransform: "uppercase",
            letterSpacing: "0.06em",
            color: "var(--cc-status-warning-soft)",
          }}
        >
          Needs your input
        </span>
      </div>

      {/* Progress dots (stepper mode) */}
      {useStepper && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 10 }}>
          <div style={{ display: "flex", gap: 3 }}>
            {specs.map((_, i) => (
              <button
                key={i}
                type="button"
                onClick={() => !submitted && setStep(i)}
                style={{
                  width: i === step ? 14 : 5,
                  height: 5,
                  borderRadius: 3,
                  border: "none",
                  backgroundColor: i === step ? ACCENT : "var(--cc-brand-alpha-20)",
                  cursor: submitted ? "default" : "pointer",
                  padding: 0,
                  transition: "all 200ms ease",
                }}
              />
            ))}
          </div>
          <span style={{ fontSize: 10, fontFamily: FONT_SG, color: "var(--cc-text-tertiary)" }}>
            {step + 1} of {total}
          </span>
        </div>
      )}

      {/* Questions */}
      {useStepper ? (
        <ChipQuestionField
          key={q.id}
          index={step}
          question={q}
          value={answers[q.id]}
          noteValue={notes[q.id] ?? ""}
          onChange={(v) => setAnswers((a) => ({ ...a, [q.id]: v }))}
          onNoteChange={(t) => setNotes((n) => ({ ...n, [q.id]: t }))}
          disabled={submitted}
        />
      ) : (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {specs.map((spec, i) => (
            <ChipQuestionField
              key={spec.id}
              index={i}
              question={spec}
              value={answers[spec.id]}
              noteValue={notes[spec.id] ?? ""}
              onChange={(v) => setAnswers((a) => ({ ...a, [spec.id]: v }))}
              onNoteChange={(t) => setNotes((n) => ({ ...n, [spec.id]: t }))}
              disabled={submitted}
            />
          ))}
        </div>
      )}

      {/* Navigation (stepper) or submit (single) */}
      {!submitted && useStepper && (
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginTop: 10 }}>
          <button
            type="button"
            onClick={() => setStep((s) => s - 1)}
            disabled={isFirst}
            style={{
              display: "flex",
              alignItems: "center",
              gap: 2,
              fontSize: 11,
              fontFamily: FONT_SG,
              fontWeight: 500,
              color: isFirst ? "var(--cc-control-border)" : "var(--cc-text-tertiary)",
              background: "none",
              border: "none",
              cursor: isFirst ? "default" : "pointer",
              padding: "2px 0",
            }}
          >
            <ChevronLeft size={12} />
            Prev
          </button>

          {isLast ? (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={!canSubmit}
              style={{
                padding: "5px 12px",
                fontSize: 12,
                fontWeight: 600,
                border: "none",
                borderRadius: 6,
                backgroundColor: canSubmit ? ACCENT : "var(--cc-brand-alpha-15)",
                color: canSubmit ? "var(--cc-surface)" : "var(--cc-text-tertiary)",
                cursor: canSubmit ? "pointer" : "default",
                fontFamily: FONT_SG,
              }}
            >
              Reply
            </button>
          ) : (
            <button
              type="button"
              onClick={() => setStep((s) => s + 1)}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 2,
                fontSize: 11,
                fontFamily: FONT_SG,
                fontWeight: 500,
                color: ACCENT,
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "2px 0",
              }}
            >
              Next
              <ChevronRight size={12} />
            </button>
          )}
        </div>
      )}

      {/* Submit for non-stepper */}
      {!submitted && !useStepper && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginTop: 10 }}>
          <button
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              padding: "6px 14px",
              fontSize: 12,
              fontWeight: 600,
              border: "none",
              borderRadius: 6,
              backgroundColor: canSubmit ? ACCENT : "var(--cc-brand-alpha-15)",
              color: canSubmit ? "var(--cc-surface)" : "var(--cc-text-tertiary)",
              cursor: canSubmit ? "pointer" : "default",
              fontFamily: FONT_SG,
            }}
          >
            Reply
          </button>
        </div>
      )}

      {submitted && (
        <div style={{ marginTop: 8, fontSize: 11, fontFamily: FONT_SG, color: "var(--cc-status-success-strong)", fontWeight: 500 }}>
          Answers submitted
        </div>
      )}
    </div>
  );
}

// ── Chip-based question field with keyboard nav + notes ─────────────────

function ChipQuestionField({
  index,
  question,
  value,
  noteValue,
  onChange,
  onNoteChange,
  disabled,
}: {
  index: number;
  question: QuestionSpec;
  value: string | string[] | undefined;
  noteValue: string;
  onChange: (next: string | string[]) => void;
  onNoteChange: (text: string) => void;
  disabled: boolean;
}) {
  const options = question.options ?? [];
  const hasOptions =
    (question.type === "select" || question.type === "multiselect") && options.length > 0;
  const [focused, setFocused] = useState(0);

  useEffect(() => {
    setFocused(0);
  }, [question.id]);

  const handleOptionsKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (!hasOptions || disabled) return;
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setFocused((f) => Math.min(f + 1, options.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setFocused((f) => Math.max(f - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        const opt = options[focused];
        if (!opt) return;
        if (question.type === "select") {
          onChange(opt);
        } else {
          const sel = Array.isArray(value) ? value : [];
          if (sel.includes(opt)) onChange(sel.filter((s) => s !== opt));
          else onChange([...sel, opt]);
        }
      }
    },
    [hasOptions, disabled, options, focused, question.type, value, onChange],
  );

  const label = (
    <div style={{ fontSize: 12, color: "var(--cc-text-primary)", lineHeight: 1.4, marginBottom: 6, fontWeight: 500, fontFamily: FONT }}>
      <span style={{ color: ACCENT, marginRight: 4, fontWeight: 700 }}>{index + 1}.</span>
      {question.prompt}
      {question.required && <span style={{ color: ACCENT, marginLeft: 3 }}>*</span>}
    </div>
  );

  // Text / multiline — render as inline input, no notes
  if (question.type === "text" || question.type === "multiline") {
    const isMultiline = question.type === "multiline";
    return (
      <div>
        {label}
        {isMultiline ? (
          <textarea
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? "Your answer..."}
            disabled={disabled}
            rows={2}
            style={{
              width: "100%", padding: "6px 10px", fontSize: 12, fontFamily: FONT,
              border: "1px solid var(--cc-line-alpha-30)", borderRadius: 6, outline: "none",
              backgroundColor: "var(--cc-surface)", resize: "vertical", lineHeight: 1.4,
              minHeight: 40, maxHeight: 100, boxSizing: "border-box", color: "var(--cc-text-primary)",
            }}
          />
        ) : (
          <input
            type="text"
            value={typeof value === "string" ? value : ""}
            onChange={(e) => onChange(e.target.value)}
            placeholder={question.placeholder ?? "Your answer..."}
            disabled={disabled}
            style={{
              width: "100%", padding: "6px 10px", fontSize: 12, fontFamily: FONT,
              border: "1px solid var(--cc-line-alpha-30)", borderRadius: 6, outline: "none",
              backgroundColor: "var(--cc-surface)", color: "var(--cc-text-primary)", boxSizing: "border-box",
            }}
          />
        )}
      </div>
    );
  }

  // Select / multiselect — chips with keyboard nav + always-visible notes
  const isSelect = question.type === "select";
  const selected = isSelect
    ? typeof value === "string" ? value : ""
    : Array.isArray(value) ? value : [];

  return (
    <div>
      {label}
      {/* Chip options — keyboard navigable */}
      <div
        role="listbox"
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleOptionsKeyDown}
        style={{ display: "flex", flexWrap: "wrap", gap: 6, outline: "none" }}
      >
        {options.map((opt, i) => {
          const isChecked = isSelect ? selected === opt : (selected as string[]).includes(opt);
          const isFocused = i === focused;
          return (
            <button
              key={opt}
              type="button"
              disabled={disabled}
              onClick={() => {
                setFocused(i);
                if (isSelect) {
                  onChange(opt);
                } else {
                  const sel = selected as string[];
                  if (sel.includes(opt)) onChange(sel.filter((s) => s !== opt));
                  else onChange([...sel, opt]);
                }
              }}
              style={{
                padding: "6px 12px",
                fontSize: 12,
                fontFamily: FONT,
                fontWeight: isChecked ? 600 : 400,
                backgroundColor: isChecked ? ACCENT : "var(--cc-surface)",
                color: isChecked ? "var(--cc-surface)" : "var(--cc-text-primary)",
                border: isChecked
                  ? `1px solid ${ACCENT}`
                  : isFocused
                  ? "1px solid var(--cc-brand-alpha-40)"
                  : "1px solid var(--cc-line-alpha-40)",
                borderRadius: 16,
                cursor: disabled ? "default" : "pointer",
                transition: "all 120ms ease",
                opacity: disabled ? 0.6 : 1,
                outline: isFocused && !isChecked ? "1px solid var(--cc-brand-alpha-20)" : "none",
                outlineOffset: 1,
              }}
            >
              {opt}
            </button>
          );
        })}
      </div>

      {/* Notes — always visible */}
      <textarea
        value={noteValue}
        onChange={(e) => onNoteChange(e.target.value)}
        placeholder="Notes (optional)..."
        disabled={disabled}
        rows={1}
        style={{
          width: "100%",
          marginTop: 8,
          padding: "6px 10px",
          fontSize: 11,
          fontFamily: FONT,
          border: "1px solid var(--cc-line-alpha-25)",
          borderRadius: 6,
          outline: "none",
          backgroundColor: "var(--cc-surface)",
          color: "var(--cc-text-secondary)",
          boxSizing: "border-box" as const,
          resize: "none",
          lineHeight: 1.4,
          minHeight: 32,
        }}
        onFocus={(e) => {
          e.currentTarget.style.borderColor = "var(--cc-brand-alpha-40)";
          e.currentTarget.style.color = "var(--cc-text-primary)";
        }}
        onBlur={(e) => {
          e.currentTarget.style.borderColor = "var(--cc-line-alpha-25)";
          if (!e.currentTarget.value) e.currentTarget.style.color = "var(--cc-text-secondary)";
        }}
      />
    </div>
  );
}

// ── Plain text question bubble (fallback) ───────────────────────────────

function PlainBubble({
  message,
  onReply,
}: {
  message: Message;
  onReply: (messageId: string, content: string, attachments?: ChatAttachment[]) => void;
}) {
  const [showReply, setShowReply] = useState(false);
  const composer = useChatComposer({
    surface: "question",
    scopeId: message.id,
  });
  const maxHeight = 120;
  const hasAssets = composer.attachments.length > 0 || composer.uploads.length > 0;

  const taskTitle = message.metadata?.questionText || message.content;

  useEffect(() => {
    if (!showReply) return;
    syncComposerTextareaHeight(composer.textareaRef.current, { maxHeight });
  }, [composer.message, composer.textareaRef, showReply]);

  const handleSend = useCallback(() => {
    const submission = composer.buildSubmission();
    if (!submission.message && submission.attachments.length === 0) return;

    onReply(message.id, submission.message, submission.attachments);
    composer.clearComposer();
    setShowReply(false);
  }, [composer, message.id, onReply]);

  return (
    <div style={{
      border: "1px solid var(--cc-line-alpha-30)",
      borderRadius: 10,
      padding: "12px 14px",
      backgroundColor: "var(--cc-brand-alpha-04)",
      maxWidth: 480,
    }}>
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 6,
        marginBottom: 6,
      }}>
        <MessageCircleQuestion size={13} style={{ color: "var(--cc-status-warning-soft)" }} />
        <span style={{
          fontSize: 10,
          fontWeight: 600,
          fontFamily: FONT_SG,
          textTransform: "uppercase",
          letterSpacing: "0.06em",
          color: "var(--cc-status-warning-soft)",
        }}>
          Needs your input
        </span>
      </div>

      <p style={{
        fontSize: 13,
        fontFamily: FONT,
        color: "var(--cc-text-primary)",
        lineHeight: 1.5,
        margin: "0 0 8px",
      }}>
        {taskTitle}
      </p>

      {!showReply ? (
        <button
          onClick={() => setShowReply(true)}
          style={{
            fontSize: 12,
            fontFamily: FONT_SG,
            fontWeight: 500,
            color: ACCENT,
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
          }}
        >
          Reply to this &darr;
        </button>
      ) : (
        <div
          onDragEnter={composer.handleDragEnter}
          onDragOver={composer.handleDragOver}
          onDragLeave={composer.handleDragLeave}
          onDrop={composer.handleDrop}
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            marginTop: 4,
            border: composer.isDragging ? "1px solid var(--cc-brand-alpha-25)" : "none",
            borderRadius: 8,
            padding: composer.isDragging ? 6 : 0,
          }}
        >
          {hasAssets ? (
            <ComposerAssetTray compact>
              <ChatAttachmentStrip
                attachments={composer.attachments}
                uploads={composer.uploads}
                onRemoveAttachment={(attachment) => { void composer.removeAttachment(attachment); }}
                onRetryUpload={(uploadId) => { void composer.retryUpload(uploadId); }}
                onRemoveUpload={composer.removeUpload}
                compact
                padding="0"
              />
            </ComposerAssetTray>
          ) : null}
          <div style={{ display: "flex", alignItems: "flex-end", gap: 6 }}>
          <textarea
            ref={composer.textareaRef}
            value={composer.message}
            onChange={(e) => composer.setMessage(e.target.value)}
            onKeyDown={(e) => {
              if (shouldInsertModifierNewline(e)) {
                e.preventDefault();
                insertTextareaNewline(e.currentTarget, composer.setMessage);
                return;
              }
              if (shouldSubmitOnPlainEnter(e)) {
                e.preventDefault();
                handleSend();
              }
            }}
            onPaste={composer.handlePaste}
            placeholder="Type your reply..."
            rows={1}
            autoFocus
            style={{
              flex: 1,
              border: "1px solid var(--cc-line-alpha-30)",
              borderRadius: 6,
              padding: "6px 10px",
              fontSize: 12,
              fontFamily: FONT,
              outline: "none",
              backgroundColor: "var(--cc-surface)",
              resize: "none",
              lineHeight: 1.5,
              minHeight: 32,
              maxHeight,
              overflowY: "hidden",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!composer.message.trim() && composer.attachments.length === 0}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 28,
              height: 28,
              borderRadius: 6,
              border: "none",
              backgroundColor: composer.message.trim() || composer.attachments.length > 0 ? ACCENT : "var(--cc-brand-alpha-15)",
              color: composer.message.trim() || composer.attachments.length > 0 ? "var(--cc-surface)" : "var(--cc-text-tertiary)",
              cursor: composer.message.trim() || composer.attachments.length > 0 ? "pointer" : "default",
            }}
          >
            <Send size={12} />
          </button>
        </div>
          <input
            ref={composer.fileInputRef}
            type="file"
            multiple
            onChange={composer.handleFileInputChange}
            style={{ display: "none" }}
            accept={composer.accept}
          />
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button
              type="button"
              onClick={composer.openFilePicker}
              disabled={composer.isUploading}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                border: "none",
                background: "transparent",
                color: composer.isUploading ? "var(--cc-text-disabled)" : "var(--cc-text-tertiary)",
                cursor: composer.isUploading ? "not-allowed" : "pointer",
                padding: 0,
                fontSize: 11,
                fontFamily: FONT_SG,
              }}
            >
              <Paperclip size={12} />
              Attach
            </button>
            {composer.hasDraft && (
              <button
                type="button"
                onClick={() => { void composer.discardDraft(); }}
                style={{
                  border: "none",
                  background: "transparent",
                  color: "var(--cc-text-tertiary)",
                  cursor: "pointer",
                  padding: 0,
                  fontSize: 11,
                  fontFamily: FONT_SG,
                }}
              >
                Discard draft
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
