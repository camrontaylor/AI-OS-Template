const assert = require("node:assert/strict");
const { File } = require("node:buffer");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../../../lib/test-utils/load-ts-module.cjs");

function createNextServerStub() {
  return {
    NextRequest: class {},
    NextResponse: {
      json(body, init = {}) {
        return {
          status: init.status ?? 200,
          body,
          async json() {
            return body;
          },
        };
      },
    },
  };
}

function createFormData(entries) {
  return {
    get(key) {
      const values = entries[key];
      return Array.isArray(values) ? values[0] ?? null : values ?? null;
    },
    getAll(key) {
      const values = entries[key];
      if (Array.isArray(values)) return values;
      return values == null ? [] : [values];
    },
  };
}

test("goal draft attachments POST uploads files and DELETE removes either one file or the whole scope", async () => {
  const calls = [];
  const uploadedFile = new File(["one"], "one.txt", { type: "text/plain" });
  const modulePath = path.resolve(__dirname, "route.ts");
  const route = loadTsModule(modulePath, {
    stubs: {
      "next/server": createNextServerStub(),
      "@/lib/goal-draft-attachment-service": {
        async storeGoalDraftFiles(args) {
          calls.push(["store", args]);
          return args.files.map((file) => ({
            fileName: file.name,
            relativePath: `.tmp/goal-drafts/${args.draftId}/${file.name}`,
            extension: "txt",
            sizeBytes: 3,
          }));
        },
        deleteGoalDraftAttachment(args) {
          calls.push(["delete", args]);
        },
        clearGoalDraftScope(args) {
          calls.push(["clear", args]);
        },
      },
    },
  });

  const postResponse = await route.POST({
    async formData() {
      return createFormData({
        draftId: "draft-1",
        clientId: "client-1",
        files: [uploadedFile],
      });
    },
  });

  const deleteSingleResponse = await route.DELETE({
    async json() {
      return {
        draftId: "draft-1",
        clientId: "client-1",
        relativePath: ".tmp/goal-drafts/draft-1/one.txt",
      };
    },
  });

  const deleteScopeResponse = await route.DELETE({
    async json() {
      return {
        draftId: "draft-1",
        clientId: "client-1",
      };
    },
  });

  assert.equal(postResponse.status, 201);
  assert.equal(deleteSingleResponse.status, 200);
  assert.equal(deleteScopeResponse.status, 200);
  assert.equal(calls.length, 3);
  assert.equal(calls[0][0], "store");
  assert.equal(calls[0][1].draftId, "draft-1");
  assert.equal(calls[0][1].clientId, "client-1");
  assert.equal(calls[0][1].files.length, 1);
  assert.equal(calls[0][1].files[0].name, "one.txt");
  assert.equal(calls[1][0], "delete");
  assert.deepEqual(calls[1][1], {
    draftId: "draft-1",
    clientId: "client-1",
    relativePath: ".tmp/goal-drafts/draft-1/one.txt",
  });
  assert.equal(calls[2][0], "clear");
  assert.deepEqual(calls[2][1], {
    draftId: "draft-1",
    clientId: "client-1",
  });
});
