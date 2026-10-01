import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

import { getConfig } from "@/lib/config";
import { fetchTeamMemoryStatus, readTeamContext } from "@/lib/team-api-context";
import { resolveMemoryBackend } from "@/lib/memory/backend";
import { memoryStatus } from "@/lib/memory/capture";
import { kickLocalMemoryConsolidation } from "@/lib/memory/local-consolidation";
import { openMemoryStore } from "@/lib/memory/store";

function idFromRecord(value: unknown): string | null {
  return value && typeof value === "object" && typeof (value as { id?: unknown }).id === "string"
    ? ((value as { id: string }).id.trim() || null)
    : null;
}

async function localOutboxStatus(
  rootDir: string,
  teamContext?: Awaited<ReturnType<typeof readTeamContext>> | null,
  existingStore?: Awaited<ReturnType<typeof openMemoryStore>> | null,
) {
  const dataDir = path.join(rootDir, ".command-centre", "memory");
  let store: Awaited<ReturnType<typeof openMemoryStore>> | null = null;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    store = existingStore ?? await openMemoryStore({ dataDir });
    const teamId = idFromRecord(teamContext?.team);
    const userId = idFromRecord(teamContext?.user);
    const params: unknown[] = [];
    const where: string[] = [];
    if (teamId) where.push(`team_id = $${params.push(teamId)}`);
    if (userId) where.push(`actor_user_id = $${params.push(userId)}`);
    const outboxRows = await store.client.query<{ status: string; n: number }>(
      `SELECT status, count(*)::int AS n
         FROM memory_sync_outbox
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
        GROUP BY status`,
      params,
    );
    const legacyRows = await store.client.query<{ sync_status: string; n: number }>(
      `SELECT sync_status, count(*)::int AS n
         FROM memory_capture_events
        ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
          ${where.length ? "AND" : "WHERE"} sync_status IN ('local_pending', 'sync_failed')
        GROUP BY sync_status`,
      params,
    );
    const byStatus: Record<string, number> = {};
    for (const row of outboxRows.rows) byStatus[row.status] = Number(row.n);
    for (const row of legacyRows.rows) {
      const key = row.sync_status === "sync_failed" ? "failed" : "queued";
      byStatus[key] = (byStatus[key] ?? 0) + Number(row.n);
    }
    return {
      byStatus,
      queued: byStatus.queued ?? 0,
      syncing: byStatus.syncing ?? 0,
      failed: byStatus.failed ?? 0,
      total: Object.values(byStatus).reduce((sum, n) => sum + Number(n), 0),
    };
  } catch (error) {
    return {
      byStatus: {},
      queued: 0,
      syncing: 0,
      failed: 0,
      total: 0,
      error: error instanceof Error ? error.message : "Local memory outbox unavailable",
    };
  } finally {
    if (!existingStore) await store?.close();
  }
}

export async function GET() {
  const config = getConfig();
  const rootDir = config.aiOsDir;
  const teamContext = await readTeamContext();
  if (teamContext) {
    kickLocalMemoryConsolidation({ rootDir, reason: "memory-status" });
    const outbox = await localOutboxStatus(rootDir, teamContext);
    try {
      const status = await fetchTeamMemoryStatus();
      return NextResponse.json({
        mode: "team",
        connected: true,
        apiUrl: teamContext.apiUrl,
        status,
        outbox,
      });
    } catch (error) {
      return NextResponse.json(
        {
          mode: "team",
          connected: false,
          apiUrl: teamContext.apiUrl,
          outbox,
          error: error instanceof Error ? error.message : "Team memory status unavailable",
        },
        { status: 502 },
      );
    }
  }

  const dataDir = path.join(rootDir, ".command-centre", "memory");
  let backendKind = "unknown";
  let store: Awaited<ReturnType<typeof openMemoryStore>> | null = null;
  try {
    fs.mkdirSync(dataDir, { recursive: true });
    const backend = resolveMemoryBackend({ dataDir }, process.env);
    backendKind = backend.kind;
    store = await openMemoryStore({ dataDir });
    const status = await memoryStatus({ store, rootDir });
    return NextResponse.json({
      mode: "local",
      connected: true,
      backend: backendKind,
      status,
      outbox: await localOutboxStatus(rootDir, null, store),
    });
  } catch (error) {
    return NextResponse.json(
      {
        mode: "local",
        connected: false,
        backend: backendKind,
        error: error instanceof Error ? error.message : "Local memory status unavailable",
      },
      { status: 500 },
    );
  } finally {
    await store?.close();
  }
}
