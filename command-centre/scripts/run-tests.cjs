const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const roots = ["src"];

function findTests(dir) {
  const tests = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      tests.push(...findTests(fullPath));
    } else if (entry.isFile() && entry.name.endsWith(".test.cjs")) {
      tests.push(fullPath);
    }
  }
  return tests;
}

const testFiles = roots
  .flatMap((root) => (fs.existsSync(root) ? findTests(root) : []))
  .sort();

if (testFiles.length === 0) {
  console.error("No .test.cjs files found.");
  process.exit(1);
}

const result = spawnSync(
  process.execPath,
  ["--no-deprecation", "--test", ...testFiles],
  { stdio: "inherit" }
);

process.exit(result.status ?? 1);
