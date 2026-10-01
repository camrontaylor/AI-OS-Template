import {
  isClaudeThinkingEffort,
  normalizeClaudeModel,
  normalizeClaudeThinkingEffortForModel,
} from "@/lib/claude-options";
import type { ClaudeModel, ClaudeThinkingEffort } from "@/types/task";
import { profileStorageKey } from "./profile-storage";

export const LLM_PREFERENCES_STORAGE_KEY = "cc.llm-preferences:v1";
export const DEFAULT_LLM_PROVIDER = "claude";

export interface LlmProviderPreference {
  model: string | null;
  reasoningEffort: string | null;
  updatedAt: string;
}

export interface LlmPreferencesPayload {
  version: 1;
  activeProvider: string;
  providers: Record<string, LlmProviderPreference>;
}

export interface ClaudeLlmPreference {
  provider: "claude";
  model: ClaudeModel;
  reasoningEffort: ClaudeThinkingEffort;
}

type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export const DEFAULT_CLAUDE_LLM_PREFERENCE: ClaudeLlmPreference = {
  provider: "claude",
  model: "sonnet",
  reasoningEffort: "auto",
};

function getStorage(storage?: StorageLike): StorageLike | null {
  if (storage) return storage;
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function normalizeProviderPreference(value: unknown): LlmProviderPreference | null {
  if (!isRecord(value)) return null;

  const model = typeof value.model === "string" ? value.model : null;
  const reasoningEffort = typeof value.reasoningEffort === "string" ? value.reasoningEffort : null;
  const updatedAt = typeof value.updatedAt === "string" ? value.updatedAt : new Date(0).toISOString();

  return {
    model,
    reasoningEffort,
    updatedAt,
  };
}

function normalizePayload(value: unknown): LlmPreferencesPayload | null {
  if (!isRecord(value)) return null;
  if (value.version !== 1) return null;
  if (typeof value.activeProvider !== "string") return null;
  if (!isRecord(value.providers)) return null;

  const providers: Record<string, LlmProviderPreference> = {};
  for (const [provider, preference] of Object.entries(value.providers)) {
    const normalized = normalizeProviderPreference(preference);
    if (normalized) {
      providers[provider] = normalized;
    }
  }

  return {
    version: 1,
    activeProvider: value.activeProvider,
    providers,
  };
}

function writeLlmPreferences(payload: LlmPreferencesPayload, storage?: StorageLike): void {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return;
  resolvedStorage.setItem(profileStorageKey(LLM_PREFERENCES_STORAGE_KEY), JSON.stringify(payload));
}

export function loadLlmPreferences(storage?: StorageLike): LlmPreferencesPayload | null {
  const resolvedStorage = getStorage(storage);
  if (!resolvedStorage) return null;

  const raw = resolvedStorage.getItem(profileStorageKey(LLM_PREFERENCES_STORAGE_KEY));
  if (!raw) return null;

  try {
    const normalized = normalizePayload(JSON.parse(raw));
    if (!normalized) {
      resolvedStorage.removeItem(profileStorageKey(LLM_PREFERENCES_STORAGE_KEY));
      return null;
    }
    return normalized;
  } catch {
    resolvedStorage.removeItem(profileStorageKey(LLM_PREFERENCES_STORAGE_KEY));
    return null;
  }
}

export function saveLlmProviderPreference(
  provider: string,
  preference: Omit<LlmProviderPreference, "updatedAt"> & { updatedAt?: string },
  storage?: StorageLike,
): LlmPreferencesPayload {
  const existing = loadLlmPreferences(storage);
  const payload: LlmPreferencesPayload = {
    version: 1,
    activeProvider: provider,
    providers: {
      ...(existing?.providers ?? {}),
      [provider]: {
        model: preference.model,
        reasoningEffort: preference.reasoningEffort,
        updatedAt: preference.updatedAt ?? new Date().toISOString(),
      },
    },
  };

  writeLlmPreferences(payload, storage);
  return payload;
}

export function loadClaudeLlmPreference(storage?: StorageLike): ClaudeLlmPreference {
  const payload = loadLlmPreferences(storage);
  const preference = payload?.providers[DEFAULT_LLM_PROVIDER];
  const model = normalizeClaudeModel(preference?.model) ?? DEFAULT_CLAUDE_LLM_PREFERENCE.model;
  const rawEffort = preference?.reasoningEffort && isClaudeThinkingEffort(preference.reasoningEffort)
    ? preference.reasoningEffort
    : DEFAULT_CLAUDE_LLM_PREFERENCE.reasoningEffort;
  const reasoningEffort =
    normalizeClaudeThinkingEffortForModel(model, rawEffort) ??
    DEFAULT_CLAUDE_LLM_PREFERENCE.reasoningEffort;

  return {
    provider: "claude",
    model,
    reasoningEffort,
  };
}

export function saveClaudeLlmPreference(
  preference: {
    model?: ClaudeModel | null;
    reasoningEffort?: ClaudeThinkingEffort | null;
  },
  storage?: StorageLike,
): ClaudeLlmPreference {
  const current = loadClaudeLlmPreference(storage);
  const model = normalizeClaudeModel(preference.model) ?? current.model;
  const rawEffort = preference.reasoningEffort ?? current.reasoningEffort;
  const reasoningEffort =
    normalizeClaudeThinkingEffortForModel(model, rawEffort) ??
    DEFAULT_CLAUDE_LLM_PREFERENCE.reasoningEffort;

  saveLlmProviderPreference(
    DEFAULT_LLM_PROVIDER,
    {
      model,
      reasoningEffort,
    },
    storage,
  );

  return {
    provider: "claude",
    model,
    reasoningEffort,
  };
}
