"use client";

import { useState, useEffect } from "react";
import { Mic, Target, Users, FileText, Palette } from "lucide-react";
import type { FileNode } from "@/types/file";
import { useClientId, appendClientId } from "@/hooks/use-client-id";

interface BrandCardGridProps {
  onSelectFile: (path: string) => void;
}

const iconMap: Record<string, React.ReactNode> = {
  "voice-profile": <Mic size={20} style={{ color: "var(--cc-brand-primary)" }} />,
  positioning: <Target size={20} style={{ color: "var(--cc-brand-primary)" }} />,
  icp: <Users size={20} style={{ color: "var(--cc-brand-primary)" }} />,
  samples: <FileText size={20} style={{ color: "var(--cc-brand-primary)" }} />,
  "brand-assets": <Palette size={20} style={{ color: "var(--cc-brand-primary)" }} />,
};

function toTitleCase(name: string): string {
  return name
    .replace(/\.md$/, "")
    .split("-")
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
    .join(" ");
}

function formatRelativeTime(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  const weeks = Math.floor(days / 7);
  return `${weeks}w ago`;
}

function getIcon(fileName: string): React.ReactNode {
  const baseName = fileName.replace(/\.md$/, "");
  return iconMap[baseName] || <FileText size={20} style={{ color: "var(--cc-brand-primary)" }} />;
}

export function BrandCardGrid({ onSelectFile }: BrandCardGridProps) {
  const clientId = useClientId();
  const [files, setFiles] = useState<FileNode[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(appendClientId("/api/files?dir=brand_context", clientId))
      .then((r) => r.json())
      .then((nodes: FileNode[]) => {
        // Filter to only files (not directories)
        setFiles(nodes.filter((n) => n.type === "file"));
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(2, 1fr)",
          gap: "1rem",
        }}
      >
        {Array.from({ length: 4 }).map((_, i) => (
          <div
            key={i}
            style={{
              backgroundColor: "var(--cc-surface)",
              borderRadius: "0.5rem",
              padding: 16,
              minHeight: 120,
            }}
          >
            <div style={{ height: 16, width: "60%", backgroundColor: "var(--cc-control-bg)", borderRadius: 4, marginBottom: 8, animation: "pulse-dot 1.5s ease-in-out infinite" }} />
            <div style={{ height: 12, width: "40%", backgroundColor: "var(--cc-control-bg)", borderRadius: 4, marginBottom: 12, animation: "pulse-dot 1.5s ease-in-out infinite" }} />
            <div style={{ height: 48, width: "100%", backgroundColor: "var(--cc-control-bg)", borderRadius: 4, animation: "pulse-dot 1.5s ease-in-out infinite" }} />
          </div>
        ))}
      </div>
    );
  }

  if (files.length === 0) {
    return (
      <div style={{ textAlign: "center", padding: "60px 20px" }}>
        <Palette size={48} style={{ color: "var(--cc-text-secondary)", margin: "0 auto 16px", display: "block" }} />
        <h4
          style={{
            fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
            fontWeight: 600,
            fontSize: 16,
            color: "var(--cc-text-primary)",
            margin: "0 0 8px 0",
          }}
        >
          No brand context files found
        </h4>
        <p
          style={{
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 14,
            color: "var(--cc-text-secondary)",
            maxWidth: 320,
            margin: "0 auto",
          }}
        >
          Run /start-here to build your brand.
        </p>
      </div>
    );
  }

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(2, 1fr)",
        gap: "1rem",
      }}
    >
      {files.map((file) => (
        <button
          key={file.path}
          onClick={() => onSelectFile(file.path)}
          style={{
            background: "var(--cc-surface)",
            border: "none",
            borderRadius: "0.5rem",
            padding: 20,
            textAlign: "left",
            cursor: "pointer",
            minHeight: 120,
            display: "flex",
            flexDirection: "column",
            gap: 8,
            transition: "box-shadow 200ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.boxShadow = "0px 12px 32px var(--cc-brand-alpha-06)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.boxShadow = "none";
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            {getIcon(file.name)}
            <span
              style={{
                fontFamily: "var(--font-epilogue), Epilogue, sans-serif",
                fontWeight: 600,
                fontSize: 15,
                color: "var(--cc-text-primary)",
              }}
            >
              {toTitleCase(file.name)}
            </span>
          </div>
          <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
            <span
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 11,
                color: "var(--cc-text-secondary)",
              }}
            >
              {formatRelativeTime(file.lastModified)}
            </span>
            <span
              style={{
                fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
                fontSize: 11,
                color: "var(--cc-text-tertiary)",
              }}
            >
              {(file.size / 1024).toFixed(1)}KB
            </span>
          </div>
        </button>
      ))}
    </div>
  );
}
