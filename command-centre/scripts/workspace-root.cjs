const fs = require("fs");
const path = require("path");

const workspaceMarkers = ["AGENTS.md", "CLAUDE.md"];

function hasWorkspaceMarker(targetPath) {
  return workspaceMarkers.some((marker) => fs.existsSync(path.join(targetPath, marker)));
}

function findWorkspaceRoot(startPath) {
  let currentDir = path.resolve(startPath);

  for (let depth = 0; depth < 10; depth += 1) {
    if (hasWorkspaceMarker(currentDir)) {
      return currentDir;
    }

    const parentDir = path.dirname(currentDir);
    if (parentDir === currentDir) {
      break;
    }

    currentDir = parentDir;
  }

  throw new Error(
    `Unable to locate the AI-OS workspace root from ${startPath}. Expected one of: ${workspaceMarkers.join(", ")}`
  );
}

module.exports = {
  findWorkspaceRoot,
  hasWorkspaceMarker,
  workspaceMarkers,
};
