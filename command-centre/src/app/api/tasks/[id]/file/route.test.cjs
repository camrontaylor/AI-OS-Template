const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../../lib/test-utils/load-ts-module.cjs");

function jsonResponse(body, init = {}) {
  return Response.json(body, { status: init.status ?? 200 });
}

function request(body, filePath = "projects/briefs/demo/brief.md", query = {}) {
  const url = new URL(`http://localhost/api/tasks/task-1/file?path=${encodeURIComponent(filePath)}`);
  for (const [key, value] of Object.entries(query)) url.searchParams.set(key, value);
  return {
    nextUrl: { searchParams: url.searchParams },
    json: async () => body,
  };
}

function loadRoute({
  archived = false,
  onWrite = () => ({ lastModified: "2026-07-13T12:00:00.000Z" }),
  pathKind = "file",
  pathExists = true,
  resolveFile = (_taskId, relativePath) => ({
    relativePath,
    absolutePath: `C:/workspace/${relativePath}`,
    baseDir: "C:/workspace",
  }),
} = {}) {
  class TaskArchiveError extends Error {
    constructor(message = "Restore this Goal before making changes.", status = 409) {
      super(message);
      this.status = status;
    }
  }

  const route = loadTsModule(path.resolve(__dirname, "route.ts"), {
    stubs: {
      fs: {
        existsSync: () => pathExists,
        statSync: () => ({
          isDirectory: () => pathKind === "directory",
          isFile: () => pathKind === "file",
          size: pathKind === "directory" ? 0 : 42,
          mtime: new Date("2026-07-13T12:00:00.000Z"),
        }),
        readFileSync: () => Buffer.from("file content"),
      },
      "next/server": { NextResponse: { json: jsonResponse } },
      "@/lib/file-service": { writeFile: onWrite },
      "@/lib/db": { getDb: () => ({}) },
      "@/lib/team-mode": { isHostedTeamMode: () => false },
      "@/lib/task-file-access": {
        resolveTaskFile: resolveFile,
      },
      "@/lib/task-archive": {
        TaskArchiveError,
        assertTaskMutable: () => {
          if (archived) throw new TaskArchiveError();
        },
      },
    },
  });

  return { route };
}

test("GET metadata distinguishes files and directories without reading content", async () => {
  const fileRoute = loadRoute({ pathKind: "file" }).route;
  const fileResponse = await fileRoute.GET(
    request(null, "projects/briefs/demo/brief.md", { meta: "1" }),
    { params: Promise.resolve({ id: "task-1" }) },
  );
  assert.deepEqual(await fileResponse.json(), {
    type: "file",
    extension: "md",
    size: 42,
    lastModified: "2026-07-13T12:00:00.000Z",
  });

  const directoryRoute = loadRoute({ pathKind: "directory" }).route;
  const directoryResponse = await directoryRoute.GET(
    request(null, "projects/briefs/demo", { meta: "1" }),
    { params: Promise.resolve({ id: "task-1" }) },
  );
  assert.deepEqual(await directoryResponse.json(), {
    type: "directory",
    extension: "",
    size: 0,
    lastModified: "2026-07-13T12:00:00.000Z",
  });
});

test("GET metadata preserves missing-path and workspace-boundary errors", async () => {
  const missingRoute = loadRoute({ pathExists: false }).route;
  const missingResponse = await missingRoute.GET(
    request(null, "projects/missing", { meta: "1" }),
    { params: Promise.resolve({ id: "task-1" }) },
  );
  assert.equal(missingResponse.status, 404);

  const deniedRoute = loadRoute({ resolveFile: () => null }).route;
  const deniedResponse = await deniedRoute.GET(
    request(null, "../secret", { meta: "1" }),
    { params: Promise.resolve({ id: "task-1" }) },
  );
  assert.equal(deniedResponse.status, 403);
});

test("PUT blocks archived Goal trees before parsing or writing file content", async () => {
  let bodyReads = 0;
  let writes = 0;
  const { route } = loadRoute({
    archived: true,
    onWrite: () => {
      writes += 1;
      return { lastModified: "unused" };
    },
  });
  const req = request({ content: "blocked" });
  req.json = async () => {
    bodyReads += 1;
    return { content: "blocked" };
  };

  const response = await route.PUT(req, { params: Promise.resolve({ id: "child-of-archived-goal" }) });

  assert.equal(response.status, 409);
  assert.match(await response.text(), /Restore this Goal/);
  assert.equal(bodyReads, 0);
  assert.equal(writes, 0);
});

test("PUT maps stale lastModified conflicts to 409 without hiding the reason", async () => {
  let writeArgs = null;
  const { route } = loadRoute({
    onWrite: (...args) => {
      writeArgs = args;
      throw new Error("File was modified since it was opened");
    },
  });

  const response = await route.PUT(
    request({ content: "new content", lastModified: "2026-07-13T10:00:00.000Z" }),
    { params: Promise.resolve({ id: "task-1" }) },
  );

  assert.equal(response.status, 409);
  assert.match(await response.text(), /modified since/);
  assert.deepEqual(writeArgs, [
    "projects/briefs/demo/brief.md",
    "new content",
    "2026-07-13T10:00:00.000Z",
    "C:/workspace",
  ]);
});
