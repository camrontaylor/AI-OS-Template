import type { ChatComposerSurface, ChatDraftPayload } from "@/types/chat-composer";
import { profileStorageKey } from "./profile-storage";

const STORAGE_PREFIX = "cc.chat-draft:v1:";
const DRAFT_TTL_MS = 7 * 24 * 60 * 60 * 1000;

type StorageLike = Pick<Storage, "length" | "key" | "getItem" | "setItem" | "removeItem">;

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function buildChatDraftStorageKey(surface: ChatComposerSurface, scopeId: string): string {
  return profileStorageKey(`${STORAGE_PREFIX}${surface}:${scopeId}`);
}

export function buildChatDraftScopeKey(
  surface: ChatComposerSurface,
  scopeId: string | null | undefined,
): string | null {
  if (!scopeId) return null;
  return `${surface}:${scopeId}`;
}

export function getChatDraftPersistenceDecision(params: {
  hydratedScopeKey: string | null;
  surface: ChatComposerSurface;
  scopeId: string | null | undefined;
  message: string;
  attachmentsCount: number;
  pastedBlocksCount: number;
}): "skip" | "clear" | "save" {
  const currentScopeKey = buildChatDraftScopeKey(params.surface, params.scopeId);
  if (!currentScopeKey || params.hydratedScopeKey !== currentScopeKey) {
    return "skip";
  }

  if (
    params.message.trim().length === 0 &&
    params.attachmentsCount === 0 &&
    params.pastedBlocksCount === 0
  ) {
    return "clear";
  }

  return "save";
}

function isExpired(updatedAt: string, now = Date.now()): boolean {
  const updatedAtMs = new Date(updatedAt).getTime();
  if (Number.isNaN(updatedAtMs)) return true;
  return now - updatedAtMs > DRAFT_TTL_MS;
}

export function cleanupExpiredChatDrafts(storage?: StorageLike): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;

  const now = Date.now();
  const keys: string[] = [];
  for (let i = 0; i < resolvedStorage.length; i += 1) {
    const key = resolvedStorage.key(i);
    if (key?.startsWith(profileStorageKey(STORAGE_PREFIX))) {
      keys.push(key);
    }
  }

  for (const key of keys) {
    try {
      const raw = resolvedStorage.getItem(key);
      if (!raw) {
        resolvedStorage.removeItem(key);
        continue;
      }

      const parsed = JSON.parse(raw) as Partial<ChatDraftPayload>;
      if (parsed.version !== 1 || typeof parsed.updatedAt !== "string" || isExpired(parsed.updatedAt, now)) {
        resolvedStorage.removeItem(key);
      }
    } catch {
      resolvedStorage.removeItem(key);
    }
  }
}

export function loadChatDraft(
  surface: ChatComposerSurface,
  scopeId: string,
  storage?: StorageLike,
): ChatDraftPayload | null {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return null;

  cleanupExpiredChatDrafts(resolvedStorage);

  try {
    const raw = resolvedStorage.getItem(buildChatDraftStorageKey(surface, scopeId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as ChatDraftPayload;
    if (parsed.version !== 1 || parsed.surface !== surface || parsed.scopeId !== scopeId) {
      resolvedStorage.removeItem(buildChatDraftStorageKey(surface, scopeId));
      return null;
    }
    if (isExpired(parsed.updatedAt)) {
      resolvedStorage.removeItem(buildChatDraftStorageKey(surface, scopeId));
      return null;
    }
    return parsed;
  } catch {
    resolvedStorage.removeItem(buildChatDraftStorageKey(surface, scopeId));
    return null;
  }
}

export function saveChatDraft(draft: ChatDraftPayload, storage?: StorageLike): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.setItem(buildChatDraftStorageKey(draft.surface, draft.scopeId), JSON.stringify(draft));
}

export function touchChatDraft(
  surface: ChatComposerSurface,
  scopeId: string,
  storage?: StorageLike,
): ChatDraftPayload | null {
  const existingDraft = loadChatDraft(surface, scopeId, storage);
  if (!existingDraft) return null;
  const nextDraft = {
    ...existingDraft,
    updatedAt: new Date().toISOString(),
  };
  saveChatDraft(nextDraft, storage);
  return nextDraft;
}

export function clearChatDraft(
  surface: ChatComposerSurface,
  scopeId: string,
  storage?: StorageLike,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.removeItem(buildChatDraftStorageKey(surface, scopeId));
}
