const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const commandCentreRoot = path.resolve(__dirname, "../../..");
const workspaceRoot = path.resolve(commandCentreRoot, "..");
const loader = require(path.join(commandCentreRoot, "scripts", "load-memory-modules.cjs"));

test("load-memory-modules resolves command-centre from AI_OS_DIR when bundled paths are wrong", () => {
  const resolved = loader.resolveCommandCentreRoot({
    env: { AI_OS_DIR: workspaceRoot },
    cwd: path.join(workspaceRoot, ".next", "server"),
    startDir: path.join(path.parse(workspaceRoot).root, "ROOT", "scripts"),
  });

  assert.equal(resolved, commandCentreRoot);
});

test("load-memory-modules loads the memory graph from the resolved source tree", () => {
  const modules = loader.loadMemoryModules({ withCapture: false });

  assert.equal(typeof modules.embedding.toVectorLiteral, "function");
  assert.equal(typeof modules.chunker.chunkMarkdown, "function");
  assert.equal(typeof modules.ingest.sha256Hex, "function");
});
