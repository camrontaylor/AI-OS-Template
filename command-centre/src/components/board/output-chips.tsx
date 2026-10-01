"use client";

import { FileText, Image, FileType } from "lucide-react";
import type { OutputFile } from "@/types/task";

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "svg"]);
const PDF_EXTENSIONS = new Set(["pdf"]);

function truncateFilename(name: string, maxLen = 20): string {
  if (name.length <= maxLen) return name;
  return name.slice(0, maxLen - 3) + "...";
}

function getFileIcon(ext: string) {
  if (IMAGE_EXTENSIONS.has(ext)) return Image;
  if (PDF_EXTENSIONS.has(ext)) return FileType;
  return FileText;
}

export function OutputChips({
  files,
}: {
  files: OutputFile[];
}) {
  if (files.length === 0) return null;

  const visible = files.slice(0, 2);
  const remaining = files.length - 2;

  return (
    <div
      style={{
        display: "flex",
        gap: 4,
        flexWrap: "wrap",
        marginTop: 8,
      }}
    >
      {visible.map((file) => {
        const Icon = getFileIcon(file.extension);

        return (
          <span
            key={file.id}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              fontSize: 11,
              fontFamily:
                "var(--font-space-grotesk), Space Grotesk, sans-serif",
              padding: "2px 8px",
              borderRadius: 4,
              backgroundColor: "var(--cc-brand-soft)",
              color: "var(--cc-brand-strong)",
              lineHeight: "16px",
            }}
          >
            <Icon size={10} />
            {truncateFilename(file.fileName)}
          </span>
        );
      })}
      {remaining > 0 && (
        <span
          style={{
            fontSize: 11,
            color: "var(--cc-text-secondary)",
            fontFamily:
              "var(--font-space-grotesk), Space Grotesk, sans-serif",
            lineHeight: "20px",
          }}
        >
          +{remaining} more
        </span>
      )}
    </div>
  );
}
