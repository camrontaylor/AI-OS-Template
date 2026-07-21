"use client";

import { useState } from "react";
import { CheckCircle2, RotateCcw } from "lucide-react";
import type { Task } from "@/types/task";
import { useTaskStore } from "@/store/task-store";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

interface ReviewBannerProps {
  task: Task;
  onIterate: (prefill: string) => void;
  /** Called after Approve succeeds — parent should close the detail view. */
  onApprove?: () => void;
}

export function ReviewBanner({ task, onIterate, onApprove }: ReviewBannerProps) {
  const [isApproving, setIsApproving] = useState(false);
  const updateTask = useTaskStore((s) => s.updateTask);

  if (task.status !== "review") return null;

  const handleApprove = async () => {
    setIsApproving(true);
    try {
      await updateTask(task.id, { status: "done", needsInput: false, completedAt: new Date().toISOString() });
      onApprove?.();
    } catch {
      setIsApproving(false);
    }
  };

  return (
    <Card className="mb-2 shrink-0 flex-row items-center justify-between gap-3 rounded-lg border px-4 py-3 shadow-none">
      <span className="text-xs font-semibold text-muted-foreground">
        Ready for review
      </span>
      <div className="flex gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => onIterate("Iterate on the above: ")}
          className="gap-1 text-[11px] text-muted-foreground"
        >
          <RotateCcw size={11} />
          Iterate
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={handleApprove}
          disabled={isApproving}
          className="gap-1 text-[11px] text-muted-foreground"
        >
          <CheckCircle2 size={11} />
          Approve
        </Button>
      </div>
    </Card>
  );
}
