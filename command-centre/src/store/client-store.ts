import { create } from "zustand";
import type { Client } from "@/types/client";
import { profileStorageKey } from "../lib/profile-storage";

const STORAGE_KEY_PREFIX = "command-centre-client:";
let clientsFetchGeneration = 0;

interface PersistedClientState {
  activeClientSlugs?: string[] | null;
  selectedClientId?: string | null;
}

interface ClientsResponse {
  clients?: Client[];
  rootName?: string;
  workspaceId?: string;
}

interface ClientStore {
  clients: Client[];
  rootName: string;
  workspaceId: string | null;
  /**
   * Feed-only visibility filter.
   * null  = show all clients in Feed
   * []    = show nothing
   * [...] = show only the listed client slugs (supports "_root")
   */
  activeClientSlugs: string[] | null;
  /**
   * Global app scope used by workspace-level UI like cron, docs, and context.
   * null = root workspace / all clients
   */
  selectedClientId: string | null;
  isLoading: boolean;
  error: string | null;

  fetchClients: () => Promise<void>;
  toggleClient: (slug: string) => void;
  setAllActive: () => void;
  isClientActive: (slug: string) => boolean;
  setSelectedClient: (clientId: string | null) => void;
  getSelectedClient: () => Client | null;
}

function normalizeClientId(clientId: string | null | undefined): string | null {
  if (!clientId || clientId === "root") {
    return null;
  }
  return clientId;
}

function normalizeFeedScopeSlug(slug: string | null | undefined): string | null {
  if (!slug) {
    return null;
  }
  if (slug === "_root" || slug === "root") {
    return "_root";
  }
  return normalizeClientId(slug);
}

function getDefaultFeedScope(clientId: string | null): string[] | null {
  return clientId ? [clientId] : null;
}

function getStorageKey(workspaceId: string): string {
  return profileStorageKey(`${STORAGE_KEY_PREFIX}${workspaceId}`);
}

function isBrowser(): boolean {
  return typeof window !== "undefined";
}

function loadPersistedClientState(workspaceId: string): PersistedClientState | null {
  if (!isBrowser()) {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(getStorageKey(workspaceId));
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as PersistedClientState;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

function savePersistedClientState(
  workspaceId: string,
  state: Pick<ClientStore, "activeClientSlugs" | "selectedClientId">
): void {
  if (!isBrowser()) {
    return;
  }

  try {
    window.localStorage.setItem(
      getStorageKey(workspaceId),
      JSON.stringify({
        activeClientSlugs: state.activeClientSlugs,
        selectedClientId: state.selectedClientId,
      })
    );
  } catch {
    // Ignore storage failures and keep the in-memory state working.
  }
}

function persistClientPreferences(
  state: Pick<ClientStore, "workspaceId" | "activeClientSlugs" | "selectedClientId">
): void {
  if (!state.workspaceId) {
    return;
  }

  savePersistedClientState(state.workspaceId, state);
}

function sanitizePersistedState(
  persisted: PersistedClientState | null,
  clients: Client[]
): Pick<ClientStore, "activeClientSlugs" | "selectedClientId"> {
  const validClientSlugs = new Set(clients.map((client) => client.slug));
  const requestedClientId = normalizeClientId(persisted?.selectedClientId ?? null);
  const selectedClientId =
    requestedClientId && validClientSlugs.has(requestedClientId)
      ? requestedClientId
      : null;

  const rawScope = persisted?.activeClientSlugs;
  if (rawScope === undefined) {
    return {
      selectedClientId,
      activeClientSlugs: getDefaultFeedScope(selectedClientId),
    };
  }

  if (rawScope === null) {
    return {
      selectedClientId,
      activeClientSlugs: null,
    };
  }

  if (!Array.isArray(rawScope)) {
    return {
      selectedClientId,
      activeClientSlugs: getDefaultFeedScope(selectedClientId),
    };
  }

  if (rawScope.length === 0) {
    return {
      selectedClientId,
      activeClientSlugs: [],
    };
  }

  const filteredScope = Array.from(
    new Set(
      rawScope
        .map((slug) => normalizeFeedScopeSlug(slug))
        .filter((slug): slug is string => {
          if (!slug) return false;
          if (slug === "_root") return true;
          return validClientSlugs.has(slug);
        })
    )
  );

  if (filteredScope.length === 0) {
    return {
      selectedClientId,
      activeClientSlugs: getDefaultFeedScope(selectedClientId),
    };
  }

  return {
    selectedClientId,
    activeClientSlugs: filteredScope,
  };
}

export const useClientStore = create<ClientStore>((set, get) => ({
  clients: [],
  rootName: "Root",
  workspaceId: null,
  activeClientSlugs: null,
  selectedClientId: null,
  isLoading: false,
  error: null,

  fetchClients: async () => {
    const generation = ++clientsFetchGeneration;
    set({ isLoading: true, error: null });
    try {
      const res = await fetch("/api/clients");
      if (!res.ok) throw new Error("Failed to fetch clients");
      const data = await res.json() as Client[] | ClientsResponse;
      if (generation !== clientsFetchGeneration) return;

      if (Array.isArray(data)) {
        set({
          clients: data,
          rootName: "Root",
          workspaceId: null,
          selectedClientId: null,
          activeClientSlugs: null,
          isLoading: false,
        });
        return;
      }

      const clients = data.clients ?? [];
      const rootName = data.rootName ?? "Root";
      const workspaceId = data.workspaceId ?? null;
      const persisted = workspaceId ? loadPersistedClientState(workspaceId) : null;
      const sanitized = sanitizePersistedState(persisted, clients);

      set({
        clients,
        rootName,
        workspaceId,
        selectedClientId: sanitized.selectedClientId,
        activeClientSlugs: sanitized.activeClientSlugs,
        isLoading: false,
      });

      if (workspaceId) {
        savePersistedClientState(workspaceId, sanitized);
      }
    } catch (err) {
      if (generation !== clientsFetchGeneration) return;
      set({
        error: err instanceof Error ? err.message : "Unknown error",
        isLoading: false,
      });
    }
  },

  toggleClient: (slug: string) => {
    const { activeClientSlugs, clients } = get();
    const allSlugs = ["_root", ...clients.map((c) => c.slug)];

    let next: string[] | null;
    if (activeClientSlugs === null) {
      next = allSlugs.filter((value) => value !== slug);
    } else if (activeClientSlugs.includes(slug)) {
      next = activeClientSlugs.filter((value) => value !== slug);
    } else {
      next = [...activeClientSlugs, slug];
    }

    const nextSelection = next;
    if (Array.isArray(nextSelection) && allSlugs.every((value) => nextSelection.includes(value))) {
      next = null;
    }

    set({ activeClientSlugs: next });
    persistClientPreferences(get());
  },

  setAllActive: () => {
    set({ activeClientSlugs: null });
    persistClientPreferences(get());
  },

  isClientActive: (slug: string) => {
    const { activeClientSlugs } = get();
    if (activeClientSlugs === null) return true;
    return activeClientSlugs.includes(slug);
  },

  setSelectedClient: (clientId: string | null) => {
    const normalized = normalizeClientId(clientId);
    set({
      selectedClientId: normalized,
      activeClientSlugs: getDefaultFeedScope(normalized),
    });
    persistClientPreferences(get());
  },

  getSelectedClient: () => {
    const { clients, selectedClientId } = get();
    if (!selectedClientId) return null;
    return clients.find((c) => c.slug === selectedClientId) || null;
  },
}));
