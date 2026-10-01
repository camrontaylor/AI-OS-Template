"use strict";

const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const scope = loadTsModule(path.join(__dirname, "task-list-scope.ts"));

test("profile task list scope cannot be narrowed by mutable client filters", () => {
  assert.equal(scope.validateTaskListScope(new URLSearchParams("scope=profile")), null);
  assert.match(
    scope.validateTaskListScope(new URLSearchParams("scope=profile&clientId=acme")),
    /cannot be combined/i,
  );
  assert.match(
    scope.validateTaskListScope(new URLSearchParams("scope=team")),
    /must be profile/i,
  );
});
