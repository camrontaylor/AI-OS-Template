const OUTBOX_PATHS = {
  capture_create: "/v1/memory/captures",
  ingest: "/v1/memory/ingest",
  manual_import: "/v1/memory/imports",
};

function json(value) {
  return JSON.stringify(value ?? {});
}

function parseMaybeJson(value) {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function normalizeScope(scope = {}, savedTeamContext = null) {
  return {
    teamId: scope.teamId && scope.teamId !== "server-resolved"
      ? scope.teamId
      : savedTeamContext?.teamId,
    clientId: scope.clientId ?? null,
    userId: scope.userId ?? null,
    visibility: scope.visibility,
  };
}

function dedupeKeyFor(item, savedTeamContext = null) {
  const scope = normalizeScope(item.scope, savedTeamContext);
  const actor = item.actorUserId || savedTeamContext?.userId || "unknown";
  const source = item.sourceHash || item.contentSha256 || item.sourcePath || "unknown";
  return [
    item.operation,
    scope.teamId || "",
    scope.clientId || "",
    actor,
    item.sessionId || "",
    source,
  ].join(":");
}

function outboxPathFor(operation) {
  const path = OUTBOX_PATHS[operation];
  if (!path) throw new Error(`Unknown memory outbox operation: ${operation}`);
  return path;
}

function shouldRetryError(error) {
  const status = Number(error?.status ?? 0);
  if (!Number.isInteger(status) || status <= 0) return true;
  if (status === 408 || status === 429) return true;
  if (status >= 500) return true;
  return false;
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

async function queueMemoryOutboxItem({ memStore, savedTeamContext, item }) {
  if (!savedTeamContext?.teamId || !savedTeamContext?.userId) {
    throw new Error("memory outbox queue requires saved Team OS team and user context");
  }
  const scope = normalizeScope(item.scope, savedTeamContext);
  if (!scope.teamId) throw new Error("memory outbox item requires a team id");
  if (scope.visibility === "team") scope.clientId = null;
  if (scope.visibility === "client" && !scope.clientId) {
    throw new Error("client memory outbox item requires a client id");
  }

  const operation = item.operation;
  const requestPath = item.requestPath || outboxPathFor(operation);
  const requestBody = item.requestBody || {};
  const dedupeKey = item.dedupeKey || dedupeKeyFor({
    ...item,
    scope,
    actorUserId: item.actorUserId || savedTeamContext.userId,
  }, savedTeamContext);

  await memStore.client.query(
    `INSERT INTO memory_sync_outbox
       (operation, dedupe_key, team_id, client_id, actor_user_id, visibility,
        source_path, source_hash, content_sha256, request_method, request_path,
        request_body, status, attempts, next_attempt_at, last_error, metadata,
        updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'POST', $10,
             $11::jsonb, 'queued', 0, now(), NULL, $12::jsonb, now())
     ON CONFLICT (dedupe_key)
     DO UPDATE SET
       source_path = EXCLUDED.source_path,
       source_hash = EXCLUDED.source_hash,
       content_sha256 = EXCLUDED.content_sha256,
       request_method = EXCLUDED.request_method,
       request_path = EXCLUDED.request_path,
       request_body = EXCLUDED.request_body,
       status = 'queued',
       next_attempt_at = now(),
       last_error = NULL,
       metadata = EXCLUDED.metadata,
       updated_at = now()`,
    [
      operation,
      dedupeKey,
      scope.teamId,
      scope.clientId,
      item.actorUserId || savedTeamContext.userId,
      scope.visibility,
      item.sourcePath ?? null,
      item.sourceHash ?? null,
      item.contentSha256 ?? requestBody.contentSha256 ?? null,
      requestPath,
      json(requestBody),
      json({
        ...(item.metadata ?? {}),
        offlineQueuedAt: new Date().toISOString(),
        apiUrl: savedTeamContext.config?.apiUrl ?? null,
      }),
    ],
  );
}

async function postOutboxItem(config, row, request) {
  return request(config, row.request_path, {
    method: row.request_method || "POST",
    body: parseMaybeJson(row.request_body),
    signal: typeof AbortSignal !== "undefined" && typeof AbortSignal.timeout === "function"
      ? AbortSignal.timeout(30_000)
      : undefined,
  });
}

const STALE_SYNCING_RECLAIM_MINUTES = 10;

// A process can die between marking a row 'syncing' and the POST resolving,
// stranding it forever since the drain query below only selects
// queued/failed. Reclaim anything left syncing past a generous timeout.
async function reclaimStaleSyncingItems({ memStore, savedTeamContext }) {
  await memStore.client.query(
    `UPDATE memory_sync_outbox
        SET status = 'queued',
            next_attempt_at = now(),
            updated_at = now()
      WHERE team_id = $1
        AND actor_user_id = $2
        AND status = 'syncing'
        AND updated_at < now() - interval '${STALE_SYNCING_RECLAIM_MINUTES} minutes'`,
    [savedTeamContext.teamId, savedTeamContext.userId],
  );
}

async function drainMemoryOutbox({ memStore, savedTeamContext, request, limit = 25, includeFailed = false }) {
  if (!savedTeamContext?.config || !savedTeamContext.teamId || !savedTeamContext.userId) {
    return { synced: 0, failed: 0, retrying: 0 };
  }
  await reclaimStaleSyncingItems({ memStore, savedTeamContext });
  const { rows } = await memStore.client.query(
    `SELECT id::text, operation, request_method, request_path, request_body
       FROM memory_sync_outbox
      WHERE team_id = $1
        AND actor_user_id = $2
        AND status ${includeFailed ? "IN ('queued', 'failed')" : "= 'queued'"}
        AND next_attempt_at <= now()
      ORDER BY created_at ASC
      LIMIT $3`,
    [savedTeamContext.teamId, savedTeamContext.userId, limit],
  );

  let synced = 0;
  let failed = 0;
  let retrying = 0;

  for (const row of rows) {
    await memStore.client.query(
      `UPDATE memory_sync_outbox
          SET status = 'syncing',
              attempts = attempts + 1,
              updated_at = now()
        WHERE id = $1`,
      [row.id],
    );
    try {
      await postOutboxItem(savedTeamContext.config, row, request);
      await memStore.client.query("DELETE FROM memory_sync_outbox WHERE id = $1", [row.id]);
      synced += 1;
    } catch (error) {
      const retry = shouldRetryError(error);
      if (retry) retrying += 1;
      else failed += 1;
      await memStore.client.query(
        `UPDATE memory_sync_outbox
            SET status = $2,
                last_error = $3,
                next_attempt_at = CASE
                  WHEN $2 = 'queued' THEN now() + interval '5 minutes'
                  ELSE now()
                END,
                updated_at = now()
          WHERE id = $1`,
        [row.id, retry ? "queued" : "failed", errorMessage(error)],
      );
    }
  }

  return { synced, failed, retrying };
}

async function memoryOutboxStatus(memStore, savedTeamContext = null) {
  const params = [];
  const where = [];
  if (savedTeamContext?.teamId) where.push(`team_id = $${params.push(savedTeamContext.teamId)}`);
  if (savedTeamContext?.userId) where.push(`actor_user_id = $${params.push(savedTeamContext.userId)}`);
  const { rows } = await memStore.client.query(
    `SELECT status, count(*)::int AS n
       FROM memory_sync_outbox
      ${where.length ? `WHERE ${where.join(" AND ")}` : ""}
      GROUP BY status`,
    params,
  );
  const byStatus = {};
  for (const row of rows) byStatus[row.status] = Number(row.n);
  return {
    byStatus,
    queued: byStatus.queued ?? 0,
    syncing: byStatus.syncing ?? 0,
    failed: byStatus.failed ?? 0,
    total: Object.values(byStatus).reduce((sum, n) => sum + Number(n), 0),
  };
}

module.exports = {
  drainMemoryOutbox,
  memoryOutboxStatus,
  outboxPathFor,
  queueMemoryOutboxItem,
  shouldRetryError,
};
