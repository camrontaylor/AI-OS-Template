import { useClientStore } from "@/store/client-store";

/**
 * Returns the currently selected clientId from the store.
 * Components use this to append ?clientId= to API calls.
 */
export function useClientId(): string | null {
  return useClientStore((s) => s.selectedClientId);
}

/**
 * Append clientId query param to a URL if a client is selected.
 */
export function appendClientId(url: string, clientId: string | null): string {
  if (!clientId) return url;
  const separator = url.includes("?") ? "&" : "?";
  return `${url}${separator}clientId=${encodeURIComponent(clientId)}`;
}
