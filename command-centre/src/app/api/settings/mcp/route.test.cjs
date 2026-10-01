"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

test("MCP settings hide another profile's materialized configuration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-mcp-owner-"));
  fs.writeFileSync(path.join(root, ".mcp.json"), "{}\n");
  let fetched = false;
  class MaterializedFileAccessError extends Error {
    constructor() { super("File not found"); this.status = 404; }
  }
  try {
    const route = loadTsModule(path.join(__dirname, "route.ts"), {
      stubs: {
        "next/server": { NextResponse: { json: jsonResponse } },
        "@/lib/config": { getConfig: () => ({ aiOsDir: root }) },
        "@/lib/team-api-context": {
          fetchTeamUserConfigFile: async () => { fetched = true; return null; },
          writeTeamUserConfigFile: async () => ({}),
          TeamApiError: class TeamApiError extends Error {},
        },
        "@/lib/materialized-file-ownership": {
          assertMaterializedPathAccessible: () => { throw new MaterializedFileAccessError(); },
          assertMaterializedPathWritable: () => {},
          MaterializedFileAccessError,
          registerMaterializedFiles: () => {},
        },
      },
    });

    const response = await route.GET();
    assert.equal(response.status, 404);
    assert.equal(fetched, false);
    assert.deepEqual(await response.json(), { error: "Configuration not found" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("MCP restore registers a new Team-managed configuration", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-mcp-restore-"));
  const registrations = [];
  try {
    const route = loadTsModule(path.join(__dirname, "route.ts"), {
      stubs: {
        "next/server": { NextResponse: { json: jsonResponse } },
        "@/lib/config": { getConfig: () => ({ aiOsDir: root }) },
        "@/lib/team-api-context": {
          fetchTeamUserConfigFile: async () => ({ content: "{\"mcpServers\":{}}", sha256: "sha" }),
          writeTeamUserConfigFile: async () => ({}),
          TeamApiError: class TeamApiError extends Error {},
        },
        "@/lib/materialized-file-ownership": {
          assertMaterializedPathAccessible: () => {},
          assertMaterializedPathWritable: () => {},
          MaterializedFileAccessError: class MaterializedFileAccessError extends Error {},
          registerMaterializedFiles: (files, options) => registrations.push({ files, options }),
        },
      },
    });

    const response = await route.GET();
    assert.equal(response.status, 200);
    assert.equal(fs.existsSync(path.join(root, ".mcp.json")), true);
    assert.deepEqual(registrations[0].options, { scope: "config", kind: "team-mcp-config" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
