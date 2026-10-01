"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { stripAnsi } from "@/lib/terminal-output";
import { useClientStore } from "@/store/client-store";

interface TerminalPaneProps {
  paneId: string;
  label: string;
  isFocused: boolean;
  onFocus: () => void;
  onClose: () => void;
  compact?: boolean;
  initialCwd?: string;
  presentation?: "default" | "feed";
}

export function TerminalPane({
  paneId,
  label,
  isFocused,
  onFocus,
  onClose,
  compact = false,
  initialCwd,
  presentation = "default",
}: TerminalPaneProps) {
  const feedPresentation = presentation === "feed";
  const [output, setOutput] = useState("");
  const [input, setInput] = useState("");
  const [sessionReady, setSessionReady] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const sessionIdRef = useRef("");
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const historyRef = useRef<string[]>([]);
  const historyIdxRef = useRef(-1);
  const selectedClientId = useClientStore((state) => state.selectedClientId);
  const initialClientIdRef = useRef(selectedClientId);

  useEffect(() => {
    mountedRef.current = true;
    // React Strict Mode intentionally mounts effects twice in development.
    // A unique id per effect prevents the first cleanup request from
    // destroying the replacement shell created by the second mount.
    const sessionId = `${paneId}:${crypto.randomUUID()}`;
    sessionIdRef.current = sessionId;
    const abort = new AbortController();
    abortRef.current = abort;

    (async () => {
      try {
        // Single request: creates session + returns SSE output stream
        const res = await fetch("/api/terminal/exec", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action: "create",
            sessionId,
            cwd: initialCwd,
            clientId: initialClientIdRef.current,
          }),
          signal: abort.signal,
        });

        if (!res.ok || !res.body) {
          if (mountedRef.current) {
            const text = await res.text().catch(() => "unknown error");
            setOutput(`Failed to start shell: ${text}\n`);
          }
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const parts = buffer.split("\n\n");
          buffer = parts.pop() || "";

          for (const part of parts) {
            if (part.startsWith(":")) continue;
            const eventMatch = part.match(/^event: (\w+)/m);
            const dataMatch = part.match(/^data: (.+)$/m);
            if (!eventMatch || !dataMatch) continue;

            const event = eventMatch[1];
            let data: string;
            try { data = JSON.parse(dataMatch[1]); } catch { data = dataMatch[1]; }

            if (event === "ready" && mountedRef.current) {
              setSessionReady(true);
            } else if ((event === "stdout" || event === "stderr") && data && mountedRef.current) {
              setOutput((prev) => prev + stripAnsi(data));
            } else if (event === "exit" && mountedRef.current) {
              setOutput((prev) => prev + "\n[Shell exited]\n");
              setSessionReady(false);
            }
          }
        }
      } catch (err) {
        if ((err as Error).name !== "AbortError" && mountedRef.current) {
          setOutput((prev) => prev + `\n[Connection error: ${(err as Error).message}]\n`);
        }
      }
    })();

    return () => {
      mountedRef.current = false;
      abort.abort();
      fetch("/api/terminal/exec", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "destroy", sessionId }),
        keepalive: true,
      }).catch(() => {});
    };
  }, [initialCwd, paneId]);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [output]);

  useEffect(() => {
    if (isFocused) inputRef.current?.focus();
  }, [isFocused]);

  const sendToShell = useCallback((text: string) => {
    fetch("/api/terminal/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "input",
        sessionId: sessionIdRef.current,
        input: text,
      }),
    }).catch(() => {});
  }, []);

  const handleSubmit = useCallback(() => {
    const cmd = input;
    if (!sessionReady) return;
    setInput("");
    if (cmd.trim()) {
      historyRef.current.unshift(cmd);
      if (historyRef.current.length > 100) historyRef.current.pop();
    }
    historyIdxRef.current = -1;
    sendToShell(cmd + "\n");
  }, [input, sessionReady, sendToShell]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      handleSubmit();
      return;
    }
    if (e.key === "c" && e.ctrlKey) {
      e.preventDefault();
      sendToShell("\x03");
      setInput("");
      return;
    }
    if (e.key === "d" && e.ctrlKey) {
      e.preventDefault();
      sendToShell("\x04");
      return;
    }
    if (e.key === "ArrowUp") {
      e.preventDefault();
      const h = historyRef.current;
      if (h.length === 0) return;
      const next = Math.min(historyIdxRef.current + 1, h.length - 1);
      historyIdxRef.current = next;
      setInput(h[next]);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      const next = historyIdxRef.current - 1;
      if (next < 0) {
        historyIdxRef.current = -1;
        setInput("");
      } else {
        historyIdxRef.current = next;
        setInput(historyRef.current[next]);
      }
      return;
    }
  }, [handleSubmit, sendToShell]);

  return (
    <div
      data-terminal-presentation={presentation}
      onClick={() => { onFocus(); inputRef.current?.focus(); }}
      style={{
        flex: 1,
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
        minWidth: 0,
        border: feedPresentation ? "none" : "1px solid var(--cc-control-bg-hover)",
        borderRadius: feedPresentation ? 0 : 8,
        background: feedPresentation ? "transparent" : "var(--cc-surface-raised)",
      }}
    >
      {/* Shell output */}
      <div
        ref={scrollRef}
        onClick={() => inputRef.current?.focus()}
        style={{
          flex: 1,
          overflow: "auto",
          padding: feedPresentation ? "12px 14px 0" : "8px 12px",
          fontFamily: "var(--cc-font-mono)",
          fontSize: "var(--cc-feed-type-terminal)",
          lineHeight: feedPresentation ? 1.75 : 1.6,
          backgroundColor: feedPresentation ? "transparent" : "var(--cc-surface-raised)",
          whiteSpace: "pre-wrap",
          wordBreak: "break-all",
          color: "var(--cc-text-primary)",
          cursor: "text",
          borderTopLeftRadius: feedPresentation ? 0 : 8,
          borderTopRightRadius: feedPresentation ? 0 : 8,
        }}
      >
        {output || (
          <span style={{ color: "var(--cc-text-tertiary)" }}>Connecting...</span>
        )}
      </div>

      {/* Command input */}
      <div
        onClick={(event) => {
          event.stopPropagation();
          onFocus();
          inputRef.current?.focus();
        }}
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 7,
          padding: feedPresentation ? "0 14px 12px" : "6px 12px",
          borderTop: feedPresentation ? "none" : "1px solid var(--cc-control-bg)",
          flexShrink: 0,
          backgroundColor: feedPresentation ? "transparent" : "var(--cc-surface)",
          borderBottomLeftRadius: feedPresentation ? 0 : 8,
          borderBottomRightRadius: feedPresentation ? 0 : 8,
        }}
      >
        <span
          aria-hidden
          style={{
            flexShrink: 0,
            color: "var(--cc-brand-primary)",
            fontSize: "var(--cc-feed-type-terminal)",
            fontWeight: 500,
            lineHeight: 1.75,
            fontFamily: "var(--cc-font-mono)",
          }}
        >
          &gt;
        </span>
        <input
          ref={inputRef}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={!sessionReady}
          placeholder={sessionReady ? "" : "connecting..."}
          autoFocus={isFocused}
          style={{
            flex: 1,
            background: "transparent",
            border: "none",
            outline: "none",
            color: "var(--cc-text-primary)",
            fontFamily: "var(--cc-font-mono)",
            fontSize: "var(--cc-feed-type-terminal)",
            lineHeight: 1.75,
            caretColor: "var(--cc-text-primary)",
          }}
        />
      </div>
    </div>
  );
}
