"use client";

import { useState, useRef, useCallback } from "react";
import { X, FolderUp, FileText, Check, AlertCircle, Sparkles, Link, ArrowRight } from "lucide-react";
import { useTaskStore } from "@/store/task-store";

interface UploadedFile {
  name: string;
  relativePath: string;
}

type ModalTab = "upload" | "create";

interface SkillUploadModalProps {
  onClose: () => void;
  onComplete: () => void;
}

export function SkillUploadModal({ onClose, onComplete }: SkillUploadModalProps) {
  const [activeTab, setActiveTab] = useState<ModalTab>("create");

  // Upload tab state
  const [isDragging, setIsDragging] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadedFiles, setUploadedFiles] = useState<UploadedFile[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [skillFolder, setSkillFolder] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Create with AI tab state
  const [skillDescription, setSkillDescription] = useState("");
  const [referenceUrl, setReferenceUrl] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [taskCreated, setTaskCreated] = useState(false);

  const createTask = useTaskStore((s) => s.createTask);
  const updateTask = useTaskStore((s) => s.updateTask);

  const handleFiles = useCallback(async (files: FileList) => {
    if (files.length === 0) return;

    setUploading(true);
    setError(null);

    // Determine the skill folder name from the first file's path
    const firstFile = files[0];
    const relativePath = firstFile.webkitRelativePath || firstFile.name;
    const topFolder = relativePath.split("/")[0];
    setSkillFolder(topFolder);

    const results: UploadedFile[] = [];

    for (const file of Array.from(files)) {
      const relPath = file.webkitRelativePath || file.name;
      // Build the target path: .claude/skills/{folder structure}
      const targetPath = `.claude/skills/${relPath}`;
      const targetDir = targetPath.substring(0, targetPath.lastIndexOf("/"));

      try {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("dir", targetDir);

        const res = await fetch("/api/files/upload", {
          method: "POST",
          body: formData,
        });

        if (!res.ok) {
          const data = await res.json();
          throw new Error(data.error || `Failed to upload ${file.name}`);
        }

        results.push({ name: file.name, relativePath: relPath });
      } catch (err) {
        setError(err instanceof Error ? err.message : "Upload failed");
        setUploading(false);
        return;
      }
    }

    setUploadedFiles(results);
    setUploading(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);

    const items = e.dataTransfer.items;
    if (items && items.length > 0) {
      // Try to get folder entries
      const allFiles: File[] = [];
      let pending = 0;

      const processEntry = (entry: FileSystemEntry, path: string) => {
        if (entry.isFile) {
          pending++;
          (entry as FileSystemFileEntry).file((file) => {
            // Attach the relative path
            Object.defineProperty(file, "webkitRelativePath", {
              value: path + file.name,
              writable: false,
            });
            allFiles.push(file);
            pending--;
            if (pending === 0) {
              const dt = new DataTransfer();
              allFiles.forEach((f) => dt.items.add(f));
              handleFiles(dt.files);
            }
          });
        } else if (entry.isDirectory) {
          pending++;
          const reader = (entry as FileSystemDirectoryEntry).createReader();
          reader.readEntries((entries) => {
            for (const child of entries) {
              processEntry(child, path + entry.name + "/");
            }
            pending--;
            if (pending === 0 && allFiles.length > 0) {
              const dt = new DataTransfer();
              allFiles.forEach((f) => dt.items.add(f));
              handleFiles(dt.files);
            }
          });
        }
      };

      for (let i = 0; i < items.length; i++) {
        const entry = items[i].webkitGetAsEntry?.();
        if (entry) {
          processEntry(entry, "");
        }
      }
    }
  }, [handleFiles]);

  const handleFolderInput = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFiles(files);
    }
  }, [handleFiles]);

  const handleCreateWithAI = useCallback(async () => {
    const desc = skillDescription.trim();
    if (!desc || isCreating) return;

    setIsCreating(true);
    setError(null);

    try {
      // Build the task description for meta-skill-creator
      let taskDescription = `Run /meta-skill-creator\n\nCreate a new skill based on the following:\n\n${desc}`;
      if (referenceUrl.trim()) {
        taskDescription += `\n\nReference URL: ${referenceUrl.trim()}`;
      }

      const taskTitle = "Create skill: " + (desc.length > 50 ? desc.slice(0, 47) + "..." : desc);

      await createTask(taskTitle, taskDescription, "task");

      // Auto-queue the task
      const tasks = useTaskStore.getState().tasks;
      const newTask = tasks.find(
        (t) => t.title === taskTitle && t.status === "backlog"
      );
      if (newTask) {
        await updateTask(newTask.id, { status: "queued" });
      }

      setTaskCreated(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create task");
    } finally {
      setIsCreating(false);
    }
  }, [skillDescription, referenceUrl, isCreating, createTask, updateTask]);

  const tabStyle = (isActive: boolean): React.CSSProperties => ({
    flex: 1,
    padding: "10px 0",
    fontSize: 13,
    fontWeight: 600,
    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
    border: "none",
    borderBottom: isActive ? "2px solid var(--cc-brand-primary)" : "2px solid transparent",
    backgroundColor: "transparent",
    color: isActive ? "var(--cc-brand-primary)" : "var(--cc-text-tertiary)",
    cursor: "pointer",
    transition: "all 150ms ease",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
  });

  return (
    <div
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        backgroundColor: "var(--cc-neutral-alpha-40)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 1000,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          backgroundColor: "var(--cc-surface)",
          borderRadius: 12,
          width: 520,
          maxHeight: "80vh",
          overflow: "auto",
          boxShadow: "0 20px 60px var(--cc-neutral-alpha-15)",
        }}
      >
        {/* Header */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "16px 20px 0",
          }}
        >
          <h3
            style={{
              margin: 0,
              fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
              fontSize: 16,
              fontWeight: 600,
              color: "var(--cc-text-primary)",
            }}
          >
            Add Skill
          </h3>
          <button
            onClick={onClose}
            style={{
              background: "none",
              border: "none",
              cursor: "pointer",
              color: "var(--cc-text-secondary)",
              padding: 4,
              display: "flex",
            }}
          >
            <X size={18} />
          </button>
        </div>

        {/* Tabs */}
        <div
          style={{
            display: "flex",
            padding: "0 20px",
            marginTop: 12,
            borderBottom: "1px solid var(--cc-line-alpha-20)",
          }}
        >
          <button style={tabStyle(activeTab === "create")} onClick={() => setActiveTab("create")}>
            <Sparkles size={14} />
            Create with AI
          </button>
          <button style={tabStyle(activeTab === "upload")} onClick={() => setActiveTab("upload")}>
            <FolderUp size={14} />
            Upload Folder
          </button>
        </div>

        {/* Body */}
        <div style={{ padding: 20 }}>
          {/* ── Create with AI tab ── */}
          {activeTab === "create" && (
            <>
              {taskCreated ? (
                // Success state
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "20px 0" }}>
                  <Check size={40} color="var(--cc-status-success)" />
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--cc-text-primary)",
                      margin: 0,
                    }}
                  >
                    Skill creation task queued
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--cc-text-secondary)",
                      margin: 0,
                      textAlign: "center",
                      lineHeight: 1.5,
                    }}
                  >
                    Claude will use the Meta Skill Creator to build your skill.
                    Check the task board for progress.
                  </p>
                  <button
                    onClick={onComplete}
                    style={{
                      marginTop: 8,
                      padding: "8px 20px",
                      backgroundColor: "var(--cc-brand-primary)",
                      color: "var(--cc-surface)",
                      border: "none",
                      borderRadius: "0.375rem",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                <>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--cc-text-secondary)",
                      margin: "0 0 16px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    Describe the skill you want, or paste a reference URL. Claude will use the Meta Skill Creator to build it.
                  </p>

                  {/* Description */}
                  <label
                    style={{
                      display: "block",
                      fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--cc-text-secondary)",
                      marginBottom: 6,
                    }}
                  >
                    What should this skill do?
                  </label>
                  <textarea
                    value={skillDescription}
                    onChange={(e) => setSkillDescription(e.target.value)}
                    placeholder="e.g. A skill that generates weekly email newsletters from blog posts, matching our brand voice..."
                    style={{
                      width: "100%",
                      minHeight: 100,
                      maxHeight: 180,
                      padding: 12,
                      fontSize: 14,
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      border: "1px solid var(--cc-line-alpha-30)",
                      borderRadius: 8,
                      outline: "none",
                      color: "var(--cc-text-primary)",
                      backgroundColor: "var(--cc-canvas-subtle)",
                      resize: "vertical",
                      lineHeight: 1.5,
                      transition: "border-color 200ms ease",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--cc-brand-primary)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--cc-line-alpha-30)"; }}
                  />

                  {/* Reference URL */}
                  <label
                    style={{
                      display: "block",
                      fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                      fontSize: 11,
                      fontWeight: 600,
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      color: "var(--cc-text-secondary)",
                      marginTop: 16,
                      marginBottom: 6,
                    }}
                  >
                    <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                      <Link size={12} />
                      Reference URL
                      <span style={{ fontWeight: 400, textTransform: "none", letterSpacing: 0, color: "var(--cc-text-tertiary)" }}>(optional)</span>
                    </span>
                  </label>
                  <input
                    type="url"
                    value={referenceUrl}
                    onChange={(e) => setReferenceUrl(e.target.value)}
                    placeholder="https://github.com/user/repo/tree/main/.claude/skills/my-skill"
                    style={{
                      width: "100%",
                      padding: "10px 12px",
                      fontSize: 13,
                      fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                      border: "1px solid var(--cc-line-alpha-30)",
                      borderRadius: 8,
                      outline: "none",
                      color: "var(--cc-text-primary)",
                      backgroundColor: "var(--cc-canvas-subtle)",
                      transition: "border-color 200ms ease",
                      boxSizing: "border-box",
                    }}
                    onFocus={(e) => { e.currentTarget.style.borderColor = "var(--cc-brand-primary)"; }}
                    onBlur={(e) => { e.currentTarget.style.borderColor = "var(--cc-line-alpha-30)"; }}
                  />

                  {/* Hint */}
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 11,
                      color: "var(--cc-text-tertiary)",
                      margin: "6px 0 0 0",
                      lineHeight: 1.4,
                    }}
                  >
                    Paste a GitHub URL to an existing skill to use as a starting point or reference.
                  </p>

                  {error && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        backgroundColor: "var(--cc-surface)5F3",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <AlertCircle size={16} color="var(--cc-status-danger)" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--cc-status-danger)", fontFamily: "var(--font-inter), Inter, sans-serif" }}>
                        {error}
                      </span>
                    </div>
                  )}

                  {/* Submit */}
                  <button
                    onClick={handleCreateWithAI}
                    disabled={!skillDescription.trim() || isCreating}
                    style={{
                      marginTop: 16,
                      width: "100%",
                      padding: "10px 20px",
                      background: skillDescription.trim()
                        ? "linear-gradient(135deg, var(--cc-brand-primary), var(--cc-brand-hover))"
                        : "var(--cc-control-border)",
                      color: "var(--cc-surface)",
                      border: "none",
                      borderRadius: "0.375rem",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 14,
                      fontWeight: 600,
                      cursor: skillDescription.trim() && !isCreating ? "pointer" : "default",
                      opacity: isCreating ? 0.7 : 1,
                      transition: "all 150ms ease",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    {isCreating ? (
                      <>
                        <div
                          style={{
                            width: 16,
                            height: 16,
                            borderRadius: "50%",
                            border: "2px solid var(--cc-neutral-alpha-30)",
                            borderTopColor: "var(--cc-surface)",
                            animation: "spin 1s linear infinite",
                          }}
                        />
                        Creating task...
                      </>
                    ) : (
                      <>
                        Create Skill
                        <ArrowRight size={16} />
                      </>
                    )}
                  </button>
                </>
              )}
            </>
          )}

          {/* ── Upload Folder tab ── */}
          {activeTab === "upload" && (
            <>
              {uploadedFiles.length > 0 ? (
                // Success state
                <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12, padding: "20px 0" }}>
                  <Check size={40} color="var(--cc-status-success)" />
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 15,
                      fontWeight: 600,
                      color: "var(--cc-text-primary)",
                      margin: 0,
                    }}
                  >
                    {skillFolder} uploaded
                  </p>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--cc-text-secondary)",
                      margin: 0,
                    }}
                  >
                    {uploadedFiles.length} file{uploadedFiles.length !== 1 ? "s" : ""} added to .claude/skills/
                  </p>
                  <div
                    style={{
                      width: "100%",
                      maxHeight: 160,
                      overflow: "auto",
                      backgroundColor: "var(--cc-surface-muted)",
                      borderRadius: 8,
                      padding: 12,
                      marginTop: 4,
                    }}
                  >
                    {uploadedFiles.map((f) => (
                      <div
                        key={f.relativePath}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          padding: "4px 0",
                          fontFamily: "var(--font-inter), Inter, sans-serif",
                          fontSize: 12,
                          color: "var(--cc-text-secondary)",
                        }}
                      >
                        <FileText size={14} style={{ flexShrink: 0 }} />
                        {f.relativePath}
                      </div>
                    ))}
                  </div>
                  <button
                    onClick={onComplete}
                    style={{
                      marginTop: 8,
                      padding: "8px 20px",
                      backgroundColor: "var(--cc-brand-primary)",
                      color: "var(--cc-surface)",
                      border: "none",
                      borderRadius: "0.375rem",
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      fontWeight: 600,
                      cursor: "pointer",
                    }}
                  >
                    Done
                  </button>
                </div>
              ) : (
                // Upload state
                <>
                  <p
                    style={{
                      fontFamily: "var(--font-inter), Inter, sans-serif",
                      fontSize: 13,
                      color: "var(--cc-text-secondary)",
                      margin: "0 0 16px 0",
                      lineHeight: 1.5,
                    }}
                  >
                    Upload a skill folder containing SKILL.md and any references, scripts, or assets.
                  </p>

                  <input
                    ref={inputRef}
                    type="file"
                    onChange={handleFolderInput}
                    style={{ display: "none" }}
                    {...{ webkitdirectory: "", directory: "", mozdirectory: "" } as React.InputHTMLAttributes<HTMLInputElement>}
                  />

                  <div
                    onDrop={handleDrop}
                    onDragOver={(e) => { e.preventDefault(); setIsDragging(true); }}
                    onDragLeave={() => setIsDragging(false)}
                    onClick={() => inputRef.current?.click()}
                    style={{
                      border: `2px dashed ${isDragging ? "var(--cc-brand-primary)" : "var(--cc-line-alpha-40)"}`,
                      borderRadius: 12,
                      padding: "40px 24px",
                      textAlign: "center",
                      cursor: uploading ? "wait" : "pointer",
                      backgroundColor: isDragging ? "var(--cc-brand-alpha-04)" : "transparent",
                      transition: "all 200ms ease",
                    }}
                  >
                    {uploading ? (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                        <div
                          style={{
                            width: 40,
                            height: 40,
                            borderRadius: "50%",
                            border: "3px solid var(--cc-control-bg)",
                            borderTopColor: "var(--cc-brand-primary)",
                            animation: "spin 1s linear infinite",
                          }}
                        />
                        <span style={{ fontSize: 14, color: "var(--cc-text-secondary)", fontFamily: "var(--font-inter), Inter, sans-serif" }}>
                          Uploading files...
                        </span>
                      </div>
                    ) : (
                      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 8 }}>
                        <FolderUp size={36} color={isDragging ? "var(--cc-brand-primary)" : "var(--cc-control-border)"} />
                        <span
                          style={{
                            fontSize: 14,
                            color: isDragging ? "var(--cc-brand-primary)" : "var(--cc-text-primary)",
                            fontFamily: "var(--font-inter), Inter, sans-serif",
                            fontWeight: 500,
                          }}
                        >
                          Drop a skill folder here or click to browse
                        </span>
                        <span
                          style={{
                            fontSize: 12,
                            color: "var(--cc-text-tertiary)",
                            fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                          }}
                        >
                          Select the folder containing SKILL.md
                        </span>
                      </div>
                    )}
                  </div>

                  {error && (
                    <div
                      style={{
                        marginTop: 12,
                        padding: "10px 12px",
                        backgroundColor: "var(--cc-surface)5F3",
                        borderRadius: 6,
                        display: "flex",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <AlertCircle size={16} color="var(--cc-status-danger)" style={{ flexShrink: 0 }} />
                      <span style={{ fontSize: 12, color: "var(--cc-status-danger)", fontFamily: "var(--font-inter), Inter, sans-serif" }}>
                        {error}
                      </span>
                    </div>
                  )}
                </>
              )}
            </>
          )}
        </div>

        <style>{`
          @keyframes spin {
            to { transform: rotate(360deg); }
          }
        `}</style>
      </div>
    </div>
  );
}
