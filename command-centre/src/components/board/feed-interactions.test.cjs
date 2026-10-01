const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");
const interactions = loadTsModule(path.resolve(__dirname, "feed-interactions.ts"));

const shortcut = (overrides = {}) => ({
  key: "\\",
  ctrlKey: true,
  metaKey: false,
  altKey: false,
  repeat: false,
  ...overrides,
});

test("Ctrl/Cmd+\\ creates a Chat only for an active editable Feed", () => {
  assert.equal(interactions.isNewFeedChatShortcut(shortcut(), { archived: false, overlayOpen: false }), true);
  assert.equal(interactions.isNewFeedChatShortcut(shortcut({ ctrlKey: false, metaKey: true }), { archived: false, overlayOpen: false }), true);
  assert.equal(interactions.isNewFeedChatShortcut(shortcut({ repeat: true }), { archived: false, overlayOpen: false }), false);
  assert.equal(interactions.isNewFeedChatShortcut(shortcut(), { archived: true, overlayOpen: false }), false);
  assert.equal(interactions.isNewFeedChatShortcut(shortcut(), { archived: false, overlayOpen: true }), false);
});

test("number shortcuts and Shift+Tab do not trigger Feed actions", () => {
  for (const key of ["1", "2", "3", "4"]) {
    assert.equal(interactions.isNewFeedChatShortcut(shortcut({ key }), { archived: false, overlayOpen: false }), false);
  }
  assert.equal(interactions.isNewFeedChatShortcut(shortcut({ key: "Tab", shiftKey: true }), { archived: false, overlayOpen: false }), false);
});

test("menu navigation wraps and supports Home and End", () => {
  assert.equal(interactions.getFeedMenuNavigationIndex("ArrowDown", 2, 3), 0);
  assert.equal(interactions.getFeedMenuNavigationIndex("ArrowUp", 0, 3), 2);
  assert.equal(interactions.getFeedMenuNavigationIndex("Home", 2, 3), 0);
  assert.equal(interactions.getFeedMenuNavigationIndex("End", 0, 3), 2);
  assert.equal(interactions.getFeedMenuNavigationIndex("Enter", 0, 3), null);
});

test("Feed sources keep Escape non-destructive and expose accessibility hooks", () => {
  const feedView = fs.readFileSync(path.resolve(__dirname, "feed-view.tsx"), "utf8");
  const canvas = fs.readFileSync(path.resolve(__dirname, "feed-canvas.tsx"), "utf8");
  const shellStyles = fs.readFileSync(path.resolve(__dirname, "feed-workspace-shell.module.css"), "utf8");
  const reply = fs.readFileSync(path.resolve(__dirname, "../modal/reply-input.tsx"), "utf8");
  const newGoal = fs.readFileSync(path.resolve(__dirname, "new-goal-panel.tsx"), "utf8");

  assert.doesNotMatch(feedView, /e\.key === "Escape" && hasPanesOpen/);
  assert.doesNotMatch(feedView, /\["1", "2", "3", "4"\]/);
  assert.match(canvas, /tabIndex=\{-1\}/);
  assert.match(canvas, /aria-label=\{`\$\{panel\.label\} panel`\}/);
  assert.match(shellStyles, /prefers-reduced-motion: reduce/);
  assert.match(reply, /aria-label="Send message"/);
  assert.match(reply, /closeComposerModal/);
  assert.match(newGoal, /closeComposerModal/);
});

test("Feed uses one primary Chat and renders no duplicate panel switcher", () => {
  const feedView = fs.readFileSync(path.resolve(__dirname, "feed-view.tsx"), "utf8");
  const canvas = fs.readFileSync(path.resolve(__dirname, "feed-canvas.tsx"), "utf8");
  const layoutHook = fs.readFileSync(path.resolve(__dirname, "../../hooks/use-feed-canvas-layout.ts"), "utf8");

  assert.doesNotMatch(canvas, /FeedPanelSwitcher|badgeCounts/);
  assert.match(feedView, /handleOpenBlankInPrimary\("New subchat"\)/);
  assert.doesNotMatch(feedView, /handleAddCanvasPanel\("chat"\)/);
  assert.match(layoutHook, /goalLineage\.has\(taskId\)/);
  assert.match(layoutHook, /panel\.resource\?\.primary/);
});

test("Goal selection waits for its persisted canvas before consuming the Main Chat request", () => {
  const feedView = fs.readFileSync(path.resolve(__dirname, "feed-view.tsx"), "utf8");
  const identityGuard = feedView.indexOf("if (canvasLayout.goalId !== taskRootId) return;");
  const handledRequest = feedView.indexOf("onInitialActiveTaskHandled?.();", identityGuard);

  assert.ok(identityGuard >= 0);
  assert.ok(handledRequest > identityGuard);
});

test("archived Goal guards run before route mutations", () => {
  const replyRoute = fs.readFileSync(path.resolve(__dirname, "../../app/api/tasks/[id]/reply/route.ts"), "utf8");
  const patchRoute = fs.readFileSync(path.resolve(__dirname, "../../app/api/tasks/[id]/route.ts"), "utf8");
  const createRoute = fs.readFileSync(path.resolve(__dirname, "../../app/api/tasks/route.ts"), "utf8");

  assert.ok(replyRoute.indexOf("isTaskArchived(db, id)") < replyRoute.indexOf("copyChatAttachmentsToSent({"));
  assert.ok(patchRoute.indexOf("isTaskArchived(db, id)") < patchRoute.indexOf("await request.json()"));
  assert.match(patchRoute, /isTaskTreeReadOnlyError\(error\)[\s\S]*status: 409/);
  assert.ok(createRoute.indexOf("isTaskArchived(db, bodyParentId)") < createRoute.indexOf("INSERT INTO tasks"));
});

test("Feed archive and history controls expose the durable user states", () => {
  const feedView = fs.readFileSync(path.resolve(__dirname, "feed-view.tsx"), "utf8");
  const sidebar = fs.readFileSync(path.resolve(__dirname, "feed-goal-sidebar.tsx"), "utf8");
  const chatPane = fs.readFileSync(path.resolve(__dirname, "../modal/chat-pane.tsx"), "utf8");
  const modalChat = fs.readFileSync(path.resolve(__dirname, "../modal/modal-chat.tsx"), "utf8");
  const detailPanel = feedView.slice(feedView.indexOf("function DetailPanel"), feedView.indexOf("function formatDateLabel"));

  assert.doesNotMatch(detailPanel, /onArchive/);
  assert.match(sidebar, /isPermanentFeedTaskId\(goal\.id\)/);
  assert.match(sidebar, /archivePendingIds\.includes\(goal\.id\)/);
  assert.match(sidebar, /restorePendingIds\.includes\(goal\.id\)/);
  assert.match(chatPane, /isDone && !readOnly/);
  assert.match(chatPane, /Complete/);
  assert.match(chatPane, /Reopen/);
  assert.match(modalChat, /data-chat-log-state="loading"/);
  assert.match(modalChat, /data-chat-log-state="empty"/);
  assert.match(modalChat, /data-chat-log-state="error"/);
  assert.match(modalChat, />\s*Retry\s*</);
  assert.match(feedView, /!isParentTask && !isReadOnly/);
  assert.match(feedView, /Archiving is paused because active work could not be stopped/);
  assert.match(feedView, />Undo</);
  assert.match(feedView, />Retry</);
  assert.match(feedView, /Restored “\$\{archiveNotice\.title\}”/);
});
