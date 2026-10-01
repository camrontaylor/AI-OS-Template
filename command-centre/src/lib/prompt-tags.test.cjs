const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

function tempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "aios-prompt-tags-"));
}

test("loadPromptTags merges team and private tags with private priority", () => {
  const root = tempDir();
  try {
    fs.mkdirSync(path.join(root, "team_context"), { recursive: true });
    fs.mkdirSync(path.join(root, "context"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "team_context", "prompt-tags.md"),
      "## shared/tag\n\nTeam body\n\n## team/only\n\nTeam only\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(root, "context", "prompt-tags.md"),
      "## shared/tag\n\nPrivate body\n\n## user/only\n\nUser only\n",
      "utf-8",
    );

    const promptTags = loadTsModule(path.resolve(__dirname, "prompt-tags.ts"), {
      stubs: {
        "./config": {
          getConfig: () => ({ aiOsDir: root }),
          getClientAiOsDir: (clientId) => path.join(root, "clients", clientId),
        },
      },
    });

    const tags = promptTags.loadPromptTags();
    const byName = new Map(tags.map((tag) => [tag.name, tag.body]));
    assert.equal(byName.get("shared/tag"), "Private body");
    assert.equal(byName.get("team/only"), "Team only");
    assert.equal(byName.get("user/only"), "User only");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("Team prompt tags ignore materialized private Team and brand files", () => {
  const root = tempDir();
  try {
    fs.mkdirSync(path.join(root, "team_context"), { recursive: true });
    fs.mkdirSync(path.join(root, "context"), { recursive: true });
    fs.mkdirSync(path.join(root, "brand_context"), { recursive: true });
    fs.mkdirSync(path.join(root, "projects", "briefs", "safe-project"), { recursive: true });
    fs.writeFileSync(path.join(root, "team_context", "prompt-tags.md"), "## stale/team\n\nStale Team data\n", "utf8");
    fs.writeFileSync(path.join(root, "context", "prompt-tags.md"), "## stale/private\n\nStale private data\n", "utf8");
    fs.writeFileSync(path.join(root, "context", "USER.md"), "Previous user", "utf8");
    fs.writeFileSync(path.join(root, "brand_context", "voice.md"), "Previous Team voice", "utf8");
    fs.writeFileSync(
      path.join(root, "projects", "briefs", "safe-project", "brief.md"),
      "# Safe project brief\n",
      "utf8",
    );

    const promptTags = loadTsModule(path.resolve(__dirname, "prompt-tags.ts"), {
      stubs: {
        "./config": {
          getConfig: () => ({ aiOsDir: root }),
          getClientAiOsDir: (clientId) => path.join(root, "clients", clientId),
        },
      },
    });

    const tags = promptTags.loadPromptTags(null, "team");
    assert.deepEqual(tags.map((tag) => tag.name), ["brief/safe-project"]);
    assert.equal(promptTags.expandPromptTags("@stale/private", null, "conversation_only"), "@stale/private");
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
