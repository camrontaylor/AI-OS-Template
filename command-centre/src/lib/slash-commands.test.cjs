const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const slash = loadTsModule(path.resolve(__dirname, "slash-commands.ts"));

test("skillNameFromSlashCommand only resolves skill commands", () => {
  assert.equal(slash.skillNameFromSlashCommand("/mkt-copywriting"), "mkt-copywriting");
  assert.equal(slash.skillNameFromSlashCommand("/team:mkt-copywriting"), "mkt-copywriting");
  assert.equal(slash.skillNameFromSlashCommand("/local:mkt-copywriting"), "mkt-copywriting");
  assert.equal(slash.skillNameFromSlashCommand("tool-youtube"), "tool-youtube");
  assert.equal(slash.skillNameFromSlashCommand("/gsd-plan-phase"), null);
  assert.equal(slash.skillNameFromSlashCommand("/meta-skill-creator"), null);
});

test("filterCommands hides denied skill commands but keeps non-skill commands", () => {
  const commands = slash.filterCommands("", ["mkt-copywriting"]);
  const names = commands.map((command) => command.command);

  assert.ok(names.includes("/mkt-copywriting"));
  assert.ok(!names.includes("/mkt-brand-voice"));
  assert.ok(names.includes("/gsd-plan-phase"));
  assert.ok(names.includes("/meta-skill-creator"));
});

test("findActiveSlashCommandToken locates a command at the cursor", () => {
  assert.deepEqual(slash.findActiveSlashCommandToken("/", 1), {
    start: 0,
    end: 1,
    query: "/",
  });

  const message = "Please /gsd-plan-phase after this";
  assert.deepEqual(
    slash.findActiveSlashCommandToken(message, message.indexOf("-plan")),
    {
      start: 7,
      end: 22,
      query: "/gsd",
    },
  );

  const multiline = "First line\nthen /mkt-copy";
  assert.deepEqual(
    slash.findActiveSlashCommandToken(multiline, multiline.length),
    {
      start: 16,
      end: multiline.length,
      query: "/mkt-copy",
    },
  );
});

test("getActiveSlashCommandToken only returns menu queries with matches", () => {
  const value = "Please /gsd-pl";
  assert.deepEqual(slash.getActiveSlashCommandToken(value, value.length), {
    start: 7,
    end: value.length,
    query: "/gsd-pl",
  });
  const unknown = "/zzzz-no-match";
  assert.equal(slash.getActiveSlashCommandToken(unknown, unknown.length), null);
});

test("slash command triggers reject URLs, paths, and inline slashes", () => {
  for (const value of [
    "https://example.com",
    "Open https://example.com/docs",
    "C:/Users/example",
    "/usr",
    "/usr/local/bin",
    "/run",
    "/project",
    "Read /docs/reference",
    "./scripts/test.sh",
    "//server/share",
    "word/gsd-plan-phase",
    "prefix-/gsd-plan-phase",
  ]) {
    assert.equal(
      slash.getActiveSlashCommandToken(value, value.length),
      null,
      value,
    );
  }
});

test("replaceActiveSlashCommand preserves surrounding text and cursor position", () => {
  assert.deepEqual(
    slash.replaceActiveSlashCommand(
      "Please /gsd-pl continue",
      "Please /gsd-pl".length,
      "/gsd-plan-phase",
    ),
    {
      value: "Please /gsd-plan-phase continue",
      selectionStart: 23,
      selectionEnd: 23,
    },
  );

  assert.deepEqual(
    slash.replaceActiveSlashCommand(
      "Before /gsd-plan-phase after",
      "Before /gsd".length,
      "/gsd-progress",
    ),
    {
      value: "Before /gsd-progress after",
      selectionStart: 21,
      selectionEnd: 21,
    },
  );

  assert.deepEqual(
    slash.replaceActiveSlashCommand("/", 1, "/start-here"),
    {
      value: "/start-here ",
      selectionStart: 12,
      selectionEnd: 12,
    },
  );
});

test("replaceActiveSlashCommand rejects invalid or inactive tokens", () => {
  assert.equal(
    slash.replaceActiveSlashCommand("word/gsd", 8, "/gsd-progress"),
    null,
  );
  assert.equal(
    slash.replaceActiveSlashCommand("/gsd", 4, "gsd-progress"),
    null,
  );
});

test("moving the cursor away deactivates the previous slash command token", () => {
  const value = "Please /gsd-pl continue";
  assert.equal(
    slash.getActiveSlashCommandToken(value, "Please /gsd-pl".length)?.query,
    "/gsd-pl",
  );
  assert.equal(slash.getActiveSlashCommandToken(value, value.length), null);
});

test("all slash-command composers use the shared cursor-aware contract", () => {
  const sourceRoot = path.resolve(__dirname, "..");
  const consumers = [
    ["components/modal/reply-input.tsx", "handleChange"],
    ["components/board/task-create-input.tsx", "handleDescChange"],
    ["components/board/feed-view.tsx", "handleReplyChange"],
    ["components/board/new-goal-panel.tsx", "handleMessageChange"],
  ];

  for (const [relativePath, changeHandler] of consumers) {
    const source = fs.readFileSync(path.join(sourceRoot, relativePath), "utf8");
    assert.match(source, /getActiveSlashCommandToken/, relativePath);
    assert.match(source, /replaceActiveSlashCommand/, relativePath);
    assert.match(
      source,
      new RegExp(`onSelect=\\{\\((?:event|e)\\) =>\\s+${changeHandler}\\(`),
      relativePath,
    );

    const handlerStart = source.indexOf("handleSlashSelect");
    const handlerEnd = source.indexOf("\n  const ", handlerStart + 1);
    const handler = source.slice(handlerStart, handlerEnd);
    assert.doesNotMatch(handler, /createTask\(/, relativePath);
    assert.doesNotMatch(handler, /updateTask\(/, relativePath);
  }
});
