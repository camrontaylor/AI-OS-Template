import { createHash } from "crypto";
import fs from "fs";
import path from "path";
import { getConfig } from "./config";
import { Client, getClientColor, slugToName } from "../types/client";

/**
 * Detect client folders by scanning the clients/ directory
 * inside the configured AI-OS root.
 * Returns an empty array if the clients/ directory does not exist.
 */
export function detectClients(): Client[] {
  const config = getConfig();
  const clientsDir = path.join(config.aiOsDir, "clients");

  if (!fs.existsSync(clientsDir)) {
    return [];
  }

  const entries = fs.readdirSync(clientsDir, { withFileTypes: true });

  return entries
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .map((entry) => ({
      slug: entry.name,
      name: slugToName(entry.name),
      path: `clients/${entry.name}`,
      color: getClientColor(entry.name),
    }));
}

/**
 * Return the display name for the root workspace (folder basename).
 */
export function getRootName(): string {
  const config = getConfig();
  return path.basename(config.aiOsDir);
}

/**
 * Return a short stable workspace ID for browser-scoped state keys.
 */
export function getWorkspaceId(): string {
  const config = getConfig();
  const normalizedPath = path
    .resolve(config.aiOsDir)
    .replace(/\\/g, "/")
    .toLowerCase();

  return createHash("sha256").update(normalizedPath).digest("hex").slice(0, 12);
}

/**
 * Normalize incoming client IDs so "root" behaves like the workspace root.
 */
export function normalizeClientId(clientId: string | null | undefined): string | null {
  if (!clientId || clientId === "root") {
    return null;
  }

  return clientId;
}

/**
 * Validate a client ID against the current workspace.
 * Returns null for root, or the normalized slug for a real client.
 * Throws with a user-facing message when the client does not exist.
 */
export function assertValidClientId(clientId: string | null | undefined): string | null {
  const normalized = normalizeClientId(clientId);
  if (!normalized) {
    return null;
  }

  const config = getConfig();
  const clientsDir = path.resolve(config.aiOsDir, "clients");
  const clientDir = path.resolve(clientsDir, normalized);
  if (
    normalized === "."
    || normalized === ".."
    || path.basename(normalized) !== normalized
    || !clientDir.startsWith(`${clientsDir}${path.sep}`)
  ) {
    throw new Error("Invalid client selection");
  }

  if (!fs.existsSync(clientDir)) {
    throw new Error(`Client directory not found: clients/${normalized}`);
  }

  return normalized;
}

/**
 * Resolve the absolute directory for a given client.
 * If clientId is null/undefined, returns the AI-OS root.
 * Throws if the resolved directory does not exist.
 */
export function getClientDir(clientId: string | null): string {
  const config = getConfig();
  const normalized = assertValidClientId(clientId);

  if (!normalized) {
    return config.aiOsDir;
  }

  return path.resolve(config.aiOsDir, "clients", normalized);
}
