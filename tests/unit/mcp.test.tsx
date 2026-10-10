import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { initI18n } from "@/i18n";
import { McpPage } from "@/features/mcp/McpPage";
import { McpStatus } from "@/features/mcp/McpStatus";
import { McpAttention } from "@/features/mcp/McpAttention";
import { McpForm } from "@/features/mcp/McpForm";
import { secretChanges, secretEntries } from "@/features/mcp/SecretFields";
import { mcpStore, refreshMcp, ingestMcpFrame, watchMcp } from "@/stores/mcp";
import { openMcpAuthorizationUrl } from "@/lib/platform/externalUrl";
import { connectionStore } from "@/stores/connection";
import { selectDaemon } from "@/daemon/identity";
import { listMcpServers, updateMcpServer, type McpServer } from "@/daemon/rest/mcp";

vi.mock("@/daemon/rest/mcp", () => ({
  listMcpServers: vi.fn(),
  createMcpServer: vi.fn(),
  updateMcpServer: vi.fn(),
}));

const server: McpServer = {
  id: "8d137bdc-8bdc-469f-b42a-36b7b04a88df",
  revision: 1,
  name: "local",
  transport: "stdio",
  command: "fixture",
  args: ["--path", "/a path with spaces"],
  enabled: true,
  state: "ready",
  env_keys: ["TOKEN"],
  header_keys: [],
  env_refs: {},
  auth: "none",
  allow_protected: false,
  startup_timeout: 15,
  call_timeout: 60,
  tools: 1,
  resources: 0,
  prompts: 0,
};

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  vi.clearAllMocks();
  selectDaemon("http://127.0.0.1:8787");
  mcpStore.setState({ servers: [], revision: -1, loaded: false, error: null });
});
afterEach(cleanup);

it("shows attention without opening the MCP panel and clears it after recovery", () => {
  render(<McpAttention />);
  expect(screen.queryByRole("img")).toBeNull();
  act(() =>
    mcpStore.getState().hydrate({
      revision: 1,
      servers: [{ ...server, state: "error", error: "Server did not respond" }],
    }),
  );
  expect(screen.getByRole("img")).toBeTruthy();
  act(() =>
    mcpStore.getState().hydrate({ revision: 2, servers: [{ ...server, state: "reconnecting" }] }),
  );
  expect(screen.queryByRole("img")).toBeNull();
  act(() => mcpStore.getState().hydrate({ revision: 3, servers: [server] }));
  expect(screen.queryByRole("img")).toBeNull();
  act(() =>
    mcpStore.getState().hydrate({
      revision: 4,
      servers: [{ ...server, enabled: false, state: "error" }],
    }),
  );
  expect(screen.queryByRole("img")).toBeNull();
});

it("ignores responses from a previously selected daemon", async () => {
  let finish!: (snapshot: { revision: number; servers: McpServer[] }) => void;
  vi.mocked(listMcpServers).mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const old = refreshMcp();
  selectDaemon("http://other:8787");
  vi.mocked(listMcpServers).mockResolvedValueOnce({
    revision: 1,
    servers: [{ ...server, name: "other" }],
  });
  await refreshMcp();
  finish({ revision: 100, servers: [server] });
  await old;
  expect(mcpStore.getState().servers.map((row) => row.name)).toEqual(["other"]);
});

it("fetches the latest event revision when an event arrives during hydration", async () => {
  let finish!: (snapshot: { revision: number; servers: McpServer[] }) => void;
  vi.mocked(listMcpServers)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ revision: 2, servers: [server] });
  const request = refreshMcp();
  ingestMcpFrame({ topic: "mcp.events", seq: 2, source: "mandri", ts: 1, raw: { revision: 2 } });
  finish({ revision: 1, servers: [] });
  await request;
  expect(mcpStore.getState().revision).toBe(2);
  expect(listMcpServers).toHaveBeenCalledTimes(2);
});

it("keeps masked secrets unless explicitly changed or removed", () => {
  const entries = secretEntries(["TOKEN", "OLD"]);
  expect(secretChanges(entries, ["TOKEN", "OLD"])).toEqual({});
  expect(secretChanges([{ ...entries[0]!, value: "new" }], ["TOKEN", "OLD"])).toEqual({
    TOKEN: "new",
    OLD: null,
  });
  expect(() => secretChanges([...entries, { ...entries[0]!, id: "duplicate" }], [])).toThrow();
});

it("saves exact arguments and preserves stored environment values while editing", async () => {
  vi.mocked(updateMcpServer).mockResolvedValue(server);
  const onSaved = vi.fn();
  const view = render(<McpForm server={server} onSaved={onSaved} onClose={vi.fn()} />);
  fireEvent.change(screen.getByDisplayValue("local"), { target: { value: "renamed" } });
  fireEvent.submit(view.container.querySelector("form")!);
  await waitFor(() => expect(onSaved).toHaveBeenCalledOnce());
  expect(updateMcpServer).toHaveBeenCalledWith(
    server,
    expect.objectContaining({
      name: "renamed",
      args: ["--path", "/a path with spaces"],
      env_updates: {},
    }),
  );
});

it("accepts reset revisions after reconnect and rejects the previous connection response", async () => {
  connectionStore.getState().setStatus("offline");
  let finish!: (snapshot: { revision: number; servers: McpServer[] }) => void;
  vi.mocked(listMcpServers)
    .mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finish = resolve;
        }),
    )
    .mockResolvedValueOnce({ revision: 1, servers: [{ ...server, name: "restarted" }] });
  const stop = watchMcp();
  try {
    connectionStore.getState().setStatus("online");
    const old = refreshMcp();
    connectionStore.getState().setStatus("reconnecting");
    connectionStore.getState().setStatus("online");
    await refreshMcp();
    finish({ revision: 100, servers: [server] });
    await old;
    expect(mcpStore.getState().revision).toBe(1);
    expect(mcpStore.getState().servers[0]?.name).toBe("restarted");
  } finally {
    stop();
    connectionStore.getState().setStatus("offline");
  }
});

it("keeps navigation usable when the MCP endpoint returns an incompatible response", async () => {
  vi.mocked(listMcpServers).mockResolvedValueOnce(
    [] as unknown as Awaited<ReturnType<typeof listMcpServers>>,
  );
  await refreshMcp();
  expect(mcpStore.getState().servers).toEqual([]);
  expect(mcpStore.getState().error).toBe("MCP unavailable");
  render(<McpAttention />);
  expect(screen.getByRole("img")).toBeTruthy();
});

it.each([
  "https://auth.example.test/authorize",
  "http://localhost:9000/authorize",
  "http://127.0.0.1:9000/authorize",
  "http://[::1]:9000/authorize",
])("opens a valid MCP authorization URL: %s", async (url) => {
  const opened = { opener: window } as unknown as Window;
  const open = vi.spyOn(window, "open").mockReturnValue(opened);
  try {
    await openMcpAuthorizationUrl(url);
    expect(open).toHaveBeenCalledWith(url, "_blank");
    expect(opened.opener).toBeNull();
  } finally {
    open.mockRestore();
  }
});

it.each([
  "javascript:alert(1)",
  "http://remote.example.test/authorize",
  "https://name:password@auth.example.test/authorize",
])("rejects an unsafe MCP authorization URL: %s", async (url) => {
  const open = vi.spyOn(window, "open");
  try {
    await expect(openMcpAuthorizationUrl(url)).rejects.toThrow("Invalid authorization URL");
    expect(open).not.toHaveBeenCalled();
  } finally {
    open.mockRestore();
  }
});

it.each(["starting", "reconnecting"] as const)(
  "shows loading without attention while %s",
  (state) => {
    mcpStore.getState().hydrate({ revision: 1, servers: [{ ...server, state }] });
    const view = render(
      <>
        <McpAttention />
        <McpStatus state={state} />
      </>,
    );
    expect(screen.queryByRole("img")).toBeNull();
    expect(view.container.querySelector(".lucide-loader-circle")).toBeTruthy();
    expect(view.container.querySelector(".lucide-triangle-alert")).toBeNull();
  },
);

it.each(["starting", "reconnecting"] as const)(
  "hides a previous connection failure in the panel while %s",
  (state) => {
    const previousError = "Server connection failed";
    mcpStore.getState().hydrate({
      revision: 1,
      servers: [{ ...server, state, error: previousError }],
    });
    const view = render(
      <>
        <McpAttention />
        <McpPage />
      </>,
    );
    expect(screen.queryByText(previousError)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
    expect(view.container.querySelector(".lucide-loader-circle")).toBeTruthy();
    act(() =>
      mcpStore.getState().hydrate({
        revision: 2,
        servers: [{ ...server, state: "error", error: previousError }],
      }),
    );
    expect(screen.getByText(previousError)).toBeTruthy();
    expect(screen.getByRole("img")).toBeTruthy();
    act(() =>
      mcpStore.getState().hydrate({
        revision: 3,
        servers: [{ ...server, state: "ready", error: previousError }],
      }),
    );
    expect(screen.queryByText(previousError)).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  },
);
