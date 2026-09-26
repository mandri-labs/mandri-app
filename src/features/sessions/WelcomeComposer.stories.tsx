import type { Meta, StoryObj } from "@storybook/react-vite";
import i18next from "i18next";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { fireEvent, within } from "@testing-library/react";
import type { CommandTransport } from "@/features/commands/service";
import { initI18n } from "@/i18n";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { WelcomeComposer } from "./WelcomeComposer";

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
  const previousStatus = connectionStore.getState().status;
  connectionStore.getState().setStatus("online");
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
    connectionStore.getState().setStatus(previousStatus);
  };
}

const HAPPY_ROUTES: StubRoute[] = [
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
    respond: () => ({
      status: 200,
      body: [{ name: "Dev", path: "D:/Dev", is_dir: true, size: null, modified_at: null }],
    }),
  },
  {
    match: (url) => url.includes("/v1/fs/list"),
    respond: () => ({
      status: 200,
      body: [{ name: "alpha", path: "D:/Dev/alpha", is_dir: true, size: null, modified_at: null }],
    }),
  },
  {
    match: (url) => url.endsWith("/v1/fs/projects"),
    respond: () => ({ status: 200, body: ["D:/Dev/alpha", "D:/Dev/beta"] }),
  },
  {
    match: (url) => url.endsWith("/v1/providers"),
    respond: () => ({
      status: 200,
      body: [{ name: "openrouter-main", kind: "openrouter", state: "verified" }],
    }),
  },
  {
    match: (url) => url.endsWith("/v1/providers/openrouter-main/models"),
    respond: () => ({
      status: 200,
      body: [
        {
          id: "z-ai/glm-5.3-flash",
          reasoning_efforts: ["low", "medium", "high"],
          default_effort: "medium",
        },
        {
          id: "anthropic/claude-sonnet-4",
          reasoning_efforts: [],
          default_effort: null,
        },
      ],
    }),
  },
];

const SESSION_PAYLOAD = {
  id: "9f1c2a34-5b6d-4e7f-8a90-b1c2d3e4f5a6",
  harness: "claude",
  gateway_route_id: "route-9",
  state: "live",
  project_path: "D:/Dev/alpha",
};

function SeedDefaults({ defaultModel }: { defaultModel?: string }) {
  useEffect(() => {
    preferencesStore.setState({
      defaultHarness: undefined,
      defaultModel,
    });
    return () => {
      preferencesStore.setState({ defaultHarness: undefined, defaultModel: undefined });
    };
  }, [defaultModel]);
  return null;
}

function fillComposer(text: string): void {
  const textarea = document.querySelector<HTMLTextAreaElement>(".composer textarea");
  if (textarea === null) {
    return;
  }
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
  setter?.call(textarea, text);
  textarea.dispatchEvent(new Event("input", { bubbles: true }));
}

function runSteps(steps: Array<() => void>): () => void {
  const timers = steps.map((step, index) => window.setTimeout(step, (index + 1) * 40));
  return () => {
    for (const timer of timers) {
      window.clearTimeout(timer);
    }
  };
}

const meta = {
  title: "Features/Sessions/WelcomeComposer",
  component: WelcomeComposer,
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta<typeof WelcomeComposer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <>
      <SeedDefaults defaultModel="openrouter-main/z-ai/glm-5.3-flash" />
      <div style={{ width: 720, padding: 24 }}>
        <WelcomeComposer />
      </div>
    </>
  ),
};

export const WithoutDefaults: Story = {
  render: () => (
    <>
      <SeedDefaults />
      <div style={{ width: 720, padding: 24 }}>
        <WelcomeComposer />
      </div>
    </>
  ),
};

export const NoRuntimes: Story = {
  render: () => (
    <>
      <SeedDefaults />
      <div style={{ width: 720, padding: 24 }}>
        <WelcomeComposer />
      </div>
    </>
  ),
  decorators: [
    (Story: () => ReactNode) => (
      <StoryWithFetch
        routes={[
          {
            match: (url) => url.endsWith("/v1/runtimes"),
            respond: () => ({ status: 503 }),
          },
        ]}
      >
        <Story />
      </StoryWithFetch>
    ),
  ],
};

function StoryWithFetch({
  routes,
  children,
}: {
  routes: StubRoute[];
  children: ReactNode;
}) {
  useEffect(() => withFetchStub(routes), [routes]);
  return <>{children}</>;
}

export const StartFailure: Story = {
  render: () => (
    <>
      <SeedDefaults />
      <div style={{ width: 720, padding: 24 }}>
        <WelcomeComposer />
      </div>
    </>
  ),
  decorators: [
    (Story: () => ReactNode) => (
      <StoryWithFetch
        routes={[
          ...HAPPY_ROUTES,
          {
            match: (url, method) => url.endsWith("/v1/runtime/sessions") && method === "POST",
            respond: () => ({
              status: 409,
              body: {
                error: {
                  code: "harness_not_installed",
                  message: "claude is not installed",
                  detail: {},
                },
              },
            }),
          },
        ]}
      >
        <AutoSubmit />
        <Story />
      </StoryWithFetch>
    ),
  ],
};

function AutoSubmit() {
  useEffect(
    () =>
      runSteps([
        () => {
          fireEvent.click(
            document.querySelector<HTMLButtonElement>('button[aria-label="Working folder"]') ??
              document.body,
          );
        },
        () => {
          const recent = document.querySelector<HTMLButtonElement>(
            '.folder-picker-row[title="D:/Dev/alpha"]',
          );
          recent?.click();
        },
        () => {
          fillComposer("Refactor the auth module and add tests");
        },
        () => {
          document.querySelector<HTMLButtonElement>(".composer-send")?.click();
        },
      ]),
    [],
  );
  return null;
}

export const StartedSuccess: Story = {
  render: () => (
    <>
      <SeedDefaults />
      <div style={{ width: 720, padding: 24 }}>
        <WelcomeComposer />
      </div>
    </>
  ),
  decorators: [
    (Story: () => ReactNode) => (
      <StoryWithFetch
        routes={[
          ...HAPPY_ROUTES,
          {
            match: (url, method) => url.endsWith("/v1/runtime/sessions") && method === "POST",
            respond: () => ({ status: 200, body: SESSION_PAYLOAD }),
          },
        ]}
      >
        <AutoSubmit />
        <Story />
      </StoryWithFetch>
    ),
  ],
};


const welcomeCommands: CommandTransport = {
  catalog: async () => ({ commands: [
    { id: "fixture:workspace-check", name: "workspace-check", description: "Check this project's conventions", aliases: [], kind: "command", argument_hint: "What should be checked?" },
    { id: "fixture:guide", name: "guide", description: "Use the workspace guide", aliases: [], kind: "skill" },
  ] }),
  invoke: async () => { throw new Error("This preview does not execute native commands"); },
  list: async () => [],
  cancel: async () => { throw new Error("No command is running in this preview"); },
};

function WelcomeCommandsPreview() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const restore = withFetchStub(HAPPY_ROUTES);
    setReady(true);
    return restore;
  }, []);
  return ready ? <div style={{ width: 720, maxWidth: "100%", padding: 24, paddingTop: 180 }}>
    <SeedDefaults />
    <WelcomeComposer commands={welcomeCommands} />
  </div> : null;
}

export const CommandsBeforeSession: Story = {
  parameters: {
    docs: { description: { story: "The welcome composer uses a discovered catalog before any session exists. These synthetic commands demonstrate the UI; execution requires choosing a working folder." } },
  },
  render: () => <WelcomeCommandsPreview />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findByText("Claude Code");
    fireEvent.change(canvas.getByRole("textbox"), { target: { value: "/" } });
    await canvas.findByRole("option", { name: /workspace-check/ });
  },
};
