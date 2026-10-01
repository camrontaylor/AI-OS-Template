"use client";

import { Suspense, useCallback, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { FeedView } from "@/components/board/feed-view";
import { TopNavShell, hrefForTopNavTab } from "@/components/layout/top-nav-shell";
import { useClientStore } from "@/store/client-store";
import { useTaskStore } from "@/store/task-store";

function legacyTabTarget(tab: string | null, file: string | null, clientId: string | null): string | null {
  if (!tab || tab === "feed") return null;
  const base = hrefForTopNavTab(tab);
  if (base === "/") return null;
  if (tab === "docs") {
    const params = new URLSearchParams();
    if (file) params.set("file", file);
    if (clientId) params.set("clientId", clientId);
    const query = params.toString();
    return query ? `${base}?${query}` : base;
  }
  return base;
}

function FeedPageBody() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const fileParam = searchParams.get("file");
  const clientIdParam = searchParams.get("clientId");
  const taskParam = searchParams.get("task");
  const searchParamsString = searchParams.toString();
  const fetchTasks = useTaskStore((s) => s.fetchTasks);
  const fetchClients = useClientStore((s) => s.fetchClients);
  const setSelectedClient = useClientStore((s) => s.setSelectedClient);
  const [requestedTaskId, setRequestedTaskId] = useState<string | null>(null);

  const clearTaskRequest = useCallback(() => {
    setRequestedTaskId(null);
    const params = new URLSearchParams(searchParamsString);
    params.delete("task");
    params.delete("tab");
    const nextQuery = params.toString();
    router.replace(nextQuery ? `/?${nextQuery}` : "/");
  }, [router, searchParamsString]);

  useEffect(() => {
    const target = legacyTabTarget(tabParam, fileParam, clientIdParam);
    if (target) router.replace(target);
  }, [router, tabParam, fileParam, clientIdParam]);

  useEffect(() => {
    if (!taskParam) return;

    let cancelled = false;

    const openDeepLinkedTask = async () => {
      try {
        const res = await fetch(`/api/tasks/${encodeURIComponent(taskParam)}`);
        if (!res.ok) {
          clearTaskRequest();
          return;
        }

        const task = await res.json();
        if (cancelled) return;

        // Finish hydrating persisted Workspace preferences before overriding
        // them for the deep link. Otherwise a slower client fetch can restore
        // the previous Workspace after the task has already opened.
        await fetchClients();
        if (cancelled) return;

        // Bootstrap the task scope before fetching the complete lineage. The
        // Feed resolves the root Goal afterwards and corrects this client when
        // a child task inherits its scope from a parent.
        setSelectedClient(task.clientId ?? null);
        await fetchTasks();
        if (cancelled) return;

        setRequestedTaskId(task.id);
      } catch {
        if (!cancelled) clearTaskRequest();
      }
    };

    void openDeepLinkedTask();

    return () => {
      cancelled = true;
    };
  }, [clearTaskRequest, fetchClients, fetchTasks, setSelectedClient, taskParam]);

  const switchTab = useCallback((tab: string) => {
    router.push(hrefForTopNavTab(tab));
  }, [router]);

  return (
    <TopNavShell activeTab="feed" workspaceContext={false} flush>
      <FeedView
        onSwitchTab={switchTab}
        requestedTaskId={requestedTaskId}
        onRequestedTaskHandled={clearTaskRequest}
      />
    </TopNavShell>
  );
}

export default function CommandCentrePage() {
  return (
    <Suspense fallback={<div style={{ minHeight: "100vh", backgroundColor: "var(--cc-canvas)" }} />}>
      <FeedPageBody />
    </Suspense>
  );
}
