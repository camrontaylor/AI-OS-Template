"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../lib/test-utils/load-ts-module.cjs");

function jsonResponse(body, init = {}) {
  return new Response(JSON.stringify(body), {
    ...init,
    headers: { "content-type": "application/json", ...(init.headers || {}) },
  });
}

test("projects list omits a brief owned by another profile", async () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-project-route-"));
  for (const slug of ["owned", "foreign"]) {
    const dir = path.join(root, "projects", "briefs", slug);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "brief.md"), `---\nproject: ${slug}\nstatus: active\nlevel: 2\ncreated: 2026-07-12\n---\n\n# ${slug}\n`);
  }
  class MaterializedFileAccessError extends Error {}
  try {
    const route = loadTsModule(path.join(__dirname, "route.ts"), {
      stubs: {
        "next/server": { NextResponse: { json: jsonResponse } },
        "@/lib/config": { getConfig: () => ({ aiOsDir: root }), getClientAiOsDir: () => root },
        "@/lib/db": { getDb: () => ({ prepare: () => ({ get: () => ({ taskCount: 0, doneCount: 0 }) }) }) },
        "@/lib/materialized-file-ownership": {
          assertMaterializedPathAccessible: () => {},
          assertMaterializedPathWritable: () => {},
          isMaterializedPathAccessible: (filePath) => filePath.includes(`${path.sep}owned${path.sep}`),
          MaterializedFileAccessError,
          registerMaterializedFiles: () => {},
        },
      },
    });
    const response = await route.GET(new Request("http://localhost/api/projects"));
    const projects = await response.json();
    assert.deepEqual(projects.map((project) => project.slug), ["owned"]);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
