const fs = require("fs");
const path = require("path");

function getPinnedNodeVersion(agenticOsDir) {
  const nvmrc = path.join(agenticOsDir, ".nvmrc");
  if (!fs.existsSync(nvmrc)) return null;
  const value = fs.readFileSync(nvmrc, "utf8").trim();
  return value || null;
}

function checkPinnedNode(agenticOsDir, actualVersion = process.version) {
  const expected = getPinnedNodeVersion(agenticOsDir);
  if (!expected) return { ok: true, expected: null, actual: actualVersion };
  return {
    ok: actualVersion === `v${expected}`,
    expected: `v${expected}`,
    actual: actualVersion,
  };
}

function assertPinnedNode(agenticOsDir, actualVersion = process.version) {
  const result = checkPinnedNode(agenticOsDir, actualVersion);
  if (!result.ok) {
    throw new Error(
      `AI-OS requires Node ${result.expected}; current runtime is ${result.actual}. Run 'nvm use' from ${agenticOsDir} and retry.`
    );
  }
  return result;
}

module.exports = { assertPinnedNode, checkPinnedNode, getPinnedNodeVersion };

if (require.main === module) {
  const agenticOsDir = path.resolve(__dirname, "..", "..");
  try {
    const result = assertPinnedNode(agenticOsDir);
    console.log(`Node runtime matches ${result.expected || result.actual}.`);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
