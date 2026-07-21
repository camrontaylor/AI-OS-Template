"use client";

import { useState, useRef, useEffect } from "react";
import { useClientStore } from "@/store/client-store";
import { Plus, Check, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

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
    <div className="flex items-end gap-3">
      {/* New Goal button — far left */}
      {onNewGoal && (
        <Button
          onClick={onNewGoal}
          size="sm"
          className="h-[32px] shrink-0 gap-2 whitespace-nowrap"
        >
          <Plus size={13} strokeWidth={2.5} />
          New Goal
        </Button>
      )}

      {/* Client filter dropdown */}
      {clients.length > 0 && (
        <div ref={ref} className="relative flex flex-col gap-1">
          <div className="mb-1 text-[10px] uppercase tracking-wide text-muted-foreground">
            Feed filter
          </div>
          <Button
            variant="outline"
            size="sm"
            onClick={() => setOpen((v) => !v)}
            className="h-[32px] gap-2 whitespace-nowrap text-muted-foreground"
          >
            {`Showing: ${filterLabel}`}
            <ChevronDown
              size={12}
              className={cn("transition-transform", open && "rotate-180")}
            />
          </Button>

          {open && (
            <div className="absolute left-0 top-[calc(100%+4px)] z-50 min-w-[200px] rounded-lg border border-border bg-card py-1 shadow-md">
              {/* "All" option — selects everything */}
              <DropdownRow
                label="All"
                checked={allSelected}
                onToggle={() => setAllActive()}
              />

              <div className="mx-3 my-1 h-px bg-border" />

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
      className={cn(
        "flex w-full items-center gap-2 px-3 py-2 text-left text-xs transition-colors hover:bg-muted/60",
        checked ? "text-foreground" : "text-muted-foreground",
      )}
    >
      <span
        className={cn(
          "inline-flex size-4 shrink-0 items-center justify-center rounded-[3px] border-[1.5px] transition-colors",
          checked ? "border-primary bg-muted" : "border-border bg-transparent",
        )}
      >
        {checked && <Check size={9} color="var(--primary)" strokeWidth={3} />}
      </span>
      {label}
    </button>
  );
}
