import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import i18next from "i18next";
import { providersStore } from "@/stores/providers";
import type { ProviderView, RouteView } from "@/stores/providers";
import { ModelCatalog } from "./ModelCatalog";
import { ProviderFormDialog } from "./ProviderForm";
import { ProvidersPage } from "./ProvidersPage";

const providerHosted: ProviderView = {
  name: "openrouter-main",
  kind: "openrouter",
  state: "verified",
  catalogState: "loaded",
  modelCatalog: [
    { id: "deepseek/deepseek-chat", reasoning_efforts: [], default_effort: null },
    {
      id: "anthropic/claude-sonnet-4",
      reasoning_efforts: ["low", "medium", "high"],
      default_effort: "medium",
    },
  ],
};

const providerDegraded: ProviderView = {
  name: "ollama-local",
  kind: "ollama",
  apiBase: "http://127.0.0.1:11434",
  state: "degraded",
  catalogState: "idle",
};

const providerUnverified: ProviderView = {
  name: "lm-studio",
  kind: "lm_studio",
  apiBase: "http://127.0.0.1:1234",
  state: "unverified",
  catalogState: "idle",
};

const providerNoCatalog: ProviderView = {
  name: "custom-bridge",
  kind: "custom",
  apiBase: "http://127.0.0.1:9000",
  state: "verified",
  catalogState: "unavailable",
};

const routes: RouteView[] = [
  {
    id: "3f9c2a10-77b1-4c8e-9a21-5f0d2b6c8e41",
    providerName: "openrouter-main",
    modelRef: "openrouter-main/deepseek/deepseek-chat",
    formats: ["anthropic", "openai"],
    createdAt: 1757083200,
  },
];

function seedStore(providers: ProviderView[], storeRoutes: RouteView[]): void {
  providersStore.setState({
    providers: Object.fromEntries(providers.map((provider) => [provider.name, provider])),
    routes: storeRoutes,
    routesLoaded: true,
  });
}

interface FetchStub {
  match: (url: string, init: RequestInit) => Response | undefined;
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const providersPayload = [providerHosted, providerDegraded, providerUnverified, providerNoCatalog].map(
  (provider) => ({
    name: provider.name,
    kind: provider.kind,
    api_base: provider.apiBase ?? null,
    state: provider.state,
  }),
);

const baseStub: FetchStub = {
  match: (url) => {
    if (url.endsWith("/v1/providers")) {
      return jsonResponse(providersPayload);
    }
    if (url.endsWith("/v1/gateway/info")) {
      return jsonResponse({
        providers: providersPayload,
        routes: routes.map((route) => ({
          id: route.id,
          provider: route.providerName,
          model_ref: route.modelRef,
          formats: route.formats,
          created_at: route.createdAt,
        })),
      });
    }
    return undefined;
  },
};

function useFetchStub(stub: FetchStub): void {
  useEffect(() => {
    const original = globalThis.fetch;
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const matched = stub.match(String(input), init ?? new Request("http://localhost"));
      if (matched !== undefined) {
        return matched;
      }
      return jsonResponse({ error: { code: "unknown", message: "not stubbed", detail: {} } }, 500);
    }) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  });
}

function StubbedPage({
  providers,
  storeRoutes,
  stub,
}: {
  providers: ProviderView[];
  storeRoutes: RouteView[];
  stub?: FetchStub;
}) {
  useFetchStub(stub ?? baseStub);
  useEffect(() => {
    seedStore(providers, storeRoutes);
  }, [providers, storeRoutes]);
  return <ProvidersPage />;
}

function StoryGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => i18next.isInitialized);
  useEffect(() => {
    const onReady = (): void => setReady(true);
    if (i18next.isInitialized) {
      setReady(true);
      return;
    }
    i18next.on("initialized", onReady);
    return () => {
      i18next.off("initialized", onReady);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

const meta = {
  title: "Features/Providers/ProvidersPage",
  component: ProvidersPage,
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta<typeof ProvidersPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ListStates: Story = {
  render: () => <StubbedPage providers={[providerHosted, providerDegraded, providerUnverified, providerNoCatalog]} storeRoutes={routes} />,
};

export const Empty: Story = {
  render: () => <StubbedPage providers={[]} storeRoutes={[]} />,
};

export const FormDialogBlank: Story = {
  render: () => {
    seedStore([providerHosted], routes);
    return (
      <div className="providers-page">
        <ProviderFormDialog open onSaved={() => undefined} onClose={() => undefined} />
      </div>
    );
  },
};

export const FormDialogLocalKind: Story = {
  render: () => {
    seedStore([providerDegraded], routes);
    return (
      <div className="providers-page">
        <ProviderFormDialog
          open
          provider={providerDegraded}
          onSaved={() => undefined}
          onClose={() => undefined}
        />
      </div>
    );
  },
};

export const FormDialogValidationErrors: Story = {
  render: () => {
    seedStore([providerHosted], routes);
    return (
      <div className="providers-page">
        <ProviderFormDialog open onSaved={() => undefined} onClose={() => undefined} />
      </div>
    );
  },
};

export const FormDialogInUseRefusal: Story = {
  render: () => (
    <StubbedPage
      providers={[providerHosted]}
      storeRoutes={routes}
      stub={{
        match: (url, init) => {
          if (url.endsWith("/v1/providers/openrouter-main") && init.method === "DELETE") {
            return jsonResponse(
              {
                error: {
                  code: "provider_in_use",
                  message: "provider still serves routes",
                  detail: { route_ids: [routes[0]?.id] },
                },
              },
              409,
            );
          }
          return baseStub.match(url, init);
        },
      }}
    />
  ),
};

export const CatalogLoaded: Story = {
  render: () => (
    <div className="providers-page">
      <div className="providers-item">
        <ModelCatalog defaultExpanded provider={providerHosted} onUseModel={() => undefined} />
      </div>
    </div>
  ),
};

export const CatalogUnavailable: Story = {
  render: () => (
    <div className="providers-page">
      <div className="providers-item">
        <ModelCatalog defaultExpanded provider={providerNoCatalog} onUseModel={() => undefined} />
      </div>
    </div>
  ),
};

export const CatalogLoading: Story = {
  render: () => (
    <div className="providers-page">
      <div className="providers-item">
        <ModelCatalog
          defaultExpanded
          provider={{ ...providerDegraded, catalogState: "loading" }}
          onUseModel={() => undefined}
        />
      </div>
    </div>
  ),
};
