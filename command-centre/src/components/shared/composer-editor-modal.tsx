"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Maximize2, Minimize2, X } from "lucide-react";
import styles from "./composer-editor-modal.module.css";

export function EditorExpandButton({
  expanded,
  onClick,
  disabled = false,
  placement = "inline",
}: {
  expanded: boolean;
  onClick: () => void;
  disabled?: boolean;
  placement?: "inline" | "modal";
}) {
  const label = expanded ? "Collapse editor" : "Expand editor";
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={`${styles.ghostButton} ${placement === "modal" ? styles.expandButton : styles.inlineExpandButton}`}
    >
      {expanded ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
    </button>
  );
}

export function ComposerEditorModal({
  title,
  initialExpanded,
  closeLabel,
  submitLabel = "Send",
  submittingLabel = "Sending...",
  submitting = false,
  submitDisabled = false,
  onClose,
  onSubmit,
  leading,
  editor,
  toolbar,
  error,
  escapeDisabled = false,
}: {
  title: string;
  initialExpanded: boolean;
  closeLabel?: string;
  submitLabel?: string;
  submittingLabel?: string;
  submitting?: boolean;
  submitDisabled?: boolean;
  onClose: () => void;
  onSubmit: () => void;
  leading?: ReactNode;
  editor: ReactNode;
  toolbar?: ReactNode;
  error?: ReactNode;
  escapeDisabled?: boolean;
}) {
  const [expanded, setExpanded] = useState(initialExpanded);
  const pointerStartedOnBackdrop = useRef(false);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.key !== "Escape"
        || event.defaultPrevented
        || submitting
        || escapeDisabled
        || document.querySelector('[data-composer-popover-open="true"]')
      ) return;
      event.preventDefault();
      onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [escapeDisabled, onClose, submitting]);

  return createPortal(
    <div
      className={styles.overlay}
    >
      <div
        aria-hidden="true"
        className={styles.backdrop}
        style={{ backdropFilter: "blur(12px)", WebkitBackdropFilter: "blur(12px)" }}
        onMouseDown={(event) => {
          event.stopPropagation();
          pointerStartedOnBackdrop.current = true;
        }}
        onClick={(event) => {
          event.stopPropagation();
          if (!submitting && pointerStartedOnBackdrop.current) onClose();
          pointerStartedOnBackdrop.current = false;
        }}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`${styles.modal} ${expanded ? styles.expanded : ""}`}
        onPointerDown={(event) => event.stopPropagation()}
        onMouseDown={(event) => event.stopPropagation()}
        onClick={(event) => event.stopPropagation()}
      >
        <div className={styles.header}>
          <span className={styles.title}>{title}</span>
          <button
            type="button"
            aria-label="Close"
            title="Close"
            onClick={onClose}
            disabled={submitting}
            className={styles.ghostButton}
          >
            <X size={16} />
          </button>
        </div>

        <div className={styles.body}>
          <div className={styles.editorFrame}>
            {leading}
            <div className={styles.editorArea}>
              <div className={styles.editorContent}>{editor}</div>
              <EditorExpandButton
                expanded={expanded}
                onClick={() => setExpanded((current) => !current)}
                disabled={submitting}
                placement="modal"
              />
            </div>
            {toolbar}
          </div>
          {error ? <div className={styles.error}>{error}</div> : null}
        </div>

        <div className={styles.footer}>
          {closeLabel ? (
            <button type="button" onClick={onClose} disabled={submitting} className={styles.secondaryButton}>
              {closeLabel}
            </button>
          ) : null}
          <button
            type="button"
            onClick={onSubmit}
            disabled={submitting || submitDisabled}
            className={styles.primaryButton}
          >
            {submitting ? submittingLabel : submitLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
