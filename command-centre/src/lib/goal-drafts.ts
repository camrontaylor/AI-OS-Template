import type { GoalDraftPayload } from "@/types/goal-draft";
import type { ChatPastedBlock } from "@/types/chat-composer";
import { profileStorageKey } from "./profile-storage";

const STORAGE_KEY = "cc.goal-drafts:v2";
const LEGACY_STORAGE_KEY = "cc.goal-drafts:v1";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isGoalDraftPayload(value: unknown): value is GoalDraftPayload {
  return Boolean(
    value &&
      typeof value === "object" &&
      (value as GoalDraftPayload).version === 2 &&
      typeof (value as GoalDraftPayload).id === "string" &&
      typeof (value as GoalDraftPayload).title === "string" &&
      typeof (value as GoalDraftPayload).message === "string" &&
      Array.isArray((value as GoalDraftPayload).attachments) &&
      typeof (value as GoalDraftPayload).createdAt === "string" &&
      typeof (value as GoalDraftPayload).updatedAt === "string",
  );
}

function migrateLegacyGoalDraft(value: unknown): GoalDraftPayload | null {
  if (
    !value ||
    typeof value !== "object" ||
    (value as { version?: unknown }).version !== 1 ||
    typeof (value as { id?: unknown }).id !== "string" ||
    typeof (value as { title?: unknown }).title !== "string" ||
    typeof (value as { message?: unknown }).message !== "string" ||
    !Array.isArray((value as { attachments?: unknown }).attachments) ||
    typeof (value as { createdAt?: unknown }).createdAt !== "string" ||
    typeof (value as { updatedAt?: unknown }).updatedAt !== "string"
  ) {
    return null;
  }

  const legacy = value as Omit<GoalDraftPayload, "version"> & {
    version: 1;
    thinkingEffort?: GoalDraftPayload["thinkingEffort"];
  };
  return {
    ...legacy,
    version: 2,
    permissionMode:
      legacy.permissionMode === "auto" ? "bypassPermissions" : legacy.permissionMode,
    thinkingEffort: legacy.thinkingEffort ?? null,
  };
}

function sortGoalDrafts(drafts: GoalDraftPayload[]): GoalDraftPayload[] {
  return [...drafts].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
}

export function buildGoalDraftSnapshot(draft: GoalDraftPayload): string {
  return JSON.stringify({
    version: draft.version,
    id: draft.id,
    clientId: draft.clientId,
    title: draft.title,
    message: draft.message,
    attachments: draft.attachments,
    level: draft.level,
    permissionMode: draft.permissionMode,
    model: draft.model,
    thinkingEffort: draft.thinkingEffort,
    tag: draft.tag,
    pastedBlocks: draft.pastedBlocks,
    createdAt: draft.createdAt,
  });
}

export function hasGoalDraftContent({
  title,
  message,
  attachments,
  pastedBlocks,
}: {
  title: string;
  message: string;
  attachments: unknown[];
  pastedBlocks: ChatPastedBlock[];
}): boolean {
  return (
    title.trim().length > 0 ||
    message.trim().length > 0 ||
    attachments.length > 0 ||
    pastedBlocks.length > 0
  );
}

function writeGoalDrafts(drafts: GoalDraftPayload[], storage?: StorageLike): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.setItem(profileStorageKey(STORAGE_KEY), JSON.stringify(sortGoalDrafts(drafts)));
}

export function loadGoalDrafts(storage?: StorageLike): GoalDraftPayload[] {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return [];

  const raw = resolvedStorage.getItem(profileStorageKey(STORAGE_KEY));
  let currentDrafts: GoalDraftPayload[] = [];

  if (raw) {
    try {
      const parsed = JSON.parse(raw);
      if (!Array.isArray(parsed)) {
        resolvedStorage.removeItem(profileStorageKey(STORAGE_KEY));
      } else {
        currentDrafts = parsed.filter(isGoalDraftPayload).map((draft) => ({
          ...draft,
          thinkingEffort: draft.thinkingEffort ?? null,
        }));
        if (currentDrafts.length !== parsed.length) {
          writeGoalDrafts(currentDrafts, resolvedStorage);
        }
      }
    } catch {
      resolvedStorage.removeItem(profileStorageKey(STORAGE_KEY));
    }
  }

  const legacyRaw = resolvedStorage.getItem(profileStorageKey(LEGACY_STORAGE_KEY));
  if (!legacyRaw) return sortGoalDrafts(currentDrafts);

  try {
    const parsedLegacy = JSON.parse(legacyRaw);
    if (!Array.isArray(parsedLegacy)) {
      resolvedStorage.removeItem(profileStorageKey(LEGACY_STORAGE_KEY));
      return sortGoalDrafts(currentDrafts);
    }

    const migrated = parsedLegacy
      .map(migrateLegacyGoalDraft)
      .filter((draft): draft is GoalDraftPayload => draft !== null);
    const currentIds = new Set(currentDrafts.map((draft) => draft.id));
    const merged = sortGoalDrafts([
      ...currentDrafts,
      ...migrated.filter((draft) => !currentIds.has(draft.id)),
    ]);

    // Only remove v1 after the v2 write succeeds.
    writeGoalDrafts(merged, resolvedStorage);
    resolvedStorage.removeItem(profileStorageKey(LEGACY_STORAGE_KEY));
    return merged;
  } catch {
    return sortGoalDrafts(currentDrafts);
  }
}

export function getGoalDraft(id: string, storage?: StorageLike): GoalDraftPayload | null {
  return loadGoalDrafts(storage).find((draft) => draft.id === id) ?? null;
}

export function saveGoalDraft(draft: GoalDraftPayload, storage?: StorageLike): GoalDraftPayload[] {
  const drafts = loadGoalDrafts(storage);
  const nextDrafts = sortGoalDrafts([
    draft,
    ...drafts.filter((existing) => existing.id !== draft.id),
  ]);
  writeGoalDrafts(nextDrafts, storage);
  return nextDrafts;
}

export function removeGoalDraft(id: string, storage?: StorageLike): GoalDraftPayload[] {
  const nextDrafts = loadGoalDrafts(storage).filter((draft) => draft.id !== id);
  if (nextDrafts.length === 0) {
    const resolvedStorage = getStorage(storage);
    if (resolvedStorage) {
      resolvedStorage.removeItem(profileStorageKey(STORAGE_KEY));
    }
    return [];
  }
  writeGoalDrafts(nextDrafts, storage);
  return nextDrafts;
}
