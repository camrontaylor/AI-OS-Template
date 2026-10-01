import type { ChatPastedBlock } from "@/types/chat-composer";
import type { ClaudeModel, ClaudeThinkingEffort, PermissionMode, TaskLevel } from "@/types/task";

export interface GoalDraftAttachment {
  fileName: string;
  relativePath: string;
  extension: string;
  sizeBytes: number;
}

export interface GoalDraftPayload {
  version: 2;
  id: string;
  clientId: string | null;
  title: string;
  message: string;
  attachments: GoalDraftAttachment[];
  level: TaskLevel;
  permissionMode: PermissionMode;
  model: ClaudeModel | null;
  thinkingEffort: ClaudeThinkingEffort | null;
  tag: string | null;
  pastedBlocks: ChatPastedBlock[];
  createdAt: string;
  updatedAt: string;
}
