const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const consolidate = require(path.resolve(__dirname, "../../../scripts/memory-consolidate.cjs"));

const BATCH = {
  id: "batch-12345678",
  claimToken: "claim-token",
  scope: { teamId: "team-1", clientId: null, userId: null, visibility: "team" },
};

const CAPTURES = [
  {
    id: "capture-1",
    sessionId: "session-1",
    actorUserId: "user-1",
    sourcePath: "context/memory/2026-06-30.aos.md#session-1",
    createdAt: "2026-06-30T12:00:00.000Z",
    content: "Team decided to consolidate memory before recall.",
  },
];

function makeRequest({ modelOutput, claim = { batch: BATCH, captures: CAPTURES } } = {}) {
  const calls = [];
  const request = async (_config, pathName, options = {}) => {
    calls.push({ pathName, options });
    if (pathName === "/v1/team/whoami") {
      return { team: { id: "team-1" }, user: { id: "user-1" } };
    }
    if (pathName === "/v1/memory/consolidation/claim") {
      return claim;
    }
    if (pathName === "/v1/memory/consolidation/complete") {
      const body = options.body;
      return {
        batch: { ...BATCH, status: "completed" },
        published: body.items.filter((item) => item.disposition === "publish"),
        review: body.items.filter((item) => item.disposition === "review"),
        discarded: body.items.filter((item) => item.disposition === "discard"),
      };
    }
    throw new Error(`unexpected request ${pathName}`);
  };
  return {
    calls,
    request,
    modelRunner: async () => modelOutput,
  };
}

test("memory-consolidate publishes clear durable items with prepared embeddings", async () => {
  const harness = makeRequest({
    modelOutput: JSON.stringify({
      items: [{
        disposition: "publish",
        captureIds: ["capture-1"],
        title: "Memory staging decision",
        content: "# Decision\n\nTeam memory is staged before recall publication.",
        confidence: 0.94,
      }],
    }),
  });
  const result = await consolidate.consolidateOnce({
    config: { apiUrl: "http://team.test", token: "token" },
    request: harness.request,
    modelRunner: harness.modelRunner,
    prepareIngest: async ({ content, sourcePath }) => ({
      contentSha256: "a".repeat(64),
      byteSize: Buffer.byteLength(content, "utf-8"),
      embeddingModel: "bge-m3",
      embeddingDim: 1024,
      chunks: [{
        index: 0,
        content,
        contentHash: "b".repeat(64),
        chunkKey: `${sourcePath}:1`,
        embedding: [1, 0],
      }],
    }),
  });

  assert.equal(result.claimed, 1);
  assert.equal(result.published, 1);
  const complete = harness.calls.find((call) => call.pathName === "/v1/memory/consolidation/complete");
  assert.ok(complete);
  const item = complete.options.body.items[0];
  assert.equal(item.disposition, "publish");
  assert.equal(item.sourceType, "memory");
  assert.match(item.sourcePath, /^consolidated\/team\//);
  assert.equal(item.embeddingModel, "bge-m3");
});

test("memory-consolidate sends low-confidence publish candidates to review", async () => {
  const harness = makeRequest({
    modelOutput: JSON.stringify({
      items: [{
        disposition: "publish",
        captureIds: ["capture-1"],
        title: "Unclear preference",
        content: "# Preference\n\nMaybe use this later.",
        confidence: 0.4,
      }],
    }),
  });
  const result = await consolidate.consolidateOnce({
    config: { apiUrl: "http://team.test", token: "token" },
    request: harness.request,
    modelRunner: harness.modelRunner,
    prepareIngest: async () => {
      throw new Error("prepareIngest should not run for low confidence");
    },
  });

  assert.equal(result.published, 0);
  assert.equal(result.review, 1);
  const complete = harness.calls.find((call) => call.pathName === "/v1/memory/consolidation/complete");
  assert.equal(complete.options.body.items[0].disposition, "review");
  assert.equal(complete.options.body.items[0].reviewReason, "low_confidence");
});

test("memory-consolidate discards empty model output as no durable memory", async () => {
  const harness = makeRequest({ modelOutput: JSON.stringify({ items: [] }) });
  const result = await consolidate.consolidateOnce({
    config: { apiUrl: "http://team.test", token: "token" },
    request: harness.request,
    modelRunner: harness.modelRunner,
    prepareIngest: async () => {
      throw new Error("prepareIngest should not run for discard");
    },
  });

  assert.equal(result.discarded, 1);
  const complete = harness.calls.find((call) => call.pathName === "/v1/memory/consolidation/complete");
  assert.equal(complete.options.body.items[0].disposition, "discard");
});

test("memory-consolidate fails closed to review when model output is invalid", async () => {
  const harness = makeRequest({ modelOutput: "not json" });
  const result = await consolidate.consolidateOnce({
    config: { apiUrl: "http://team.test", token: "token" },
    request: harness.request,
    modelRunner: harness.modelRunner,
  });

  assert.equal(result.published, 0);
  assert.equal(result.review, 1);
  const complete = harness.calls.find((call) => call.pathName === "/v1/memory/consolidation/complete");
  assert.equal(complete.options.body.items[0].disposition, "review");
  assert.match(complete.options.body.items[0].reviewReason, /model_failed/);
});

test("memory-consolidate keeps system prompt shell metacharacters out of argv", () => {
  const args = consolidate.buildClaudeConsolidationArgs("haiku");
  const promptInput = consolidate.buildClaudeConsolidationInput("Capture content");

  assert.equal(args.includes("--system-prompt"), false);
  assert.ok(!args.some((arg) => String(arg).includes("publish|review|discard")));
  assert.match(promptInput, /publish\|review\|discard/);
});

test("memory-consolidate treats explicit memory requests as durable candidates", () => {
  const prompt = consolidate.buildConsolidationSystemPrompt();

  assert.match(prompt, /remember this/);
  assert.match(prompt, /save this/);
  assert.match(prompt, /team\/client memory/);
  assert.match(prompt, /mark it review instead of publishing/);
});

test("memory-consolidate discards memory maintenance captures without model review", async () => {
  const maintenanceCapture = {
    ...CAPTURES[0],
    id: "capture-maintenance",
    content: [
      "- User submitted a scheduled job task requesting Claude Code to refresh the local PGLite memory index for AI-OS.",
      "- Claude Code executed `npm run memory:capture -- --reason refresh --force` from command-centre.",
      "- Status check showed Tier 1 semantic recall is current.",
    ].join("\n"),
  };
  const harness = makeRequest({
    claim: { batch: BATCH, captures: [maintenanceCapture] },
  });
  const result = await consolidate.consolidateOnce({
    config: { apiUrl: "http://team.test", token: "token" },
    request: harness.request,
    modelRunner: async () => {
      throw new Error("model should not run for maintenance captures");
    },
  });

  assert.equal(result.published, 0);
  assert.equal(result.review, 0);
  assert.equal(result.discarded, 1);
  const complete = harness.calls.find((call) => call.pathName === "/v1/memory/consolidation/complete");
  assert.equal(complete.options.body.items[0].disposition, "discard");
  assert.equal(complete.options.body.items[0].discardReason, "memory_maintenance_capture");
});

test("memory-consolidate does not treat explicit team memory requests as maintenance just because they came from context memory", async () => {
  const canaryCapture = {
    ...CAPTURES[0],
    id: "capture-canary",
    sourcePath: "context/memory/2026-07-02.aos.md#session-canary",
    content: [
      "- User invoked the meta-memory-write skill to save a test entry to working memory.",
      "- Task: add the canary phrase \"TEAM_MEMORY_FLOW_CANARY_2026_07_02\" to context/MEMORY.md for Team OS memory-flow testing.",
      "- Claude Code executed the skill and confirmed successful write with the standard confirmation message.",
    ].join("\n"),
  };
  const harness = makeRequest({
    claim: { batch: BATCH, captures: [canaryCapture] },
    modelOutput: JSON.stringify({
      items: [{
        disposition: "publish",
        captureIds: ["capture-canary"],
        title: "Team memory flow canary",
        content: "Team OS memory-flow testing uses canary phrase `TEAM_MEMORY_FLOW_CANARY_2026_07_02`.",
        confidence: 0.95,
      }],
    }),
  });
  const result = await consolidate.consolidateOnce({
    config: { apiUrl: "http://team.test", token: "token" },
    request: harness.request,
    modelRunner: harness.modelRunner,
    prepareIngest: async ({ content, sourcePath }) => ({
      contentSha256: "a".repeat(64),
      byteSize: Buffer.byteLength(content, "utf-8"),
      embeddingModel: "bge-m3",
      embeddingDim: 1024,
      chunks: [{
        index: 0,
        content,
        contentHash: "b".repeat(64),
        chunkKey: `${sourcePath}:1`,
        embedding: [1, 0],
      }],
    }),
  });

  assert.equal(result.published, 1);
  assert.equal(result.discarded, 0);
  const complete = harness.calls.find((call) => call.pathName === "/v1/memory/consolidation/complete");
  assert.equal(complete.options.body.items[0].disposition, "publish");
});
