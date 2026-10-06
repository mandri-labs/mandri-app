import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import en from "./en.json";
import fr from "./fr.json";
import commandsEn from "@/features/commands/en.json";
import commandsFr from "@/features/commands/fr.json";
import usageEn from "@/features/usage/en.json";
import usageFr from "@/features/usage/fr.json";

export type Locale = "fr" | "en";

const resources = {
  en: {
    translation: {
      ...en,
      commands: commandsEn,
      usage: usageEn,
      core: { ...en.core, route: { ...en.core.route, usage: usageEn.title } },
    },
  },
  fr: {
    translation: {
      ...fr,
      commands: commandsFr,
      usage: usageFr,
      core: { ...fr.core, route: { ...fr.core.route, usage: usageFr.title } },
    },
  },
};

export async function initI18n(initialLocale: Locale): Promise<typeof i18next> {
  if (!i18next.isInitialized) {
    await i18next.use(initReactI18next).init({
      resources,
      lng: initialLocale,
      fallbackLng: "en",
      supportedLngs: ["fr", "en"],
      interpolation: { escapeValue: false },
      react: { useSuspense: false },
    });
    return i18next;
  }
  await i18next.changeLanguage(initialLocale);
  return i18next;
}

export async function changeLocale(locale: Locale): Promise<void> {
  await i18next.changeLanguage(locale);
}

export default i18next;
