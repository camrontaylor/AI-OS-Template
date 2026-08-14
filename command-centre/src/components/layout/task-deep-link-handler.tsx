"use client";

import { useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useClientStore } from "@/store/client-store";
import { useTaskStore } from "@/store/task-store";

export function TaskDeepLinkHandler() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const taskParam = searchParams.get("task");
  const searchParamsString = searchParams.toString();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const openPanel = useTaskStore((s) => s.openPanel);
  const setSelectedClient = useClientStore((s) => s.setSelectedClient);

  useEffect(() => {
    if (!taskParam) return;

    let cancelled = false;

    const openDeepLinkedTask = async () => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskParam)}`);
        if (!res.ok) return;

        const task = await res.json();
        if (cancelled) return;

        setSelectedClient(task.clientId ?? null);
        await fetchTasks();
        if (cancelled) return;

        openPanel(task.id);
      } finally {
        if (cancelled) return;

        const params = new URLSearchParams(searchParamsString);
        params.delete("task");
        const nextQuery = params.toString();
        router.replace(nextQuery ? `${window.location.pathname}?${nextQuery}` : window.location.pathname);
      }
    };

    void openDeepLinkedTask();

    return () => {
      cancelled = true;
    };
  }, [taskParam, searchParamsString, router, fetchTasks, openPanel, setSelectedClient]);

  return null;
}
