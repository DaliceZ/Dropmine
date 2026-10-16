import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { english } from "../locales/en";

type Language = "th" | "en";
type Theme = "light" | "dark";
type Preferences = { language: Language; theme: Theme };
type Translate = (
  source: string,
  values?: Record<string, string | number>,
) => string;
type ContextValue = Preferences & {
  setLanguage: (language: Language) => void;
  setTheme: (theme: Theme) => void;
  t: Translate;
};
const PreferencesContext = createContext<ContextValue | null>(null);

function initialPreferences(): Preferences {
  try {
    const value = JSON.parse(
      localStorage.getItem("dropmine.preferences") || "{}",
    );
    return {
      language: value?.language === "en" ? "en" : "th",
      theme: value?.theme === "dark" ? "dark" : "light",
    };
  } catch {
    return { language: "th", theme: "light" };
  }
}

export function PreferencesProvider({ children }: { children: ReactNode }) {
  const [preferences, setPreferences] = useState(initialPreferences);
  useLayoutEffect(() => {
    document.documentElement.lang = preferences.language;
    document.documentElement.dataset.theme = preferences.theme;
    document.title =
      preferences.language === "en"
        ? "Dropmine — Send files"
        : "Dropmine — ส่งไฟล์ถึงกัน";
    const color = preferences.theme === "light" ? "#f6f7f9" : "#0c0d0f";
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", color);
    try {
      localStorage.setItem("dropmine.preferences", JSON.stringify(preferences));
    } catch {
      return;
    }
  }, [preferences]);
  const t = useCallback<Translate>(
    (source, values) => {
      const text =
        preferences.language === "en" ? (english[source] ?? source) : source;
      return text.replace(/\{(\w+)\}/g, (match, key: string) =>
        String(values?.[key] ?? match),
      );
    },
    [preferences.language],
  );
  const value = useMemo<ContextValue>(
    () => ({
      ...preferences,
      t,
      setLanguage: (language) =>
        setPreferences((current) => ({ ...current, language })),
      setTheme: (theme) => setPreferences((current) => ({ ...current, theme })),
    }),
    [preferences, t],
  );
  return (
    <PreferencesContext.Provider value={value}>
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences() {
  const value = useContext(PreferencesContext);
  if (!value) throw new Error("PreferencesProvider is required");
  return value;
}
