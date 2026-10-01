const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const fileService = loadTsModule(path.resolve(__dirname, "file-service.ts"), {
  stubs: {
    "./config": {
      getConfig: () => ({ aiOsDir: "unused" }),
    },
    "./materialized-file-ownership": {
      assertMaterializedPathAccessible() {},
      assertMaterializedPathWritable() {},
      isMaterializedPathAccessible: () => true,
      registerMaterializedFiles() {},
      removeMaterializedOwnership() {},
    },
  },
});

test("writeFile never follows a pre-existing predictable temp symlink", (t) => {
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "aos-file-workspace-"));
  const outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "aos-file-outside-"));
  const projectsDir = path.join(workspace, "projects");
  const targetPath = path.join(projectsDir, "demo.md");
  const legacyTempPath = `${targetPath}.tmp`;
  const outsidePath = path.join(outsideDir, "outside.md");

  fs.mkdirSync(projectsDir, { recursive: true });
  fs.writeFileSync(outsidePath, "ORIGINAL", "utf-8");
  try {
    fs.symlinkSync(outsidePath, legacyTempPath, "file");
  } catch (error) {
    if (error && ["EPERM", "EACCES", "ENOTSUP"].includes(error.code)) {
      t.skip(`File symlinks are unavailable: ${error.code}`);
      return;
    }
    throw error;
  }

  t.after(() => {
    fs.rmSync(workspace, { recursive: true, force: true });
    fs.rmSync(outsideDir, { recursive: true, force: true });
  });

  const saved = fileService.writeFile("projects/demo.md", "CHANGED", undefined, workspace);

  assert.equal(saved.content, "CHANGED");
  assert.equal(fs.readFileSync(targetPath, "utf-8"), "CHANGED");
  assert.equal(fs.readFileSync(outsidePath, "utf-8"), "ORIGINAL");
  assert.equal(fs.lstatSync(legacyTempPath).isSymbolicLink(), true);
  assert.deepEqual(
    fs.readdirSync(projectsDir).sort(),
    ["demo.md", "demo.md.tmp"],
    "unique temporary files must not remain after the atomic rename",
  );
});
