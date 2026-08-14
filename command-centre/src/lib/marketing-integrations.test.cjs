const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const integrations = loadTsModule(path.resolve(__dirname, "marketing-integrations.ts"));

test("parseComposioSnapshot extracts active and reconnect toolkit rows", () => {
  const snapshot = integrations.parseComposioSnapshot(`
Connected-account snapshot from composio connections list (updated 2026-07-08):

| Status | Toolkits |
|--------|----------|
| Active | \`apify\`, \`firecrawl\`, \`instagram\`, \`linkedin\`, \`twitter\` |
| Needs reconnect before use | \`gmail\`, \`github\`, \`google_analytics\`, \`hubspot\` |
`);

  assert.equal(snapshot.updatedAt, "2026-07-08");
  assert.deepEqual(snapshot.active, ["apify", "firecrawl", "instagram", "linkedin", "twitter"]);
  assert.deepEqual(snapshot.needsReconnect, ["github", "gmail", "google_analytics", "hubspot"]);
});

test("buildMarketingIntegrationStatuses marks social publishing partial without a scheduler adapter", () => {
  const rows = integrations.buildMarketingIntegrationStatuses({
    mcpServers: [],
    services: [],
    configuredCount: 0,
    composio: {
      active: ["instagram", "linkedin", "twitter"],
      needsReconnect: [],
      updatedAt: "2026-07-08",
      source: "test",
    },
  });

  const social = rows.find((row) => row.key === "social-publishing");
  assert.equal(social.readiness, "partial");
  assert.equal(social.readinessPercent, 50);
  assert.deepEqual(social.matchedSignals, ["Instagram Composio", "LinkedIn Composio", "X/Twitter Composio"]);
  assert.ok(social.missingSignals.includes("Buffer"));
});

test("buildMarketingIntegrationStatuses separates reconnect from missing", () => {
  const rows = integrations.buildMarketingIntegrationStatuses({
    mcpServers: [],
    services: [{ key: "FIRECRAWL_API_KEY", service: "Firecrawl", usedBy: "test", configured: true }],
    configuredCount: 1,
    composio: {
      active: ["apify"],
      needsReconnect: ["gmail", "github"],
      updatedAt: "2026-07-08",
      source: "test",
    },
  });

  assert.equal(rows.find((row) => row.key === "research-crawl").readiness, "ready");
  assert.equal(rows.find((row) => row.key === "email").readiness, "reconnect");
  assert.equal(rows.find((row) => row.key === "site-cms").readiness, "partial");
});

test("getIntegrationSummary counts ready, partial, reconnect, missing, and gated surfaces", () => {
  const rows = integrations.buildMarketingIntegrationStatuses({
    mcpServers: [],
    services: [],
    configuredCount: 0,
    composio: {
      active: ["dataforseo", "firecrawl", "apify", "googleads"],
      needsReconnect: ["google_analytics", "gmail"],
      updatedAt: "2026-07-08",
      source: "test",
    },
  });

  const summary = integrations.getIntegrationSummary(rows);
  assert.equal(summary.total, rows.length);
  assert.ok(summary.ready > 0);
  assert.ok(summary.partial > 0);
  assert.ok(summary.reconnect > 0);
  assert.ok(summary.gated > 0);
});
