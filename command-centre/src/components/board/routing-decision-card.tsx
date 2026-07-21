"use client";

import { X } from "lucide-react";
import type { TaskLevel } from "@/types/task";
import { LEVEL_COLORS, LEVEL_LABELS, LEVEL_ICONS } from "@/lib/levels";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

/**
 * Screen B — Auto-routing decision card.
 *
 * Rendered after the user submits a goal in "Auto" mode. Shows the routing
 * decision (level + confidence), reasoning, overlaps with existing work, and
 * clarification questions. User can proceed, change level, or dismiss.
 *
 * Wired to inline styles to match the rest of `components/board/`.
 */

export interface RoutingDecision {
  level: TaskLevel;
  confidence: number; // 0-1
  reasoning?: string;
  bullets?: string[];
  overlaps?: Array<{ taskId: string; title: string }>;
  clarifications?: string[];
}

interface Props {
  decision: RoutingDecision;
  goal: string;
  loading?: boolean;
  onProceed: () => void;
  onChangeLevel: () => void;
  onDismiss: () => void;
}

export function RoutingDecisionCard({
  decision,
  goal,
  loading,
  onProceed,
  onChangeLevel,
  onDismiss,
}: Props) {
  const levelColor = LEVEL_COLORS[decision.level];
  const confidencePct = Math.round((decision.confidence ?? 0) * 100);

  if (loading) {
    return (
      <Card className="relative mb-4 rounded-lg border p-4 shadow-none">
        <div className="mb-3 flex items-center gap-3">
          <Skeleton className="h-5 w-[92px]" />
          <Skeleton className="h-4 w-[140px]" />
        </div>
        <Skeleton className="mb-2 h-4 w-full" />
        <Skeleton className="mb-2 h-4 w-[85%]" />
        <Skeleton className="mb-4 h-4 w-[60%]" />
        <div className="flex gap-2">
          <Skeleton className="h-[32px] w-[92px]" />
          <Skeleton className="h-[32px] w-[112px]" />
        </div>
      </Card>
    );
  }

  return (
    <Card className="relative mb-4 rounded-lg border p-4 shadow-none">
      {/* Dismiss button */}
      <Button
        variant="ghost"
        size="icon"
        onClick={onDismiss}
        title="Dismiss"
        className="absolute right-2 top-2 size-7 text-muted-foreground hover:text-destructive"
      >
        <X size={14} />
      </Button>

      {/* Header: level badge + confidence */}
      <div className="mb-3 flex items-center gap-3 pr-6">
        <span
          style={{ backgroundColor: levelColor.bg, color: levelColor.text }}
          className="inline-flex items-center gap-2 rounded px-3 py-1 text-[11px] font-semibold uppercase tracking-wide"
        >
          <span aria-hidden>{LEVEL_ICONS[decision.level]}</span>
          {LEVEL_LABELS[decision.level]}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground">
          {confidencePct}% confident
        </span>
        {/* Confidence meter */}
        <div className="h-1 max-w-[120px] flex-1 overflow-hidden rounded-sm bg-border">
          <div
            style={{ width: `${confidencePct}%` }}
            className="h-full bg-primary transition-[width] duration-300"
          />
        </div>
      </div>

      {/* Goal */}
      <div className="mb-3 text-[13px] font-semibold leading-snug text-foreground">
        {goal}
      </div>

      {/* Reasoning */}
      {decision.reasoning && (
        <div
          className={cn(
            "text-xs leading-relaxed text-muted-foreground",
            decision.bullets?.length ? "mb-2" : "mb-3",
          )}
        >
          {decision.reasoning}
        </div>
      )}

      {/* Bullets */}
      {decision.bullets && decision.bullets.length > 0 && (
        <ul className="mb-3 list-disc pl-[20px] text-xs leading-relaxed text-muted-foreground">
          {decision.bullets.map((b, i) => (
            <li key={i} className="mb-1">{b}</li>
          ))}
        </ul>
      )}

      {/* Overlaps */}
      {decision.overlaps && decision.overlaps.length > 0 && (
        <div className="mb-3 mt-1 border-t border-border pt-2">
          <div className={sectionLabel}>Overlaps with existing work</div>
          <div className="flex flex-wrap gap-2">
            {decision.overlaps.map((o) => (
              <Badge
                key={o.taskId}
                variant="secondary"
                className="px-2 py-1 text-[11px] font-normal"
              >
                {o.title}
              </Badge>
            ))}
          </div>
        </div>
      )}

      {/* Clarifications */}
      {decision.clarifications && decision.clarifications.length > 0 && (
        <div className="mb-3 mt-1 border-t border-border pt-2">
          <div className={sectionLabel}>Needs clarification</div>
          <ul className="list-disc pl-[20px] text-xs leading-relaxed text-muted-foreground">
            {decision.clarifications.map((c, i) => (
              <li key={i} className="mb-1">{c}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Actions */}
      <div className="mt-4 flex items-center gap-2">
        <Button onClick={onProceed} size="sm">
          Proceed
        </Button>
        <Button onClick={onChangeLevel} variant="outline" size="sm">
          Change level…
        </Button>
      </div>
    </Card>
  );
}

const sectionLabel =
  "mb-2 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground";
