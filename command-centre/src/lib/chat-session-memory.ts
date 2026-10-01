import { profileStorageKey } from "./profile-storage";

const STORAGE_PREFIX = "cc.chat-session:v1:";
const ROOT_SCOPE = "_root";

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function getClientScopeKey(clientId: string | null | undefined): string {
  return clientId || ROOT_SCOPE;
}

export function buildChatSessionStorageKey(clientId: string | null | undefined): string {
  return profileStorageKey(`${STORAGE_PREFIX}${getClientScopeKey(clientId)}`);
}

export function loadRememberedConversationId(
  clientId: string | null | undefined,
  storage?: StorageLike,
): string | null {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return null;
  return resolvedStorage.getItem(buildChatSessionStorageKey(clientId));
}

export function rememberConversationId(
  clientId: string | null | undefined,
  conversationId: string,
  storage?: StorageLike,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.setItem(buildChatSessionStorageKey(clientId), conversationId);
}

export function clearRememberedConversationId(
  clientId: string | null | undefined,
  storage?: StorageLike,
): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.removeItem(buildChatSessionStorageKey(clientId));
}
