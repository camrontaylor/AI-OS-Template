const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");
const { shouldShowComposerExpansion } = loadTsModule(path.resolve(__dirname, "composer-expansion.ts"));

const base = {
  hasText: true,
  lineHeight: 20,
  paddingTop: 4,
  paddingBottom: 4,
  minimumLines: 3,
};

test("hides expansion for empty, one-line, and two-line prompts", () => {
  assert.equal(shouldShowComposerExpansion({ ...base, hasText: false, scrollHeight: 68 }), false);
  assert.equal(shouldShowComposerExpansion({ ...base, scrollHeight: 28 }), false);
  assert.equal(shouldShowComposerExpansion({ ...base, scrollHeight: 48 }), false);
});

test("shows expansion at three visual lines", () => {
  assert.equal(shouldShowComposerExpansion({ ...base, scrollHeight: 68 }), true);
});

test("responds to wrapped height changes caused by resizing", () => {
  const wide = shouldShowComposerExpansion({ ...base, scrollHeight: 48 });
  const narrow = shouldShowComposerExpansion({ ...base, scrollHeight: 68 });
  assert.equal(wide, false);
  assert.equal(narrow, true);
});
