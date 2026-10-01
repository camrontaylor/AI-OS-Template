"use client";

import { useEffect } from "react";

import {
  ACTIVE_PROFILE_MARKER_KEY,
  getBrowserLocalProfile,
} from "@/lib/profile-storage";

export function LocalProfileBoundary({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    const current = getBrowserLocalProfile();
    const marker = window.localStorage.getItem(ACTIVE_PROFILE_MARKER_KEY);
    if (!marker) {
      window.localStorage.setItem(ACTIVE_PROFILE_MARKER_KEY, JSON.stringify(current));
    } else {
      try {
        const parsed = JSON.parse(marker) as { profileKey?: unknown; sessionId?: unknown };
        if (
          typeof parsed.profileKey === "string" &&
          (parsed.profileKey !== current.profileKey || parsed.sessionId !== current.sessionId)
        ) {
          if (parsed.profileKey === current.profileKey) {
            window.localStorage.setItem(ACTIVE_PROFILE_MARKER_KEY, JSON.stringify(current));
          }
          window.location.reload();
          return;
        }
      } catch {
        // A malformed global marker is replaced on the next profile change.
      }
    }

    const handleStorage = (event: StorageEvent) => {
      if (event.key !== ACTIVE_PROFILE_MARKER_KEY || !event.newValue) return;
      try {
        const parsed = JSON.parse(event.newValue) as { profileKey?: unknown; sessionId?: unknown };
        if (
          typeof parsed.profileKey === "string" &&
          (parsed.profileKey !== current.profileKey || parsed.sessionId !== current.sessionId)
        ) {
          window.location.reload();
        }
      } catch {
        // Ignore malformed cross-tab markers.
      }
    };
    window.addEventListener("storage", handleStorage);
    return () => window.removeEventListener("storage", handleStorage);
  }, []);

  return <>{children}</>;
}
