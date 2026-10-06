import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { setBaseUrl } from "@/daemon/rest/client";
import { modelSelection, nativeHarness } from "@/daemon/modelSelection";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import type { HarnessKind } from "@/daemon/types/ws";
import { WelcomeComposer } from "@/features/sessions/WelcomeComposer";
import { swapSessionModel } from "@/features/providers/swapSessionModel";
import { initI18n } from "@/i18n";
import { connectionStore } from "@/stores/connection";
import { preferencesStore } from "@/stores/preferences";
import { sessionsStore } from "@/stores/sessions";

const socket = vi.hoisted(() => ({ request: vi.fn(), subscribe: vi.fn(), unsubscribe: vi.fn() }));
vi.mock("@/app/connection", () => ({ getDaemonSocket: () => socket }));

const gatewayRef = "opencode_go/glm-5.3-flash";
const nativeId = "opencode-go/glm-5.3-flash";
const provider = { name: "opencode_go", kind: "opencode_go", api_base: null, state: "verified" };
const model = {
  id: "glm-5.3-flash",
  display_name: "GLM-5.3-Flash",
  reasoning_efforts: ["low", "high"],
  default_effort: "low",
};
const runtimeRows = ["codex", "pi"].map((harness) => ({
  harness,
  installed: true,
  degraded: false,
  version: "test",
  capabilities: { model_sources: ["native", "gateway"] },
}));
let testSequence = 0;
let activeHarness: HarnessKind;
let requests: { path: string; method: string; body: Record<string, unknown> }[];

function sessionResponse(selection: Record<string, unknown>) {
  return {
    id: "routing-session",
    harness: activeHarness,
    state: "live",
    project_path: "/synthetic",
    execution_backend: "host",
    privacy_mode: "none",
    reasoning_effort: null,
    gateway_route_id: selection.model_source === "native" ? null : "gateway-route",
    ...selection,
  };
}

beforeAll(() => initI18n("en"));
beforeEach(() => {
  activeHarness = "pi";
  requests = [];
  setBaseUrl(`http://model-routing-${++testSequence}.test`);
  connectionStore.setState({ status: "online" });
  preferencesStore.setState({ defaultHarness: "pi", defaultModel: undefined, defaultEffort: null });
  sessionsStore.setState({ sessions: {}, order: [], drafts: {} });
  socket.request.mockImplementation(async (action: string) => {
    if (action === "command.catalog") return { commands: [] };
    if (action === "session.prompt") return { state: "queued", code: null };
    throw new Error(`Unexpected websocket action: ${action}`);
  });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const path = new URL(String(input)).pathname;
      const method = init?.method ?? "GET";
      const body = init?.body ? (JSON.parse(String(init.body)) as Record<string, unknown>) : {};
      requests.push({ path, method, body });
      let payload: unknown;
      if (path === "/v1/runtimes") payload = runtimeRows;
      else if (/^\/v1\/runtimes\/[^/]+\/models$/.test(path)) payload = [{ ...model, id: nativeId }];
      else if (path === "/v1/providers") payload = [provider];
      else if (path === "/v1/providers/opencode_go/models") payload = [model];
      else if (path === "/v1/runtime/sessions" && method === "POST")
        payload = sessionResponse(body);
      else if (path === "/v1/sessions/routing-session/model" && method === "PATCH")
        payload = sessionResponse(body);
      else throw new Error(`Unexpected HTTP request: ${method} ${path}`);
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }),
  );
});
afterEach(() => {
  cleanup();
  sessionFeed.closeSession("routing-session");
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

async function openWelcome(harness: HarnessKind): Promise<void> {
  activeHarness = harness;
  preferencesStore.setState({ defaultHarness: harness });
  render(<WelcomeComposer initialCwd="/synthetic" />);
  await waitFor(() =>
    expect(screen.getByLabelText("Harness").textContent).toContain(
      harness === "pi" ? "Pi" : "Codex",
    ),
  );
}

async function chooseModel(ref: string): Promise<void> {
  fireEvent.click(screen.getByLabelText("Model"));
  const changeModel = screen.queryByRole("button", { name: /Change model/ });
  if (changeModel) fireEvent.click(changeModel);
  const search = await screen.findByRole("combobox");
  await screen.findByTitle(ref);
  fireEvent.change(search, { target: { value: "glm 5.3" } });
  fireEvent.click(screen.getByTitle(ref));
}

async function submitWelcome(): Promise<Record<string, unknown>> {
  fireEvent.change(screen.getByRole("textbox"), { target: { value: "Hello" } });
  fireEvent.click(screen.getByLabelText("Send"));
  await waitFor(() =>
    expect(socket.request).toHaveBeenCalledWith("session.prompt", {
      session_id: "routing-session",
      content: "Hello",
    }),
  );
  return requests.find(
    (request) => request.path === "/v1/runtime/sessions" && request.method === "POST",
  )!.body;
}

it.each(["pi", "codex"] as const)(
  "sends %s gateway selections unchanged from the menu through HTTP creation and the first websocket prompt",
  async (harness) => {
    await openWelcome(harness);
    await chooseModel(gatewayRef);
    const body = await submitWelcome();
    expect(body).toMatchObject({ harness, model: gatewayRef, effort: "low" });
    expect(body.model_source).toBeUndefined();
    expect(sessionsStore.getState().sessions["routing-session"]?.model).toBe(gatewayRef);
  },
);

it.each(["pi", "codex"] as const)(
  "sends %s native selections with their source and complete provider/model ID",
  async (harness) => {
    await openWelcome(harness);
    const ref = `native:${harness}/${nativeId}`;
    await chooseModel(ref);
    const body = await submitWelcome();
    expect(body).toMatchObject({ harness, model: nativeId, model_source: "native" });
    expect(body.effort).toBeUndefined();
    expect(sessionsStore.getState().sessions["routing-session"]?.model).toBe(ref);
  },
);

it.each(["pi", "codex"] as const)(
  "preserves the same gateway model and effort when switching away from %s",
  async (harness) => {
    await openWelcome(harness);
    await chooseModel(gatewayRef);
    fireEvent.click(screen.getByLabelText("Harness"));
    const next = harness === "pi" ? "codex" : "pi";
    fireEvent.click(screen.getByRole("button", { name: next === "pi" ? "Pi" : "Codex" }));
    activeHarness = next;
    const body = await submitWelcome();
    expect(body).toMatchObject({ harness: next, model: gatewayRef, effort: "low" });
    expect(body.model_source).toBeUndefined();
  },
);

it.each(["pi", "codex"] as const)(
  "clears the old native selection when switching away from %s",
  async (harness) => {
    await openWelcome(harness);
    await chooseModel(`native:${harness}/${nativeId}`);
    fireEvent.click(screen.getByLabelText("Harness"));
    const next = harness === "pi" ? "codex" : "pi";
    fireEvent.click(screen.getByRole("button", { name: next === "pi" ? "Pi" : "Codex" }));
    activeHarness = next;
    expect(screen.getByLabelText("Model").textContent).toContain("Choose a model");
    const body = await submitWelcome();
    expect(body).toMatchObject({ harness: next, model: "" });
    expect(body.effort).toBeUndefined();
  },
);

it.each(["pi", "codex"] as const)(
  "keeps gateway and native sources distinct when changing a running %s session",
  async (harness) => {
    activeHarness = harness;
    sessionsStore.setState({
      sessions: {
        "routing-session": {
          id: "routing-session",
          harness,
          title: "Routing",
          state: "live",
          deleted: false,
          pendingApprovals: 0,
          model: `native:${harness}/${nativeId}`,
          gatewayRouteId: undefined,
        },
      },
    });
    for (const [ref, selection] of [
      [gatewayRef, { model: gatewayRef, model_source: "gateway" }],
      [`native:${harness}/${nativeId}`, { model: nativeId, model_source: "native" }],
      [gatewayRef, { model: gatewayRef, model_source: "gateway" }],
    ] as const) {
      await act(async () => {
        await swapSessionModel("routing-session", ref);
      });
      expect(requests.at(-1)).toEqual({
        path: "/v1/sessions/routing-session/model",
        method: "PATCH",
        body: selection,
      });
      expect(sessionsStore.getState().sessions["routing-session"]?.model).toBe(ref);
    }
  },
);

it("classifies the native namespace without registering harness names or truncating model IDs", () => {
  expect(modelSelection("native:future-harness/provider/namespace/model")).toEqual({
    model: "provider/namespace/model",
    model_source: "native",
  });
  expect(nativeHarness("native:future-harness/provider/namespace/model")).toBe("future-harness");
  expect(modelSelection("custom-provider/pi/model")).toEqual({
    model: "custom-provider/pi/model",
    model_source: "gateway",
  });
  for (const ref of ["native:pi", "native:/model", "native:pi/", "native:two words/model"]) {
    expect(nativeHarness(ref)).toBeUndefined();
  }
});
