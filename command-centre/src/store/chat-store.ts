import { create } from "zustand";
import type { Conversation, Message, AgentDecision, ChatEvent } from "@/types/chat";
import type { ClaudeModel, ClaudeThinkingEffort, PermissionMode } from "@/types/task";
import { readApiError } from "@/lib/api-error";
import type { ChatAttachment } from "@/types/chat-composer";
import { clearChatDraft } from "@/lib/chat-drafts";
import {
  clearRememberedConversationId,
  loadRememberedConversationId,
  rememberConversationId,
} from "@/lib/chat-session-memory";

interface ChatState {
  /** The active conversation (only one at a time) */
  conversation: Conversation | null;
  /** Messages in the active conversation, ordered by createdAt */
  messages: Message[];
  /** Agent decisions for the active conversation */
  decisions: AgentDecision[];
  /** Whether the orchestrator is currently processing */
  isProcessing: boolean;
  /** Pending questions from sub-agents that need user reply */
  pendingQuestions: Message[];

  // Actions
  loadOrCreateConversation: (clientId?: string | null) => Promise<Conversation>;
  sendMessage: (content: string, options?: { permissionMode?: PermissionMode; model?: ClaudeModel | null; thinkingEffort?: ClaudeThinkingEffort | null; attachments?: ChatAttachment[] }) => Promise<void>;
  replyToQuestion: (messageId: string, content: string, attachments?: ChatAttachment[]) => Promise<void>;
  fetchMessages: (conversationId: string) => Promise<void>;
  applyChatSSE: (event: ChatEvent) => void;
  setProcessing: (v: boolean) => void;
  archiveConversation: () => Promise<void>;
}

function getAttachmentPathKey(attachments: ChatAttachment[] | undefined): string {
  return (attachments ?? [])
    .map((attachment) => attachment.relativePath)
    .sort()
    .join("|");
}

function getMessageAttachmentPathKey(message: Pick<Message, "metadata">): string {
  return getAttachmentPathKey(message.metadata?.attachments);
}

function isOptimisticTempMessage(message: Message): boolean {
  return message.id.startsWith("temp-");
}

function doesOptimisticMessageMatchRealMessage(optimistic: Message, real: Message): boolean {
  return (
    isOptimisticTempMessage(optimistic) &&
    optimistic.conversationId === real.conversationId &&
    optimistic.role === real.role &&
    optimistic.parentMessageId === real.parentMessageId &&
    optimistic.content === real.content &&
    getMessageAttachmentPathKey(optimistic) === getMessageAttachmentPathKey(real)
  );
}

function reconcileRealMessage(messages: Message[], realMessage: Message, tempId?: string): Message[] {
  const existingRealIndex = messages.findIndex((message) => message.id === realMessage.id);
  const optimisticIndex = messages.findIndex((message) =>
    tempId
      ? message.id === tempId
      : doesOptimisticMessageMatchRealMessage(message, realMessage),
  );

  if (existingRealIndex !== -1) {
    const next = messages.map((message) => message.id === realMessage.id ? realMessage : message);
    if (optimisticIndex !== -1 && optimisticIndex !== existingRealIndex) {
      return next.filter((_, index) => index !== optimisticIndex);
    }
    return next;
  }

  if (optimisticIndex !== -1) {
    return messages.map((message, index) => index === optimisticIndex ? realMessage : message);
  }

  return [...messages, realMessage];
}

function isConversationCompatible(conversation: Conversation, clientId: string | null | undefined): boolean {
  if (conversation.status !== "active") return false;
  if (!clientId) return conversation.clientId == null;
  return conversation.clientId === clientId;
}

export const useChatStore = create<ChatState>((set, get) => ({
  conversation: null,
  messages: [],
  decisions: [],
  isProcessing: false,
  pendingQuestions: [],

  loadOrCreateConversation: async (clientId?: string | null) => {
    const scopedClientId = clientId ?? null;
    const rememberedConversationId = loadRememberedConversationId(scopedClientId);

    if (rememberedConversationId) {
      try {
        const rememberedResponse = await fetch(`/api/chat/conversations/${encodeURIComponent(rememberedConversationId)}`);
        if (rememberedResponse.ok) {
          const rememberedConversation: Conversation = await rememberedResponse.json();
          if (isConversationCompatible(rememberedConversation, scopedClientId)) {
            set({ conversation: rememberedConversation });
            rememberConversationId(scopedClientId, rememberedConversation.id);
            await get().fetchMessages(rememberedConversation.id);
            return rememberedConversation;
          }
        }
      } catch (error) {
        console.error("Failed to restore remembered chat conversation:", error);
      }

      clearRememberedConversationId(scopedClientId);
    }

    // Try to load the most recent active conversation
    const params = new URLSearchParams();
    params.set("clientId", scopedClientId ?? "root");
    params.set("status", "active");

    const res = await fetch(`/api/chat/conversations?${params}`);
    if (!res.ok) {
      throw new Error(await readApiError(res, "Failed to load conversations"));
    }

    const conversations: Conversation[] = await res.json();
    if (conversations.length > 0) {
      const conv = conversations[0];
      set({ conversation: conv });
      rememberConversationId(scopedClientId, conv.id);
      await get().fetchMessages(conv.id);
      return conv;
    }

    // No active conversation — create one
    const createRes = await fetch("/api/chat/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ clientId: scopedClientId }),
    });
    if (!createRes.ok) {
      throw new Error(await readApiError(createRes, "Failed to create conversation"));
    }
    const conv: Conversation = await createRes.json();
    set({ conversation: conv, messages: [], decisions: [], pendingQuestions: [] });
    rememberConversationId(scopedClientId, conv.id);
    return conv;
  },

  sendMessage: async (content: string, options) => {
    const { conversation } = get();
    if (!conversation) return;

    const now = new Date().toISOString();
    const tempId = `temp-${crypto.randomUUID()}`;

    // Optimistic add
    const optimistic: Message = {
      id: tempId,
      conversationId: conversation.id,
      taskId: null,
      role: "user",
      content,
      metadata: options?.attachments?.length ? { attachments: options.attachments } : null,
      parentMessageId: null,
      createdAt: now,
    };
    set((s) => ({ messages: [...s.messages, optimistic], isProcessing: true }));

    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          content,
          permissionMode: options?.permissionMode,
          model: options?.model ?? undefined,
          thinkingEffort: options?.thinkingEffort ?? undefined,
          attachments: options?.attachments ?? [],
        }),
      });

      if (!res.ok) {
        console.error("Failed to send message:", res.status);
        set((s) => ({
          messages: s.messages.filter((m) => m.id !== tempId),
          isProcessing: false,
        }));
        return;
      }

      const data = await res.json();

      // Single atomic set: replace temp with real, add orchestrator, dedupe
      set((s) => {
        let msgs = reconcileRealMessage(s.messages, data.userMessage, tempId);

        // Add orchestrator response if present and not already there
        if (data.orchestratorMessage && !msgs.some((m) => m.id === data.orchestratorMessage.id)) {
          msgs = [...msgs, data.orchestratorMessage];
        }

        return { messages: msgs, isProcessing: false };
      });
    } catch (err) {
      console.error("Send message error:", err);
      set((s) => ({
        messages: s.messages.filter((m) => m.id !== tempId),
        isProcessing: false,
      }));
    }
  },

  replyToQuestion: async (messageId: string, content: string, attachments: ChatAttachment[] = []) => {
    const { conversation } = get();
    if (!conversation) return;

    const now = new Date().toISOString();
    const tempId = `temp-${crypto.randomUUID()}`;
    const replyMsg: Message = {
      id: tempId,
      conversationId: conversation.id,
      taskId: null,
      role: "user",
      content,
      metadata: {
        replyToMessageId: messageId,
        ...(attachments.length > 0 ? { attachments } : {}),
      },
      parentMessageId: messageId,
      createdAt: now,
    };

    set((s) => ({
      messages: [...s.messages, replyMsg],
      pendingQuestions: s.pendingQuestions.filter((q) => q.id !== messageId),
    }));

    try {
      const res = await fetch("/api/chat/message", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          conversationId: conversation.id,
          content,
          replyToMessageId: messageId,
          attachments,
        }),
      });

      if (!res.ok) {
        console.error("Reply to question failed:", res.status);
        set((s) => ({
          messages: s.messages.filter((message) => message.id !== tempId),
        }));
        return;
      }

      const data = await res.json();
      if (data?.userMessage) {
        set((s) => ({
          messages: reconcileRealMessage(s.messages, data.userMessage, tempId),
        }));
      }
    } catch (err) {
      console.error("Reply to question error:", err);
      set((s) => ({
        messages: s.messages.filter((message) => message.id !== tempId),
      }));
    }
  },

  fetchMessages: async (conversationId: string) => {
    try {
      const res = await fetch(`/api/chat/conversations/${conversationId}/messages`);
      if (!res.ok) return;
      const data = await res.json();
      const messages: Message[] = data.messages || [];
      const pendingQuestions = messages.filter(
        (m) => m.role === "sub_agent" && m.metadata?.questionText && !messages.some(
          (r) => r.parentMessageId === m.id && r.role === "user"
        )
      );
      set({ messages, pendingQuestions });
    } catch (err) {
      console.error("Fetch messages error:", err);
    }
  },

  applyChatSSE: (event: ChatEvent) => {
    if (event.type === "chat:message" && event.message) {
      const msg = event.message;
      set((s) => {
        const newMessages = reconcileRealMessage(s.messages, msg);
        const pendingWithoutCurrent = s.pendingQuestions.filter((question) =>
          question.id !== msg.id && question.id !== msg.parentMessageId,
        );
        const newPending = msg.role === "sub_agent" && msg.metadata?.questionText
          ? [...pendingWithoutCurrent, msg]
          : pendingWithoutCurrent;
        return {
          messages: newMessages,
          pendingQuestions: newPending,
          isProcessing: msg.role === "orchestrator" ? false : s.isProcessing,
        };
      });
    } else if (event.type === "chat:decision" && event.decision) {
      set((s) => ({
        decisions: [...s.decisions, event.decision!],
      }));
    }
  },

  setProcessing: (v: boolean) => set({ isProcessing: v }),

  archiveConversation: async () => {
    const { conversation } = get();
    if (!conversation) return;

    await fetch(`/api/chat/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: "archived" }),
    });

    clearRememberedConversationId(conversation.clientId ?? null);
    clearChatDraft("conversation", conversation.id);
    set({ conversation: null, messages: [], decisions: [], pendingQuestions: [] });
  },
}));
