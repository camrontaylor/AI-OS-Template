const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const plan = loadTsModule(path.resolve(__dirname, "plan-brief.ts"), {
  stubs: {
    "@/types/question-spec": {
      extractQuestionSpecsFromText: () => null,
      parseQuestionSpecs: () => [],
      stripQuestionSpecsFromText: (text) => text,
    },
  },
});

test("derives ordered active and superseded plan versions from approval turns", () => {
  const entries = [
    { id: "a", type: "text", timestamp: "2026-07-12T10:00:00Z", content: "```approved-brief\n# Plan one\n```" },
    { id: "u", type: "user_reply", timestamp: "2026-07-12T10:01:00Z", content: "revise" },
    { id: "b1", type: "text", timestamp: "2026-07-12T10:02:00Z", content: "```approved-brief\n# Plan" },
    { id: "b2", type: "text", timestamp: "2026-07-12T10:03:00Z", content: " two\n```" },
  ];
  const versions = plan.extractApprovedPlanVersionsFromLogs(entries);
  assert.deepEqual(versions.map((version) => [version.content, version.status]), [
    ["# Plan one", "superseded"],
    ["# Plan\n two", "active"],
  ]);
});
