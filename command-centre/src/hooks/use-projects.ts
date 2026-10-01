"use client";

import { useState, useEffect } from "react";
import { useClientStore } from "@/store/client-store";
import type { Project } from "@/types/project";

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const selectedClientId = useClientStore((s) => s.selectedClientId);

  useEffect(() => {
    let cancelled = false;
    setIsLoading(true);

    const url = selectedClientId
      ? `/api/projects?clientId=${encodeURIComponent(selectedClientId)}`
      : "/api/projects";

    fetch(url)
      .then((res) => res.json())
      .then((data) => {
        if (!cancelled) {
          setProjects(Array.isArray(data) ? data : []);
          setIsLoading(false);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setProjects([]);
          setIsLoading(false);
        }
      });

    return () => { cancelled = true; };
  }, [selectedClientId]);

  return { projects, isLoading };
}
