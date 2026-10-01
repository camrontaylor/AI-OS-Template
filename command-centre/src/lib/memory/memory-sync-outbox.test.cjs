const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadMemoryModules } = require("../../../scripts/load-memory-modules.cjs");
const { drainMemoryOutbox } = require("../../../scripts/lib/memory-sync-outbox.cjs");

const EMBED_DIM = 1024;

const savedTeamContext = {
  config: { apiUrl: "http://example.invalid", token: "test-token" },
  teamId: "team-1",
  userId: "user-1",
};

async function openStore() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-outbox-"));
  const dataDir = path.join(root, ".command-centre", "memory");
  fs.mkdirSync(dataDir, { recursive: true });
  const { store } = loadMemoryModules({ withCapture: false });
  return { root, memStore: await store.openMemoryStore({ dataDir, embedDim: EMBED_DIM }) };
}

async function insertOutboxRow(memStore, overrides = {}) {
  const params = [
    overrides.operation || "ingest",
    overrides.dedupeKey || `ingest:test:${Math.random().toString(36).slice(2)}`,
    overrides.teamId || savedTeamContext.teamId,
    overrides.clientId ?? null,
    overrides.actorUserId || savedTeamContext.userId,
    overrides.visibility || "private",
    overrides.sourcePath || "context/memory/2026-01-01.aos.md#session-1",
    overrides.sourceHash || "hash-1",
    overrides.contentSha256 || "sha-1",
    overrides.requestPath || "/v1/memory/ingest",
    JSON.stringify(overrides.requestBody || { note: "test" }),
    overrides.status || "queued",
    overrides.attempts ?? 0,
    overrides.updatedAt || new Date().toISOString(),
  ];
  const result = await memStore.client.query(
    `INSERT INTO memory_sync_outbox
       (operation, dedupe_key, team_id, client_id, actor_user_id, visibility,
        source_path, source_hash, content_sha256, request_method, request_path,
        request_body, status, attempts, next_attempt_at, updated_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'POST', $10, $11::jsonb, $12, $13, now(), $14)
     RETURNING id::text`,
    params,
  );
  return result.rows[0].id;
}

async function readRow(memStore, id) {
  const { rows } = await memStore.client.query(
    "SELECT id::text, status FROM memory_sync_outbox WHERE id = $1",
    [id],
  );
  return rows[0] || null;
}

test("drainMemoryOutbox reclaims a row stranded in 'syncing' past the staleness window", async () => {
  const { root, memStore } = await openStore();
  try {
    const staleUpdatedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const id = await insertOutboxRow(memStore, { status: "syncing", updatedAt: staleUpdatedAt });

    const calls = [];
    const result = await drainMemoryOutbox({
      memStore,
      savedTeamContext,
      request: async (config, requestPath) => {
        calls.push(requestPath);
        return { ok: true };
      },
    });

    assert.equal(calls.length, 1);
    assert.equal(calls[0], "/v1/memory/ingest");
    assert.equal(result.synced, 1);
    assert.equal(await readRow(memStore, id), null); // deleted after a successful drain
  } finally {
    await memStore.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("drainMemoryOutbox leaves a freshly-syncing row alone", async () => {
  const { root, memStore } = await openStore();
  try {
    const id = await insertOutboxRow(memStore, { status: "syncing", updatedAt: new Date().toISOString() });

    const calls = [];
    const result = await drainMemoryOutbox({
      memStore,
      savedTeamContext,
      request: async (config, requestPath) => {
        calls.push(requestPath);
        return { ok: true };
      },
    });

    assert.equal(calls.length, 0);
    assert.equal(result.synced, 0);
    const row = await readRow(memStore, id);
    assert.equal(row.status, "syncing");
  } finally {
    await memStore.close();
    fs.rmSync(root, { recursive: true, force: true });
  }
});
