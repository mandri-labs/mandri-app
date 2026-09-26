import { createStore } from "zustand/vanilla";
import { createJSONStorage, persist } from "zustand/middleware";
import { getPreferenceStorage } from "@/lib/platform/persist";
import {
  LOCAL_ENDPOINT,
  normalizeEndpointUrl,
  restoreEndpoints,
  type DaemonEndpoint,
} from "./endpoints";

export type LanguageSetting = "fr" | "en" | "auto";

export type ResolvedLanguage = "fr" | "en";

export type ThemeSetting = "dark" | "light";

export type LanguageResolver = () => ResolvedLanguage;

export const DEFAULT_DAEMON_BASE_URL = LOCAL_ENDPOINT.url;

export const PREFERENCES_STORAGE_KEY = "mandri.preferences";

export interface WindowGeometry {
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  maximized?: boolean;
}

export interface PreferencesData {
  theme: ThemeSetting;
  language: LanguageSetting;
  resolvedLanguage: ResolvedLanguage;
  daemonBaseUrl: string;
  endpoints: DaemonEndpoint[];
  selectedEndpointId: string;
  defaultHarness?: string;
  defaultModel?: string;
  defaultEffort?: string | null;
  approvalNotifications: boolean;
  closeToTray: boolean;
  windowGeometry?: WindowGeometry;
}

export interface PreferencesState extends PreferencesData {
  setTheme: (theme: ThemeSetting) => void;
  setLanguage: (language: LanguageSetting) => void;
  setLanguageResolver: (resolver: LanguageResolver) => void;
  setResolvedLanguage: (language: ResolvedLanguage) => void;
  setDaemonBaseUrl: (url: string) => void;
  setDefaultHarness: (harness?: string) => void;
  setDefaultModel: (model?: string) => void;
  setDefaultEffort: (effort: string | null) => void;
  saveEndpoint: (endpoint: DaemonEndpoint) => void;
  selectEndpoint: (id: string) => void;
  removeEndpoint: (id: string) => void;
  setApprovalNotifications: (enabled: boolean) => void;
  setCloseToTray: (enabled: boolean) => void;
  setWindowGeometry: (geometry?: WindowGeometry) => void;
  patch: (partial: Partial<PreferencesData>) => void;
}

function defaultLanguageResolver(): ResolvedLanguage {
  const locale = typeof navigator !== "undefined" ? navigator.language : "en";
  return locale.toLowerCase().startsWith("fr") ? "fr" : "en";
}

let languageResolver: LanguageResolver = defaultLanguageResolver;

export const preferencesStore = createStore<PreferencesState>()(
  persist(
    (set, get) => ({
      theme: "dark",
      language: "auto",
      resolvedLanguage: defaultLanguageResolver(),
      daemonBaseUrl: DEFAULT_DAEMON_BASE_URL,
      endpoints: [LOCAL_ENDPOINT],
      selectedEndpointId: LOCAL_ENDPOINT.id,
      approvalNotifications: true,
      closeToTray: true,
      setTheme: (theme) => {
        set({ theme });
      },
      setLanguage: (language) => {
        if (language === "auto") {
          set({ language, resolvedLanguage: languageResolver() });
          return;
        }
        set({ language, resolvedLanguage: language });
      },
      setLanguageResolver: (resolver) => {
        languageResolver = resolver;
      },
      setResolvedLanguage: (language) => {
        set({ resolvedLanguage: language });
      },
      setDaemonBaseUrl: (url) => {
        set(restoreEndpoints({ endpoints: get().endpoints, daemonBaseUrl: url }));
      },
      setDefaultHarness: (harness) => {
        const model = get().defaultModel;
        const incompatible =
          model?.startsWith("native:") && !model.startsWith(`native:${harness}/`);
        set({
          defaultHarness: harness,
          ...(incompatible ? { defaultModel: undefined, defaultEffort: null } : {}),
        });
      },
      setDefaultModel: (model) => {
        set({ defaultModel: model, defaultEffort: null });
      },
      setDefaultEffort: (effort) => set({ defaultEffort: effort }),
      saveEndpoint: (endpoint) => {
        const url = normalizeEndpointUrl(endpoint.url);
        if (endpoint.id === LOCAL_ENDPOINT.id || !endpoint.name.trim() || !url) return;
        const endpoints = get().endpoints;
        if (endpoints.some((row) => row.id !== endpoint.id && row.url === url)) return;
        const next = { ...endpoint, name: endpoint.name.trim(), url };
        set({
          endpoints: [...endpoints.filter((row) => row.id !== endpoint.id), next],
          ...(get().selectedEndpointId === endpoint.id ? { daemonBaseUrl: url } : {}),
        });
      },
      selectEndpoint: (id) => {
        const endpoint = get().endpoints.find((row) => row.id === id);
        if (endpoint) set({ selectedEndpointId: id, daemonBaseUrl: endpoint.url });
      },
      removeEndpoint: (id) => {
        if (id === LOCAL_ENDPOINT.id) return;
        set({
          endpoints: get().endpoints.filter((row) => row.id !== id),
          ...(get().selectedEndpointId === id
            ? { selectedEndpointId: LOCAL_ENDPOINT.id, daemonBaseUrl: LOCAL_ENDPOINT.url }
            : {}),
        });
      },
      setApprovalNotifications: (enabled) => {
        set({ approvalNotifications: enabled });
      },
      setCloseToTray: (enabled) => {
        set({ closeToTray: enabled });
      },
      setWindowGeometry: (geometry) => {
        set({ windowGeometry: geometry });
      },
      patch: (partial) => {
        set(partial);
      },
    }),
    {
      name: PREFERENCES_STORAGE_KEY,
      storage: createJSONStorage<Partial<PreferencesData>>(() => {
        const backing = getPreferenceStorage();
        return {
          getItem: (name) => backing.load(name),
          setItem: (name, value) => backing.save(name, value),
          removeItem: (name) => backing.remove(name),
        };
      }),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        daemonBaseUrl: state.daemonBaseUrl,
        defaultHarness: state.defaultHarness,
        defaultModel: state.defaultModel,
        defaultEffort: state.defaultEffort,
        endpoints: state.endpoints,
        selectedEndpointId: state.selectedEndpointId,
        approvalNotifications: state.approvalNotifications,
        closeToTray: state.closeToTray,
        windowGeometry: state.windowGeometry,
      }),
      merge: (persisted, current) => {
        const stored = (persisted ?? {}) as Partial<PreferencesData>;
        // Endpoint selection belongs to this webview, never to a desktop backup.
        // In particular, no localStorage selection always means Local.
        let deviceConnection: Partial<PreferencesData> = {};
        try {
          deviceConnection =
            JSON.parse(localStorage.getItem(PREFERENCES_STORAGE_KEY) ?? "null")?.state ?? {};
        } catch {
          /* A missing or malformed device preference falls back to Local. */
        }
        const merged: PreferencesState = {
          ...current,
          ...stored,
          ...restoreEndpoints(deviceConnection),
        };
        if (merged.language === "auto") {
          merged.resolvedLanguage = languageResolver();
        }
        return merged;
      },
    },
  ),
);
