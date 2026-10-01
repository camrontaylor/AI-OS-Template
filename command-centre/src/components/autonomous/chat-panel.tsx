"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useChatStore } from "@/store/chat-store";
import { useClientStore } from "@/store/client-store";
import { ChatInput } from "./chat-input";
import { BubbledQuestion } from "./bubbled-question";
import { ChatMessageAttachmentList } from "@/components/shared/chat-attachment-strip";
import { Bot } from "lucide-react";
import type { Message } from "@/types/chat";
import type { ClaudeModel, ClaudeThinkingEffort, PermissionMode } from "@/types/task";
import type { ChatAttachment } from "@/types/chat-composer";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function ChatMessage({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSubAgent = message.role === "sub_agent";

  return (
    <div style={{
      display: "flex",
      gap: 8,
      alignItems: "flex-start",
    }}>
      {/* Avatar for non-user messages */}
      {!isUser && (
        <div style={{
          width: 22,
          height: 22,
          borderRadius: "50%",
          backgroundColor: isSubAgent ? "var(--cc-status-warning-bg)" : "var(--cc-brand-alpha-10)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
          marginTop: 1,
        }}>
          <Bot size={11} style={{ color: isSubAgent ? "var(--cc-status-warning-soft)" : "var(--cc-brand-primary)" }} />
        </div>
      )}

      <div style={{
        flex: 1,
        minWidth: 0,
        marginLeft: isUser ? 30 : 0,
      }}>
        {/* Name + timestamp */}
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          marginBottom: 2,
        }}>
          <span style={{
            fontSize: 11,
            fontWeight: 600,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: isUser ? "var(--cc-text-secondary)" : "var(--cc-brand-primary)",
          }}>
            {isUser ? "You" : isSubAgent ? "Sub-agent" : "Agent"}
          </span>
          <span style={{
            fontSize: 10,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: "var(--cc-text-faint)",
          }}>
            {formatTime(message.createdAt)}
          </span>
        </div>

        {/* Content */}
        <div style={{
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--cc-text-primary)",
          lineHeight: 1.5,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}>
          {message.content}
        </div>
        <ChatMessageAttachmentList attachments={message.metadata?.attachments ?? []} />
      </div>
    </div>
  );
}

export function ChatPanel() {
  const conversation = useChatStore((s) => s.conversation);
  const messages = useChatStore((s) => s.messages);
  const isProcessing = useChatStore((s) => s.isProcessing);
  const loadOrCreateConversation = useChatStore((s) => s.loadOrCreateConversation);
  const sendMessage = useChatStore((s) => s.sendMessage);
  const replyToQuestion = useChatStore((s) => s.replyToQuestion);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [isConversationLoading, setIsConversationLoading] = useState(false);

  useEffect(() => {
    let isCancelled = false;
    setIsConversationLoading(true);

    void loadOrCreateConversation(selectedClientId ?? null)
      .catch((error) => {
        console.error("Failed to load chat conversation:", error);
      })
      .finally(() => {
        if (!isCancelled) {
          setIsConversationLoading(false);
        }
      });

    return () => {
      isCancelled = true;
    };
  }, [loadOrCreateConversation, selectedClientId]);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const handleSend = useCallback((content: string, options: { permissionMode: PermissionMode; model: ClaudeModel | null; thinkingEffort: ClaudeThinkingEffort | null; attachments: ChatAttachment[] }) => {
    sendMessage(content, options);
  }, [sendMessage]);

  const handleReply = useCallback((messageId: string, content: string, attachments: ChatAttachment[] = []) => {
    replyToQuestion(messageId, content, attachments);
  }, [replyToQuestion]);

  return (
    <div style={{
      width: 360,
      flexShrink: 0,
      borderLeft: "1px solid var(--cc-line-alpha-15)",
      backgroundColor: "var(--cc-surface)",
      display: "flex",
      flexDirection: "column",
      height: "calc(100vh - 52px)",
      position: "sticky",
      top: 52,
    }}>
      {/* Header */}
      <div style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: "10px 16px",
        borderBottom: "1px solid var(--cc-line-alpha-12)",
        flexShrink: 0,
      }}>
        <div style={{
          width: 20,
          height: 20,
          borderRadius: "50%",
          backgroundColor: "var(--cc-brand-alpha-08)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}>
          <Bot size={11} style={{ color: "var(--cc-brand-primary)" }} />
        </div>
        <span style={{
          fontSize: 13,
          fontWeight: 600,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          color: "var(--cc-text-primary)",
        }}>
          Agent Chat
        </span>
        {isProcessing && (
          <div style={{
            display: "flex",
            gap: 3,
            alignItems: "center",
            marginLeft: "auto",
          }}>
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                style={{
                  width: 4,
                  height: 4,
                  borderRadius: "50%",
                  backgroundColor: "var(--cc-brand-primary)",
                  opacity: 0.4,
                  animation: `pulse-dot 1.4s ease-in-out ${i * 0.16}s infinite`,
                }}
              />
            ))}
          </div>
        )}
      </div>

      {/* Messages */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "12px 16px",
          display: "flex",
          flexDirection: "column",
          gap: 10,
        }}
      >
        {messages.length === 0 && !isProcessing && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
            padding: "40px 16px",
          }}>
            <p style={{
              fontSize: 12,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--cc-text-tertiary)",
              margin: 0,
              textAlign: "center",
              lineHeight: 1.5,
            }}>
              Tell me what you need — tasks appear in the feed as they&apos;re created.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          if (msg.role === "sub_agent" && msg.metadata?.questionText) {
            return <BubbledQuestion key={msg.id} message={msg} onReply={handleReply} />;
          }
          return <ChatMessage key={msg.id} message={msg} />;
        })}
      </div>

      {/* Input */}
      <ChatInput
        scopeId={conversation?.id}
        onSend={handleSend}
        disabled={isProcessing || isConversationLoading}
        placeholder="Type a message..."
      />
    </div>
  );
}
