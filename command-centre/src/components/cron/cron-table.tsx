"use client";

import { useEffect, useState } from "react";
import { Plus, Clock } from "lucide-react";
import { useCronStore } from "@/store/cron-store";
import { useClientStore } from "@/store/client-store";
import { CronRow } from "./cron-row";
import { CreateJobPanel } from "./create-job-panel";
import { RuntimeStatus } from "./runtime-status";

export function CronJobsView() {
  const jobs = useCronStore((s) => s.jobs);
  const isLoading = useCronStore((s) => s.isLoading);
  const fetchJobs = useCronStore((s) => s.fetchJobs);
  const setShowCreatePanel = useCronStore((s) => s.setShowCreatePanel);
  const setEditingJob = useCronStore((s) => s.setEditingJob);
  const moveJob = useCronStore((s) => s.moveJob);
  const selectedClientId = useClientStore((s) => s.selectedClientId);

  const [dragIndex, setDragIndex] = useState<number | null>(null);
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);

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

  const activeCount = jobs.filter((j) => j.active).length;
  const pausedCount = jobs.filter((j) => !j.active).length;
  const todayStr = new Date().toISOString().slice(0, 10);
  const runsToday = jobs.filter(
    (j) => j.lastRun?.lastRun && j.lastRun.lastRun.startsWith(todayStr)
  ).length;

  const statCardStyle: React.CSSProperties = {
    backgroundColor: "var(--cc-surface)",
    borderRadius: "0.375rem",
    padding: "14px 20px",
    flex: 1,
    minWidth: 0,
  };

  const statValueStyle: React.CSSProperties = {
    fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
    fontSize: 22,
    fontWeight: 700,
    color: "var(--cc-text-primary)",
  };

  const statLabelStyle: React.CSSProperties = {
    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
    fontSize: 10,
    textTransform: "uppercase" as const,
    letterSpacing: "0.12em",
    color: "var(--cc-text-secondary)",
    marginTop: 2,
  };

  return (
    <div>
      <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
        <div style={statCardStyle}>
          <div style={statValueStyle}>{activeCount}</div>
          <div style={statLabelStyle}>Active Jobs</div>
        </div>
        <div style={statCardStyle}>
          <div style={statValueStyle}>{pausedCount}</div>
          <div style={statLabelStyle}>Paused Jobs</div>
        </div>
        <div style={statCardStyle}>
          <div style={statValueStyle}>{runsToday}</div>
          <div style={statLabelStyle}>Runs Today</div>
        </div>
        <div style={statCardStyle}>
          <div style={{ ...statValueStyle, fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif" }}>
            $0.00
          </div>
          <div style={statLabelStyle}>Today&apos;s Spend</div>
        </div>
      </div>

      <RuntimeStatus />

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: 16,
        }}
      >
        <h3
          style={{
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 700,
            fontSize: 18,
            color: "var(--cc-text-primary)",
            margin: 0,
          }}
        >
          Scheduled Tasks
        </h3>
        <button
          onClick={() => setShowCreatePanel(true)}
          style={{
            background: "linear-gradient(135deg, var(--cc-brand-primary) 0%, var(--cc-brand-hover) 100%)",
            color: "var(--cc-surface)",
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 600,
            height: 34,
            padding: "0 16px",
            borderRadius: "0.375rem",
            border: "none",
            cursor: "pointer",
            fontSize: 13,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: 6,
          }}
        >
          <Plus size={14} />
          Create Job
        </button>
      </div>

      {/* Table container for horizontal scroll */}
      <div style={{ overflowX: "auto" }}>
        <div style={{ minWidth: 1050 }}>
          {/* Table header */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1.5fr 1fr 0.8fr 0.8fr 0.7fr 90px 280px",
          gap: 12,
          padding: "8px 16px",
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          fontSize: 10,
          textTransform: "uppercase",
          letterSpacing: "0.12em",
          color: "var(--cc-text-secondary)",
          marginBottom: 10,
        }}
      >
        <span style={{ paddingLeft: 22 }}>Name</span>
        <span>Schedule</span>
        <span>Last Run</span>
        <span>Next Run</span>
        <span>Avg Duration</span>
        <span>Status</span>
        <span>Actions</span>
      </div>

          {isLoading && (
            <div
              style={{
                textAlign: "center",
                padding: 40,
                fontFamily: "var(--font-inter), Inter, sans-serif",
                fontSize: 14,
                color: "var(--cc-text-secondary)",
              }}
            >
              Loading scheduled tasks...
            </div>
          )}

          {!isLoading && jobs.length === 0 && (
            <div
              style={{
                textAlign: "center",
                padding: "60px 20px",
                fontFamily: "var(--font-inter), Inter, sans-serif",
              }}
            >
              <Clock size={48} color="var(--cc-text-secondary)" style={{ marginBottom: 16 }} />
              <h4
                style={{
                  fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                  fontWeight: 600,
                  fontSize: 16,
                  color: "var(--cc-text-primary)",
                  margin: "0 0 8px 0",
                }}
              >
                No scheduled tasks configured yet
              </h4>
              <p
                style={{
                  fontSize: 14,
                  color: "var(--cc-text-secondary)",
                  maxWidth: 320,
                  margin: "0 auto 20px",
                }}
              >
                Set up recurring tasks to automate your regular workflows.
              </p>
              <button
                onClick={() => setShowCreatePanel(true)}
                style={{
                  background: "linear-gradient(135deg, var(--cc-brand-primary) 0%, var(--cc-brand-hover) 100%)",
                  color: "var(--cc-surface)",
                  fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                  fontWeight: 600,
                  height: 36,
                  padding: "0 20px",
                  borderRadius: "0.375rem",
                  border: "none",
                  cursor: "pointer",
                  fontSize: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                Create First Job
              </button>
            </div>
          )}

          {!isLoading &&
            jobs.map((job, i) => (
              <CronRow
                key={`${job.clientId ?? "root"}:${job.slug}`}
                job={job}
                index={i}
                onDragStart={handleDragStart}
                onDragOver={handleDragOver}
                onDrop={handleDrop}
                onDragEnd={handleDragEnd}
                isDragOver={dragOverIndex === i}
                isDragging={dragIndex === i}
              />
            ))}
        </div>
      </div>

      <CreateJobPanel />
    </div>
  );
}
