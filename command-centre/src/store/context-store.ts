import { create } from "zustand";

interface ContextStore {
  hasBrandContext: boolean | null;
  fetchContextStatus: (clientId?: string | null) => Promise<void>;
}

export const useContextStore = create<ContextStore>((set) => ({
  hasBrandContext: null,

  fetchContextStatus: async (clientId?: string | null) => {
    try {
      const url = clientId
        ? `/api/context/brand?clientId=${encodeURIComponent(clientId)}`
        : "/api/context/brand";
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      set({ hasBrandContext: data.hasBrandContext });
    } catch {
      // Silently fail — context status is non-critical
    }
  },
}));
