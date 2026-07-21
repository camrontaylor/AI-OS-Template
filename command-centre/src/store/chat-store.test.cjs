const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");

function createMemoryHarness() {
  const rememberedIds = new Map();
  const rememberCalls = [];
  const clearCalls = [];
  const keyFor = (clientId) => clientId ?? "_root";

  return {
    rememberedIds,
    rememberCalls,
    clearCalls,
    stub: {
      loadRememberedConversationId(clientId) {
        return rememberedIds.get(keyFor(clientId)) ?? null;
      },
      rememberConversationId(clientId, conversationId) {
        rememberedIds.set(keyFor(clientId), conversationId);
        rememberCalls.push([clientId ?? null, conversationId]);
      },
      clearRememberedConversationId(clientId) {
        rememberedIds.delete(keyFor(clientId));
        clearCalls.push(clientId ?? null);
      },
    },
  };
}

function loadStore() {
  const memory = createMemoryHarness();
  const clearedDrafts = [];
  const modulePath = path.resolve(__dirname, "chat-store.ts");
  const useChatStore = loadTsModule(modulePath, {
    stubs: {
      "@/types/chat": {},
      "@/types/task": {},
      "@/types/chat-composer": {},
      "@/lib/chat-drafts": {
        clearChatDraft(surface, scopeId) {
          clearedDrafts.push([surface, scopeId]);
        },
      },
      "@/lib/chat-session-memory": memory.stub,
    },
  }).useChatStore;

  return {
    store: useChatStore,
    memory,
    clearedDrafts,
  };
}

function createJsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
  };
}

function createConversation(overrides = {}) {
  return {
    id: "conv-1",
    title: "Conversation",
    status: "active",
    clientId: null,
    createdAt: "2026-04-20T10:00:00.000Z",
    updatedAt: "2026-04-20T10:00:00.000Z",
    ...overrides,
  };
}

function createAttachment(relativePath) {
  return {
    id: `attachment-${relativePath}`,
    fileName: relativePath.split("/").pop(),
    relativePath,
    extension: relativePath.split(".").pop(),
    sizeBytes: 128,
    contentType: "text/plain",
    surface: "sent",
    scopeId: "conv-1",
    draftKey: null,
    state: "sent",
    uploadedAt: "2026-04-20T10:00:00.000Z",
  };
}

test("loadOrCreateConversation restores the remembered conversation for the current client scope", async () => {
  const { store, memory } = loadStore();
  const originalFetch = global.fetch;
  const calls = [];
  const rememberedConversation = createConversation({ id: "conv-remembered", clientId: null });

  memory.rememberedIds.set("_root", "conv-remembered");

  global.fetch = async (input) => {
    calls.push(String(input));
    const url = String(input);
    if (url.endsWith("/api/chat/conversations/conv-remembered")) {
      return createJsonResponse(rememberedConversation);
    }
    if (url.endsWith("/api/chat/conversations/conv-remembered/messages")) {
      return createJsonResponse({ messages: [] });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const conversation = await store.getState().loadOrCreateConversation(null);

    assert.equal(conversation.id, "conv-remembered");
    assert.equal(store.getState().conversation?.id, "conv-remembered");
    assert.deepEqual(calls, [
      "/api/chat/conversations/conv-remembered",
      "/api/chat/conversations/conv-remembered/messages",
    ]);
    assert.deepEqual(memory.rememberCalls, [[null, "conv-remembered"]]);
    assert.deepEqual(memory.clearCalls, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("loadOrCreateConversation falls back to the latest active conversation when the remembered id is stale", async () => {
  const { store, memory } = loadStore();
  const originalFetch = global.fetch;
  const calls = [];
  const latestConversation = createConversation({ id: "conv-latest", clientId: "client-1" });

  memory.rememberedIds.set("client-1", "conv-stale");

  global.fetch = async (input) => {
    calls.push(String(input));
    const url = String(input);
    if (url.endsWith("/api/chat/conversations/conv-stale")) {
      return createJsonResponse({ error: "not found" }, 404);
    }
    if (url === "/api/chat/conversations?clientId=client-1&status=active") {
      return createJsonResponse([latestConversation]);
    }
    if (url.endsWith("/api/chat/conversations/conv-latest/messages")) {
      return createJsonResponse({ messages: [] });
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  };

  try {
    const conversation = await store.getState().loadOrCreateConversation("client-1");

    assert.equal(conversation.id, "conv-latest");
    assert.equal(store.getState().conversation?.id, "conv-latest");
    assert.deepEqual(calls, [
      "/api/chat/conversations/conv-stale",
      "/api/chat/conversations?clientId=client-1&status=active",
      "/api/chat/conversations/conv-latest/messages",
    ]);
    assert.deepEqual(memory.clearCalls, ["client-1"]);
    assert.deepEqual(memory.rememberCalls.at(-1), ["client-1", "conv-latest"]);
  } finally {
    global.fetch = originalFetch;
  }
});

test("archiveConversation clears the remembered session id and the stored chat draft", async () => {
  const { store, memory, clearedDrafts } = loadStore();
  const originalFetch = global.fetch;

  store.setState({
    conversation: createConversation({ id: "conv-archive", clientId: "client-1" }),
    messages: [],
    decisions: [],
    pendingQuestions: [],
    isProcessing: false,
  });

  global.fetch = async () => createJsonResponse({ ok: true });

  try {
    await store.getState().archiveConversation();

    assert.deepEqual(memory.clearCalls, ["client-1"]);
    assert.deepEqual(clearedDrafts, [["conversation", "conv-archive"]]);
    assert.equal(store.getState().conversation, null);
    assert.deepEqual(store.getState().messages, []);
  } finally {
    global.fetch = originalFetch;
  }
});

test("sendMessage dedupes the optimistic user message when SSE arrives before the response", async () => {
  const { store } = loadStore();
  const originalFetch = global.fetch;
  const attachment = createAttachment(".tmp/chat-drafts/sent/conversation/conv-1/message-1/notes.md");
  const userMessage = {
    id: "user-1",
    conversationId: "conv-1",
    taskId: null,
    role: "user",
    content: "Use the notes",
    metadata: { attachments: [attachment] },
    parentMessageId: null,
    createdAt: "2026-04-20T10:01:00.000Z",
  };
  const orchestratorMessage = {
    id: "orch-1",
    conversationId: "conv-1",
    taskId: null,
    role: "orchestrator",
    content: "Queued.",
    metadata: null,
    parentMessageId: "user-1",
    createdAt: "2026-04-20T10:01:01.000Z",
  };

  store.setState({
    conversation: createConversation(),
    messages: [],
    decisions: [],
    pendingQuestions: [],
    isProcessing: false,
  });

  global.fetch = async () => {
    store.getState().applyChatSSE({ type: "chat:message", message: userMessage });
    store.getState().applyChatSSE({ type: "chat:message", message: orchestratorMessage });
    return createJsonResponse({ userMessage, orchestratorMessage }, 201);
  };

  try {
    await store.getState().sendMessage("Use the notes", { attachments: [attachment] });

    const userMessages = store.getState().messages.filter((message) => message.role === "user");
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].id, "user-1");
    assert.equal(store.getState().messages.filter((message) => message.id === "orch-1").length, 1);
    assert.equal(store.getState().isProcessing, false);
  } finally {
    global.fetch = originalFetch;
  }
});

test("sendMessage stays deduped when the response arrives before SSE", async () => {
  const { store } = loadStore();
  const originalFetch = global.fetch;
  const attachment = createAttachment(".tmp/chat-drafts/sent/conversation/conv-1/message-2/design.png");
  const userMessage = {
    id: "user-2",
    conversationId: "conv-1",
    taskId: null,
    role: "user",
    content: "Review the design",
    metadata: { attachments: [attachment] },
    parentMessageId: null,
    createdAt: "2026-04-20T10:02:00.000Z",
  };
  const orchestratorMessage = {
    id: "orch-2",
    conversationId: "conv-1",
    taskId: null,
    role: "orchestrator",
    content: "Queued.",
    metadata: null,
    parentMessageId: "user-2",
    createdAt: "2026-04-20T10:02:01.000Z",
  };

  store.setState({
    conversation: createConversation(),
    messages: [],
    decisions: [],
    pendingQuestions: [],
    isProcessing: false,
  });

  global.fetch = async () => createJsonResponse({ userMessage, orchestratorMessage }, 201);

  try {
    await store.getState().sendMessage("Review the design", { attachments: [attachment] });
    store.getState().applyChatSSE({ type: "chat:message", message: userMessage });
    store.getState().applyChatSSE({ type: "chat:message", message: orchestratorMessage });

    const userMessages = store.getState().messages.filter((message) => message.role === "user");
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].id, "user-2");
    assert.equal(store.getState().messages.filter((message) => message.id === "orch-2").length, 1);
  } finally {
    global.fetch = originalFetch;
  }
});

test("replyToQuestion dedupes the optimistic reply when SSE arrives before the response", async () => {
  const { store } = loadStore();
  const originalFetch = global.fetch;
  const attachment = createAttachment(".tmp/chat-drafts/sent/question/question-1/reply-1/spec.txt");
  const questionMessage = {
    id: "question-1",
    conversationId: "conv-1",
    taskId: null,
    role: "sub_agent",
    content: "Need more details",
    metadata: { questionText: "Need more details" },
    parentMessageId: null,
    createdAt: "2026-04-20T10:03:00.000Z",
  };
  const replyMessage = {
    id: "reply-1",
    conversationId: "conv-1",
    taskId: null,
    role: "user",
    content: "Here are the details",
    metadata: {
      replyToMessageId: "question-1",
      attachments: [attachment],
    },
    parentMessageId: "question-1",
    createdAt: "2026-04-20T10:03:30.000Z",
  };

  store.setState({
    conversation: createConversation(),
    messages: [questionMessage],
    decisions: [],
    pendingQuestions: [questionMessage],
    isProcessing: false,
  });

  global.fetch = async () => {
    store.getState().applyChatSSE({ type: "chat:message", message: replyMessage });
    return createJsonResponse({ userMessage: replyMessage }, 201);
  };

  try {
    await store.getState().replyToQuestion("question-1", "Here are the details", [attachment]);

    const userMessages = store.getState().messages.filter((message) => message.role === "user");
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].id, "reply-1");
    assert.equal(store.getState().pendingQuestions.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});

test("replyToQuestion stays deduped when the response arrives before SSE", async () => {
  const { store } = loadStore();
  const originalFetch = global.fetch;
  const attachment = createAttachment(".tmp/chat-drafts/sent/question/question-2/reply-2/notes.md");
  const questionMessage = {
    id: "question-2",
    conversationId: "conv-1",
    taskId: null,
    role: "sub_agent",
    content: "Can you clarify?",
    metadata: { questionText: "Can you clarify?" },
    parentMessageId: null,
    createdAt: "2026-04-20T10:04:00.000Z",
  };
  const replyMessage = {
    id: "reply-2",
    conversationId: "conv-1",
    taskId: null,
    role: "user",
    content: "Yes, clarified.",
    metadata: {
      replyToMessageId: "question-2",
      attachments: [attachment],
    },
    parentMessageId: "question-2",
    createdAt: "2026-04-20T10:04:20.000Z",
  };

  store.setState({
    conversation: createConversation(),
    messages: [questionMessage],
    decisions: [],
    pendingQuestions: [questionMessage],
    isProcessing: false,
  });

  global.fetch = async () => createJsonResponse({ userMessage: replyMessage }, 201);

  try {
    await store.getState().replyToQuestion("question-2", "Yes, clarified.", [attachment]);
    store.getState().applyChatSSE({ type: "chat:message", message: replyMessage });

    const userMessages = store.getState().messages.filter((message) => message.role === "user");
    assert.equal(userMessages.length, 1);
    assert.equal(userMessages[0].id, "reply-2");
    assert.equal(store.getState().pendingQuestions.length, 0);
  } finally {
    global.fetch = originalFetch;
  }
});
