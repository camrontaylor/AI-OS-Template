"use client";

import { useEffect, useState } from "react";
import { Plus, Clock, AlertCircle, LayoutList } from "lucide-react";
import { useCronStore } from "@/store/cron-store";
import { useClientStore } from "@/store/client-store";
import { CronRow } from "./cron-row";
import { CreateJobPanel } from "./create-job-panel";
import { RuntimeStatus } from "./runtime-status";
import { ScheduledOperationsOverview } from "./scheduled-operations-overview";
import { buildScheduledOperationsBoard } from "@/lib/marketing-scheduled-operations";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";

export function CronJobsView() {
  const jobs = useCronStore((s) => s.jobs);
  const isLoading = useCronStore((s) => s.isLoading);
  const error = useCronStore((s) => s.error);
  const systemStatus = useCronStore((s) => s.systemStatus);
  const activeRuns = useCronStore((s) => s.activeRuns);
  const fetchJobs = useCronStore((s) => s.fetchJobs);
  const setShowCreatePanel = useCronStore((s) => s.setShowCreatePanel);
  const setEditingJob = useCronStore((s) => s.setEditingJob);
  const moveJob = useCronStore((s) => s.moveJob);
  const selectedClientId = useClientStore((s) => s.selectedClientId);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const operationsBoard = buildScheduledOperationsBoard(jobs, activeRuns);
  const tableGridColumns = "1.5fr 1fr 0.8fr 0.8fr 0.7fr 90px 280px";

  const handleDragStart = (e: React.DragEvent, index: number) => {
    setDragIndex(index);
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(index));
  };

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    setDragOverIndex(index);
  };

  const handleDrop = (e: React.DragEvent, index: number) => {
    e.preventDefault();
    if (dragIndex !== null && dragIndex !== index) {
      moveJob(dragIndex, index);
    }
    setDragIndex(null);
    setDragOverIndex(null);
  };

  const handleDragEnd = () => {
    setDragIndex(null);
    setDragOverIndex(null);
  };

  useEffect(() => {
    setEditingJob(null);
    fetchJobs();
  }, [fetchJobs, selectedClientId, setEditingJob]);

  return (
    <div className="flex flex-col gap-6">
      <ScheduledOperationsOverview
        jobs={jobs}
        operationsBoard={operationsBoard}
        systemStatus={systemStatus}
        selectedClientId={selectedClientId}
        onCreateJob={() => setShowCreatePanel(true)}
      />

      <RuntimeStatus />

      {error && (
        <Card className="flex-row items-start gap-3 rounded-lg border p-4 shadow-none">
          <AlertCircle className="mt-0.5 shrink-0 text-destructive" />
          <div className="min-w-0">
            <div className="text-sm font-medium text-foreground">Cron API error</div>
            <div className="mt-1 text-sm text-muted-foreground">{error}</div>
          </div>
        </Card>
      )}

      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h3 className="m-0 text-lg font-semibold text-foreground">Scheduled Operations</h3>
            <Badge variant="outline">{jobs.length}</Badge>
          </div>
          <p className="m-0 mt-1 text-sm text-muted-foreground">
            Jobs are grouped by operator state so failures, live runs, and paused workflows are visible first.
          </p>
        </div>
        <Button onClick={() => setShowCreatePanel(true)} size="sm">
          <Plus data-icon="inline-start" />
          Create Job
        </Button>
      </div>

      {isLoading && (
        <Card className="rounded-lg p-10 text-center text-sm text-muted-foreground shadow-none">
          Loading scheduled tasks...
        </Card>
      )}

      {!isLoading && jobs.length === 0 && (
        <Card className="rounded-lg px-5 py-16 text-center shadow-none">
          <Clock className="mx-auto mb-4 size-12 text-muted-foreground" />
          <h4 className="mb-2 text-base font-semibold text-foreground">
            No scheduled tasks configured yet
          </h4>
          <p className="mx-auto mb-5 max-w-sm text-sm text-muted-foreground">
            Set up recurring tasks to automate regular workflows.
          </p>
          <Button onClick={() => setShowCreatePanel(true)} size="sm">
            Create First Job
          </Button>
        </Card>
      )}

      {!isLoading && jobs.length > 0 && (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-4">
            {operationsBoard.lanes.map((lane) => (
              <Card key={lane.key} className="gap-0 rounded-lg py-0 shadow-none">
                <CardContent className="p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-foreground">{lane.title}</div>
                      <div className="mt-1 text-xs text-muted-foreground">{lane.description}</div>
                    </div>
                    <Badge variant={lane.operations.length ? "secondary" : "outline"}>
                      {lane.operations.length}
                    </Badge>
                  </div>
                </CardContent>
              </Card>
            ))}
          </div>

          {operationsBoard.lanes.map((lane) => (
            <Card key={lane.key} className="rounded-lg shadow-none">
              <CardHeader className="gap-2">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <CardTitle className="flex items-center gap-2 text-base">
                      <LayoutList className="text-muted-foreground" />
                      {lane.title}
                      <Badge variant="outline">{lane.operations.length}</Badge>
                    </CardTitle>
                    <CardDescription className="mt-1">{lane.description}</CardDescription>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {lane.operations.length === 0 ? (
                  <div className="rounded-lg border bg-background p-4 text-sm text-muted-foreground">
                    No jobs in this lane.
                  </div>
                ) : (
                  <div className="overflow-x-auto">
                    <div style={{ minWidth: 1050 }}>
                      <div
                        className="mb-3 grid gap-3 px-4 py-2 text-[10px] uppercase tracking-wider text-muted-foreground"
                        style={{
                          gridTemplateColumns: tableGridColumns,
                        }}
                      >
                        <span className="pl-[24px]">Name</span>
                        <span>Schedule</span>
                        <span>Last Run</span>
                        <span>Next Run</span>
                        <span>Avg Duration</span>
                        <span>Status</span>
                        <span>Actions</span>
                      </div>

                      {lane.operations.map((operation) => (
                        <CronRow
                          key={operation.jobKey}
                          job={operation.job}
                          index={operation.originalIndex}
                          onDragStart={handleDragStart}
                          onDragOver={handleDragOver}
                          onDrop={handleDrop}
                          onDragEnd={handleDragEnd}
                          isDragOver={dragOverIndex === operation.originalIndex}
                          isDragging={dragIndex === operation.originalIndex}
                          operation={operation}
                        />
                      ))}
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateJobPanel />
    </div>
  );
}
