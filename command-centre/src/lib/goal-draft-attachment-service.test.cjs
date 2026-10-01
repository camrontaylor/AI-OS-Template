const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const policyPath = path.resolve(__dirname, "chat-attachment-policy.ts");
const policy = loadTsModule(policyPath);

function createTempWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "goal-draft-attachments-"));
  const rootDir = path.join(base, "root-workspace");
  const clientDir = path.join(base, "client-workspace");
  fs.mkdirSync(rootDir, { recursive: true });
  fs.mkdirSync(clientDir, { recursive: true });
  return {
    base,
    rootDir,
    clientDir,
    cleanup() {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function createService(workspace) {
  const modulePath = path.resolve(__dirname, "goal-draft-attachment-service.ts");
  return loadTsModule(modulePath, {
    stubs: {
      "@/lib/config": {
        getClientAiOsDir: (clientId) => {
          if (!clientId) return workspace.rootDir;
          assert.equal(clientId, "client-1");
          return workspace.clientDir;
        },
      },
      "@/lib/chat-attachment-policy": policy,
      "@/lib/db": {
        getActiveLocalProfileDescriptor: () => ({ mode: "solo" }),
      },
      "@/types/goal-draft": {},
    },
  });
}

function createFile(name, content, type = "text/plain") {
  const buffer = Buffer.from(content, "utf-8");
  return {
    name,
    size: buffer.length,
    type,
    async arrayBuffer() {
      return buffer;
    },
  };
}

test("goal draft attachment storage writes into the correct draft folder", async () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const [rootAttachment] = await service.storeGoalDraftFiles({
      draftId: "draft-root",
      clientId: null,
      files: [createFile("root.txt", "root")],
    });
    const [clientAttachment] = await service.storeGoalDraftFiles({
      draftId: "draft-client",
      clientId: "client-1",
      files: [createFile("client.txt", "client")],
    });

    assert.equal(fs.existsSync(path.join(workspace.rootDir, rootAttachment.relativePath)), true);
    assert.equal(fs.existsSync(path.join(workspace.clientDir, clientAttachment.relativePath)), true);
  } finally {
    workspace.cleanup();
  }
});

test("goal draft attachment deletion stays inside the expected draft scope", async () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const [attachment] = await service.storeGoalDraftFiles({
      draftId: "draft-1",
      clientId: null,
      files: [createFile("notes.txt", "notes")],
    });

    assert.throws(() => {
      service.deleteGoalDraftAttachment({
        draftId: "draft-2",
        clientId: null,
        relativePath: attachment.relativePath,
      });
    }, /expected draft scope/);

    service.clearGoalDraftScope({ draftId: "draft-1", clientId: null });
    assert.equal(
      fs.existsSync(path.join(workspace.rootDir, ".tmp", "goal-drafts", "draft-1")),
      false,
    );
  } finally {
    workspace.cleanup();
  }
});
