"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");
const events = loadTsModule(path.resolve(__dirname, "use-workspace-file-events.ts"));

test("workspace file event parser accepts connection and safe directory events", () => {
  assert.deepEqual(
    events.parseWorkspaceFileEventBlock("event: connected\ndata: {\"timestamp\":\"now\"}"),
    { type: "connected" },
  );
  assert.deepEqual(
    events.parseWorkspaceFileEventBlock("event: workspace:directory-changed\ndata: {\"directory\":\"projects\\\\briefs\\\\demo\"}"),
    { type: "workspace:directory-changed", directory: "projects/briefs/demo" },
  );
  assert.deepEqual(
    events.parseWorkspaceFileEventBlock("event: workspace:directory-changed\ndata: {\"directory\":\"\"}"),
    { type: "workspace:directory-changed", directory: "" },
  );
});

test("workspace file event parser rejects malformed and unsafe payloads", () => {
  assert.equal(events.parseWorkspaceFileEventBlock(": keep-alive"), null);
  assert.equal(events.parseWorkspaceFileEventBlock("event: task:updated\ndata: {}"), null);
  assert.equal(events.parseWorkspaceFileEventBlock("event: workspace:directory-changed\ndata: nope"), null);
  assert.equal(events.parseWorkspaceFileEventBlock("event: workspace:directory-changed\ndata: {\"directory\":\"../secret\"}"), null);
  assert.equal(events.parseWorkspaceFileEventBlock("event: workspace:directory-changed\ndata: {\"directory\":\"C:/secret\"}"), null);
});
