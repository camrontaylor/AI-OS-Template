const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../test-utils/load-ts-module.cjs");

const connectors = loadTsModule(path.resolve(__dirname, "connectors.ts"));

const scope = {
  teamId: "team-1",
  clientId: "acme",
  userId: null,
  visibility: "client",
};

test("prepareConnectorImport keeps manual import as the first connector path", () => {
  const prepared = connectors.prepareConnectorImport({
    connector: { id: "manual", itemId: "acme-notes.md" },
    scope,
    sourcePath: "manual/acme-notes.md",
    sourceType: "other",
    title: "Acme notes",
    content: "# Acme\n\nManual shared notes.",
    metadata: { importedBy: "cli" },
  });

  assert.equal(prepared.sourcePath, "manual/acme-notes.md");
  assert.equal(prepared.sourceType, "other");
  assert.equal(prepared.title, "Acme notes");
  assert.equal(prepared.metadata.importedBy, "cli");
  assert.deepEqual(prepared.metadata.connector, {
    id: "manual",
    sourcePath: "manual/acme-notes.md",
    itemId: "acme-notes.md",
  });
});

test("prepareConnectorImport gives future connectors a stable integration point", () => {
  const prepared = connectors.prepareConnectorImport({
    connector: {
      id: "google_drive",
      itemId: "folders/q3-plan",
      sourceUrl: "https://drive.google.com/file/d/q3-plan",
      collectionId: "shared-drive-1",
      displayName: "Q3 Plan",
    },
    scope,
    content: "# Q3\n\nDrive content.",
  });

  assert.equal(prepared.sourcePath, "connectors/google_drive/folders/q3-plan");
  assert.equal(prepared.sourceType, "other");
  assert.equal(prepared.title, "Q3 Plan");
  assert.deepEqual(prepared.metadata.connector, {
    id: "google_drive",
    sourcePath: "connectors/google_drive/folders/q3-plan",
    itemId: "folders/q3-plan",
    sourceUrl: "https://drive.google.com/file/d/q3-plan",
    collectionId: "shared-drive-1",
    displayName: "Q3 Plan",
  });
});

test("prepareConnectorImport accepts safe future connector ids without store changes", () => {
  const prepared = connectors.prepareConnectorImport({
    connector: { id: "salesforce", itemId: "accounts/acme" },
    scope,
    content: "Future CRM content.",
  });

  assert.equal(prepared.sourcePath, "connectors/salesforce/accounts/acme");
  assert.equal(prepared.metadata.connector.id, "salesforce");
});

test("prepareConnectorImport rejects unsafe source paths before ingest", () => {
  assert.throws(
    () => connectors.prepareConnectorImport({
      connector: "manual",
      scope,
      sourcePath: "../secrets.md",
      content: "bad",
    }),
    /sourcePath must not contain/,
  );
});
