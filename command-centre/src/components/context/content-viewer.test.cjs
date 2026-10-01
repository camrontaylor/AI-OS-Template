const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

function loadContentViewer() {
  return loadTsModule(path.resolve(__dirname, "content-viewer.tsx"), {
    stubs: {
      "@/components/shared/markdown-preview": { MarkdownPreview: () => null },
      "@/components/shared/markdown-editor": { MarkdownEditor: () => null },
      "@/components/shared/delete-confirm-button": { DeleteConfirmButton: () => null },
      "@/components/team/sync-conflict-modal": { SyncConflictModal: () => null },
      "@/hooks/use-client-id": {
        useClientId: () => null,
        appendClientId: (url, clientId) => clientId ? `${url}${url.includes("?") ? "&" : "?"}clientId=${clientId}` : url,
      },
      "@/hooks/use-authenticated-file": {
        downloadAuthenticatedFile: () => {},
        useAuthenticatedFileUrl: () => null,
      },
      "@/types/file": {},
    },
  });
}

test("Docs push target sends team_context files to shared context sync", () => {
  const { getTeamPushTargetForDocs } = loadContentViewer();
  const target = getTeamPushTargetForDocs({
    enableTeamPush: true,
    apiSurface: "docs",
    filePath: "team_context/AGENTS.md",
    clientId: null,
    isDirectoryPath: false,
  });

  assert.deepEqual(target, {
    endpoint: "/api/team/brand-context",
    body: { path: "team_context/AGENTS.md" },
  });
});

test("Docs push target still sends selected client files to client sync", () => {
  const { getTeamPushTargetForDocs } = loadContentViewer();
  const target = getTeamPushTargetForDocs({
    enableTeamPush: true,
    apiSurface: "docs",
    filePath: "context/USER.md",
    clientId: "acme",
    isDirectoryPath: false,
  });

  assert.deepEqual(target, {
    endpoint: "/api/team/sync-client",
    body: { client: "acme", path: "context/USER.md" },
  });
});
