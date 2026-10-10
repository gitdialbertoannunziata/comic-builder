import { useEffect, useSyncExternalStore } from "react";
import { getLanguage, setLanguage, subscribeLanguage, type Language } from "./i18n.js";
import { loadPreference, savePreference } from "./platform/session.js";

const saved = loadPreference<unknown>("language", "it");
setLanguage(saved === "en" ? "en" : "it");

export function useLanguage(): [Language, (value: Language) => void] {
  const language = useSyncExternalStore(subscribeLanguage, getLanguage, () => "it" as const);
  useEffect(() => {
    document.documentElement.lang = language;
    savePreference("language", language);
  }, [language]);
  return [language, setLanguage];
}