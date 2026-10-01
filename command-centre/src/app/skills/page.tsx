"use client";

import { useState, useCallback, useEffect } from "react";
import { SkillsFileTree } from "@/components/skills/skills-file-tree";
import { SkillsSummary } from "@/components/skills/skills-summary";
import { SkillUploadModal } from "@/components/skills/skill-upload-modal";
import { ContentViewer } from "@/components/context/content-viewer";
import { TopNavShell } from "@/components/layout/top-nav-shell";
import type { SkillFileSelection } from "@/types/file";
import { useClientId } from "@/hooks/use-client-id";
import { isSkillFileReadOnly } from "@/lib/skill-navigation";

export default function SkillsPage() {
  const clientId = useClientId();
  const [selectedFile, setSelectedFile] = useState<SkillFileSelection | null>(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [showUpload, setShowUpload] = useState(false);

  useEffect(() => {
    setSelectedFile(null);
  }, [clientId]);

  const handleFileDeleted = useCallback(() => {
    setSelectedFile(null);
    setRefreshKey((k) => k + 1);
  }, []);

  const handleAddSkill = useCallback(() => {
    setShowUpload(true);
  }, []);

  const handleUploadComplete = useCallback(() => {
    setShowUpload(false);
    setRefreshKey((k) => k + 1);
  }, []);

  return (
    <TopNavShell activeTab="skills">
      <div
        style={{
          display: "flex",
          minHeight: "calc(100vh - 140px)",
          borderRadius: 8,
          overflow: "hidden",
          border: "1px solid var(--cc-line-alpha-15)",
        }}
      >
        {/* File tree sidebar */}
        <div
          style={{
            width: 280,
            flexShrink: 0,
            backgroundColor: "var(--cc-surface-muted)",
            overflowY: "auto",
            borderRight: "1px solid var(--cc-line-alpha-20)",
          }}
        >
          <SkillsFileTree
            key={refreshKey}
            onSelectFile={setSelectedFile}
            selectedFile={selectedFile}
          />
        </div>

        {/* Content area: summary when nothing selected, viewer when a file is picked */}
        <div style={{ flex: 1, backgroundColor: "var(--cc-surface)", minHeight: 400 }}>
          {selectedFile ? (
            <div>
              <button
                onClick={() => setSelectedFile(null)}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 6,
                  padding: "10px 16px",
                  border: "none",
                  borderBottom: "1px solid var(--cc-line-alpha-20)",
                  background: "transparent",
                  color: "var(--cc-brand-primary)",
                  fontFamily: "var(--font-inter), Inter, sans-serif",
                  fontSize: 13,
                  fontWeight: 500,
                  cursor: "pointer",
                  width: "100%",
                  transition: "background 150ms ease",
                }}
                onMouseEnter={(e) => { e.currentTarget.style.background = "var(--cc-brand-alpha-04)"; }}
                onMouseLeave={(e) => { e.currentTarget.style.background = "transparent"; }}
              >
                ← All Skills
              </button>
              <ContentViewer
                selectedPath={selectedFile.path}
                skillOrigin={selectedFile.origin}
                readOnly={isSkillFileReadOnly(selectedFile)}
                onFileDeleted={handleFileDeleted}
              />
            </div>
          ) : (
            <SkillsSummary onSelectSkill={setSelectedFile} onAddSkill={handleAddSkill} />
          )}
        </div>
      </div>

      {showUpload && (
        <SkillUploadModal
          onClose={() => setShowUpload(false)}
          onComplete={handleUploadComplete}
        />
      )}
    </TopNavShell>
  );
}
