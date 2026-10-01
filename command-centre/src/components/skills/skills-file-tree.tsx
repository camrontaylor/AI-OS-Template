"use client";

import { useState, useEffect, useCallback } from "react";
import { FileText, Folder, FolderOpen, Cpu } from "lucide-react";
import type { FileNode } from "@/types/file";
import { useClientId, appendClientId } from "@/hooks/use-client-id";
import { asFileNodes } from "@/lib/file-node-response";
import type { SkillCatalogEntry, SkillFileSelection, SkillOrigin } from "@/types/file";

interface SkillsFileTreeProps {
  onSelectFile: (selection: SkillFileSelection) => void;
  selectedFile: SkillFileSelection | null;
}

interface SkillFolderNode extends FileNode {
  origin: SkillOrigin;
  hidden?: boolean;
}

export function SkillsFileTree({ onSelectFile, selectedFile }: SkillsFileTreeProps) {
  const clientId = useClientId();
  const [skillFolders, setSkillFolders] = useState<SkillFolderNode[]>([]);
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set());
  const [childrenMap, setChildrenMap] = useState<Record<string, FileNode[]>>({});
  // Paths of SKILL.local.md files the selected client owns on inherited
  // skills. They live in the client folder, not under the skill's effective
  // origin, so directory listings never return them and their nodes must
  // resolve with the "client" origin.
  const [overridePaths, setOverridePaths] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;

    async function load() {
      setLoading(true);
      setExpandedDirs(new Set());
      setChildrenMap({});
      try {
        const response = await fetch(appendClientId("/api/skills", clientId));
        if (!response.ok) throw new Error("Unable to load skills");
        const skills = await response.json() as SkillCatalogEntry[];
        if (mounted) {
          const folders = skills.map((skill) => ({
            name: skill.folderName,
            path: `.claude/skills/${skill.folderName}`,
            type: "directory" as const,
            lastModified: "",
            size: 0,
            origin: skill.effectiveOrigin,
            hidden: Boolean(skill.hiddenByClient),
          }));
          const overrides = new Set<string>();
          for (const skill of skills) {
            if (skill.clientOverride) overrides.add(`.claude/skills/${skill.folderName}/SKILL.local.md`);
          }
          setSkillFolders(folders);
          setOverridePaths(overrides);
          setLoading(false);
        }
      } catch {
        if (mounted) setLoading(false);
      }
    }

    load();
    return () => { mounted = false; };
  }, [clientId]);

  const toggleDir = useCallback(
    (dirPath: string, origin: SkillOrigin) => {
      setExpandedDirs((prev) => {
        const next = new Set(prev);
        if (next.has(dirPath)) {
          next.delete(dirPath);
        } else {
          next.add(dirPath);
          if (!childrenMap[dirPath]) {
            fetch(appendClientId(`/api/files?dir=${encodeURIComponent(dirPath)}&skillOrigin=${origin}`, clientId))
              .then(async (r) => {
                if (!r.ok) return [];
                const payload: unknown = await r.json();
                return asFileNodes(payload);
              })
              .then((children) => {
                // The client's SKILL.local.md on an inherited skill is not in
                // the effective origin's listing; surface it alongside.
                const overrideFile = `${dirPath}/SKILL.local.md`;
                const merged = overridePaths.has(overrideFile) && !children.some((child) => child.name === "SKILL.local.md")
                  ? [...children, { name: "SKILL.local.md", path: overrideFile, type: "file" as const, lastModified: "", size: 0 }]
                  : children;
                setChildrenMap((prev) => ({ ...prev, [dirPath]: merged }));
              })
              .catch(() => {
                setChildrenMap((prev) => ({ ...prev, [dirPath]: [] }));
              });
          }
        }
        return next;
      });
    },
    [childrenMap, clientId, overridePaths]
  );

  const renderNode = (node: FileNode, origin: SkillOrigin, depth: number = 0) => {
    const isDir = node.type === "directory";
    const isExpanded = expandedDirs.has(node.path);
    // A client-owned override node opens from the client origin even though
    // it hangs under a skill whose files come from the root.
    const nodeOrigin: SkillOrigin = overridePaths.has(node.path) ? "client" : origin;
    const isSelected = node.path === selectedFile?.path && nodeOrigin === selectedFile.origin;
    const children = childrenMap[node.path] || node.children || [];

    return (
      <div key={node.path}>
        <button
          onClick={() => (isDir ? toggleDir(node.path, origin) : onSelectFile({ path: node.path, origin: nodeOrigin }))}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 12px",
            paddingLeft: 12 + depth * 16,
            border: "none",
            background: isSelected ? "var(--cc-brand-soft)" : "transparent",
            color: isSelected ? "var(--cc-brand-strong)" : "var(--cc-text-primary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            cursor: "pointer",
            borderRadius: "0.25rem",
            textAlign: "left",
            transition: "background 150ms ease",
          }}
          onMouseEnter={(e) => {
            if (!isSelected) e.currentTarget.style.background = "var(--cc-surface-muted)";
          }}
          onMouseLeave={(e) => {
            if (!isSelected) e.currentTarget.style.background = "transparent";
          }}
        >
          {isDir ? (
            isExpanded ? (
              <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
            ) : (
              <Folder size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
            )
          ) : (
            <FileText size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
          )}
          <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", flex: 1 }}>
            {node.name}
          </span>
        </button>

        {isDir && isExpanded && (
          <div>
            {children.map((child) => renderNode(child, origin, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  if (loading) {
    return (
      <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 8 }}>
        {[82, 68, 91, 74, 86, 63, 78, 70].map((width, i) => (
          <div
            key={i}
            style={{
              height: 16,
              width: `${width}%`,
              backgroundColor: "var(--cc-control-bg)",
              borderRadius: 4,
              animation: "pulse-dot 1.5s ease-in-out infinite",
            }}
          />
        ))}
      </div>
    );
  }

  if (skillFolders.length === 0) {
    return (
      <div style={{ padding: 24, textAlign: "center" }}>
        <Cpu size={32} style={{ color: "var(--cc-text-secondary)", margin: "0 auto 8px" }} />
        <p style={{ fontFamily: "var(--font-inter), Inter, sans-serif", fontSize: 13, color: "var(--cc-text-secondary)" }}>
          No skills installed
        </p>
      </div>
    );
  }

  // With a client selected, split the tree by origin: the client's own skills
  // live in a bordered section of their own, everything else is inherited
  // from the root. Without a client the tree stays flat, as before.
  const showOriginSections = Boolean(clientId);
  const clientOnlyFolders = skillFolders.filter((folder) => folder.origin === "client");
  const inheritedFolders = showOriginSections
    ? skillFolders.filter((folder) => folder.origin !== "client")
    : skillFolders;

  // Group inherited folders by category prefix
  const grouped: Record<string, SkillFolderNode[]> = {};
  for (const folder of inheritedFolders) {
    const category = folder.name.split("-")[0];
    if (!grouped[category]) grouped[category] = [];
    grouped[category].push(folder);
  }
  const sortedGroups = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b));

  const sectionHeaderStyle = {
    padding: "6px 12px",
    fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
    fontSize: 10,
    fontWeight: 600,
    textTransform: "uppercase" as const,
    letterSpacing: "0.08em",
    color: "var(--cc-text-tertiary)",
  };

  const renderSkillFolder = (folder: SkillFolderNode) => {
    const isExpanded = expandedDirs.has(folder.path);
    const children = childrenMap[folder.path] || [];
    // Check if any child file is selected
    const hasSelectedChild = selectedFile?.origin === folder.origin && Boolean(selectedFile?.path.startsWith(folder.path + "/"));

    return (
      <div key={folder.path} style={{ opacity: folder.hidden ? 0.55 : 1 }}>
        <button
          onClick={() => toggleDir(folder.path, folder.origin)}
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            width: "100%",
            padding: "8px 12px",
            border: "none",
            background: hasSelectedChild && !isExpanded ? "var(--cc-brand-alpha-30)" : "transparent",
            color: "var(--cc-text-primary)",
            fontFamily: "var(--font-inter), Inter, sans-serif",
            fontSize: 13,
            cursor: "pointer",
            borderRadius: "0.25rem",
            textAlign: "left",
            transition: "background 150ms ease",
          }}
          onMouseEnter={(e) => {
            e.currentTarget.style.background = "var(--cc-surface-muted)";
          }}
          onMouseLeave={(e) => {
            e.currentTarget.style.background =
              hasSelectedChild && !isExpanded ? "var(--cc-brand-alpha-30)" : "transparent";
          }}
        >
          {isExpanded ? (
            <FolderOpen size={16} style={{ color: "var(--cc-brand-primary)", flexShrink: 0 }} />
          ) : (
            <Folder size={16} style={{ color: "var(--cc-text-secondary)", flexShrink: 0 }} />
          )}
          <span
            style={{
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
              flex: 1,
              fontWeight: 500,
            }}
          >
            {folder.name}
          </span>
        </button>

        {isExpanded && (
          <div>
            {children.map((child) => renderNode(child, folder.origin, 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div style={{ padding: "8px 0" }}>
      <div
        style={{
          padding: "6px 12px 10px",
          fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
          fontSize: 10,
          color: "var(--cc-text-tertiary)",
        }}
      >
        {skillFolders.length} skills
      </div>
      {showOriginSections && clientOnlyFolders.length > 0 && (
        <div
          style={{
            margin: "0 8px 12px",
            border: "1px solid var(--cc-brand-strong)",
            borderRadius: 8,
            paddingBottom: 4,
          }}
        >
          <div style={{ ...sectionHeaderStyle, color: "var(--cc-brand-strong)", paddingTop: 8 }}>
            Client-only
          </div>
          {clientOnlyFolders.map(renderSkillFolder)}
        </div>
      )}
      {showOriginSections && (
        <div style={sectionHeaderStyle}>Inherited from root</div>
      )}
      {sortedGroups.map(([category, folders]) => (
        <div key={category} style={{ marginBottom: 4 }}>
          <div
            style={{
              padding: "6px 12px",
              fontFamily: "var(--font-space-grotesk), Space Grotesk, sans-serif",
              fontSize: 10,
              fontWeight: 600,
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              color: "var(--cc-text-tertiary)",
            }}
          >
            {category}
          </div>
          {folders.map(renderSkillFolder)}
        </div>
      ))}
    </div>
  );
}
