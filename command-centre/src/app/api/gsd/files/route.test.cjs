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

test("GSD file listing omits files owned by another profile", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-gsd-route-"));
  const planningDir = path.join(root, ".planning");
  const phaseDir = path.join(planningDir, "phases", "01-foundation");
  fs.mkdirSync(phaseDir, { recursive: true });
  fs.writeFileSync(path.join(phaseDir, "owned.md"), "owned\n");
  fs.writeFileSync(path.join(phaseDir, "foreign.md"), "foreign\n");
  try {
    const route = loadTsModule(path.join(__dirname, "route.ts"), {
      stubs: {
        "next/server": { NextResponse: { json: jsonResponse } },
        "@/lib/config": { resolvePlanningDir: () => ({ planningDir, projectSlug: "project" }) },
        "@/lib/materialized-file-ownership": {
          isMaterializedPathAccessible: (filePath) => path.basename(filePath) === "owned.md",
        },
      },
    });
    const response = await route.GET({ url: "http://localhost/api/gsd/files?phase=1" });
    const body = await response.json();
    assert.deepEqual(body.files.map((file) => file.name), ["owned.md"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
