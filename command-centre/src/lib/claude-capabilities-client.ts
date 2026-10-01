"use client";

import { useEffect, useState } from "react";
import type { ClaudeCapabilities } from "@/lib/claude-auto-mode";

let cached: { value: ClaudeCapabilities; expiresAt: number } | null = null;
let inFlight: Promise<ClaudeCapabilities> | null = null;

async function fetchCapabilities(): Promise<ClaudeCapabilities> {
  if (cached && cached.expiresAt > Date.now()) return cached.value;
  if (inFlight) return inFlight;

  inFlight = fetch("/api/claude/capabilities", { cache: "no-store" })
    .then(async (response) => {
      if (!response.ok) throw new Error("Claude capability check failed");
      const value = await response.json() as ClaudeCapabilities;
      const ttl = value.cli.status === "available" ? 5 * 60_000 : 30_000;
      cached = { value, expiresAt: Date.now() + ttl };
      return value;
    })
    .finally(() => {
      inFlight = null;
    });

  return inFlight;
}

export function useClaudeCapabilities(): {
  capabilities: ClaudeCapabilities | null;
  status: "loading" | "ready" | "error";
} {
  const [capabilities, setCapabilities] = useState<ClaudeCapabilities | null>(cached?.value ?? null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    cached?.value ? "ready" : "loading",
  );

  useEffect(() => {
    let active = true;
    fetchCapabilities()
      .then((value) => {
        if (!active) return;
        setCapabilities(value);
        setStatus("ready");
      })
      .catch(() => {
        if (active) setStatus("error");
      });
    return () => {
      active = false;
    };
  }, []);

  return { capabilities, status };
}
