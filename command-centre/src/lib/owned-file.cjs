"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { randomUUID } = require("node:crypto");

class OwnedFilePreservationError extends Error {
  constructor(filePath, claimPath, cause = null) {
    super(
      `Could not safely restore ${filePath}; the recoverable copy remains at ${claimPath}` +
        (cause?.message ? `: ${cause.message}` : ""),
    );
    this.name = "OwnedFilePreservationError";
    this.filePath = filePath;
    this.claimPath = claimPath;
    this.cause = cause || undefined;
  }
}

function readOwnedFile(filePath, fsImpl) {
  try {
    return fsImpl.readFileSync(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function safelyMatches(matcher, contents) {
  try {
    return matcher(contents) === true;
  } catch {
    return false;
  }
}

function filesHaveSameContents(firstPath, secondPath, fsImpl) {
  try {
    return fsImpl.readFileSync(firstPath).equals(fsImpl.readFileSync(secondPath));
  } catch {
    return false;
  }
}

function handleRestoreCollision(claimPath, filePath, fsImpl) {
  if (filesHaveSameContents(claimPath, filePath, fsImpl)) {
    fsImpl.rmSync(claimPath, { force: true });
    return true;
  }
  throw new OwnedFilePreservationError(filePath, claimPath);
}

function restoreUnmatchedClaim(claimPath, filePath, fsImpl) {
  try {
    fsImpl.linkSync(claimPath, filePath);
    fsImpl.rmSync(claimPath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return handleRestoreCollision(claimPath, filePath, fsImpl);
    }
  }

  try {
    fsImpl.copyFileSync(claimPath, filePath, fs.constants.COPYFILE_EXCL);
    fsImpl.rmSync(claimPath, { force: true });
    return true;
  } catch (error) {
    if (error?.code === "EEXIST") {
      return handleRestoreCollision(claimPath, filePath, fsImpl);
    }
    throw new OwnedFilePreservationError(filePath, claimPath, error);
  }
}

function safeToken(value, label) {
  const safe = String(value).replace(/[^a-zA-Z0-9-]/g, "");
  if (!safe) throw new TypeError(`A safe ${label} token is required.`);
  return safe;
}

function siblingPath(filePath, operation, token, extension) {
  return path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${operation}-${process.pid}-${token}.${extension}`,
  );
}

function claimCanonicalPath(filePath, operation, token, fsImpl) {
  const claimPath = siblingPath(filePath, operation, token, "claim");
  try {
    fsImpl.renameSync(filePath, claimPath);
    return claimPath;
  } catch (error) {
    if (error?.code === "ENOENT") return null;
    throw error;
  }
}

function publishExclusive(sourcePath, filePath, fsImpl) {
  try {
    fsImpl.linkSync(sourcePath, filePath);
    return "published";
  } catch (error) {
    if (error?.code === "EEXIST") {
      return filesHaveSameContents(sourcePath, filePath, fsImpl)
        ? "identical"
        : "occupied";
    }
  }
  try {
    fsImpl.copyFileSync(sourcePath, filePath, fs.constants.COPYFILE_EXCL);
    return "published";
  } catch (error) {
    if (error?.code === "EEXIST") {
      return filesHaveSameContents(sourcePath, filePath, fsImpl)
        ? "identical"
        : "occupied";
    }
    throw error;
  }
}

/**
 * Removes a small ownership file without ever unlinking the canonical path
 * after validation. The rename claims one exact filesystem entry atomically;
 * validation and deletion then happen only against that private claim.
 */
function removeFileIfMatchesAtomically(filePath, matcher, options = {}) {
  const {
    fsImpl = fs,
    precheck = true,
    beforeClaim = null,
    afterClaim = null,
    claimToken = randomUUID(),
  } = options;
  if (typeof matcher !== "function") {
    throw new TypeError("An ownership matcher is required.");
  }

  if (precheck) {
    const current = readOwnedFile(filePath, fsImpl);
    if (current === null || !safelyMatches(matcher, current)) {
      return false;
    }
  }
  if (typeof beforeClaim === "function") {
    beforeClaim();
  }

  const safeClaimToken = safeToken(claimToken, "claim");
  const claimPath = claimCanonicalPath(filePath, "remove", safeClaimToken, fsImpl);
  if (!claimPath) return false;
  if (typeof afterClaim === "function") {
    afterClaim({ claimPath, filePath });
  }

  let claimedContents;
  try {
    claimedContents = fsImpl.readFileSync(claimPath, "utf8");
  } catch (error) {
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    throw error;
  }

  if (!safelyMatches(matcher, claimedContents)) {
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    return false;
  }

  fsImpl.rmSync(claimPath, { force: true });
  return true;
}

function writeFileAtomically(filePath, contents, options = {}) {
  const {
    fsImpl = fs,
    encoding = "utf8",
    tempToken = randomUUID(),
  } = options;
  const safeTempToken = safeToken(tempToken, "temporary");
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = siblingPath(filePath, "write", safeTempToken, "tmp");
  try {
    fsImpl.writeFileSync(tempPath, contents, { encoding, flag: "wx" });
    fsImpl.renameSync(tempPath, filePath);
  } finally {
    fsImpl.rmSync(tempPath, { force: true });
  }
}

function writeFileExclusivelyAtomically(filePath, contents, options = {}) {
  const {
    fsImpl = fs,
    encoding = "utf8",
    tempToken = randomUUID(),
  } = options;
  const safeTempToken = safeToken(tempToken, "temporary");
  fsImpl.mkdirSync(path.dirname(filePath), { recursive: true });
  const tempPath = siblingPath(filePath, "exclusive", safeTempToken, "tmp");
  try {
    fsImpl.writeFileSync(tempPath, contents, { encoding, flag: "wx" });
    const result = publishExclusive(tempPath, filePath, fsImpl);
    return result === "published";
  } finally {
    fsImpl.rmSync(tempPath, { force: true });
  }
}

function replaceFileIfMatchesAtomically(filePath, matcher, createReplacement, options = {}) {
  const {
    fsImpl = fs,
    precheck = true,
    beforeClaim = null,
    afterClaim = null,
    claimToken = randomUUID(),
    tempToken = randomUUID(),
  } = options;
  if (typeof matcher !== "function" || typeof createReplacement !== "function") {
    throw new TypeError("Ownership matcher and replacement factory are required.");
  }
  if (precheck) {
    const current = readOwnedFile(filePath, fsImpl);
    if (current === null || !safelyMatches(matcher, current)) return false;
  }
  if (typeof beforeClaim === "function") beforeClaim();
  const safeClaimToken = safeToken(claimToken, "claim");
  const safeTempToken = safeToken(tempToken, "temporary");

  const claimPath = claimCanonicalPath(
    filePath,
    "replace",
    safeClaimToken,
    fsImpl,
  );
  if (!claimPath) return false;
  if (typeof afterClaim === "function") afterClaim({ claimPath, filePath });

  let claimedContents;
  try {
    claimedContents = fsImpl.readFileSync(claimPath, "utf8");
  } catch (error) {
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    throw error;
  }
  if (!safelyMatches(matcher, claimedContents)) {
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    return false;
  }

  let replacementContents;
  try {
    replacementContents = String(createReplacement(claimedContents));
  } catch (error) {
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    throw error;
  }
  const replacementPath = siblingPath(
    filePath,
    "replacement",
    safeTempToken,
    "tmp",
  );
  try {
    fsImpl.writeFileSync(replacementPath, replacementContents, {
      encoding: "utf8",
      flag: "wx",
    });
  } catch (error) {
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    throw error;
  }
  let publishResult;
  try {
    publishResult = publishExclusive(replacementPath, filePath, fsImpl);
  } catch (error) {
    fsImpl.rmSync(replacementPath, { force: true });
    restoreUnmatchedClaim(claimPath, filePath, fsImpl);
    throw error;
  } finally {
    fsImpl.rmSync(replacementPath, { force: true });
  }

  if (publishResult === "occupied") {
    // The foreign canonical entry wins. The isolated entry was positively
    // matched as the caller's old state, so it is safe to discard.
    fsImpl.rmSync(claimPath, { force: true });
    return false;
  }
  fsImpl.rmSync(claimPath, { force: true });
  return true;
}

module.exports = {
  OwnedFilePreservationError,
  removeFileIfMatchesAtomically,
  replaceFileIfMatchesAtomically,
  writeFileAtomically,
  writeFileExclusivelyAtomically,
};
