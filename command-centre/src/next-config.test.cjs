const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const loadConfig = require("next/dist/server/config").default;
const { PHASE_DEVELOPMENT_SERVER } = require("next/constants");

const appRoot = path.resolve(__dirname, "..");

test("next dev never writes agent rule files that would move the workspace root", async () => {
  const config = await loadConfig(PHASE_DEVELOPMENT_SERVER, appRoot, { silent: true });

  // Next 16.3+ writes AGENTS.md and CLAUDE.md into command-centre/ when
  // `next dev` runs under an AI agent. Both are workspace-root markers in
  // scripts/workspace-root.cjs, so the next boot would read an empty workspace.
  assert.equal(config.agentRules, false);
});
