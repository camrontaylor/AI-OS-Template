import type { BrowserLocalProfileV1 } from "./local-profile";

export const ACTIVE_PROFILE_MARKER_KEY = "cc.active-profile:v1";

declare global {
  interface Window {
    __COMMAND_CENTRE_PROFILE__?: BrowserLocalProfileV1;
  }
}

const SOLO_BROWSER_PROFILE: BrowserLocalProfileV1 = Object.freeze({
  version: 1,
  mode: "solo",
  profileKey: "solo",
  sessionId: "uninitialized",
});

export function getBrowserLocalProfile(): BrowserLocalProfileV1 {
  if (typeof window === "undefined") return SOLO_BROWSER_PROFILE;
  const profile = window.__COMMAND_CENTRE_PROFILE__;
  if (
    profile?.version === 1 &&
    (profile.mode === "solo" || profile.mode === "team") &&
    typeof profile.profileKey === "string" &&
    typeof profile.sessionId === "string"
  ) {
    return profile;
  }
  return SOLO_BROWSER_PROFILE;
}

export function profileStorageKey(key: string): string {
  const profile = getBrowserLocalProfile();
  return profile.mode === "solo"
    ? key
    : `cc.profile:v1:${profile.profileKey}:${key}`;
}

export function notifyLocalProfileChange(nextProfile: BrowserLocalProfileV1): boolean {
  if (typeof window === "undefined") return false;
  const current = getBrowserLocalProfile();
  if (current.profileKey === nextProfile.profileKey && current.sessionId === nextProfile.sessionId) return false;
  purgeBrowserProfileStorage(current);
  window.localStorage.setItem(ACTIVE_PROFILE_MARKER_KEY, JSON.stringify(nextProfile));
  window.location.reload();
  return true;
}

export function purgeBrowserProfileStorage(
  profile: BrowserLocalProfileV1 = getBrowserLocalProfile(),
): void {
  if (typeof window === "undefined" || profile.mode !== "team") return;
  const prefix = `cc.profile:v1:${profile.profileKey}:`;
  for (const storage of [window.localStorage, window.sessionStorage]) {
    const keys: string[] = [];
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index);
      if (key?.startsWith(prefix)) keys.push(key);
    }
    for (const key of keys) storage.removeItem(key);
  }
}
