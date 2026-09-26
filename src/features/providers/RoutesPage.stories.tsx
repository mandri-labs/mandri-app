import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import i18next from "i18next";
import { providersStore } from "@/stores/providers";
import type { ProviderView, RouteView } from "@/stores/providers";
import { RoutesPage } from "./RoutesPage";

const providerVerified: ProviderView = {
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

const routeStable: RouteView = {
  id: "3f9c2a10-77b1-4c8e-9a21-5f0d2b6c8e41",
  providerName: "openrouter-main",
  modelRef: "openrouter-main/deepseek/deepseek-chat",
  formats: ["anthropic", "openai"],
  createdAt: 1757083200,
};

const routeManual: RouteView = {
  id: "8b41e6d2-19cf-4a57-b3e0-6c9d1a4f7b52",
  providerName: "ollama-local",
  modelRef: "ollama-local/llama3:70b",
  formats: ["gemini"],
  createdAt: 1757083300,
};

function seedStore(providers: ProviderView[], routes: RouteView[]): void {
  providersStore.setState({
    providers: Object.fromEntries(providers.map((provider) => [provider.name, provider])),
    routes,
    routesLoaded: true,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

function useFetchStub(routes: RouteView[]): void {
  useEffect(() => {
    const original = globalThis.fetch;
    const providersPayload = [providerVerified, providerDegraded].map((provider) => ({
      name: provider.name,
      kind: provider.kind,
      api_base: provider.apiBase ?? null,
      state: provider.state,
    }));
    globalThis.fetch = (async (input: RequestInfo | URL) => {
      const url = String(input);
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
      return jsonResponse({ error: { code: "unknown", message: "not stubbed", detail: {} } }, 500);
    }) as typeof fetch;
    return () => {
      globalThis.fetch = original;
    };
  });
}

function StubbedRoutesPage({ providers, routes }: { providers: ProviderView[]; routes: RouteView[] }) {
  useFetchStub(routes);
  useEffect(() => {
    seedStore(providers, routes);
  }, [providers, routes]);
  return <RoutesPage />;
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
  title: "Features/Providers/RoutesPage",
  component: RoutesPage,
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta<typeof RoutesPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const RoutesList: Story = {
  render: () => (
    <StubbedRoutesPage providers={[providerVerified, providerDegraded]} routes={[routeStable, routeManual]} />
  ),
};

export const EmptyRoutes: Story = {
  render: () => <StubbedRoutesPage providers={[providerVerified]} routes={[]} />,
};

export const CreateRouteDialog: Story = {
  render: () => {
    seedStore([providerVerified], [routeStable]);
    return <RoutesPage />;
  },
};

export const SwapFromCatalog: Story = {
  render: () => (
    <StubbedRoutesPage providers={[providerVerified, providerDegraded]} routes={[routeStable]} />
  ),
};

export const SwapManualEntry: Story = {
  render: () => (
    <StubbedRoutesPage providers={[providerVerified]} routes={[routeManual]} />
  ),
};
