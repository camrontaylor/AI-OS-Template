"use client";

import { useMemo } from "react";
import { useClientStore } from "@/store/client-store";
import { useTaskStore } from "@/store/task-store";

function arraysEqual(a: string[] | null, b: string[] | null): boolean {
  if (a === null || b === null) return a === b;
  if (a.length !== b.length) return false;
  return a.every((value, index) => value === b[index]);
}

export function ScopeBar() {
  const clients = useClientStore((s) => s.clients);
  const rootName = useClientStore((s) => s.rootName);
  const selectedClientId = useClientStore((s) => s.selectedClientId);
  const activeClientSlugs = useClientStore((s) => s.activeClientSlugs);
  const setSelectedClient = useClientStore((s) => s.setSelectedClient);
  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  const workspaceLabel = useMemo(() => {
    const client = selectedClientId
      ? clients.find((item) => item.slug === selectedClientId) ?? null
      : null;
    if (client) return client.name;
    return `${rootName} (all clients)`;
  }, [clients, rootName, selectedClientId]);

  const defaultFeedScope = selectedClientId ? [selectedClientId] : null;
  const hasFeedOverride = !arraysEqual(activeClientSlugs, defaultFeedScope);

  const feedSummary = useMemo(() => {
    if (!hasFeedOverride) return null;
    if (activeClientSlugs === null) return "All clients";
    if (activeClientSlugs.length === 0) return "No clients";

    const names = activeClientSlugs.map((slug) => {
      if (slug === "_root") return rootName;
      return clients.find((client) => client.slug === slug)?.name ?? slug;
    });

    if (names.length <= 2) {
      return names.join(", ");
    }
    return `${names.length} clients`;
  }, [activeClientSlugs, clients, hasFeedOverride, rootName]);

  const handleSwitchToRoot = () => {
    setSelectedClient(null);
    fetchTasks();
  };

  return (
    <div
      style={{
        minHeight: 32,
        backgroundColor: "var(--cc-brand-soft)",
        borderBottom: "1px solid var(--cc-line-alpha-20)",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "6px 24px",
        fontFamily: "var(--font-inter), Inter, sans-serif",
        flexWrap: "wrap",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          flexWrap: "wrap",
        }}
      >
        <span
          style={{
            fontSize: 12,
            fontWeight: 500,
            color: "var(--cc-brand-strong)",
          }}
        >
          Workspace: {workspaceLabel}
        </span>
        {feedSummary && (
          <span
            style={{
              fontSize: 11,
              fontWeight: 500,
              color: "var(--cc-brand-primary)",
              backgroundColor: "var(--cc-neutral-alpha-40)",
              border: "1px solid var(--cc-brand-alpha-12)",
              borderRadius: 999,
              padding: "2px 8px",
            }}
          >
            Feed-only filter: {feedSummary}
          </span>
        )}
      </div>
      {selectedClientId && (
        <button
          onClick={handleSwitchToRoot}
          style={{
            background: "none",
            border: "none",
            cursor: "pointer",
            fontSize: 12,
            fontFamily: "var(--font-inter), Inter, sans-serif",
            color: "var(--cc-brand-primary)",
            padding: 0,
            textDecoration: "none",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.textDecoration = "underline";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.textDecoration = "none";
          }}
        >
          Switch to Root
        </button>
      )}
    </div>
  );
}
