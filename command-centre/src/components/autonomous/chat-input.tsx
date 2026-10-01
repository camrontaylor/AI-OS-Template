"use client";

import { useCallback, useEffect, useState, KeyboardEvent } from "react";
import { Paperclip, Send } from "lucide-react";
import { PermissionPicker } from "@/components/shared/permission-picker";
import { ModelPicker } from "@/components/shared/model-picker";
import { ThinkingEffortPicker } from "@/components/shared/thinking-effort-picker";
import { ComposerAssetTray } from "@/components/shared/composer-asset-tray";
import { ComposerDraftAssetCollection } from "@/components/shared/composer-draft-asset-collection";
import { useChatComposer } from "@/hooks/use-chat-composer";
import { useComposerResize } from "@/hooks/use-composer-resize";
import type { PermissionMode, ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import type { ChatAttachment } from "@/types/chat-composer";
import { insertTextareaNewline, shouldInsertModifierNewline, shouldSubmitOnPlainEnter, syncComposerTextareaHeight } from "@/lib/composer";
import { getChatAttachmentExtension } from "@/lib/chat-attachment-policy";
import { normalizeClaudeThinkingEffortForModel } from "@/lib/claude-options";
import {
  DEFAULT_CLAUDE_LLM_PREFERENCE,
  loadClaudeLlmPreference,
  saveClaudeLlmPreference,
} from "@/lib/llm-preferences";

interface ChatInputProps {
  scopeId?: string | null;
  onSend: (
    message: string,
    options: {
      permissionMode: PermissionMode;
      model: ClaudeModel | null;
      thinkingEffort: ClaudeThinkingEffort | null;
      attachments: ChatAttachment[];
    },
  ) => void;
  disabled?: boolean;
  placeholder?: string;
}

export function ChatInput({ scopeId, onSend, disabled, placeholder }: ChatInputProps) {
  const [permissionMode, setPermissionMode] = useState<PermissionMode>("bypassPermissions");
  const [model, setModel] = useState<ClaudeModel | null>(DEFAULT_CLAUDE_LLM_PREFERENCE.model);
  const [thinkingEffort, setThinkingEffort] = useState<ClaudeThinkingEffort | null>(
    DEFAULT_CLAUDE_LLM_PREFERENCE.reasoningEffort,
  );
  const composer = useChatComposer({
    surface: "conversation",
    scopeId,
  });
  const minHeight = 60;
  const maxHeight = 320;
  const { composerHeight, hasUserResized, handleResizePointerDown } = useComposerResize({
    minHeight,
    maxHeight,
    initialHeight: minHeight,
  });
  const hasAssets = composer.attachments.length > 0 || composer.uploads.length > 0 || composer.pastedBlocks.length > 0;
  const canSend =
    !disabled &&
    (
      composer.message.trim().length > 0 ||
      composer.attachments.length > 0 ||
      composer.pastedBlocks.length > 0
    );

  useEffect(() => {
    syncComposerTextareaHeight(composer.textareaRef.current, {
      minHeight,
      maxHeight,
      targetHeight: hasUserResized ? composerHeight : null,
    });
  }, [composer.message, composer.textareaRef, composerHeight, hasUserResized, maxHeight, minHeight]);

  useEffect(() => {
    const preference = loadClaudeLlmPreference();
    setModel(preference.model);
    setThinkingEffort(preference.reasoningEffort);
  }, []);

  const handleSend = useCallback(() => {
    const submission = composer.buildSubmission();
    if ((!submission.message && submission.attachments.length === 0) || disabled) return;

    onSend(submission.message, {
      permissionMode,
      model,
      thinkingEffort,
      attachments: submission.attachments,
    });
    composer.clearComposer();
  }, [composer, disabled, model, onSend, permissionMode, thinkingEffort]);

  const handleModelChange = useCallback((nextModel: ClaudeModel | null) => {
    const nextThinkingEffort =
      normalizeClaudeThinkingEffortForModel(nextModel, thinkingEffort ?? "auto") ?? "auto";
    setModel(nextModel);
    setThinkingEffort(nextThinkingEffort);
    saveClaudeLlmPreference({
      model: nextModel,
      reasoningEffort: nextThinkingEffort,
    });
  }, [thinkingEffort]);

  const handleThinkingEffortChange = useCallback((nextThinkingEffort: ClaudeThinkingEffort) => {
    const normalizedThinkingEffort =
      normalizeClaudeThinkingEffortForModel(model, nextThinkingEffort) ?? "auto";
    setThinkingEffort(normalizedThinkingEffort);
    saveClaudeLlmPreference({
      model: model ?? undefined,
      reasoningEffort: normalizedThinkingEffort,
    });
  }, [model]);

  const handleKeyDown = useCallback((event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (shouldInsertModifierNewline(event)) {
      event.preventDefault();
      insertTextareaNewline(event.currentTarget, composer.setMessage);
      return;
    }
    if (shouldSubmitOnPlainEnter(event)) {
      event.preventDefault();
      handleSend();
    }
  }, [composer.setMessage, handleSend]);

  return (
    <div
      onDragEnter={composer.handleDragEnter}
      onDragOver={composer.handleDragOver}
      onDragLeave={composer.handleDragLeave}
      onDrop={composer.handleDrop}
      style={{
        padding: "12px 16px",
        borderTop: "1px solid var(--cc-line-alpha-15)",
        backgroundColor: "var(--cc-surface)",
      }}
    >
      <div style={{
        backgroundColor: "var(--cc-surface-muted)",
        borderRadius: 12,
        border: composer.isDragging ? "1px solid var(--cc-brand-alpha-45)" : "1px solid var(--cc-line-alpha-20)",
        boxShadow: composer.isDragging ? "0 0 0 3px var(--cc-brand-alpha-08)" : "none",
        transition: "border-color 150ms ease, box-shadow 150ms ease",
      }}>
        <div style={{ display: "flex", justifyContent: "center", padding: "8px 12px 0" }}>
          <button
            type="button"
            aria-label="Drag to resize input"
            onPointerDown={handleResizePointerDown}
            style={{
              width: 44,
              height: 8,
              border: "none",
              borderRadius: 999,
              backgroundColor: "var(--cc-line-alpha-30)",
              cursor: "ns-resize",
            }}
          />
        </div>

        {hasAssets ? (
          <ComposerAssetTray>
            <ComposerDraftAssetCollection
              pastedBlocks={composer.pastedBlocks}
              attachmentItems={[
                ...composer.attachments.map((attachment) => ({
                  id: attachment.id,
                  fileName: attachment.fileName,
                  extension: attachment.extension,
                  sizeBytes: attachment.sizeBytes,
                  contentType: attachment.contentType ?? null,
                  previewPath: attachment.relativePath,
                  previewSurface: attachment.surface,
                  previewScopeId: attachment.scopeId,
                  status: "ready" as const,
                })),
                ...composer.uploads.map((upload) => ({
                  id: upload.id,
                  fileName: upload.fileName,
                  extension: getChatAttachmentExtension(upload.fileName),
                  status: upload.status,
                  error: upload.error,
                })),
              ]}
              padding="0"
              onInsertPastedBlock={composer.insertPastedTextBlock}
              onRemovePastedBlock={composer.removePastedTextBlock}
              onRemoveAttachmentItem={(itemId) => {
                const attachment = composer.attachments.find((candidate) => candidate.id === itemId);
                if (attachment) {
                  void composer.removeAttachment(attachment);
                  return;
                }
                composer.removeUpload(itemId);
              }}
              onRetryAttachmentItem={(itemId) => { void composer.retryUpload(itemId); }}
            />
          </ComposerAssetTray>
        ) : null}

        <div style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 8,
          padding: "8px 12px",
          minWidth: 0,
        }}>
          <textarea
            ref={composer.textareaRef}
            value={composer.message}
            onChange={(event) => composer.setMessage(event.target.value)}
            onKeyDown={handleKeyDown}
            onPaste={composer.handlePaste}
            placeholder={placeholder || "Type a message..."}
            disabled={disabled}
            rows={1}
            style={{
              flex: 1,
              border: "none",
              background: "transparent",
              resize: "none",
              outline: "none",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 14,
              lineHeight: "20px",
              color: "var(--cc-text-primary)",
              boxSizing: "border-box" as const,
              minHeight,
              maxHeight: hasUserResized ? composerHeight : maxHeight,
              maxWidth: "100%",
              whiteSpace: "pre-wrap",
              overflowWrap: "anywhere",
              wordBreak: "break-word",
              overflowX: "hidden",
              overflowY: "auto",
              padding: "2px 0",
            }}
          />
          <button
            onClick={handleSend}
            disabled={!canSend}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              width: 32,
              height: 32,
              borderRadius: 8,
              border: "none",
              backgroundColor: canSend ? "var(--cc-brand-primary)" : "var(--cc-brand-alpha-15)",
              color: canSend ? "var(--cc-surface)" : "var(--cc-text-tertiary)",
              cursor: canSend ? "pointer" : "default",
              flexShrink: 0,
              transition: "all 120ms ease",
            }}
          >
            <Send size={16} />
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

        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 2,
          padding: "4px 8px 6px",
          borderTop: "1px solid var(--cc-line-alpha-15)",
        }}>
          <button
            type="button"
            onClick={composer.openFilePicker}
            disabled={composer.isUploading || !scopeId}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              padding: "4px 6px",
              border: "none",
              borderRadius: 5,
              backgroundColor: "transparent",
              color: composer.isUploading || !scopeId ? "var(--cc-text-disabled)" : "var(--cc-text-secondary)",
              cursor: composer.isUploading || !scopeId ? "not-allowed" : "pointer",
            }}
            onMouseEnter={(event) => { if (!composer.isUploading && scopeId) event.currentTarget.style.backgroundColor = "var(--cc-neutral-alpha-04)"; }}
            onMouseLeave={(event) => { event.currentTarget.style.backgroundColor = "transparent"; }}
            title={scopeId ? "Attach files" : "Chat is still loading"}
          >
            <Paperclip size={14} />
          </button>
          {composer.hasDraft && (
            <button
              type="button"
              onClick={() => { void composer.discardDraft(); }}
              style={{
                border: "none",
                background: "transparent",
                color: "var(--cc-text-tertiary)",
                fontSize: 11,
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                cursor: "pointer",
                padding: "4px 6px",
              }}
            >
              Discard draft
            </button>
          )}
          <ModelPicker value={model} onChange={handleModelChange} autoModeActive={permissionMode === "auto"} />
          <ThinkingEffortPicker value={thinkingEffort} model={model} onChange={handleThinkingEffortChange} />
          <PermissionPicker value={permissionMode} model={model} onChange={setPermissionMode} />
        </div>
      </div>
    </div>
  );
}
