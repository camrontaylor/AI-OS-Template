"use client";

import { AttachmentAssetCard, type AttachmentAssetItem } from "@/components/shared/attachment-asset-grid";
import { PastedTextCard } from "@/components/shared/pasted-text-card";
import type { ChatPastedBlock } from "@/types/chat-composer";

export function ComposerDraftAssetCollection({
  pastedBlocks,
  attachmentItems,
  compact,
  padding,
  onInsertPastedBlock,
  onRemovePastedBlock,
  onRemoveAttachmentItem,
  onRetryAttachmentItem,
}: {
  pastedBlocks: ChatPastedBlock[];
  attachmentItems: AttachmentAssetItem[];
  compact?: boolean;
  padding?: string;
  onInsertPastedBlock: (blockId: string) => void;
  onRemovePastedBlock: (blockId: string) => void;
  onRemoveAttachmentItem?: (itemId: string) => void;
  onRetryAttachmentItem?: (itemId: string) => void;
}) {
  if (pastedBlocks.length === 0 && attachmentItems.length === 0) {
    return null;
  }

  return (
    <div
      style={{
        display: "flex",
        gap: compact ? 7 : 8,
        flexWrap: "wrap",
        padding: padding ?? (compact ? "4px 8px" : "4px 12px 6px"),
      }}
    >
      {pastedBlocks.map((block) => (
        <PastedTextCard
          key={block.id}
          text={block.text}
          onInsert={() => onInsertPastedBlock(block.id)}
          onRemove={() => onRemovePastedBlock(block.id)}
        />
      ))}
      {attachmentItems.map((item) => (
        <AttachmentAssetCard
          key={item.id}
          item={item}
          compact={compact}
          onRemoveItem={onRemoveAttachmentItem}
          onRetryItem={onRetryAttachmentItem}
        />
      ))}
    </div>
  );
}
