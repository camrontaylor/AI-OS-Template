const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const claudeOptions = loadTsModule(path.resolve(__dirname, "claude-options.ts"), {
  stubs: {
    "@/types/task": {},
  },
});

const preferences = loadTsModule(path.resolve(__dirname, "llm-preferences.ts"), {
  stubs: {
    "@/lib/claude-options": claudeOptions,
    "@/types/task": {},
  },
});

function createStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return map.has(key) ? map.get(key) : null;
    },
    setItem(key, value) {
      map.set(key, String(value));
    },
    removeItem(key) {
      map.delete(key);
    },
    dump() {
      return Object.fromEntries(map.entries());
    },
  };
}

test("Claude LLM preference falls back to Sonnet auto", () => {
  const storage = createStorage();

  assert.deepEqual(preferences.loadClaudeLlmPreference(storage), {
    provider: "claude",
    model: "sonnet",
    reasoningEffort: "auto",
  });
});

test("Claude LLM preference saves into provider-based storage", () => {
  const storage = createStorage();

  preferences.saveClaudeLlmPreference({
    model: "haiku",
    reasoningEffort: "high",
  }, storage);

  assert.deepEqual(preferences.loadClaudeLlmPreference(storage), {
    provider: "claude",
    model: "haiku",
    reasoningEffort: "auto",
  });

  const raw = JSON.parse(storage.dump()[preferences.LLM_PREFERENCES_STORAGE_KEY]);
  assert.equal(raw.version, 1);
  assert.equal(raw.activeProvider, "claude");
  assert.equal(raw.providers.claude.model, "haiku");
  assert.equal(raw.providers.claude.reasoningEffort, "auto");
});

test("Claude LLM preference normalizes invalid saved values", () => {
  const storage = createStorage({
    [preferences.LLM_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      version: 1,
      activeProvider: "claude",
      providers: {
        claude: {
          model: "bad model",
          reasoningEffort: "turbo",
          updatedAt: "2026-05-27T10:00:00.000Z",
        },
      },
    }),
  });

  assert.deepEqual(preferences.loadClaudeLlmPreference(storage), {
    provider: "claude",
    model: "sonnet",
    reasoningEffort: "auto",
  });
});

test("Claude LLM preference preserves custom model IDs", () => {
  const storage = createStorage();

  preferences.saveClaudeLlmPreference({
    model: "claude-fable-5",
    reasoningEffort: "xhigh",
  }, storage);

  assert.deepEqual(preferences.loadClaudeLlmPreference(storage), {
    provider: "claude",
    model: "claude-fable-5",
    reasoningEffort: "xhigh",
  });
});

test("Claude LLM preference maps xhigh to high for Sonnet", () => {
  const storage = createStorage({
    [preferences.LLM_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      version: 1,
      activeProvider: "claude",
      providers: {
        claude: {
          model: "sonnet",
          reasoningEffort: "xhigh",
          updatedAt: "2026-05-27T10:00:00.000Z",
        },
      },
    }),
  });

  assert.deepEqual(preferences.loadClaudeLlmPreference(storage), {
    provider: "claude",
    model: "sonnet",
    reasoningEffort: "high",
  });
});

test("provider storage preserves future providers when saving Claude", () => {
  const storage = createStorage({
    [preferences.LLM_PREFERENCES_STORAGE_KEY]: JSON.stringify({
      version: 1,
      activeProvider: "gemini",
      providers: {
        gemini: {
          model: "gemini-2.5-pro",
          reasoningEffort: "high",
          updatedAt: "2026-05-27T09:00:00.000Z",
        },
      },
    }),
  });

  preferences.saveClaudeLlmPreference({
    model: "opus",
    reasoningEffort: "max",
  }, storage);

  const raw = JSON.parse(storage.dump()[preferences.LLM_PREFERENCES_STORAGE_KEY]);
  assert.equal(raw.activeProvider, "claude");
  assert.equal(raw.providers.gemini.model, "gemini-2.5-pro");
  assert.equal(raw.providers.claude.model, "opus");
  assert.equal(raw.providers.claude.reasoningEffort, "max");
});

test("invalid preference payload is discarded", () => {
  const storage = createStorage({
    [preferences.LLM_PREFERENCES_STORAGE_KEY]: "{nope",
  });

  assert.equal(preferences.loadLlmPreferences(storage), null);
  assert.deepEqual(storage.dump(), {});
});
