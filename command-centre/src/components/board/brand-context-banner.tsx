"use client";

import { useEffect, useState } from "react";
import { Sparkles } from "lucide-react";
import { useContextStore } from "@/store/context-store";
import { useTaskStore } from "@/store/task-store";
import { useClientStore } from "@/store/client-store";
import {
  findStartHereTaskToQueue,
  getBrandContextBannerMessage,
  shouldQueueBrandStartHereTask,
  shouldShowBrandContextBanner,
} from "./brand-context-banner-state";
import { START_HERE_DESCRIPTION, START_HERE_TITLE } from "@/components/onboarding/onboarding-state";

export function BrandContextBanner() {
  const fetchContextStatus = useContextStore((s) => s.fetchContextStatus);
  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const hasBrandContext = useContextStore((s) => s.getHasBrandContext(selectedClientId));
  const [creating, setCreating] = useState(false);

  useEffect(() => {
    fetchContextStatus(selectedClientId);
  }, [selectedClientId, fetchContextStatus]);

  if (!shouldShowBrandContextBanner(hasBrandContext)) return null;

  const handleRunStartHere = async () => {
    const clientId = selectedClientId ?? null;
    setCreating(true);
    try {
      const taskId = await createTask(
        START_HERE_TITLE,
        START_HERE_DESCRIPTION,
        "task",
        null,  // projectSlug
        null,  // parentId
        "bypassPermissions",
        undefined,
        clientId
      );
      const tasks = useTaskStore.getState().tasks;
      const startHereTask = findStartHereTaskToQueue(tasks, taskId, clientId);
      if (shouldQueueBrandStartHereTask(startHereTask)) {
        await updateTask(startHereTask.id, { status: "queued" });
      }
    } finally {
      setCreating(false);
    }
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 16px",
        marginBottom: 12,
        borderRadius: 8,
        backgroundColor: "var(--cc-line-alpha-15)",
        border: "1px solid var(--cc-line-alpha-30)",
      }}
    >
      <Sparkles size={18} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
      <span
        style={{
          flex: 1,
          fontSize: 13,
          fontFamily: "var(--font-inter), Inter, sans-serif",
          color: "var(--cc-text-primary)",
        }}
      >
        {getBrandContextBannerMessage(selectedClientId ?? null)}
      </span>
      <button
        onClick={handleRunStartHere}
        disabled={creating}
        style={{
          padding: "6px 14px",
          borderRadius: 6,
          border: "none",
          backgroundColor: "var(--cc-brand-primary)",
          color: "var(--cc-surface)",
          fontSize: 12,
          fontWeight: 600,
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          cursor: creating ? "not-allowed" : "pointer",
          opacity: creating ? 0.6 : 1,
          whiteSpace: "nowrap",
        }}
      >
        {creating ? "Creating..." : "Run Start-Here"}
      </button>
    </div>
  );
}
