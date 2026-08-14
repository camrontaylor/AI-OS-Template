const { execSync, spawnSync } = require("child_process");
const path = require("path");
const { assertPinnedNode } = require("../../scripts/lib/assert-node-version.cjs");

const port = String(process.env.PORT || "3000");

// The command-centre folder is one level up from this scripts/ folder.
const commandCentreDir = path.resolve(__dirname, "..");
const agenticOsDir = path.resolve(commandCentreDir, "..");

try {
  assertPinnedNode(agenticOsDir);
} catch (error) {
  console.error(`[predev] ${error.message}`);
  process.exit(1);
}

// better-sqlite3 is a native module. If the Node that runs the dev server is a
// different version from the Node that ran `npm install`, the compiled binary
// has the wrong ABI and loading it throws NODE_MODULE_VERSION / ERR_DLOPEN_FAILED.
// The page still serves but every DB-backed feature (cron, feed) errors. This
// check catches that ABI mismatch and rebuilds better-sqlite3 against the
// current Node so the next steps start clean.
function isAbiMismatch(error) {
  if (!error) {
    return false;
  }

  const code = error.code ? String(error.code) : "";
  const message = error.message ? String(error.message) : "";

  return (
    code === "ERR_DLOPEN_FAILED" ||
    /NODE_MODULE_VERSION/i.test(message) ||
    /ERR_DLOPEN_FAILED/i.test(message) ||
    // Some Node versions report the mismatch as a generic dlopen failure that
    // mentions the module being compiled against a different Node version.
    /was compiled against a different Node\.js version/i.test(message)
  );
}

function ensureBetterSqlite3() {
  // Resolve better-sqlite3 from the command-centre node_modules, not from
  // wherever this script happens to be invoked.
  let modulePath;

  try {
    modulePath = require.resolve("better-sqlite3", { paths: [commandCentreDir] });
  } catch {
    // Not installed yet. `npm install` has not run, so there is nothing to
    // rebuild here. Leave it to the normal install/build flow.
    return;
  }

  try {
    require(modulePath);
    return;
  } catch (error) {
    if (!isAbiMismatch(error)) {
      // A different load failure (corrupt install, missing dependency, etc.).
      // Do not try to rebuild blindly. Report it and let the dev server surface
      // the real error.
      console.warn(`[predev] better-sqlite3 failed to load: ${error.message}`);
      return;
    }

    console.log(
      "[predev] better-sqlite3 was built for a different Node version. Rebuilding it against the current Node..."
    );

    try {
      execSync("npm rebuild better-sqlite3", {
        cwd: commandCentreDir,
        stdio: "inherit",
      });
      console.log("[predev] Rebuilt better-sqlite3 successfully.");
    } catch {
      console.warn(
        "[predev] Could not rebuild better-sqlite3 automatically. " +
          "Run 'npm rebuild better-sqlite3' inside command-centre, " +
          "or delete node_modules and run 'npm install' again. " +
          "Cron and feed features need this to work."
      );
    }
  }
}

function killPortOnWindows(targetPort) {
  let output = "";

  try {
    output = execSync("netstat -ano -p tcp", {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    });
  } catch (error) {
    output = error.stdout?.toString() || "";
  }

  const pids = new Set(
    output
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.includes(`:${targetPort}`) && line.includes("LISTENING"))
      .map((line) => line.split(/\s+/).at(-1))
      .filter((pid) => pid && /^\d+$/.test(pid) && pid !== "0")
  );

  for (const pid of pids) {
    spawnSync("taskkill", ["/F", "/PID", pid], {
      stdio: "ignore",
    });
  }

  if (pids.size > 0) {
    console.log(`[predev] Freed port ${targetPort} by stopping PID(s): ${[...pids].join(", ")}`);
  }
}

function killPortOnUnix(targetPort) {
  let pids = [];

  try {
    const output = execSync(`lsof -ti :${targetPort}`, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();

    if (output) {
      pids = output.split(/\r?\n/).filter(Boolean);
    }
  } catch {
    return;
  }

  if (pids.length === 0) {
    return;
  }

  spawnSync("kill", ["-9", ...pids], {
    stdio: "ignore",
  });

  console.log(`[predev] Freed port ${targetPort} by stopping PID(s): ${pids.join(", ")}`);
}

// `--sqlite-only` runs just the native-module ABI check and rebuild. It is used
// by the postinstall hook, where freeing the dev port would be wrong. The normal
// predev path (no flag) frees the port and then runs the same check.
const sqliteOnly = process.argv.includes("--sqlite-only");

if (!sqliteOnly) {
  if (process.platform === "win32") {
    killPortOnWindows(port);
  } else {
    killPortOnUnix(port);
  }
}

ensureBetterSqlite3();
