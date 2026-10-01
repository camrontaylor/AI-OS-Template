const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../lib/test-utils/load-ts-module.cjs");

const themePreference = loadTsModule(
  path.resolve(__dirname, "theme-preference.ts"),
);

function createStorage(initial = {}) {
  const values = new Map(Object.entries(initial));
  return {
    getItem(key) {
      return values.has(key) ? values.get(key) : null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    dump() {
      return Object.fromEntries(values.entries());
    },
  };
}

test("missing and invalid values default to system", () => {
  assert.equal(themePreference.loadThemePreference(createStorage()), "system");

  const invalidStorage = createStorage({
    [themePreference.THEME_PREFERENCE_STORAGE_KEY]: "sepia",
  });
  assert.equal(themePreference.loadThemePreference(invalidStorage), "system");
});

test("theme preferences persist and load", () => {
  const storage = createStorage();

  for (const preference of ["system", "light", "dark"]) {
    themePreference.saveThemePreference(preference, storage);
    assert.equal(themePreference.loadThemePreference(storage), preference);
  }
});

test("system resolves from the operating-system preference", () => {
  assert.equal(themePreference.resolveThemePreference("system", false), "light");
  assert.equal(themePreference.resolveThemePreference("system", true), "dark");
  assert.equal(themePreference.resolveThemePreference("light", true), "light");
  assert.equal(themePreference.resolveThemePreference("dark", false), "dark");
});

test("storage failures fall back to system without throwing", () => {
  const storage = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("blocked");
    },
  };

  assert.equal(themePreference.loadThemePreference(storage), "system");
  assert.doesNotThrow(() => themePreference.saveThemePreference("dark", storage));
});

test("bootstrap script applies saved and system themes before render", () => {
  function runBootstrap(storedPreference, prefersDark) {
    const root = { dataset: {} };
    const window = {
      localStorage: createStorage(
        storedPreference
          ? {
              [themePreference.THEME_PREFERENCE_STORAGE_KEY]: storedPreference,
            }
          : {},
      ),
      matchMedia() {
        return { matches: prefersDark };
      },
    };
    const document = { documentElement: root };

    Function(
      "window",
      "document",
      themePreference.THEME_BOOTSTRAP_SCRIPT,
    )(window, document);

    return root.dataset.theme;
  }

  assert.equal(runBootstrap("light", true), "light");
  assert.equal(runBootstrap("dark", false), "dark");
  assert.equal(runBootstrap("system", true), "dark");
  assert.equal(runBootstrap(null, false), "light");
});
