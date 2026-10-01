"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useCronStore } from "@/store/cron-store";
import { CLAUDE_MODEL_OPTIONS, normalizeClaudeModel } from "@/lib/claude-options";
import { ScheduleSelector } from "./schedule-selector";

export function CreateJobPanel() {
  const showCreatePanel = useCronStore((s) => s.showCreatePanel);
  const setShowCreatePanel = useCronStore((s) => s.setShowCreatePanel);
  const createJob = useCronStore((s) => s.createJob);
  const updateJob = useCronStore((s) => s.updateJob);
  const editingJob = useCronStore((s) => s.editingJob);
  const setEditingJob = useCronStore((s) => s.setEditingJob);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState({ time: "09:00", days: "daily" });
  const [model, setModel] = useState("sonnet");
  const [prompt, setPrompt] = useState("");

  // Sync state when editingJob changes
  useEffect(() => {
    if (editingJob) {
      setName(editingJob.name || "");
      setDescription(editingJob.description || "");
      setSchedule({ time: editingJob.time || "09:00", days: editingJob.days || "daily" });
      setModel(editingJob.model || "sonnet");
      setPrompt(editingJob.prompt || "");
    } else {
      setName("");
      setDescription("");
      setSchedule({ time: "09:00", days: "daily" });
      setModel("sonnet");
      setPrompt("");
    }
  }, [editingJob]);

  if (!showCreatePanel && !editingJob) return null;

  const handleClose = () => {
    setShowCreatePanel(false);
    setEditingJob(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const normalizedModel = normalizeClaudeModel(model);
    if (!name.trim() || !prompt.trim() || !normalizedModel) return;

    if (editingJob) {
      updateJob(editingJob.slug, {
        name: name.trim(),
        description: description.trim(),
        time: schedule.time,
        days: schedule.days,
        model: normalizedModel,
        prompt: prompt.trim(),
      });
    } else {
      createJob({
        name: name.trim(),
        description: description.trim(),
        time: schedule.time,
        days: schedule.days,
        model: normalizedModel,
        prompt: prompt.trim(),
      });
    }
  };

  const canSubmit = Boolean(name.trim() && prompt.trim() && normalizeClaudeModel(model));

  const inputStyle: React.CSSProperties = {
    width: "100%",
    padding: "10px 12px",
    borderRadius: "0.375rem",
    border: "1px solid var(--cc-line-alpha-20)",
    backgroundColor: "var(--cc-surface)",
    fontSize: 14,
    fontFamily: "var(--font-inter), Inter, sans-serif",
    color: "var(--cc-text-primary)",
    outline: "none",
    transition: "border-color 150ms ease, box-shadow 150ms ease",
    boxSizing: "border-box" as const,
  };

  const labelStyle: React.CSSProperties = {
    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
    fontSize: 10,
    textTransform: "uppercase",
    letterSpacing: "0.12em",
    color: "var(--cc-text-secondary)",
    marginBottom: 6,
    display: "block",
  };

  return (
    <>
      {/* Overlay */}
      <div
        onClick={handleClose}
        style={{
          position: "fixed",
          inset: 0,
          backgroundColor: "var(--cc-neutral-alpha-35)",
          zIndex: 100,
        }}
      />

      {/* Panel */}
      <div
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          width: 480,
          backgroundColor: "var(--cc-surface)",
          zIndex: 101,
          display: "flex",
          flexDirection: "column",
          boxShadow: "0px 12px 32px var(--cc-brand-alpha-06)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            padding: "16px 24px",
            borderBottom: "1px solid var(--cc-line-alpha-15)",
          }}
        >
          <h3
            style={{
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontWeight: 700,
              fontSize: 18,
              color: "var(--cc-brand-primary)",
              margin: 0,
            }}
          >
            {editingJob ? "Edit Job" : "Create Job"}
          </h3>
          <button
            onClick={handleClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 4,
              color: "var(--cc-text-secondary)",
              display: "flex",
              alignItems: "center",
            }}
          >
            <X size={20} />
          </button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          style={{
            flex: 1,
            overflow: "auto",
            padding: 24,
            display: "flex",
            flexDirection: "column",
            gap: 20,
          }}
        >
          {/* Name */}
          <div>
            <label style={labelStyle}>Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly Competitor Scan"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--cc-brand-primary)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px var(--cc-brand-alpha-10)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--cc-line-alpha-20)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Description */}
          <div>
            <label style={labelStyle}>Description</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this job does"
              style={inputStyle}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--cc-brand-primary)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px var(--cc-brand-alpha-10)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--cc-line-alpha-20)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>

          {/* Schedule */}
          <div>
            <label style={labelStyle}>Schedule</label>
            <ScheduleSelector value={schedule} onChange={setSchedule} />
          </div>

          {/* Model */}
          <div>
            <label style={labelStyle}>Model</label>
            <input
              list="claude-model-options"
              value={model}
              onChange={(e) => setModel(e.target.value)}
              placeholder="sonnet"
              style={{
                ...inputStyle,
                borderColor: normalizeClaudeModel(model) ? inputStyle.borderColor : "#555555",
              }}
            />
            <datalist id="claude-model-options">
              {CLAUDE_MODEL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {option.label}
                </option>
              ))}
            </datalist>
          </div>

          {/* Prompt */}
          <div>
            <label style={labelStyle}>Prompt</label>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the recurring task..."
              rows={8}
              style={{
                ...inputStyle,
                resize: "vertical",
                minHeight: 160,
              }}
              onFocus={(e) => {
                e.currentTarget.style.borderColor = "var(--cc-brand-primary)";
                e.currentTarget.style.boxShadow =
                  "0 0 0 2px var(--cc-brand-alpha-10)";
              }}
              onBlur={(e) => {
                e.currentTarget.style.borderColor = "var(--cc-line-alpha-20)";
                e.currentTarget.style.boxShadow = "none";
              }}
            />
          </div>
        </form>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "flex-end",
            gap: 12,
            padding: "16px 24px",
            borderTop: "1px solid var(--cc-line-alpha-15)",
          }}
        >
          <button
            type="button"
            onClick={handleClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: "10px 16px",
              fontSize: 14,
              fontWeight: 500,
              color: "var(--cc-text-secondary)",
              fontFamily: "var(--font-inter), Inter, sans-serif",
            }}
          >
            Cancel
          </button>
            <button
            type="submit"
            onClick={handleSubmit}
            disabled={!canSubmit}
            style={{
              background: "linear-gradient(135deg, var(--cc-brand-primary) 0%, var(--cc-brand-hover) 100%)",
              color: "var(--cc-surface)",
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontWeight: 600,
              padding: "10px 20px",
              borderRadius: "0.375rem",
              border: "none",
              cursor: canSubmit ? "pointer" : "not-allowed",
              fontSize: 14,
              opacity: canSubmit ? 1 : 0.5,
              transition: "opacity 150ms ease",
            }}
          >
            {editingJob ? "Save Changes" : "Create Job"}
          </button>
        </div>
      </div>
    </>
  );
}
