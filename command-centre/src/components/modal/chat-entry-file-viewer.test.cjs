const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "chat-entry.tsx"), "utf8");
const modalChatSource = fs.readFileSync(path.resolve(__dirname, "modal-chat.tsx"), "utf8");

test("markdown links and inline paths preserve directory hints for Feed routing", () => {
  assert.match(source, /resolveWorkspaceFileReference\(href\)/);
  assert.match(source, /resolveWorkspaceFileReference\(text\)/);
  assert.match(source, /hasWorkspaceDirectoryHint\(href\)/);
  assert.match(source, /hasWorkspaceDirectoryHint\(text\)/);
  assert.match(source, /onPreviewFile\?\.\(\{ relativePath, extension, fileName, directoryHint \}\)/);
  assert.match(source, /directoryHint \? "Files panel" : "File viewer"/);
  assert.equal(
    source.match(/onPointerDown=\{\(event\) => event\.stopPropagation\(\)\}/g)?.length,
    2,
  );
});

test("file output cards resolve a safe path before opening the File viewer", () => {
  assert.match(source, /resolveWorkspaceFileReference\(info\.relativePath\)/);
  assert.match(source, /onPreview\?\.\(\{ relativePath, extension: info\.extension \}\)/);
});

test("modal chat forwards its File viewer callback without importing context capture", () => {
  assert.match(modalChatSource, /<ChatEntry[\s\S]*onPreviewFile=\{onPreviewFile\}/);
  assert.doesNotMatch(source, /from "\.\/context-notice"/);
  assert.doesNotMatch(source, /buildContextNoticeModel/);
});

test("context notice shows only loaded sources and groups client instruction paths correctly", () => {
  assert.match(source, /const loaded = sources\.filter\(\(source\) => source\.status !== "available"\)/);
  assert.match(source, /const groups = groupLoadedContextSources\(loaded\)/);
  assert.doesNotMatch(source, /availableCount/);
  assert.match(source, /\^Context available:/);
  assert.match(source, /if \(loadedCount === 0\) return null/);
  assert.match(source, /sourcePath\.endsWith\(`\/\$\{fileName\}`\)/);
  assert.match(source, /sourcePath\.includes\("\/context\/"\)/);
});
