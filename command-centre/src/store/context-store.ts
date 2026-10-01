import { create } from "zustand";

type BrandContextScopeKey = "root" | `client:${string}`;

interface BrandContextStateSnapshot {
  hasBrandContext: boolean | null;
  brandContextByScope: Record<string, boolean | null | undefined>;
}

interface ContextStore {
  /** Root workspace brand-context status. Kept for backwards-compatible selectors. */
  hasBrandContext: boolean | null;
  brandContextByScope: Record<string, boolean | null | undefined>;
  getHasBrandContext: (clientId?: string | null) => boolean | null;
  fetchContextStatus: (clientId?: string | null) => Promise<void>;
}

export function getBrandContextScopeKey(clientId?: string | null): BrandContextScopeKey {
  const normalized = clientId && clientId !== "root" ? clientId : null;
  return normalized ? `client:${normalized}` : "root";
}

export function selectHasBrandContextForScope(
  state: BrandContextStateSnapshot,
  clientId?: string | null,
): boolean | null {
  const key = getBrandContextScopeKey(clientId);
  const scoped = state.brandContextByScope[key];
  if (scoped === true || scoped === false) return scoped;
  if (key === "root") return state.hasBrandContext;
  return null;
}

export const useContextStore = create<ContextStore>((set, get) => ({
  hasBrandContext: null,
  brandContextByScope: {},

  getHasBrandContext: (clientId?: string | null) => selectHasBrandContextForScope(get(), clientId),

  fetchContextStatus: async (clientId?: string | null) => {
    try {
      const scopeKey = getBrandContextScopeKey(clientId);
      const url = clientId
        ? `/api/context/brand?clientId=${encodeURIComponent(clientId)}`
        : "/api/context/brand";
      const res = await fetch(url);
      if (!res.ok) return;
      const data = await res.json();
      const hasBrandContext = data.hasBrandContext === true;

      set((state) => {
        const brandContextByScope = {
          ...state.brandContextByScope,
          [scopeKey]: hasBrandContext,
        };

        return scopeKey === "root"
          ? { hasBrandContext, brandContextByScope }
          : { brandContextByScope };
      });
    } catch {
      // Silently fail — context status is non-critical
    }
  },
}));
