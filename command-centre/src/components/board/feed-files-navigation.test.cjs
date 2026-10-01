const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const navigation = loadTsModule(path.resolve(__dirname, "feed-files-navigation.ts"));

test("builds the complete directory chain used to reveal a folder", () => {
  assert.deepEqual(navigation.buildDirectoryChain("projects/briefs/demo/"), [
    "projects",
    "projects/briefs",
    "projects/briefs/demo",
  ]);
  assert.deepEqual(navigation.buildDirectoryChain("projects\\briefs\\demo"), [
    "projects",
    "projects/briefs",
    "projects/briefs/demo",
  ]);
  assert.deepEqual(navigation.buildDirectoryChain(null), []);
});

test("builds only the ancestor directories used to reveal an active file", () => {
  assert.deepEqual(navigation.buildFileAncestorChain("projects/briefs/demo/brief.md"), [
    "projects",
    "projects/briefs",
    "projects/briefs/demo",
  ]);
  assert.deepEqual(navigation.buildFileAncestorChain("projects\\briefs\\demo\\brief.md"), [
    "projects",
    "projects/briefs",
    "projects/briefs/demo",
  ]);
  assert.deepEqual(navigation.buildFileAncestorChain("README.md"), []);
  assert.deepEqual(navigation.buildFileAncestorChain(null), []);
});

test("Feed routes directory references to a reusable Files panel and reveals the target", () => {
  const panelSource = fs.readFileSync(path.resolve(__dirname, "feed-resource-panels.tsx"), "utf8");
  const feedSource = fs.readFileSync(path.resolve(__dirname, "feed-view.tsx"), "utf8");
  const hookSource = fs.readFileSync(path.resolve(__dirname, "../../hooks/use-feed-canvas-layout.ts"), "utf8");

  assert.match(feedSource, /meta=1/);
  assert.match(feedSource, /metadata\.type === "directory"/);
  assert.match(feedSource, /handleOpenFilesPanel\(safePath\)/);
  assert.match(hookSource, /const openFilesPanel = useCallback/);
  assert.match(hookSource, /panel\.type === "files"/);
  assert.match(hookSource, /navigationKey: nextNavigationKey\(\)/);
  assert.match(panelSource, /buildDirectoryChain\(targetDirectory\)/);
  assert.match(panelSource, /setExpanded\(\(current\) => new Set\(\[\.\.\.current, \.\.\.revealDirectories\]\)\)/);
  assert.match(panelSource, /scrollIntoView\(\{ block: "nearest" \}\)/);
});

test("an open File viewer drives Files selection without opening Files automatically", () => {
  const panelSource = fs.readFileSync(path.resolve(__dirname, "feed-resource-panels.tsx"), "utf8");
  const feedSource = fs.readFileSync(path.resolve(__dirname, "feed-view.tsx"), "utf8");
  const hookSource = fs.readFileSync(path.resolve(__dirname, "../../hooks/use-feed-canvas-layout.ts"), "utf8");
  const openFilePanelSource = hookSource.slice(
    hookSource.indexOf("const openFilePanel"),
    hookSource.indexOf("const openFilesPanel"),
  );

  assert.match(feedSource, /const activeFilePanel = canvasPanels\.find\(\(panel\) => panel\.type === "file"\)/);
  assert.match(feedSource, /activeFilePath=\{activeFilePanel\?\.resource\?\.relativePath\}/);
  assert.match(feedSource, /activeFileNavigationKey=\{activeFilePanel\?\.resource\?\.navigationKey\}/);
  assert.match(hookSource, /const openFilePanel = useCallback[\s\S]*navigationKey: nextNavigationKey\(\)/);
  assert.doesNotMatch(openFilePanelSource, /openFilesPanel\(/);
  assert.match(panelSource, /buildFileAncestorChain\(activeFilePath\)/);
  assert.match(panelSource, /setSelectedPath\(activeFilePath \?\? targetDirectory \?\? null\)/);
  assert.match(panelSource, /if \(!activeFilePath\) setSelectedPath\(node\.path\)/);
  assert.match(panelSource, /var\(--cc-brand-alpha-04\)/);
  assert.match(panelSource, /selected \? "var\(--cc-brand-alpha-06\)" : hovered/);
});

test("Files keeps an incremental directory cache and reacts to live workspace events", () => {
  const panelSource = fs.readFileSync(path.resolve(__dirname, "feed-resource-panels.tsx"), "utf8");
  const revealStart = panelSource.indexOf("const directoryChain = buildDirectoryChain(targetDirectory)");
  const revealEnd = panelSource.indexOf("const handleWorkspaceDirectoryChanged", revealStart);
  const revealSource = panelSource.slice(revealStart, revealEnd);

  assert.ok(revealStart >= 0 && revealEnd > revealStart);
  assert.doesNotMatch(revealSource, /setChildren\(\{\}\)/);
  assert.doesNotMatch(revealSource, /setLoading\(true\)/);
  assert.match(panelSource, /loadedDirectoriesRef\.current\.has\(dir\)/);
  assert.match(panelSource, /inFlightLoadsRef\.current\.get\(dir\)/);
  assert.match(panelSource, /useWorkspaceFileEvents\(\{/);
  assert.match(panelSource, /loadDirectory\(directory, \{ force: true \}\)/);
  assert.match(panelSource, /Promise\.allSettled\(loadedDirectories\.map/);
});
