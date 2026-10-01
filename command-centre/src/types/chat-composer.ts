export type ChatComposerSurface = "conversation" | "task" | "question";

export type ChatAttachmentState = "draft" | "sent";

export interface ChatAttachment {
  id: string;
  fileName: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
  contentType?: string | null;
  surface: ChatComposerSurface;
  scopeId: string;
  draftKey: string | null;
  state: ChatAttachmentState;
  uploadedAt: string;
}

export interface ChatPastedBlock {
  id: string;
  text: string;
  label?: string;
}

export interface ChatDraftPayload {
  version: 1;
  surface: ChatComposerSurface;
  scopeId: string;
  draftKey: string;
  message: string;
  attachments: ChatAttachment[];
  pastedBlocks: ChatPastedBlock[];
  updatedAt: string;
}
