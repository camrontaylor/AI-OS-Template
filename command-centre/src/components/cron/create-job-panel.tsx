"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { useCronStore } from "@/store/cron-store";
import { ScheduleSelector } from "./schedule-selector";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";

export function CreateJobPanel() {
  const showCreatePanel = useCronStore((s) => s.showCreatePanel);
  const setShowCreatePanel = useCronStore((s) => s.setShowCreatePanel);
  const createJob = useCronStore((s) => s.createJob);
  const updateJob = useCronStore((s) => s.updateJob);
  const editingJob = useCronStore((s) => s.editingJob);
  const setEditingJob = useCronStore((s) => s.setEditingJob);
  const createJobDraft = useCronStore((s) => s.createJobDraft);
  const setCreateJobDraft = useCronStore((s) => s.setCreateJobDraft);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [schedule, setSchedule] = useState({ time: "09:00", days: "daily" });
  const [model, setModel] = useState("sonnet");
  const [prompt, setPrompt] = useState("");

  // Sync state when editing, opening a template draft, or creating a blank job.
  useEffect(() => {
    if (editingJob) {
      setName(editingJob.name || "");
      setDescription(editingJob.description || "");
      setSchedule({ time: editingJob.time || "09:00", days: editingJob.days || "daily" });
      setModel(editingJob.model || "sonnet");
      setPrompt(editingJob.prompt || "");
    } else if (createJobDraft) {
      setName(createJobDraft.name || "");
      setDescription(createJobDraft.description || "");
      setSchedule({ time: createJobDraft.time || "09:00", days: createJobDraft.days || "daily" });
      setModel(createJobDraft.model || "sonnet");
      setPrompt(createJobDraft.prompt || "");
    } else {
      setName("");
      setDescription("");
      setSchedule({ time: "09:00", days: "daily" });
      setModel("sonnet");
      setPrompt("");
    }
  }, [editingJob, createJobDraft]);

  if (!showCreatePanel && !editingJob) return null;

  const handleClose = () => {
    setShowCreatePanel(false);
    setEditingJob(null);
    setCreateJobDraft(null);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim() || !prompt.trim()) return;

    if (editingJob) {
      updateJob(editingJob.slug, {
        name: name.trim(),
        description: description.trim(),
        time: schedule.time,
        days: schedule.days,
        model,
        prompt: prompt.trim(),
      });
    } else {
      createJob({
        name: name.trim(),
        description: description.trim(),
        time: schedule.time,
        days: schedule.days,
        model,
        prompt: prompt.trim(),
      });
    }
  };

  const labelClass =
    "mb-2 block text-[10px] uppercase tracking-wider text-muted-foreground";

  return (
    <>
      {/* Overlay */}
      <div
        onClick={handleClose}
        className="fixed inset-0 z-[100] bg-foreground/20"
      />

      {/* Panel */}
      <div className="fixed inset-y-0 right-0 z-[101] flex w-full flex-col border-l border-border bg-card shadow-lg sm:w-[480px]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-border px-6 py-4">
          <h3 className="text-lg font-semibold text-foreground">
            {editingJob ? "Edit Job" : "Create Job"}
          </h3>
          <Button
            variant="ghost"
            size="icon"
            onClick={handleClose}
            className="text-muted-foreground"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Form */}
        <form
          onSubmit={handleSubmit}
          className="flex flex-1 flex-col gap-5 overflow-auto p-6"
        >
          {/* Name */}
          <div>
            <Label className={labelClass}>Name</Label>
            <Input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Weekly Competitor Scan"
            />
          </div>

          {/* Description */}
          <div>
            <Label className={labelClass}>Description</Label>
            <Input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Brief description of what this job does"
            />
          </div>

          {/* Schedule */}
          <div>
            <Label className={labelClass}>Schedule</Label>
            <ScheduleSelector value={schedule} onChange={setSchedule} />
          </div>

          {/* Model */}
          <div>
            <Label className={labelClass}>Model</Label>
            <select
              value={model}
              onChange={(e) => setModel(e.target.value)}
              className="h-9 w-full rounded-md border border-input bg-transparent px-3 text-sm text-foreground outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
            >
              <option value="haiku">Haiku</option>
              <option value="sonnet">Sonnet</option>
              <option value="opus">Opus</option>
            </select>
          </div>

          {/* Prompt */}
          <div>
            <Label className={labelClass}>Prompt</Label>
            <Textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              placeholder="Describe the recurring task..."
              rows={8}
              className="min-h-40 resize-y"
            />
          </div>
        </form>

        {/* Footer */}
        <div className="flex justify-end gap-3 border-t border-border px-6 py-4">
          <Button type="button" variant="ghost" onClick={handleClose}>
            Cancel
          </Button>
          <Button
            type="submit"
            onClick={handleSubmit}
            disabled={!name.trim() || !prompt.trim()}
          >
            {editingJob ? "Save Changes" : "Create Job"}
          </Button>
        </div>
      </div>
    </>
  );
}
