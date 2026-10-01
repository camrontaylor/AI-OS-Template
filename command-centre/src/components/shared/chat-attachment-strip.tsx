"use client";

import { AttachmentAssetGrid, type AttachmentAssetItem } from "@/components/shared/attachment-asset-grid";
import { getChatAttachmentExtension } from "@/lib/chat-attachment-policy";
import type { ChatAttachment } from "@/types/chat-composer";

export interface ComposerUploadItem {
  id: string;
  fileName: string;
  status: "uploading" | "failed";
  error?: string;
}

function toAttachmentItem(attachment: ChatAttachment): AttachmentAssetItem {
  return {
    id: attachment.id,
    fileName: attachment.fileName,
    extension: attachment.extension,
    sizeBytes: attachment.sizeBytes,
    contentType: attachment.contentType ?? null,
    previewPath: attachment.relativePath,
    previewSurface: attachment.surface,
    previewScopeId: attachment.scopeId,
    status: "ready",
  };
}

function toUploadItem(upload: ComposerUploadItem): AttachmentAssetItem {
  return {
    id: upload.id,
    fileName: upload.fileName,
    extension: getChatAttachmentExtension(upload.fileName),
    status: upload.status,
    error: upload.error,
  };
}

export function ChatAttachmentStrip({
  attachments,
  uploads = [],
  onRemoveAttachment,
  onRetryUpload,
  onRemoveUpload,
  compact,
  padding,
}: {
  attachments: ChatAttachment[];
  uploads?: ComposerUploadItem[];
  onRemoveAttachment?: (attachment: ChatAttachment) => void;
  onRetryUpload?: (uploadId: string) => void;
  onRemoveUpload?: (uploadId: string) => void;
  compact?: boolean;
  padding?: string;
}) {
  const items = [
    ...attachments.map(toAttachmentItem),
    ...uploads.map(toUploadItem),
  ];

  if (items.length === 0) return null;

  return (
    <AttachmentAssetGrid
      items={items}
      compact={compact}
      padding={padding}
      onRemoveItem={(itemId) => {
        const attachment = attachments.find((candidate) => candidate.id === itemId);
        if (attachment && onRemoveAttachment) {
          onRemoveAttachment(attachment);
          return;
        }
        if (onRemoveUpload) {
          onRemoveUpload(itemId);
        }
      }}
      onRetryItem={(itemId) => {
        if (onRetryUpload) onRetryUpload(itemId);
      }}
    />
  );
}

export function ChatMessageAttachmentList({
  attachments,
  compact,
  isUser: _isUser,
}: {
  attachments: ChatAttachment[];
  compact?: boolean;
  isUser?: boolean;
}) {
  if (attachments.length === 0) return null;

  return (
    <div style={{ marginTop: 10 }}>
      <AttachmentAssetGrid
        items={attachments.map(toAttachmentItem)}
        compact={compact}
        padding="0"
      />
    </div>
  );
}
