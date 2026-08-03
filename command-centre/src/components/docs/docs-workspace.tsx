"use client";

import { useEffect, useState } from "react";
import { ContentViewer } from "@/components/context/content-viewer";
import { ResizablePane } from "@/components/shared/resizable-pane";
import { DocsFileTree } from "./docs-file-tree";

export function DocsWorkspace({ initialFile }: { initialFile?: string | null }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(
    initialFile || "AGENTS.md",
  );
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    if (initialFile) setSelectedPath(initialFile);
  }, [initialFile]);

  return (
    <ResizablePane
      storageKey="docs-sidebar-width"
      initialLeft={260}
      minLeft={180}
      maxLeft={600}
      style={{ minHeight: "calc(100vh - 140px)", gap: 0 }}
      left={
        <div className="max-h-[calc(100vh_-_140px)] w-full overflow-y-auto rounded-lg border bg-muted">
          <DocsFileTree
            key={refreshKey}
            onSelectFile={setSelectedPath}
            selectedPath={selectedPath}
          />
        </div>
      }
      right={
        <div className="min-h-[400px] w-full rounded-lg border bg-card">
          <ContentViewer
            selectedPath={selectedPath}
            onFileDeleted={() => {
              setSelectedPath(null);
              setRefreshKey((key) => key + 1);
            }}
          />
        </div>
      }
    />
  );
}
