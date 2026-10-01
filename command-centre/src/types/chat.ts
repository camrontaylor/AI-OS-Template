import type { ChatAttachment } from "@/types/chat-composer";
import type { StoredWorkScopeV1 } from "@/lib/identity/session-scope";

export type MessageRole = "user" | "orchestrator" | "sub_agent" | "system";
export type ConversationStatus = "active" | "archived";
export type DecisionType = "scope" | "decompose" | "delegate" | "clarify" | "complete_inline";
export type CoordinationLevel = "inject" | "shared_context" | "team";

export interface Conversation {
  id: string;
  title: string | null;
  status: ConversationStatus;
  createdAt: string;
  updatedAt: string;
  clientId: string | null;
  workScope: StoredWorkScopeV1;
}

export interface Message {
  id: string;
  conversationId: string;
  taskId: string | null;
  role: MessageRole;
  content: string;
  metadata: MessageMetadata | null;
  parentMessageId: string | null;
  createdAt: string;
}

export interface MessageMetadata {
  /** For orchestrator messages: what decision was made */
  decisionId?: string;
  /** For bubbled sub-agent questions */
  questionTaskId?: string;
  questionText?: string;
  /** Structured question specs (select/multiselect options) */
  questionSpecs?: import("@/types/question-spec").QuestionSpec[];
  /** For reply messages: which question this answers */
  replyToMessageId?: string;
  /** Files attached in the chat composer */
  attachments?: ChatAttachment[];
  /** For task completion messages */
  outputFiles?: string[];
  /** Cost tracking */
  costUsd?: number;
  tokensUsed?: number;
}

export interface AgentDecision {
  id: string;
  conversationId: string;
  messageId: string | null;
  decisionType: DecisionType;
  reasoning: string | null;
  taskIds: string[];
  level: string | null;
  createdAt: string;
}

/** SSE event types for chat */
export type ChatEventType =
  | "chat:message"
  | "chat:decision"
  | "chat:typing";

export interface ChatEvent {
  type: ChatEventType;
  message?: Message;
  decision?: AgentDecision;
  conversationId: string;
  timestamp: string;
}
