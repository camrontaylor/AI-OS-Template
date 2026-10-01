"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";
import {
  applyResolvedTheme,
  DEFAULT_THEME_PREFERENCE,
  loadThemePreference,
  parseThemePreference,
  resolveThemePreference,
  saveThemePreference,
  SYSTEM_THEME_MEDIA_QUERY,
  THEME_PREFERENCE_STORAGE_KEY,
  type ResolvedTheme,
  type ThemePreference,
} from "@/design-system/theme-preference";

interface ThemePreferenceContextValue {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
}

const ThemePreferenceContext = createContext<ThemePreferenceContextValue | null>(null);

function getSystemPrefersDark(): boolean {
  return window.matchMedia(SYSTEM_THEME_MEDIA_QUERY).matches;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const [preference, setPreferenceState] =
    useState<ThemePreference>(DEFAULT_THEME_PREFERENCE);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>("light");

  const applyPreference = useCallback(
    (nextPreference: ThemePreference, prefersDark = getSystemPrefersDark()) => {
      const nextResolvedTheme = resolveThemePreference(nextPreference, prefersDark);
      applyResolvedTheme(nextResolvedTheme);
      setResolvedTheme(nextResolvedTheme);
    },
    [],
  );

  useEffect(() => {
    const storedPreference = loadThemePreference();
    setPreferenceState(storedPreference);
    applyPreference(storedPreference);
  }, [applyPreference]);

  useEffect(() => {
    const mediaQuery = window.matchMedia(SYSTEM_THEME_MEDIA_QUERY);
    const handleSystemThemeChange = (event: MediaQueryListEvent) => {
      if (preference === "system") {
        applyPreference(preference, event.matches);
      }
    };

    mediaQuery.addEventListener("change", handleSystemThemeChange);
    return () => mediaQuery.removeEventListener("change", handleSystemThemeChange);
  }, [applyPreference, preference]);

  useEffect(() => {
    const handleStorageChange = (event: StorageEvent) => {
      if (event.key !== THEME_PREFERENCE_STORAGE_KEY) return;

      const nextPreference = parseThemePreference(event.newValue);
      setPreferenceState(nextPreference);
      applyPreference(nextPreference);
    };

    window.addEventListener("storage", handleStorageChange);
    return () => window.removeEventListener("storage", handleStorageChange);
  }, [applyPreference]);

  const setPreference = useCallback(
    (nextPreference: ThemePreference) => {
      saveThemePreference(nextPreference);
      setPreferenceState(nextPreference);
      applyPreference(nextPreference);
    },
    [applyPreference],
  );

  const value = useMemo(
    () => ({ preference, resolvedTheme, setPreference }),
    [preference, resolvedTheme, setPreference],
  );

  return (
    <ThemePreferenceContext.Provider value={value}>
      {children}
    </ThemePreferenceContext.Provider>
  );
}

export function useThemePreference(): ThemePreferenceContextValue {
  const context = useContext(ThemePreferenceContext);
  if (!context) {
    throw new Error("useThemePreference must be used within ThemeProvider");
  }
  return context;
}
