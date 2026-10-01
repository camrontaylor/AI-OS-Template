const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const parser = loadTsModule(path.resolve(__dirname, "structured-brief-items.ts"));

test("strict Brief item arrays become friendly with or without a JSON fence label", () => {
  const raw = '[{"title":"**Panel switcher**","description":"Open panels quickly."},{"title":"Reload state"}]';
  const expected = [
    { title: "Panel switcher", description: "Open panels quickly." },
    { title: "Reload state", description: "" },
  ];

  assert.deepEqual(parser.parseStructuredBriefItems(raw), expected);
  assert.deepEqual(parser.parseStructuredBriefItems(raw, "language-json"), expected);
});

test("explicit non-JSON fences keep normal code rendering", () => {
  const raw = '[{"title":"Panel switcher"}]';
  assert.equal(parser.parseStructuredBriefItems(raw, "language-javascript"), null);
  assert.equal(parser.parseStructuredBriefItems(raw, "json"), null);
});

test("malformed, empty, oversized, and non-array JSON stays as code", () => {
  assert.equal(parser.parseStructuredBriefItems("not JSON", "language-json"), null);
  assert.equal(parser.parseStructuredBriefItems("[]", "language-json"), null);
  assert.equal(parser.parseStructuredBriefItems('{"title":"One"}', "language-json"), null);
  const oversized = JSON.stringify(Array.from({ length: 101 }, (_, index) => ({ title: `Item ${index}` })));
  assert.equal(parser.parseStructuredBriefItems(oversized, "language-json"), null);
});

test("items reject missing or blank titles, wrong descriptions, and extra keys", () => {
  const invalid = [
    '[{"description":"Missing title"}]',
    '[{"title":"   "}]',
    '[{"title":42}]',
    '[{"title":"Valid","description":42}]',
    '[{"title":"Valid","status":"pending"}]',
  ];

  for (const raw of invalid) {
    assert.equal(parser.parseStructuredBriefItems(raw, "language-json"), null, raw);
  }
});

test("chat rendering passes the fenced code language to the strict parser", () => {
  const source = fs.readFileSync(path.resolve(__dirname, "chat-entry.tsx"), "utf8");
  assert.match(source, /isValidElement<\{ className\?: string \}>\(children\)/);
  assert.match(source, /children\.props\.className/);
  assert.match(source, /parseStructuredBriefItems\(codeText, languageClassName\)/);
});
