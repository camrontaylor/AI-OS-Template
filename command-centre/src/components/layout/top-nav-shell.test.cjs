const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const test = require("node:test");

const source = fs.readFileSync(path.resolve(__dirname, "top-nav-shell.tsx"), "utf8");

test("Team navigation reacts to the shared Team OS connection state", () => {
  assert.match(source, /useTeamNavigationStore\(\(state\) => isTeamNavigationAvailable\(state\.status\)\)/);
  assert.match(source, /tabs\.filter\(\(tab\) => tab\.key !== "team" \|\| teamNavigationAvailable\)\.map/);
});

test("legacy Team links remain resolvable even when the tab is hidden", () => {
  assert.match(source, /\{ key: "team", label: "Team", href: "\/team"/);
  assert.match(source, /export function hrefForTopNavTab/);
});
