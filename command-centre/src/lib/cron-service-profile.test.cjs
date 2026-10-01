"use strict";

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

test("cron service filters job files and uses the active profile database", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-cron-service-"));
  const jobsDir = path.join(root, "cron", "jobs");
  fs.mkdirSync(jobsDir, { recursive: true });
  fs.writeFileSync(path.join(jobsDir, "owned.md"), "owned\n");
  fs.writeFileSync(path.join(jobsDir, "foreign.md"), "foreign\n");
  const calls = [];
  const registrations = [];
  const runtime = {
    runWithDbPath(dbPath, operation) {
      calls.push(dbPath);
      return operation();
    },
    getCronJob(_root, slug, clientId) {
      calls.push(`read:${slug}`);
      return { slug, clientId, workspaceKey: "root", active: true };
    },
    listWorkspaceDescriptors() { return [{ clientId: null }]; },
    createCronJob(_root, clientId, input) {
      return { slug: "new-job", clientId, workspaceKey: "root", active: true, name: input.name };
    },
  };
  try {
    const cron = loadTsModule(path.join(__dirname, "cron-service.ts"), {
      stubs: {
      "./config": {
        getConfig: () => ({ aiOsDir: root }),
        getClientAiOsDir: (clientId) => clientId ? path.join(root, "clients", clientId) : root,
      },
      "./cron-system-status": { getCronSystemStatus: () => ({}) },
      "./db": { getActiveLocalProfileDescriptor: () => ({ mode: "team", profileKey: "profile-a", dbPath: path.join(root, "profiles", "profile-a", "data.db") }) },
      "./materialized-file-ownership": {
        assertMaterializedPathAccessible: () => {},
        assertMaterializedPathWritable: (filePath) => calls.push(`write:${filePath}`),
        isMaterializedPathAccessible: (filePath) => filePath.endsWith(`${path.sep}owned.md`),
        registerMaterializedFiles: (files, options) => registrations.push({ files, options }),
        removeMaterializedOwnership: () => {},
      },
      "./cron-runtime.js": runtime,
      },
    });

    assert.deepEqual(cron.listCronJobs().map((job) => job.slug), ["owned"]);
    assert.equal(calls.includes("read:foreign"), false);
    assert.equal(calls.includes(path.join(root, "profiles", "profile-a", "data.db")), true);

    cron.createCronJob({ name: "New Job" });
    assert.equal(calls.some((value) => String(value).endsWith(`${path.sep}cron${path.sep}jobs${path.sep}new-job.md`)), true);
    assert.deepEqual(registrations[0].options, { scope: "team", kind: "cron-job" });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
