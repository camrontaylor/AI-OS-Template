"use client";

import { useEffect, useState } from "react";

interface GreetingHeaderProps {
  userName: string | null;
}

export function GreetingHeader({ userName }: GreetingHeaderProps) {
  // Compute greeting + date only after mount so the server-rendered HTML
  // (which doesn't know the user's local time) matches the first client
  // paint. Prevents hydration mismatches.
  const [state, setState] = useState<{ greeting: string; dateStr: string } | null>(null);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    const greeting =
      hour < 12 ? "Good morning" : hour < 17 ? "Good afternoon" : "Good evening";
    const dateStr = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "long",
      day: "numeric",
    });
    setState({ greeting, dateStr });
  }, []);

  const greeting = state?.greeting ?? "Hello";
  const dateStr = state?.dateStr ?? "";

  return (
    <div style={{ marginBottom: 32 }}>
      <h1
        style={{
          fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
          fontSize: 28,
          fontWeight: 700,
          color: "var(--cc-text-primary)",
          letterSpacing: "-0.02em",
          margin: 0,
        }}
      >
        <span suppressHydrationWarning>{greeting}{userName ? `, ${userName}` : ""}.</span>
      </h1>
      <p
        style={{
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          fontSize: 14,
          color: "var(--cc-text-secondary)",
          marginTop: 8,
          minHeight: "1.2em",
        }}
        suppressHydrationWarning
      >
        {dateStr ? `Here's your snapshot for ${dateStr}.` : "\u00a0"}
      </p>
    </div>
  );
}
