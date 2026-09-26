import { isTauri } from "./index";

export type AppLocale = "fr" | "en";

function fromLocaleTag(tag: string): AppLocale {
  return tag.toLowerCase().startsWith("fr") ? "fr" : "en";
}

export async function detectLocale(): Promise<AppLocale> {
  if (isTauri()) {
    try {
      const { locale } = await import("@tauri-apps/plugin-os");
      const tag = (await locale()) ?? navigator.language;
      return fromLocaleTag(tag);
    } catch {
      return fromLocaleTag(navigator.language);
    }
  }
  return fromLocaleTag(navigator.language);
}
