const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const modulePath = path.resolve(__dirname, "goal-draft-panel-state.ts");
const panelState = loadTsModule(modulePath);

test("saving the first draft keeps the open panel identity stable", () => {
  const initial = panelState.createGoalDraftPanelState();
  const blankSession = panelState.openBlankGoalDraftPanel(initial);
  const saved = panelState.saveDraftInOpenGoalPanel(blankSession, "draft-1");

  assert.equal(saved.panelKey, blankSession.panelKey);
  assert.equal(saved.activeDraftId, "draft-1");
});

test("saving a new draft still marks that draft as the active saved draft", () => {
  const blankSession = panelState.openBlankGoalDraftPanel(
    panelState.createGoalDraftPanelState(),
  );
  const saved = panelState.saveDraftInOpenGoalPanel(blankSession, "draft-1");

  assert.equal(saved.activeDraftId, "draft-1");
});

test("opening an existing draft starts a fresh panel session seeded to that draft", () => {
  const initial = panelState.createGoalDraftPanelState();
  const opened = panelState.openSavedGoalDraftPanel(initial, "draft-7");

  assert.equal(opened.activeDraftId, "draft-7");
  assert.notEqual(opened.panelKey, initial.panelKey);
});
