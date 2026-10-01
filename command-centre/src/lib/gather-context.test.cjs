const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-gather-"));
  fs.mkdirSync(path.join(root, "brand_context"), { recursive: true });
  fs.mkdirSync(path.join(root, "clients", "acme", "brand_context"), { recursive: true });
  return root;
}

function loadGatherContext(root, searchTeamMemory) {
  return loadTsModule(path.resolve(__dirname, "gather-context.ts"), {
    stubs: {
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: root }),
        getClientAiOsDir: (clientId) => path.join(root, "clients", clientId),
      },
      "@/lib/db": { getDb: () => ({}) },
      "@/lib/team-api-context": { searchTeamMemory },
    },
  });
}

test("gatherContext keeps local mode scoped to the selected client", async () => {
  const root = tempWorkspace();
  try {
    fs.writeFileSync(
      path.join(root, "brand_context", "voice-profile.md"),
      "ROOT ONLY CONTEXT",
    );
    fs.writeFileSync(
      path.join(root, "clients", "acme", "brand_context", "voice-profile.md"),
      "ACME CLIENT CONTEXT",
    );
    const gather = loadGatherContext(root, async () => null);

    const result = await gather.gatherContext("Plan a campaign", "acme");

    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].kind, "brand");
    assert.match(result.summary, /ACME CLIENT CONTEXT/);
    assert.doesNotMatch(result.summary, /ROOT ONLY CONTEXT/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gatherContext uses Team memory search with the selected client in Team mode", async () => {
  const root = tempWorkspace();
  let requested = null;
  try {
    fs.writeFileSync(
      path.join(root, "clients", "acme", "brand_context", "voice-profile.md"),
      "LOCAL CLIENT CONTEXT SHOULD NOT LEAK",
    );
    const gather = loadGatherContext(root, async (query, clientId, topK) => {
      requested = { query, clientId, topK };
      return {
        requestedClientId: clientId,
        visibilitySet: ["system", "team", "client"],
        eventId: "search-event-1",
        results: [{
          sourcePath: "clients/acme/context/memory/shared.md",
          sourceType: "memory",
          content: "HOSTED ACME MEMORY",
          startLine: 3,
          endLine: 5,
          finalScore: 0.91,
        }],
      };
    });

    const result = await gather.gatherContext("Plan an Acme campaign", "acme");

    assert.deepEqual(requested, {
      query: "Plan an Acme campaign",
      clientId: "acme",
      topK: 5,
    });
    assert.equal(result.sources.length, 1);
    assert.equal(result.sources[0].kind, "memory");
    assert.match(result.sources[0].origin, /visibility=system,team,client/);
    assert.match(result.summary, /HOSTED ACME MEMORY/);
    assert.doesNotMatch(result.summary, /LOCAL CLIENT CONTEXT SHOULD NOT LEAK/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("gatherContext does not fall back to local files when Team memory search fails", async () => {
  const root = tempWorkspace();
  try {
    fs.writeFileSync(
      path.join(root, "clients", "acme", "brand_context", "voice-profile.md"),
      "LOCAL CLIENT CONTEXT SHOULD NOT LEAK",
    );
    const gather = loadGatherContext(root, async () => {
      throw new Error("Team API unavailable");
    });

    const result = await gather.gatherContext("Plan an Acme campaign", "acme");

    assert.deepEqual(result.sources, []);
    assert.equal(result.summary, "");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
