const assert = require("node:assert/strict");
const { spawnSync } = require("node:child_process");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const REPO_ROOT = path.resolve(__dirname, "../../..");
const FIRST_RUN_HOOK = path.join(REPO_ROOT, ".claude", "hooks", "detect-first-run.js");

// Team OS signals that make the hook exit early; cleared so a signed-in
// developer machine never masks Solo-mode behaviour.
const TEAM_ENV_KEYS = [
  "AI_OS_WORK_MODE",
  "AI_OS_TEAM_ENRICHMENT",
  "AI_OS_CONTEXT_OVERLAY_DIR",
];

function tempWorkspace() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "aios-first-run-"));
  fs.mkdirSync(path.join(root, ".claude"), { recursive: true });
  return root;
}

function write(root, relPath, content) {
  const file = path.join(root, relPath);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf-8");
}

function runHook(cwd) {
  const configDir = fs.mkdtempSync(path.join(os.tmpdir(), "aios-first-run-config-"));
  try {
    const env = { ...process.env, AI_OS_TEAM_CONFIG_DIR: configDir };
    for (const key of TEAM_ENV_KEYS) delete env[key];
    return spawnSync(process.execPath, [FIRST_RUN_HOOK], {
      input: JSON.stringify({ cwd, session_id: "session-1" }),
      encoding: "utf8",
      env,
      windowsHide: true,
      timeout: 15000,
    });
  } finally {
    fs.rmSync(configDir, { recursive: true, force: true });
  }
}

function fires(cwd) {
  const result = runHook(cwd);
  assert.equal(result.status, 0, result.stderr);
  if (result.stdout === "") return false;
  const parsed = JSON.parse(result.stdout);
  assert.equal(parsed.hookSpecificOutput.hookEventName, "SessionStart");
  assert.match(parsed.hookSpecificOutput.additionalContext, /start-here/);
  return true;
}

function withWorkspace(fn) {
  const root = tempWorkspace();
  try {
    fn(root);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
}

test("fresh install without brand_context fires onboarding", () => {
  withWorkspace((root) => {
    assert.equal(fires(root), true);
  });
});

test("fresh install with only .gitkeep in brand_context fires onboarding", () => {
  withWorkspace((root) => {
    write(root, "brand_context/.gitkeep", "");
    assert.equal(fires(root), true);
  });
});

test("business root with populated brand_context stays silent", () => {
  withWorkspace((root) => {
    write(root, "brand_context/voice-profile.md", "# Voice\n\nDirect and warm.\n");
    assert.equal(fires(root), false);
  });
});

test("personal root with a configured client stays silent", () => {
  withWorkspace((root) => {
    write(root, "brand_context/.gitkeep", "");
    write(root, "clients/acme/brand_context/voice-profile.md", "# Voice\n\nPlain.\n");
    assert.equal(fires(root), false);
  });
});

test("root with only unconfigured clients still fires onboarding", () => {
  withWorkspace((root) => {
    write(root, "brand_context/.gitkeep", "");
    write(root, "clients/acme/brand_context/.gitkeep", "");
    write(root, "clients/beta/brand_context/empty.md", "   \n");
    assert.equal(fires(root), true);
  });
});

test("skipped-onboarding marker keeps the root silent", () => {
  withWorkspace((root) => {
    write(root, "brand_context/.gitkeep", "");
    write(root, "context/.onboarding-skipped", "");
    assert.equal(fires(root), false);
  });
});

test("client workspace without brand_context still fires its own onboarding", () => {
  withWorkspace((root) => {
    write(root, "clients/configured/brand_context/voice-profile.md", "# Voice\n");
    write(root, "clients/fresh/brand_context/.gitkeep", "");
    assert.equal(fires(path.join(root, "clients", "fresh")), true);
  });
});

test("first-run message offers the skip path", () => {
  withWorkspace((root) => {
    const result = runHook(root);
    const message = JSON.parse(result.stdout).hookSpecificOutput.additionalContext;
    assert.match(message, /onboarding-skipped/);
    assert.match(message, /If the user states a task, begin it immediately/);
    assert.match(message, /GitHub backup is optional/);
    assert.doesNotMatch(message, /begin onboarding now|do NOT wait|backup check →/);
  });
});
