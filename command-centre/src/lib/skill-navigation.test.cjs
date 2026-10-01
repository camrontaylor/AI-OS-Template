const assert = require("node:assert/strict");
const path = require("node:path");
const test = require("node:test");

const { loadTsModule } = require("./test-utils/load-ts-module.cjs");

const navigation = loadTsModule(path.resolve(__dirname, "skill-navigation.ts"), {
  stubs: { "@/types/file": {} },
});

test("skill cards select the catalog's effective origin", () => {
  assert.deepEqual(navigation.primarySkillFileSelection({
    folderName: "mkt-copywriting",
    effectiveOrigin: "team",
  }), {
    path: ".claude/skills/mkt-copywriting/SKILL.md",
    origin: "team",
  });
});

test("Team and local base files are read-only while client and local overrides are editable", () => {
  assert.equal(navigation.isSkillFileReadOnly({ path: ".claude/skills/a/SKILL.md", origin: "team" }), true);
  assert.equal(navigation.isSkillFileReadOnly({ path: ".claude/skills/a/SKILL.md", origin: "local" }), true);
  assert.equal(navigation.isSkillFileReadOnly({ path: ".claude/skills/a/SKILL.local.md", origin: "local" }), false);
  assert.equal(navigation.isSkillFileReadOnly({ path: ".claude/skills/a/SKILL.md", origin: "client" }), false);
});
