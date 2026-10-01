"use client";

import { useEffect, useRef, useCallback, useState } from "react";
import { useChatStore } from "@/store/chat-store";
import { useClientStore } from "@/store/client-store";
import { ChatInput } from "./chat-input";
import { BubbledQuestion } from "./bubbled-question";
import { ChatMessageAttachmentList } from "@/components/shared/chat-attachment-strip";
import { Bot, User } from "lucide-react";
import type { Message } from "@/types/chat";
import type { ClaudeModel, ClaudeThinkingEffort, PermissionMode } from "@/types/task";
import type { ChatAttachment } from "@/types/chat-composer";

function formatTime(dateStr: string): string {
  const d = new Date(dateStr);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSubAgent = message.role === "sub_agent";

  return (
    <div style={{
      display: "flex",
      flexDirection: "column",
      alignItems: isUser ? "flex-end" : "flex-start",
      gap: 4,
      maxWidth: "85%",
      alignSelf: isUser ? "flex-end" : "flex-start",
    }}>
      {/* Avatar + name */}
      {!isUser && (
        <div style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          paddingLeft: 2,
        }}>
          <div style={{
            width: 20,
            height: 20,
            borderRadius: "50%",
            backgroundColor: isSubAgent ? "var(--cc-status-warning-bg)" : "var(--cc-brand-alpha-10)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}>
            <Bot size={11} style={{ color: isSubAgent ? "var(--cc-status-warning-soft)" : "var(--cc-brand-primary)" }} />
          </div>
          <span style={{
            fontSize: 10,
            fontWeight: 600,
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            color: "var(--cc-text-tertiary)",
          }}>
            {isSubAgent ? "Sub-agent" : "Agent"}
          </span>
        </div>
      )}

      {/* Message content */}
      <div style={{
        padding: "10px 14px",
        borderRadius: isUser ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
        backgroundColor: isUser ? "var(--cc-brand-primary)" : "var(--cc-surface-muted)",
        color: isUser ? "var(--cc-surface)" : "var(--cc-text-primary)",
        fontSize: 13,
        fontFamily: "var(--font-inter), Inter, sans-serif",
        lineHeight: 1.5,
        whiteSpace: "pre-wrap",
        wordBreak: "break-word",
      }}>
        {message.content}
        <ChatMessageAttachmentList attachments={message.metadata?.attachments ?? []} isUser={isUser} />
      </div>

      {/* Timestamp */}
      <span style={{
        fontSize: 10,
        fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
        color: "var(--cc-text-tertiary)",
        paddingLeft: isUser ? 0 : 2,
        paddingRight: isUser ? 2 : 0,
      }}>
        {formatTime(message.createdAt)}
      </span>
    </div>
  );
}

export function ChatView() {
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
      flex: 1,
      display: "flex",
      flexDirection: "column",
      minWidth: 0,
      backgroundColor: "var(--cc-surface)",
    }}>
      {/* Messages area */}
      <div
        ref={scrollRef}
        style={{
          flex: 1,
          overflowY: "auto",
          padding: "16px 24px",
          display: "flex",
          flexDirection: "column",
          gap: 12,
        }}
      >
        {messages.length === 0 && !isProcessing && (
          <div style={{
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 8,
            padding: 40,
          }}>
            <div style={{
              width: 48,
              height: 48,
              borderRadius: "50%",
              backgroundColor: "var(--cc-brand-alpha-08)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}>
              <Bot size={24} style={{ color: "var(--cc-brand-primary)" }} />
            </div>
            <p style={{
              fontSize: 15,
              fontWeight: 600,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--cc-text-primary)",
              margin: 0,
            }}>
              Autonomous Mode
            </p>
            <p style={{
              fontSize: 13,
              fontFamily: "var(--font-inter), Inter, sans-serif",
              color: "var(--cc-text-tertiary)",
              margin: 0,
              textAlign: "center",
              maxWidth: 360,
              lineHeight: 1.5,
            }}>
              Tell me what you need &mdash; I&apos;ll scope it, create tasks, and manage execution. You can track progress in the sidebar.
            </p>
          </div>
        )}

        {messages.map((msg) => {
          // Check if this message is a bubbled question
          const isBubbledQuestion = msg.role === "sub_agent" && msg.metadata?.questionText;

          if (isBubbledQuestion) {
            return <BubbledQuestion key={msg.id} message={msg} onReply={handleReply} />;
          }

          return <MessageBubble key={msg.id} message={msg} />;
        })}

        {/* Processing indicator */}
        {isProcessing && (
          <div style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            alignSelf: "flex-start",
            padding: "8px 14px",
            backgroundColor: "var(--cc-surface-muted)",
            borderRadius: "12px 12px 12px 4px",
          }}>
            <div style={{
              display: "flex",
              gap: 4,
              alignItems: "center",
            }}>
              {[0, 1, 2].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 6,
                    height: 6,
                    borderRadius: "50%",
                    backgroundColor: "var(--cc-brand-primary)",
                    opacity: 0.4,
                    animation: `pulse-dot 1.4s ease-in-out ${i * 0.16}s infinite`,
                  }}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Input */}
      <ChatInput
        scopeId={conversation?.id}
        onSend={handleSend}
        disabled={isProcessing || isConversationLoading}
        placeholder="Tell me what you need..."
      />
    </div>
  );
}
