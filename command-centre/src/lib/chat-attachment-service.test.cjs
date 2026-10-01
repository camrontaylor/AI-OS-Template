const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const policyPath = path.resolve(__dirname, "chat-attachment-policy.ts");
const policy = loadTsModule(policyPath);

function createTempWorkspace() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "chat-attachment-service-"));
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

function createDbStub() {
  return {
    prepare(sql) {
      return {
        get(value) {
          if (sql.includes("SELECT clientId, workScope FROM conversations")) {
            return value === "conv-client"
              ? { clientId: "client-1", workScope: null }
              : { clientId: null, workScope: null };
          }
          if (sql.includes("SELECT clientId, workScope FROM tasks")) {
            return value === "task-client"
              ? { clientId: "client-1", workScope: null }
              : { clientId: null, workScope: null };
          }
          if (sql.includes("SELECT c.clientId")) {
            return { clientId: null, workScope: null };
          }
          if (sql.includes("SELECT status FROM conversations")) {
            return value === "conv-archived" ? { status: "archived" } : { status: "active" };
          }
          if (sql.includes("SELECT status, needsInput FROM tasks")) {
            if (value === "task-done") return { status: "done", needsInput: 0 };
            return { status: "running", needsInput: 1 };
          }
          if (sql.includes("SELECT c.status")) {
            return { status: "active" };
          }
          throw new Error(`Unhandled SQL in test db stub: ${sql}`);
        },
      };
    },
  };
}

function createService(workspace) {
  const modulePath = path.resolve(__dirname, "chat-attachment-service.ts");
  return loadTsModule(modulePath, {
    stubs: {
      "@/lib/db": {
        getDb: () => createDbStub(),
        getActiveLocalProfileDescriptor: () => ({ mode: "solo" }),
      },
      "@/lib/config": {
        getConfig: () => ({ aiOsDir: workspace.rootDir }),
        getClientAiOsDir: (clientId) => {
          assert.equal(clientId, "client-1");
          return workspace.clientDir;
        },
      },
      "@/lib/chat-attachment-policy": policy,
      "@/lib/identity/work-scope": {
        readWorkScopeFromRow(row) {
          return { mode: "solo", version: 1, clientId: row.clientId ?? null };
        },
      },
      "@/types/chat-composer": {},
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

test("storeChatDraftFiles saves multiple files under the correct draft folder", async () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const attachments = await service.storeChatDraftFiles({
      surface: "conversation",
      scopeId: "conv-root",
      draftKey: "draft-1",
      files: [
        createFile("notes.md", "# Draft"),
        createFile("plan.pdf", "%PDF", "application/pdf"),
      ],
    });

    assert.equal(attachments.length, 2);
    for (const attachment of attachments) {
      assert.match(
        attachment.relativePath,
        /^\.tmp\/chat-drafts\/drafts\/conversation\/conv-root\/draft-1\//,
      );
      assert.equal(
        fs.existsSync(path.join(workspace.rootDir, attachment.relativePath)),
        true,
      );
    }
  } finally {
    workspace.cleanup();
  }
});

test("storeChatDraftFiles resolves client-scoped uploads into the client workspace", async () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const [attachment] = await service.storeChatDraftFiles({
      surface: "task",
      scopeId: "task-client",
      draftKey: "draft-1",
      files: [createFile("client.txt", "hello client")],
    });

    assert.equal(fs.existsSync(path.join(workspace.clientDir, attachment.relativePath)), true);
    assert.equal(fs.existsSync(path.join(workspace.rootDir, attachment.relativePath)), false);
  } finally {
    workspace.cleanup();
  }
});

test("deleteChatDraftAttachment only deletes files from the exact draft scope", async () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const [keptAttachment] = await service.storeChatDraftFiles({
      surface: "conversation",
      scopeId: "conv-other",
      draftKey: "draft-1",
      files: [createFile("keep.txt", "keep")],
    });

    assert.throws(() => {
      service.deleteChatDraftAttachment({
        surface: "conversation",
        scopeId: "conv-root",
        draftKey: "draft-1",
        relativePath: keptAttachment.relativePath,
      });
    }, /expected draft scope/);

    assert.equal(fs.existsSync(path.join(workspace.rootDir, keptAttachment.relativePath)), true);
  } finally {
    workspace.cleanup();
  }
});

test("copyChatAttachmentsToSent rewrites attachment metadata for the destination scope", async () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const [draftAttachment] = await service.storeChatDraftFiles({
      surface: "conversation",
      scopeId: "conv-root",
      draftKey: "draft-1",
      files: [createFile("design.png", "image-bytes", "image/png")],
    });

    const [sentAttachment] = service.copyChatAttachmentsToSent({
      surface: "task",
      scopeId: "task-root",
      referenceId: "reply-1",
      attachments: [draftAttachment],
    });

    assert.equal(sentAttachment.state, "sent");
    assert.equal(sentAttachment.surface, "task");
    assert.equal(sentAttachment.scopeId, "task-root");
    assert.equal(sentAttachment.draftKey, null);
    assert.match(
      sentAttachment.relativePath,
      /^\.tmp\/chat-drafts\/sent\/task\/task-root\/reply-1\//,
    );
    assert.equal(
      fs.existsSync(path.join(workspace.rootDir, sentAttachment.relativePath)),
      true,
    );
  } finally {
    workspace.cleanup();
  }
});

test("cleanupChatAttachmentStorage prunes stale draft folders and inactive sent folders", () => {
  const workspace = createTempWorkspace();
  const service = createService(workspace);

  try {
    const staleDraftDir = path.join(
      workspace.rootDir,
      ".tmp",
      "chat-drafts",
      "drafts",
      "conversation",
      "conv-root",
      "draft-stale",
    );
    const oldSentDoneDir = path.join(
      workspace.rootDir,
      ".tmp",
      "chat-drafts",
      "sent",
      "task",
      "task-done",
      "ref-1",
    );
    const oldSentLiveDir = path.join(
      workspace.rootDir,
      ".tmp",
      "chat-drafts",
      "sent",
      "task",
      "task-live",
      "ref-1",
    );

    fs.mkdirSync(staleDraftDir, { recursive: true });
    fs.mkdirSync(oldSentDoneDir, { recursive: true });
    fs.mkdirSync(oldSentLiveDir, { recursive: true });
    fs.writeFileSync(path.join(staleDraftDir, "draft.txt"), "draft");
    fs.writeFileSync(path.join(oldSentDoneDir, "done.txt"), "done");
    fs.writeFileSync(path.join(oldSentLiveDir, "live.txt"), "live");

    const now = new Date();
    const staleDraftDate = new Date(now.getTime() - 8 * 24 * 60 * 60 * 1000);
    const staleSentDate = new Date(now.getTime() - 31 * 24 * 60 * 60 * 1000);
    fs.utimesSync(staleDraftDir, staleDraftDate, staleDraftDate);
    fs.utimesSync(oldSentDoneDir, staleSentDate, staleSentDate);
    fs.utimesSync(oldSentLiveDir, staleSentDate, staleSentDate);

    service.cleanupChatAttachmentStorage({ surface: "conversation", scopeId: "conv-root" });

    assert.equal(fs.existsSync(staleDraftDir), false);
    assert.equal(fs.existsSync(oldSentDoneDir), false);
    assert.equal(fs.existsSync(oldSentLiveDir), true);
  } finally {
    workspace.cleanup();
  }
});
