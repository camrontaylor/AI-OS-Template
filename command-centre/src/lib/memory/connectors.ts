import type { Scope, SourceType } from "./types";

/**
 * Connector ids known to the MVP. The boundary also accepts future ids that
 * match the same safe token format, so adding a connector does not require a
 * memory store change.
 */
export const KNOWN_CONNECTOR_IDS = [
  "manual",
  "google_drive",
  "notion",
  "github",
  "other",
] as const;

export type KnownConnectorId = (typeof KNOWN_CONNECTOR_IDS)[number];
export type ConnectorId = KnownConnectorId | (string & {});

export interface ConnectorDescriptor {
  id: ConnectorId;
  itemId?: string;
  sourceUrl?: string;
  accountId?: string;
  collectionId?: string;
  displayName?: string;
  version?: string;
  metadata?: Record<string, unknown>;
}

export interface ConnectorContentItem {
  connector: ConnectorDescriptor | string;
  scope: Scope;
  content: string;
  sourcePath?: string | null;
  sourceType?: SourceType;
  title?: string | null;
  contentDate?: string | null;
  authorityWeight?: number;
  metadata?: Record<string, unknown>;
}

export interface PreparedConnectorImport {
  scope: Scope;
  sourcePath: string;
  sourceType: SourceType;
  title: string | null;
  contentDate: string | null;
  authorityWeight: number | undefined;
  content: string;
  metadata: Record<string, unknown>;
}

export class ConnectorImportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConnectorImportError";
  }
}

const CONNECTOR_ID_RE = /^[a-z][a-z0-9_-]{0,63}$/;

function optionalPlainObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function optionalString(value: unknown, field: string): string | undefined {
  if (value == null) return undefined;
  if (typeof value !== "string") {
    throw new ConnectorImportError(`${field} must be a string`);
  }
  const trimmed = value.trim();
  return trimmed === "" ? undefined : trimmed;
}

function normalizeConnectorId(value: unknown): ConnectorId {
  const id = optionalString(value, "connector.id");
  if (!id) throw new ConnectorImportError("connector.id is required");
  if (!CONNECTOR_ID_RE.test(id)) {
    throw new ConnectorImportError(
      "connector.id must start with a lowercase letter and contain only lowercase letters, numbers, underscores, or hyphens",
    );
  }
  return id as ConnectorId;
}

export function normalizeConnectorDescriptor(
  raw: ConnectorDescriptor | string,
): ConnectorDescriptor {
  if (typeof raw === "string") {
    return { id: normalizeConnectorId(raw) };
  }
  const obj = optionalPlainObject(raw);
  if (!obj) throw new ConnectorImportError("connector must be a string or object");
  const metadata = optionalPlainObject(obj.metadata) ?? undefined;
  return {
    id: normalizeConnectorId(obj.id),
    itemId: optionalString(obj.itemId, "connector.itemId"),
    sourceUrl: optionalString(obj.sourceUrl, "connector.sourceUrl"),
    accountId: optionalString(obj.accountId, "connector.accountId"),
    collectionId: optionalString(obj.collectionId, "connector.collectionId"),
    displayName: optionalString(obj.displayName, "connector.displayName"),
    version: optionalString(obj.version, "connector.version"),
    ...(metadata ? { metadata } : {}),
  };
}

export function normalizeConnectorSourcePath(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  if (!normalized) throw new ConnectorImportError("sourcePath is required");
  const parts = normalized.split("/");
  if (parts.some((part) => part === "." || part === ".." || part.trim() === "")) {
    throw new ConnectorImportError("sourcePath must not contain empty, '.', or '..' path segments");
  }
  return normalized;
}

function safeConnectorPathPart(value: string): string {
  const normalized = value
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/{2,}/g, "/");
  const parts = normalized
    .split("/")
    .map((part) => part.trim().replace(/[^a-zA-Z0-9._-]+/g, "-"))
    .filter(Boolean)
    .filter((part) => part !== "." && part !== "..");
  return parts.length > 0 ? parts.join("/") : "item";
}

export function defaultConnectorSourcePath(connector: ConnectorDescriptor): string {
  const id = safeConnectorPathPart(String(connector.id));
  const item = safeConnectorPathPart(
    connector.itemId ?? connector.displayName ?? connector.sourceUrl ?? "item",
  );
  return normalizeConnectorSourcePath(
    connector.id === "manual" ? `manual/${item}` : `connectors/${id}/${item}`,
  );
}

export function connectorMetadata(
  connector: ConnectorDescriptor,
  sourcePath: string,
): Record<string, unknown> {
  const metadata: Record<string, unknown> = {
    id: connector.id,
    sourcePath,
  };
  if (connector.itemId) metadata.itemId = connector.itemId;
  if (connector.sourceUrl) metadata.sourceUrl = connector.sourceUrl;
  if (connector.accountId) metadata.accountId = connector.accountId;
  if (connector.collectionId) metadata.collectionId = connector.collectionId;
  if (connector.displayName) metadata.displayName = connector.displayName;
  if (connector.version) metadata.version = connector.version;
  if (connector.metadata) metadata.metadata = connector.metadata;
  return metadata;
}

/**
 * Normalize one external content item into the generic ingest/import contract.
 * Connectors should do provider-specific auth and fetching before this point;
 * after this boundary the memory system only sees content, source metadata, and
 * a normal AI-OS scope.
 */
export function prepareConnectorImport(item: ConnectorContentItem): PreparedConnectorImport {
  const connector = normalizeConnectorDescriptor(item.connector);
  const sourcePath = normalizeConnectorSourcePath(
    item.sourcePath ?? defaultConnectorSourcePath(connector),
  );
  return {
    scope: item.scope,
    sourcePath,
    sourceType: item.sourceType ?? "other",
    title: item.title ?? connector.displayName ?? null,
    contentDate: item.contentDate ?? null,
    authorityWeight: item.authorityWeight,
    content: item.content,
    metadata: {
      ...(item.metadata ?? {}),
      connector: connectorMetadata(connector, sourcePath),
    },
  };
}
