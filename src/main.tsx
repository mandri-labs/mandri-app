import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./design/fonts";
import "./design/tokens.css";
import "./design/theme.css";
import { App } from "@/app/App";
import { initApprovalNotifications } from "@/app/notificationBridge";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { detectLocale } from "@/lib/platform/locale";
import { whenPreferenceStorageReady } from "@/lib/platform/persist";
import { initWindowGeometry, setCloseToTray } from "@/lib/platform/window";
import { initI18n } from "@/i18n";
import { appLog } from "@/lib/platform/log";
import { createDebugLogger, isDebugLoggingEnabled } from "@/lib/debug";

const log = createDebugLogger("app");

async function bootstrap(): Promise<void> {
  void appLog("info", "mandri app starting");
  log.info("bootstrap starting", {
    debugLogging: isDebugLoggingEnabled(),
    href: window.location.href,
  });
  await whenPreferenceStorageReady();
  const detected = await detectLocale();
  const prefs = preferencesStore.getState();
  prefs.setLanguageResolver(() => detected);
  const resolved = prefs.language === "fr" || prefs.language === "en" ? prefs.language : detected;
  prefs.setResolvedLanguage(resolved);
  await initI18n(resolved);
  document.documentElement.dataset.theme = prefs.theme;
  initApprovalNotifications();
  createRoot(document.getElementById("root") as HTMLElement).render(
    <StrictMode>
      <App />
    </StrictMode>,
  );
  setCloseToTray(preferencesStore.getState().closeToTray);
  preferencesStore.subscribe((state, previous) => {
    if (state.theme !== previous.theme) {
      document.documentElement.dataset.theme = state.theme;
    }
    if (state.closeToTray !== previous.closeToTray) {
      setCloseToTray(state.closeToTray);
    }
  });
  void initWindowGeometry();
  try {
    const { connectDaemon } = await import("./app/connection");
    log.info("connecting to daemon", { baseUrl: preferencesStore.getState().daemonBaseUrl });
    connectDaemon();
  } catch (error) {
    log.error("daemon connection bootstrap failed", {
      message: error instanceof Error ? error.message : String(error),
    });
    connectionStore.getState().setStatus("offline");
  }
}

void bootstrap();
