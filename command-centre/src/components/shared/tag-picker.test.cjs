const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const { TagFilterBar } = loadTsModule(path.resolve(__dirname, "tag-picker.tsx"));

function render(tasks) {
  return renderToStaticMarkup(React.createElement(TagFilterBar, {
    tasks,
    activeTag: null,
    onTagChange() {},
  }));
}

test("tag filter bar reserves no space when there are no tags", () => {
  assert.equal(render([{ tag: null }, { tag: null }]), "");
});

test("tag filter bar owns its visible frame when tags exist", () => {
  const markup = render([{ tag: "beta" }, { tag: "alpha" }, { tag: "beta" }]);

  assert.match(markup, /data-feed-tag-filter-bar="true"/);
  assert.match(markup, />All<\/button>/);
  assert.ok(markup.indexOf("alpha") < markup.indexOf("beta"));
  assert.match(markup, /padding:8px 12px/);
  assert.match(markup, /border-bottom:1px solid var\(--cc-line-alpha-15\)/);
});
