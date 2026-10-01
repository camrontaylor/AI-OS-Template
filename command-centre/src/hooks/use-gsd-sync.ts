import { useEffect, useRef } from "react";

/**
 * Calls POST /api/gsd/ensure-task on mount to keep the board in sync
 * with the .planning/ directory. Only fires once per page load.
 */
export function useGsdSync() {
  const hasSynced = useRef(false);

  useEffect(() => {
    if (hasSynced.current) return;
    hasSynced.current = true;

    fetch("/api/gsd/ensure-task", { method: "POST" }).catch(() => {
      // Silent — sync is best-effort
    });
  }, []);
}
