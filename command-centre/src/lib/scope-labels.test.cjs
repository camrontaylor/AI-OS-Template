"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function loadLabels(stateDir) {
  return loadTsModule(path.join(__dirname, "scope-labels.ts"), {
    stubs: {
      "./local-profile": {
        getLocalProfileStatePath(fileName) {
          return path.join(stateDir, fileName);
        },
      },
    },
  });
}

test("scope labels retain former Teams and scope clients by Team", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-scope-labels-"));
  try {
    const labels = loadLabels(stateDir);
    labels.mergeScopeLabels({
      teams: [{ id: "team-a", name: "Alpha", slug: "alpha" }],
      selectedTeamId: "team-a",
      clients: [{ id: "client-a", slug: "shared", name: "Alpha Shared" }],
      now: "2026-07-12T00:00:00.000Z",
    });
    const second = labels.mergeScopeLabels({
      teams: [{ id: "team-b", name: "Beta", slug: "beta" }],
      selectedTeamId: "team-b",
      clients: [{ id: "client-b", slug: "shared", name: "Beta Shared" }],
      now: "2026-07-13T00:00:00.000Z",
    });

    assert.deepEqual(second.teams.map((team) => team.id), ["team-a", "team-b"]);
    assert.deepEqual(
      second.clients.map((client) => [client.teamId, client.clientId, client.name]),
      [
        ["team-a", "shared", "Alpha Shared"],
        ["team-b", "shared", "Beta Shared"],
      ],
    );
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test("scope labels recover safely from corrupt display-only state", () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-scope-labels-"));
  try {
    fs.writeFileSync(path.join(stateDir, "scope-labels-v1.json"), "{broken");
    const labels = loadLabels(stateDir);
    assert.deepEqual(labels.readScopeLabels(), { version: 1, teams: [], clients: [] });
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});
