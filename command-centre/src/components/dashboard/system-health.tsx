"use client";

import Link from "next/link";
import { Cpu, Clock, Palette, ArrowRight } from "lucide-react";
import type { DashboardSummary } from "@/types/dashboard";
import { Card } from "@/components/ui/card";

interface SystemHealthProps {
  system: DashboardSummary["system"];
}

export function SystemHealth({ system }: SystemHealthProps) {
  return (
    <Card className="min-w-0 flex-1 gap-0 rounded-lg border p-6 shadow-none">
      <div className="mb-3 flex items-center gap-2">
        <Cpu size={16} color="var(--muted-foreground)" />
        <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
          System Health
        </span>
      </div>
      <div className="flex flex-col gap-3">
        {/* Cron */}
        <Link href="/cron" className={linkRowClass}>
          <Clock size={14} color="var(--muted-foreground)" className="shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {system.cronActive > 0
                ? `${system.cronActive} scheduled task${system.cronActive !== 1 ? "s" : ""} active`
                : "No scheduled tasks configured"}
            </div>
            {system.cronLastRun && (
              <div className="mt-1 text-xs text-muted-foreground">
                Last: {system.cronLastRun.jobName} - {system.cronLastRun.result}
              </div>
            )}
          </div>
          <ArrowRight size={12} color="var(--muted-foreground)" className="shrink-0" />
        </Link>

        {/* Skills */}
        <Link href="/skills" className={linkRowClass}>
          <Cpu size={14} color="var(--muted-foreground)" className="shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {system.skillsInstalled} skill{system.skillsInstalled !== 1 ? "s" : ""} installed
            </div>
          </div>
          <ArrowRight size={12} color="var(--muted-foreground)" className="shrink-0" />
        </Link>

        {/* Brand context */}
        <Link href="/docs" className={linkRowClass}>
          <Palette size={14} color="var(--muted-foreground)" className="shrink-0" />
          <div className="flex-1">
            <div className="text-sm font-medium text-foreground">
              {system.brandContextFiles} brand context file{system.brandContextFiles !== 1 ? "s" : ""}
            </div>
          </div>
          <ArrowRight size={12} color="var(--muted-foreground)" className="shrink-0" />
        </Link>
      </div>
    </Card>
  );
}

const linkRowClass =
  "-mx-2 flex items-start gap-3 rounded-md px-2 py-2 text-inherit no-underline transition-colors hover:bg-muted/60";
