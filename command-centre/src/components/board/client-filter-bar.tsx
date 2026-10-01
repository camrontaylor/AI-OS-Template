"use client";

import { useState, useRef, useEffect } from "react";
import { useClientStore } from "@/store/client-store";
import { Plus, Check, ChevronDown } from "lucide-react";

const MONO = "'DM Mono', monospace";

export function ClientFilterBar({
  onNewGoal,
}: {
  onNewGoal?: () => void;
}) {
  const clients = useClientStore((s) => s.clients);
  const rootName = useClientStore((s) => s.rootName);
  const toggleClient = useClientStore((s) => s.toggleClient);
  const setAllActive = useClientStore((s) => s.setAllActive);
  const isClientActive = useClientStore((s) => s.isClientActive);
  const activeClientSlugs = useClientStore((s) => s.activeClientSlugs);

  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Individual client items (root workspace + real clients)
  const clientItems = [
    { slug: "_root", name: rootName },
    ...clients.map((c) => ({ slug: c.slug, name: c.name })),
  ];

  const allSelected = activeClientSlugs === null;

  // Build display label
  const activeNames = clientItems.filter((item) => isClientActive(item.slug)).map((item) => item.name);
  const filterLabel = allSelected
    ? "All"
    : activeNames.length === 0
    ? "None"
    : activeNames.length <= 2
    ? activeNames.join(", ")
    : `${activeNames.length} selected`;

  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        gap: 10,
        padding: "0",
      }}
    >
      {/* New Goal button — far left */}
      {onNewGoal && (
        <button
          onClick={onNewGoal}
          style={{
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 5,
            height: 30,
            padding: "0 12px",
            fontSize: 11,
            fontWeight: 600,
            fontFamily: MONO,
            background: "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))",
            color: "var(--cc-surface)",
            border: "none",
            borderRadius: 6,
            cursor: "pointer",
            transition: "opacity 150ms ease",
            whiteSpace: "nowrap",
            flexShrink: 0,
          }}
          onMouseEnter={(e) => { e.currentTarget.style.opacity = "0.9"; }}
          onMouseLeave={(e) => { e.currentTarget.style.opacity = "1"; }}
        >
          <Plus size={13} strokeWidth={2.5} />
          New Goal
        </button>
      )}

      {/* Client filter dropdown */}
      {clients.length > 0 && (
        <div
          ref={ref}
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            gap: 4,
          }}
        >
          <div
            style={{
              fontSize: 10,
              fontFamily: MONO,
              color: "var(--cc-text-tertiary)",
              textTransform: "uppercase",
              letterSpacing: "0.06em",
              marginBottom: 4,
            }}
          >
            Feed filter
          </div>
          <button
            onClick={() => setOpen((v) => !v)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              gap: 5,
              height: 30,
              padding: "0 10px",
              fontSize: 11,
              fontFamily: MONO,
              fontWeight: 500,
              color: "var(--cc-text-secondary)",
              background: "none",
              border: "1px solid var(--cc-line-alpha-40)",
              borderRadius: 6,
              cursor: "pointer",
              transition: "border-color 120ms ease",
              whiteSpace: "nowrap",
            }}
            onMouseEnter={(e) => { e.currentTarget.style.borderColor = "var(--cc-line-alpha-70)"; }}
            onMouseLeave={(e) => { e.currentTarget.style.borderColor = "var(--cc-line-alpha-40)"; }}
          >
            {`Showing: ${filterLabel}`}
            <ChevronDown
              size={12}
              style={{
                transition: "transform 150ms ease",
                transform: open ? "rotate(180deg)" : "rotate(0deg)",
              }}
            />
          </button>

          {open && (
            <div
              style={{
                position: "absolute",
                top: "calc(100% + 4px)",
                left: 0,
                minWidth: 200,
                background: "var(--cc-surface)",
                border: "1px solid var(--cc-line-alpha-40)",
                borderRadius: 8,
                boxShadow: "0 4px 12px var(--cc-neutral-alpha-08)",
                zIndex: 50,
                padding: "4px 0",
              }}
            >
              {/* "All" option — selects everything */}
              <DropdownRow
                label="All"
                checked={allSelected}
                onToggle={() => setAllActive()}
              />

              <div style={{
                height: 1,
                background: "var(--cc-line-alpha-25)",
                margin: "4px 12px",
              }} />

              {/* Individual clients */}
              {clientItems.map((item) => (
                <DropdownRow
                  key={item.slug}
                  label={item.name}
                  checked={isClientActive(item.slug)}
                  onToggle={() => toggleClient(item.slug)}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function DropdownRow({
  label,
  checked,
  onToggle,
}: {
  label: string;
  checked: boolean;
  onToggle: () => void;
}) {
  return (
    <button
      onClick={onToggle}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: "100%",
        padding: "6px 12px",
        background: "none",
        border: "none",
        cursor: "pointer",
        fontSize: 12,
        fontFamily: "'DM Mono', monospace",
        color: checked ? "var(--cc-palette-neutral-900)" : "var(--cc-text-tertiary)",
        textAlign: "left",
        transition: "background 80ms ease",
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-line-alpha-10)"; }}
      onMouseLeave={(e) => { e.currentTarget.style.background = "none"; }}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 14,
          height: 14,
          borderRadius: 3,
          border: checked ? "1.5px solid var(--cc-brand-primary)" : "1.5px solid var(--cc-palette-neutral-400)",
          background: checked ? "var(--cc-brand-alpha-08)" : "transparent",
          transition: "all 0.12s",
          flexShrink: 0,
        }}
      >
        {checked && <Check size={9} color="var(--cc-brand-primary)" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}
