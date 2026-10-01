const REGULAR_WIDTHS = ["72%", "91%", "64%", "84%", "76%", "96%"] as const;
const COMPACT_WIDTHS = ["62%", "86%", "55%", "78%", "69%"] as const;

interface FileTreeSkeletonProps {
  compact?: boolean;
}

export function FileTreeSkeleton({ compact = false }: FileTreeSkeletonProps) {
  const widths = compact ? COMPACT_WIDTHS : REGULAR_WIDTHS;

  return (
    <div
      aria-label="Loading files"
      style={{
        padding: compact ? 12 : 16,
        display: "flex",
        flexDirection: "column",
        gap: compact ? 6 : 8,
      }}
    >
      {widths.map((width, index) => (
        <div
          key={index}
          aria-hidden="true"
          style={{
            height: compact ? 12 : 16,
            width,
            backgroundColor: "var(--cc-control-bg)",
            borderRadius: compact ? 3 : 4,
            animation: "pulse-dot 1.5s ease-in-out infinite",
          }}
        />
      ))}
    </div>
  );
}
