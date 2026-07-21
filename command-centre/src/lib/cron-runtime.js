// Re-export shim. The canonical cron scheduler lives at scripts/cron/cron-runtime.js
// at the AI-OS workspace root, so cron runs without the Command Centre (see AGENTS.md,
// "Command Centre Boundary"). This shim keeps existing Command Centre imports and tests
// working unchanged. It loads the canonical module from disk at runtime via createRequire
// so bundlers (Turbopack pins its root to command-centre/) never try to statically
// resolve a file outside this package.
const fs = require("fs");
const path = require("path");
const { createRequire } = require("module");

function findCanonical() {
  const relative = path.join("scripts", "cron", "cron-runtime.js");
  // __dirname is real under plain node; under a bundler it can be a virtual
  // path, in which case the process.cwd() walk finds the workspace root.
  for (const start of [__dirname, process.cwd()]) {
    let dir = path.resolve(start);
    for (let depth = 0; depth < 10; depth += 1) {
      const candidate = path.join(dir, relative);
      if (fs.existsSync(candidate)) return candidate;
      const parent = path.dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  throw new Error(
    `Unable to locate scripts/cron/cron-runtime.js above ${__dirname} or ${process.cwd()}`
  );
}

const canonicalPath = findCanonical();
module.exports = createRequire(canonicalPath)(canonicalPath);
