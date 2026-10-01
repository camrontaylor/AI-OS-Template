const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");
const React = require("react");
const { renderToStaticMarkup } = require("react-dom/server");

const { loadTsModule } = require("../../lib/test-utils/load-ts-module.cjs");

const sharedSkeleton = loadTsModule(
  path.resolve(__dirname, "../shared/file-tree-skeleton.tsx"),
);

const commonStubs = {
  "@/hooks/use-client-id": {
    useClientId: () => null,
    appendClientId: (url, clientId) => clientId ? `${url}${url.includes("?") ? "&" : "?"}clientId=${clientId}` : url,
  },
  "@/lib/file-icons": {
    getFileIcon: () => function FileIcon() { return null; },
    getFileIconColor: () => "currentColor",
  },
  "@/lib/profile-storage": {
    profileStorageKey: (key) => key,
  },
  "@/components/shared/file-tree-skeleton": sharedSkeleton,
};

function loadDocsFileTree() {
  return loadTsModule(path.resolve(__dirname, "docs-file-tree.tsx"), {
    stubs: commonStubs,
  });
}

test("Docs file tree includes team_context between context and brand_context", () => {
  const { DOCS_SECTION_DEFS } = loadDocsFileTree();
  assert.deepEqual(
    DOCS_SECTION_DEFS.map((section) => section.dir),
    ["context", "team_context", "brand_context", "docs", "projects"],
  );
  assert.equal(DOCS_SECTION_DEFS[1].label, "Team Context");
});

test("Docs file tree API URLs include the docs surface", () => {
  const { docsSurfaceUrl } = loadDocsFileTree();
  assert.equal(
    docsSurfaceUrl("/api/files?dir=team_context", "acme"),
    "/api/files?dir=team_context&clientId=acme&surface=docs",
  );
});

test("all loading file trees render deterministic server markup", () => {
  const { DocsFileTree } = loadDocsFileTree();
  const { FileTree } = loadTsModule(
    path.resolve(__dirname, "../context/file-tree.tsx"),
    { stubs: commonStubs },
  );
  const { ScopedFileTree } = loadTsModule(
    path.resolve(__dirname, "../shared/scoped-file-tree.tsx"),
    { stubs: commonStubs },
  );
  const cases = [
    [DocsFileTree, { onSelectFile() {}, selectedPath: null }, ["72%", "91%", "64%"]],
    [FileTree, { onSelectFile() {}, selectedPath: null }, ["72%", "91%", "64%"]],
    [ScopedFileTree, { rootDir: "projects", onSelectFile() {}, selectedPath: null }, ["62%", "86%", "55%"]],
  ];

  for (const [Component, props, expectedWidths] of cases) {
    const first = renderToStaticMarkup(React.createElement(Component, props));
    const second = renderToStaticMarkup(React.createElement(Component, props));
    assert.equal(second, first);
    for (const width of expectedWidths) {
      assert.match(first, new RegExp(`width:${width}`));
    }
  }
});

test("file-tree loading components do not use render-time randomness", () => {
  const sourcePaths = [
    path.resolve(__dirname, "docs-file-tree.tsx"),
    path.resolve(__dirname, "../context/file-tree.tsx"),
    path.resolve(__dirname, "../shared/scoped-file-tree.tsx"),
    path.resolve(__dirname, "../shared/file-tree-skeleton.tsx"),
  ];

  for (const sourcePath of sourcePaths) {
    assert.doesNotMatch(fs.readFileSync(sourcePath, "utf8"), /Math\.random/);
  }
});
