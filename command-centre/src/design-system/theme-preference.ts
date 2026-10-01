export const THEME_PREFERENCE_STORAGE_KEY = "cc.theme-preference:v1";
export const SYSTEM_THEME_MEDIA_QUERY = "(prefers-color-scheme: dark)";

export type ThemePreference = "system" | "light" | "dark";
export type ResolvedTheme = "light" | "dark";

export const DEFAULT_THEME_PREFERENCE: ThemePreference = "system";

type ThemeStorage = Pick<Storage, "getItem" | "setItem">;
type ThemeRoot = Pick<HTMLElement, "dataset">;

function getBrowserStorage(): ThemeStorage | null {
  if (typeof window === "undefined") return null;
  return window.localStorage;
}

export function isThemePreference(value: unknown): value is ThemePreference {
  return value === "system" || value === "light" || value === "dark";
}

export function parseThemePreference(value: unknown): ThemePreference {
  return isThemePreference(value) ? value : DEFAULT_THEME_PREFERENCE;
}

export function loadThemePreference(storage?: ThemeStorage): ThemePreference {
  const resolvedStorage = storage ?? getBrowserStorage();
  if (!resolvedStorage) return DEFAULT_THEME_PREFERENCE;

  try {
    return parseThemePreference(resolvedStorage.getItem(THEME_PREFERENCE_STORAGE_KEY));
  } catch {
    return DEFAULT_THEME_PREFERENCE;
  }
}

export function saveThemePreference(
  preference: ThemePreference,
  storage?: ThemeStorage,
): void {
  const resolvedStorage = storage ?? getBrowserStorage();
  if (!resolvedStorage) return;

  try {
    resolvedStorage.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
  } catch {
    // Theme changes still apply for the current tab when storage is unavailable.
  }
}

export function resolveThemePreference(
  preference: ThemePreference,
  prefersDark: boolean,
): ResolvedTheme {
  if (preference === "system") {
    return prefersDark ? "dark" : "light";
  }
  return preference;
}

export function applyResolvedTheme(
  resolvedTheme: ResolvedTheme,
  root?: ThemeRoot,
): void {
  const resolvedRoot =
    root ?? (typeof document !== "undefined" ? document.documentElement : null);
  if (!resolvedRoot) return;
  resolvedRoot.dataset.theme = resolvedTheme;
}

const storageKeyLiteral = JSON.stringify(THEME_PREFERENCE_STORAGE_KEY);
const mediaQueryLiteral = JSON.stringify(SYSTEM_THEME_MEDIA_QUERY);

export const THEME_BOOTSTRAP_SCRIPT = `
(() => {
  let preference = "system";
  let prefersDark = false;

  try {
    const stored = window.localStorage.getItem(${storageKeyLiteral});
    if (stored === "system" || stored === "light" || stored === "dark") {
      preference = stored;
    }
  } catch {}

  try {
    prefersDark = window.matchMedia(${mediaQueryLiteral}).matches;
  } catch {}

  document.documentElement.dataset.theme =
    preference === "dark" || (preference === "system" && prefersDark)
      ? "dark"
      : "light";
})();
`;
