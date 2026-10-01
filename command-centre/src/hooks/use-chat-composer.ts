"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  buildChatDraftScopeKey,
  cleanupExpiredChatDrafts,
  clearChatDraft,
  getChatDraftPersistenceDecision,
  loadChatDraft,
  saveChatDraft,
  touchChatDraft,
} from "@/lib/chat-drafts";
import { CHAT_ATTACHMENT_ACCEPT_ATTR, getChatAttachmentExtension, getChatAttachmentValidationError } from "@/lib/chat-attachment-policy";
import { expandComposerPastedBlocks, hasComposerContent } from "@/lib/chat-message-content";
import {
  insertPastedTextAtSelection,
  removePendingPastedText,
  shouldCapturePastedText,
} from "@/lib/pasted-text";
import type { ChatAttachment, ChatComposerSurface, ChatDraftPayload, ChatPastedBlock } from "@/types/chat-composer";
import type { ComposerUploadItem } from "@/components/shared/chat-attachment-strip";

interface UploadItemState extends ComposerUploadItem {
  file?: File;
}

const IMAGE_MIME_TO_EXTENSION: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/svg+xml": "svg",
};

function createId(): string {
  return typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
    ? crypto.randomUUID()
    : Math.random().toString(36).slice(2);
}

function ensureNamedFile(file: File): File {
  if (file.name && getChatAttachmentExtension(file.name)) {
    return file;
  }

  const extension = IMAGE_MIME_TO_EXTENSION[file.type] ?? "txt";
  return new File([file], `pasted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${extension}`, {
    type: file.type,
  });
}

function normalizeUploadedAttachments(value: unknown): ChatAttachment[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is ChatAttachment => {
    return Boolean(
      item &&
      typeof item === "object" &&
      typeof (item as ChatAttachment).id === "string" &&
      typeof (item as ChatAttachment).relativePath === "string" &&
      typeof (item as ChatAttachment).fileName === "string",
    );
  });
}

export function useChatComposer(params: {
  surface: ChatComposerSurface;
  scopeId: string | null | undefined;
}) {
  const { surface, scopeId } = params;
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const dragDepthRef = useRef(0);
  const [message, setMessage] = useState("");
  const [attachments, setAttachments] = useState<ChatAttachment[]>([]);
  const [pastedBlocks, setPastedBlocks] = useState<ChatPastedBlock[]>([]);
  const [draftKey, setDraftKey] = useState(() => createId());
  const [uploadItems, setUploadItems] = useState<UploadItemState[]>([]);
  const [isDragging, setIsDragging] = useState(false);
  const [hydratedScopeKey, setHydratedScopeKey] = useState<string | null>(null);
  const currentScopeKey = buildChatDraftScopeKey(surface, scopeId);

  useEffect(() => {
    cleanupExpiredChatDrafts();
  }, []);

  useEffect(() => {
    setHydratedScopeKey(null);

    if (!scopeId || !currentScopeKey) {
      setMessage("");
      setAttachments([]);
      setPastedBlocks([]);
      setDraftKey(createId());
      setUploadItems([]);
      setIsDragging(false);
      dragDepthRef.current = 0;
      return;
    }

    const existingDraft = loadChatDraft(surface, scopeId);
    const restoredDraft = existingDraft
      ? touchChatDraft(surface, scopeId) ?? existingDraft
      : null;

    if (restoredDraft) {
      setMessage(restoredDraft.message);
      setAttachments(restoredDraft.attachments);
      setPastedBlocks(restoredDraft.pastedBlocks);
      setDraftKey(restoredDraft.draftKey || createId());
    } else {
      setMessage("");
      setAttachments([]);
      setPastedBlocks([]);
      setDraftKey(createId());
    }
    setUploadItems([]);
    setIsDragging(false);
    dragDepthRef.current = 0;
    setHydratedScopeKey(currentScopeKey);
  }, [currentScopeKey, scopeId, surface]);

  useEffect(() => {
    const persistenceDecision = getChatDraftPersistenceDecision({
      hydratedScopeKey,
      surface,
      scopeId,
      message,
      attachmentsCount: attachments.length,
      pastedBlocksCount: pastedBlocks.length,
    });

    if (persistenceDecision === "skip" || !scopeId) return;

    if (persistenceDecision === "clear") {
      clearChatDraft(surface, scopeId);
      return;
    }

    const draft: ChatDraftPayload = {
      version: 1,
      surface,
      scopeId,
      draftKey,
      message,
      attachments,
      pastedBlocks,
      updatedAt: new Date().toISOString(),
    };
    saveChatDraft(draft);
  }, [attachments, draftKey, hydratedScopeKey, message, pastedBlocks, scopeId, surface]);

  const uploads = useMemo<ComposerUploadItem[]>(
    () => uploadItems.map(({ id, fileName, status, error }) => ({ id, fileName, status, error })),
    [uploadItems],
  );

  const isUploading = uploadItems.some((item) => item.status === "uploading");
  const hasDraft = hasComposerContent(message, attachments) || pastedBlocks.length > 0;

  const uploadFile = useCallback(async (uploadId: string, file: File) => {
    if (!scopeId) {
      setUploadItems((current) =>
        current.map((item) => item.id === uploadId ? { ...item, status: "failed", error: "Composer is not ready yet" } : item),
      );
      return;
    }

    try {
      const formData = new FormData();
      formData.append("surface", surface);
      formData.append("scopeId", scopeId);
      formData.append("draftKey", draftKey);
      formData.append("files", file);

      const response = await fetch("/api/chat/attachments", {
        method: "POST",
        body: formData,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(typeof data.error === "string" ? data.error : "Upload failed");
      }

      const uploadedAttachments = normalizeUploadedAttachments(data.attachments);
      setAttachments((current) => {
        const seen = new Set(current.map((attachment) => attachment.relativePath));
        const next = [...current];
        for (const attachment of uploadedAttachments) {
          if (seen.has(attachment.relativePath)) continue;
          seen.add(attachment.relativePath);
          next.push(attachment);
        }
        return next;
      });
      setUploadItems((current) => current.filter((item) => item.id !== uploadId));
    } catch (error) {
      const message = error instanceof Error ? error.message : "Upload failed";
      setUploadItems((current) =>
        current.map((item) => item.id === uploadId ? { ...item, status: "failed", error: message } : item),
      );
    }
  }, [draftKey, scopeId, surface]);

  const uploadFiles = useCallback(async (files: File[] | FileList | null) => {
    if (!files) return;

    const normalized = Array.from(files).map(ensureNamedFile);
    const nextItems: UploadItemState[] = normalized.map((file) => ({
      id: createId(),
      fileName: file.name,
      status: "uploading",
      error: undefined,
      file,
    }));

    setUploadItems((current) => [...current, ...nextItems]);

    for (const item of nextItems) {
      const validationError = getChatAttachmentValidationError({ name: item.fileName, size: item.file?.size ?? 0 });
      if (validationError) {
        setUploadItems((current) =>
          current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: validationError } : entry),
        );
        continue;
      }
      if (!item.file) {
        setUploadItems((current) =>
          current.map((entry) => entry.id === item.id ? { ...entry, status: "failed", error: "File data is missing" } : entry),
        );
        continue;
      }
      await uploadFile(item.id, item.file);
    }
  }, [uploadFile]);

  const retryUpload = useCallback(async (uploadId: string) => {
    const upload = uploadItems.find((item) => item.id === uploadId);
    if (!upload?.file) return;
    setUploadItems((current) =>
      current.map((item) => item.id === uploadId ? { ...item, status: "uploading", error: undefined } : item),
    );
    await uploadFile(uploadId, upload.file);
  }, [uploadFile, uploadItems]);

  const removeUpload = useCallback((uploadId: string) => {
    setUploadItems((current) => current.filter((item) => item.id !== uploadId));
  }, []);

  const removeAttachment = useCallback(async (attachment: ChatAttachment) => {
    setAttachments((current) => current.filter((item) => item.id !== attachment.id));
    if (!scopeId || attachment.state !== "draft" || !attachment.draftKey) {
      return;
    }

    try {
      await fetch("/api/chat/attachments", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          surface,
          scopeId,
          draftKey: attachment.draftKey,
          relativePath: attachment.relativePath,
        }),
      });
    } catch {
      // Best effort cleanup only.
    }
  }, [scopeId, surface]);

  const discardDraft = useCallback(async () => {
    if (scopeId && attachments.some((attachment) => attachment.state === "draft")) {
      try {
        await fetch("/api/chat/attachments", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            surface,
            scopeId,
            draftKey,
          }),
        });
      } catch {
        // Best effort cleanup only.
      }
    }

    setMessage("");
    setAttachments([]);
    setPastedBlocks([]);
    setUploadItems([]);
    setDraftKey(createId());
    if (scopeId) {
      clearChatDraft(surface, scopeId);
    }
  }, [attachments, draftKey, scopeId, surface]);

  const handlePaste = useCallback((event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const fileItems = Array.from(event.clipboardData?.items ?? [])
      .filter((item) => item.kind === "file")
      .map((item) => item.getAsFile())
      .filter((file): file is File => Boolean(file));

    if (fileItems.length > 0) {
      event.preventDefault();
      void uploadFiles(fileItems);
      return;
    }

    const text = event.clipboardData?.getData("text/plain") ?? "";
    if (!shouldCapturePastedText(text)) {
      return;
    }

    event.preventDefault();
    setPastedBlocks((current) => [...current, { id: createId(), text }]);
  }, [uploadFiles]);

  const insertPastedTextBlock = useCallback((blockId: string) => {
    const block = pastedBlocks.find((entry) => entry.id === blockId);
    if (!block) return;

    const textarea = textareaRef.current;
    const selectionStart = textarea?.selectionStart ?? message.length;
    const selectionEnd = textarea?.selectionEnd ?? selectionStart;
    const insertion = insertPastedTextAtSelection(
      message,
      block.text,
      selectionStart,
      selectionEnd,
    );

    setMessage(insertion.value);
    setPastedBlocks((current) => removePendingPastedText(current, blockId));

    requestAnimationFrame(() => {
      const nextTextarea = textareaRef.current;
      if (!nextTextarea) return;
      nextTextarea.focus();
      nextTextarea.setSelectionRange(insertion.selectionStart, insertion.selectionEnd);
    });
  }, [message, pastedBlocks]);

  const removePastedTextBlock = useCallback((blockId: string) => {
    setPastedBlocks((current) => removePendingPastedText(current, blockId));
  }, []);

  const hasFileDragPayload = useCallback((dataTransfer: DataTransfer | null): boolean => {
    if (!dataTransfer) return false;
    return Array.from(dataTransfer.types).includes("Files");
  }, []);

  const handleDragEnter = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current += 1;
    setIsDragging(true);
  }, [hasFileDragPayload]);

  const handleDragOver = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "copy";
    setIsDragging(true);
  }, [hasFileDragPayload]);

  const handleDragLeave = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1);
    if (dragDepthRef.current === 0) {
      setIsDragging(false);
    }
  }, [hasFileDragPayload]);

  const handleDrop = useCallback((event: React.DragEvent<HTMLElement>) => {
    if (!hasFileDragPayload(event.dataTransfer)) return;
    event.preventDefault();
    dragDepthRef.current = 0;
    setIsDragging(false);
    void uploadFiles(event.dataTransfer.files);
  }, [hasFileDragPayload, uploadFiles]);

  const handleFileInputChange = useCallback((event: React.ChangeEvent<HTMLInputElement>) => {
    void uploadFiles(event.target.files);
    event.target.value = "";
  }, [uploadFiles]);

  const openFilePicker = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const buildSubmission = useCallback(() => {
    return {
      message: expandComposerPastedBlocks(message, pastedBlocks).trim(),
      attachments,
    };
  }, [attachments, message, pastedBlocks]);

  const clearComposer = useCallback(() => {
    setMessage("");
    setAttachments([]);
    setPastedBlocks([]);
    setUploadItems([]);
    setDraftKey(createId());
    if (scopeId) {
      clearChatDraft(surface, scopeId);
    }
  }, [scopeId, surface]);

  return {
    message,
    setMessage,
    attachments,
    pastedBlocks,
    uploads,
    isUploading,
    isDragging,
    hasDraft,
    textareaRef,
    fileInputRef,
    accept: CHAT_ATTACHMENT_ACCEPT_ATTR,
    handlePaste,
    handleDragEnter,
    handleDragOver,
    handleDragLeave,
    handleDrop,
    handleFileInputChange,
    openFilePicker,
    removeAttachment,
    retryUpload,
    removeUpload,
    insertPastedTextBlock,
    removePastedTextBlock,
    discardDraft,
    buildSubmission,
    clearComposer,
  };
}
