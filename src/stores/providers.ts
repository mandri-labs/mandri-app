import { createStore } from "zustand/vanilla";
import type { components } from "@/daemon/types/rest.gen";
import type { ServerMessage } from "@/daemon/types/ws";
import { createCachedSelector } from "@/app/useStore";
import { daemonIdentity } from "@/daemon/identity";

type ProviderOut = components["schemas"]["ProviderOut"];
type ProvidersInfoOut = components["schemas"]["ProvidersInfoOut"];
type RouteOut = components["schemas"]["RouteOut"];
type ModelOut = components["schemas"]["ModelOut"];

export type ModelCatalogEntry = ModelOut;

export const PROVIDER_KINDS = [
  "openrouter",
  "opencode",
  "opencode_go",
  "ollama",
  "lm_studio",
  "openai",
  "chatgpt",
  "anthropic",
  "gemini",
  "custom",
] as const;

export type ProviderKind = (typeof PROVIDER_KINDS)[number];

export const LOCAL_PROVIDER_KINDS: readonly ProviderKind[] = ["ollama", "lm_studio", "custom"];

export const HOSTED_PROVIDER_KINDS: readonly ProviderKind[] = [
  "openrouter",
  "opencode",
  "opencode_go",
  "openai",
  "chatgpt",
  "anthropic",
  "gemini",
];

export const ROUTE_FORMATS = ["anthropic", "openai", "gemini"] as const;

export function isLocalProviderKind(kind: string): boolean {
  return (LOCAL_PROVIDER_KINDS as readonly string[]).includes(kind);
}

export function isHostedProviderKind(kind: string): boolean {
  return (HOSTED_PROVIDER_KINDS as readonly string[]).includes(kind);
}

export type ProviderVerificationState = "unverified" | "verified" | "degraded" | "pending_auth";

export type CatalogState = "idle" | "loading" | "loaded" | "unavailable";

export interface ProviderView {
  name: string;
  kind: string;
  apiBase?: string;
  state: ProviderVerificationState;
  enabled?: boolean;
  authorizeUrl?: string;
  loginId?: string;
  modelCatalog?: ModelCatalogEntry[];
  catalogState: CatalogState;
}

export interface RouteView {
  id: string;
  providerName: string;
  modelRef: string;
  formats: string[];
  createdAt: number;
}

export interface ProvidersState {
  providers: Record<string, ProviderView>;
  routes: RouteView[];
  routesLoaded: boolean;
  hydrateProviders: (rows: readonly (ProviderOut | ProvidersInfoOut)[]) => void;
  upsertProvider: (row: ProviderOut | ProvidersInfoOut) => void;
  removeProvider: (name: string) => void;
  setVerification: (name: string, state: ProviderVerificationState) => void;
  setCatalog: (name: string, models: readonly ModelCatalogEntry[] | "unavailable") => void;
  setCatalogLoading: (name: string) => void;
  resetCatalog: (name: string) => void;
  setRoutes: (rows: readonly (RouteOut | RouteView)[]) => void;
  applyGatewayEvent: (frame: ServerMessage) => void;
  swapRouteModel: (routeId: string, model: string) => void;
}

export const providersStore = createStore<ProvidersState>()((set) => {
  function providerViewOf(
    row: ProviderOut | ProvidersInfoOut,
    existing?: ProviderView,
  ): ProviderView {
    return {
      name: row.name,
      kind: row.kind,
      apiBase: row.api_base ?? undefined,
      state: parseVerificationState(row.state),
      enabled: row.enabled ?? true,
      authorizeUrl:
        "authorize_url" in row ? (row.authorize_url ?? undefined) : existing?.authorizeUrl,
      loginId: "login_id" in row ? (row.login_id ?? undefined) : existing?.loginId,
      modelCatalog: existing?.modelCatalog,
      catalogState: existing?.catalogState ?? "idle",
    };
  }

  return {
    providers: {},
    routes: [],
    routesLoaded: false,

    hydrateProviders: (rows) => {
      set((state) => {
        const providers: Record<string, ProviderView> = {};
        for (const row of rows) {
          providers[row.name] = providerViewOf(row, state.providers[row.name]);
        }
        return { providers };
      });
    },

    upsertProvider: (row) => {
      set((state) => ({
        providers: {
          ...state.providers,
          [row.name]: providerViewOf(row),
        },
      }));
    },

    removeProvider: (name) => {
      set((state) => {
        if (state.providers[name] === undefined) {
          return state;
        }
        const providers = { ...state.providers };
        delete providers[name];
        return { providers };
      });
    },

    setVerification: (name, verificationState) => {
      set((state) => {
        const existing = state.providers[name];
        if (existing === undefined) {
          return state;
        }
        return {
          providers: {
            ...state.providers,
            [name]: { ...existing, state: verificationState },
          },
        };
      });
    },

    setCatalog: (name, models) => {
      set((state) => {
        const existing = state.providers[name];
        if (existing === undefined) {
          return state;
        }
        const updated: ProviderView =
          models === "unavailable"
            ? { ...existing, catalogState: "unavailable", modelCatalog: undefined }
            : { ...existing, catalogState: "loaded", modelCatalog: [...models] };
        return { providers: { ...state.providers, [name]: updated } };
      });
    },

    resetCatalog: (name) => {
      set((state) => {
        const provider = state.providers[name];
        if (!provider) return state;
        return {
          providers: {
            ...state.providers,
            [name]: { ...provider, catalogState: "idle", modelCatalog: undefined },
          },
        };
      });
    },

    setCatalogLoading: (name) => {
      set((state) => {
        const existing = state.providers[name];
        if (existing === undefined || existing.catalogState !== "idle") {
          return state;
        }
        return {
          providers: { ...state.providers, [name]: { ...existing, catalogState: "loading" } },
        };
      });
    },

    setRoutes: (rows) => {
      set({
        routes: rows.map(routeViewOf),
        routesLoaded: true,
      });
    },

    applyGatewayEvent: (frame) => {
      if (!("topic" in frame) || frame.topic !== "gateway.events" || !("raw" in frame)) {
        return;
      }
      const raw = asRecord(frame.raw);
      const event = raw?.["event"];
      if (typeof event !== "string") {
        return;
      }
      const routeId = raw?.["route_id"];
      const providerName = raw?.["provider_name"];
      if (event === "route_deleted") {
        if (typeof routeId !== "string") {
          return;
        }
        set((state) => ({
          routes: state.routes.filter((route) => route.id !== routeId),
        }));
        return;
      }
      if (event === "route_created" || event === "route_updated") {
        if (typeof routeId !== "string") {
          return;
        }
        set((state) => {
          const existing = state.routes.find((route) => route.id === routeId);
          if (existing !== undefined) {
            const routes = state.routes.map((route) =>
              route.id === routeId && typeof providerName === "string"
                ? { ...route, providerName }
                : route,
            );
            return { routes };
          }
          if (event !== "route_created") {
            return state;
          }
          return {
            routes: [
              ...state.routes,
              {
                id: routeId,
                providerName: typeof providerName === "string" ? providerName : "",
                modelRef: "",
                formats: [],
                createdAt: 0,
              },
            ],
          };
        });
      }
    },

    swapRouteModel: (routeId, model) => {
      set((state) => {
        const known = state.routes.some((route) => route.id === routeId);
        if (!known) {
          return state;
        }
        return {
          routes: state.routes.map((route) =>
            route.id === routeId ? { ...route, modelRef: model } : route,
          ),
        };
      });
    },
  };

  function parseVerificationState(value: string): ProviderVerificationState {
    return value === "verified" || value === "degraded" || value === "pending_auth"
      ? value
      : "unverified";
  }

  function routeViewOf(row: RouteOut | RouteView): RouteView {
    if ("providerName" in row) {
      return { ...row };
    }
    return {
      id: row.id,
      providerName: row.provider,
      modelRef: row.model_ref,
      formats: [...row.formats],
      createdAt: row.created_at,
    };
  }
});

daemonIdentity.subscribe(() => {
  providersStore.setState({ providers: {}, routes: [], routesLoaded: false });
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return undefined;
  }
  return value as Record<string, unknown>;
}

export const selectVerifiedProviders = createCachedSelector(
  (state: Pick<ProvidersState, "providers">) => state.providers,
  (providers) =>
    Object.values(providers).filter(
      (provider) => provider.enabled !== false && provider.state === "verified",
    ),
);

export function selectRoutesForProvider(
  state: Pick<ProvidersState, "routes">,
  name: string,
): RouteView[] {
  return state.routes.filter((route) => route.providerName === name);
}
