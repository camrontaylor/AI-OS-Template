"use client";

import { useEffect, useState, useRef } from "react";
import { ChevronDown, Globe, Check, Loader2, AlertCircle } from "lucide-react";
import { useClientStore } from "@/store/client-store";
import { useTaskStore } from "@/store/task-store";
import { TEAM_CONTEXT_CHANGE_EVENT } from "@/store/team-navigation-store";

interface ClientSwitcherProps {
  collapsed?: boolean;
  direction?: "up" | "down";
}

export function ClientSwitcher({ collapsed = false, direction = "up" }: ClientSwitcherProps) {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  const {
    clients,
    rootName,
    selectedClientId,
    isLoading,
    error,
    fetchClients,
    setSelectedClient,
    getSelectedClient,
  } = useClientStore();

  const fetchTasks = useTaskStore((s) => s.fetchTasks);

  useEffect(() => {
    fetchClients();
  }, [fetchClients]);

  useEffect(() => {
    const refresh = () => void fetchClients();
    window.addEventListener(TEAM_CONTEXT_CHANGE_EVENT, refresh);
    return () => window.removeEventListener(TEAM_CONTEXT_CHANGE_EVENT, refresh);
  }, [fetchClients]);

  // Close dropdown on outside click
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [isOpen]);

  const selectedClient = getSelectedClient();
  const displayName = selectedClient ? selectedClient.name : rootName;

  const handleSelect = (clientId: string | null) => {
    setSelectedClient(clientId);
    fetchTasks();
    setIsOpen(false);
  };

  // Empty state: no clients detected
  if (!isLoading && !error && clients.length === 0) {
    return (
      <div style={{ padding: collapsed ? "8px 0" : "8px 12px" }}>
        {!collapsed && (
          <>
            <div
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--cc-text-secondary)",
                marginBottom: 8,
              }}
            >
              WORKSPACE
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 40,
                padding: "0 12px",
                borderRadius: 6,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 14,
                fontWeight: 500,
                color: "var(--cc-text-primary-alt)",
              }}
            >
              <Globe size={16} style={{ color: "var(--cc-text-secondary)" }} />
              Root
            </div>
          </>
        )}
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div style={{ padding: collapsed ? "8px 0" : "8px 12px" }}>
        {!collapsed && (
          <>
            <div
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 10,
                textTransform: "uppercase",
                letterSpacing: "0.12em",
                color: "var(--cc-text-secondary)",
                marginBottom: 8,
              }}
            >
              WORKSPACE
            </div>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 8,
                height: 40,
                padding: "0 12px",
                color: "var(--cc-status-danger-alt)",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
              }}
            >
              <AlertCircle size={16} />
              Error loading clients
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div ref={containerRef} style={{ position: "relative", padding: collapsed ? "8px 0" : "8px 0" }}>
      {/* Section label */}
      {!collapsed && (
        <div
          style={{
            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
            fontSize: 10,
            textTransform: "uppercase",
            letterSpacing: "0.12em",
            color: "var(--cc-text-secondary)",
            marginBottom: 8,
            padding: "0 12px",
          }}
        >
          WORKSPACE
        </div>
      )}

      {/* Trigger button */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: collapsed ? "center" : "space-between",
          gap: 8,
          width: collapsed ? 40 : "100%",
          height: 40,
          padding: collapsed ? 0 : "0 12px",
          borderRadius: 6,
          border: "none",
          background: "transparent",
          cursor: "pointer",
          fontFamily: "var(--font-inter), Inter, sans-serif",
          fontSize: 13,
          fontWeight: 500,
          lineHeight: 1.2,
          color: "var(--cc-text-primary-alt)",
          transition: "background 150ms ease",
          margin: collapsed ? "0 auto" : 0,
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.backgroundColor = "var(--cc-surface-muted)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.backgroundColor = "transparent";
        }}
        title={collapsed ? `Workspace: ${displayName}` : undefined}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <Globe size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
          {!collapsed && (
            <span
              style={{
                display: "block",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {displayName}
            </span>
          )}
        </div>
        {!collapsed && (
          isLoading ? (
            <Loader2 size={16} style={{ color: "var(--cc-text-secondary)", animation: "spin 1s linear infinite" }} />
          ) : (
            <ChevronDown size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
          )
        )}
      </button>

      {/* Dropdown (opens upward) */}
      {isOpen && (
        <div
          style={{
            position: "absolute",
            ...(direction === "up"
              ? { bottom: "100%", marginBottom: 4 }
              : { top: "100%", marginTop: 4 }),
            left: 0,
            right: collapsed ? "auto" : 0,
            width: collapsed ? 240 : undefined,
            backgroundColor: "var(--cc-surface)",
            borderRadius: 8,
            boxShadow: "0 4px 12px var(--cc-brand-alpha-08)",
            border: "1px solid var(--cc-line-alpha-20)",
            maxHeight: 280,
            overflowY: "auto",
            padding: 4,
            zIndex: 100,
          }}
        >
          {/* Root option */}
          <button
            onClick={() => handleSelect(null)}
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              width: "100%",
              height: 40,
              padding: "8px 12px",
              borderRadius: 6,
              border: "none",
              background: selectedClientId === null ? "var(--cc-brand-soft)" : "transparent",
              cursor: "pointer",
              fontFamily: "var(--font-inter), Inter, sans-serif",
              fontSize: 13,
              color: selectedClientId === null ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
              transition: "background 150ms ease",
            }}
            onMouseEnter={(e) => {
              if (selectedClientId !== null) e.currentTarget.style.backgroundColor = "var(--cc-surface-muted)";
            }}
            onMouseLeave={(e) => {
              if (selectedClientId !== null) e.currentTarget.style.backgroundColor = "transparent";
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0, flex: 1 }}>
              <Globe size={16} style={{ color: selectedClientId === null ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)" }} />
              <div style={{ textAlign: "left", minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    fontWeight: 500,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {rootName}
                </div>
                <div
                  style={{
                    fontSize: 10,
                    color: selectedClientId === null ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
                    opacity: 0.7,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  All clients
                </div>
              </div>
            </div>
            {selectedClientId === null && <Check size={16} />}
          </button>

          {/* Divider */}
          <div
            style={{
              height: 1,
              backgroundColor: "var(--cc-line-alpha-20)",
              margin: "4px 0",
            }}
          />

          {/* Client items */}
          {clients.map((client) => (
            <button
              key={client.slug}
              onClick={() => handleSelect(client.slug)}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                width: "100%",
                height: 40,
                padding: "8px 12px",
                borderRadius: 6,
                border: "none",
                background: selectedClientId === client.slug ? "var(--cc-brand-soft)" : "transparent",
                cursor: "pointer",
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 13,
                color: selectedClientId === client.slug ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
                transition: "background 150ms ease",
              }}
              onMouseEnter={(e) => {
                if (selectedClientId !== client.slug) e.currentTarget.style.backgroundColor = "var(--cc-surface-muted)";
              }}
              onMouseLeave={(e) => {
                if (selectedClientId !== client.slug) e.currentTarget.style.backgroundColor = "transparent";
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    display: "block",
                    flex: 1,
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    whiteSpace: "nowrap",
                  }}
                >
                  {client.name}
                </span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
                <span
                  style={{
                    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                    fontSize: 11,
                    color: selectedClientId === client.slug ? "var(--cc-brand-strong)" : "var(--cc-text-secondary)",
                    opacity: 0.6,
                    whiteSpace: "nowrap",
                    overflow: "hidden",
                    textOverflow: "ellipsis",
                    maxWidth: 92,
                  }}
                >
                  clients/{client.slug}
                </span>
                {selectedClientId === client.slug && <Check size={16} />}
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
