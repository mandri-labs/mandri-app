import type { Meta, StoryObj } from "@storybook/react-vite";
import i18next from "i18next";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { initI18n } from "@/i18n";
import { DashboardPage } from "./DashboardPage";

void initI18n("en");

function StoryGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => i18next.isInitialized);
  useEffect(() => {
    const onReady = (): void => {
      setReady(true);
    };
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

interface StubRoute {
  match: (url: string, method: string) => boolean;
  respond: () => { status: number; body?: unknown };
}

function stubResponse(outcome: { status: number; body?: unknown }): Response {
  const text = outcome.body === undefined ? "" : JSON.stringify(outcome.body);
  return {
    ok: outcome.status >= 200 && outcome.status < 300,
    status: outcome.status,
    text: async () => text,
  } as unknown as Response;
}

function withFetchStub(routes: StubRoute[]): () => void {
  const original = window.fetch;
  const stub = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const method = init?.method ?? "GET";
    for (const route of routes) {
      if (route.match(url, method)) {
        return stubResponse(route.respond());
      }
    }
    return stubResponse({ status: 404 });
  };
  window.fetch = stub as typeof window.fetch;
  return () => {
    window.fetch = original;
  };
}

const DASHBOARD_ROUTES: StubRoute[] = [
  {
    match: (url) => url.endsWith("/v1/runtimes"),
    respond: () => ({
      status: 200,
      body: [
        { harness: "claude", installed: true, version: "2.1.0", degraded: false },
        { harness: "codex", installed: true, version: null, degraded: true },
        { harness: "opencode", installed: false, version: null, degraded: false },
      ],
    }),
  },
  {
    match: (url) => url.endsWith("/v1/fs/roots"),
    respond: () => ({ status: 200, body: [] }),
  },
  {
    match: (url) => url.endsWith("/v1/fs/projects"),
    respond: () => ({ status: 200, body: [] }),
  },
  {
    match: (url) => url.endsWith("/v1/providers"),
    respond: () => ({ status: 200, body: [] }),
  },
  {
    match: (url) => url.endsWith("/v1/sessions"),
    respond: () => ({ status: 200, body: [] }),
  },
];

function StubbedDashboard() {
  useEffect(() => withFetchStub(DASHBOARD_ROUTES), []);
  return <DashboardPage />;
}

const meta = {
  title: "Features/Sessions/DashboardPage",
  component: DashboardPage,
  parameters: { layout: "fullscreen" },
  decorators: [(Story: () => React.ReactNode) => <StoryGate>{<Story />}</StoryGate>],
} satisfies Meta<typeof DashboardPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Welcome: Story = {
  render: () => <StubbedDashboard />,
};
