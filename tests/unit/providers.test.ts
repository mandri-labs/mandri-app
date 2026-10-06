import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonError } from "@/daemon/errors";
import {
  createProvider,
  deleteProvider,
  listProviderModels,
  verifyProvider,
} from "@/daemon/rest/providers";
import { createRoute, deleteRoute, setRouteModel } from "@/daemon/rest/gateway";
import { providersStore } from "@/stores/providers";
import type { EventMessage, WsTopic } from "@/daemon/types/ws";
import type { FetchHandler } from "./helpers/fetchStub";
import { errorResponse, jsonResponse, stubFetch } from "./helpers/fetchStub";

function gatewayEvent(event: string, routeId: string, providerName?: string): EventMessage {
  return {
    topic: "gateway.events" as WsTopic,
    seq: 1,
    source: "daemon",
    raw: { event, route_id: routeId, provider_name: providerName },
    ts: 1,
  };
}

beforeEach(() => {
  providersStore.setState({ providers: {}, routes: [], routesLoaded: false });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("provider REST calls", () => {
  it("creates a provider with verify-on-save and maps the payload", async () => {
    const handler: FetchHandler = (url, init) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/providers");
      expect(init.method).toBe("POST");
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body).toEqual({
        name: "openrouter-main",
        kind: "openrouter",
        api_base: null,
        api_key: "sk-test",
        verify: true,
      });
      return jsonResponse(
        { name: "openrouter-main", kind: "openrouter", api_base: null, state: "verified" },
        201,
      );
    };
    stubFetch(handler);
    const provider = await createProvider({
      name: "openrouter-main",
      kind: "openrouter",
      api_base: null,
      api_key: "sk-test",
      verify: true,
    });
    expect(provider.name).toBe("openrouter-main");
    expect(provider.state).toBe("verified");
  });

  it("surfaces provider_exists as a typed DaemonError", async () => {
    stubFetch(() =>
      errorResponse(409, "provider_exists", "provider already registered", { name: "dup" }),
    );
    const error = await createProvider({
      name: "dup",
      kind: "openai",
      api_key: "k",
      verify: true,
    }).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonError);
    const daemonError = error as DaemonError;
    expect(daemonError.code).toBe("provider_exists");
    expect(daemonError.httpStatus).toBe(409);
    expect(daemonError.message).toBe("provider already registered");
  });

  it("maps verify failure to provider_verification_failed", async () => {
    stubFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/providers/local/verify");
      return errorResponse(400, "provider_verification_failed", "connection refused", {
        kind: "ollama",
      });
    });
    const error = await verifyProvider("local").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("provider_verification_failed");
    expect((error as DaemonError).detail["kind"]).toBe("ollama");
  });

  it("blocks provider removal with provider_in_use and route ids in detail", async () => {
    stubFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/providers/openrouter-main");
      expect(init.method).toBe("DELETE");
      return errorResponse(409, "provider_in_use", "provider still serves routes", {
        route_ids: ["route-1", "route-2"],
      });
    });
    const error = await deleteProvider("openrouter-main").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonError);
    const daemonError = error as DaemonError;
    expect(daemonError.code).toBe("provider_in_use");
    expect(daemonError.detail["route_ids"]).toEqual(["route-1", "route-2"]);
  });

  it("lists provider models with reasoning metadata", async () => {
    stubFetch((url) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/providers/openrouter-main/models");
      return jsonResponse([
        { id: "model-a", reasoning_efforts: ["low", "high"], default_effort: "low" },
        { id: "model-b", reasoning_efforts: [], default_effort: null },
      ]);
    });
    const models = await listProviderModels("openrouter-main");
    expect(models).toEqual([
      { id: "model-a", reasoning_efforts: ["low", "high"], default_effort: "low" },
      { id: "model-b", reasoning_efforts: [], default_effort: null },
    ]);
  });

  it("maps catalog failure to provider_models_failed (manual entry fallback)", async () => {
    stubFetch(() => errorResponse(502, "provider_models_failed", "catalog upstream failed"));
    const error = await listProviderModels("local").catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("provider_models_failed");
    expect((error as DaemonError).httpStatus).toBe(502);
  });
});

describe("gateway route REST calls", () => {
  it("creates a route with model and formats", async () => {
    const handler: FetchHandler = (url, init) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/gateway/routes");
      expect(init.method).toBe("POST");
      expect(JSON.parse(String(init.body))).toEqual({
        model: "openrouter-main/model-a",
        formats: ["anthropic", "openai"],
      });
      return jsonResponse(
        {
          id: "route-1",
          provider: "openrouter-main",
          model_ref: "openrouter-main/model-a",
          formats: ["anthropic", "openai"],
          created_at: 42,
          child_token: "t",
        },
        201,
      );
    };
    stubFetch(handler);
    const created = await createRoute({
      model: "openrouter-main/model-a",
      formats: ["anthropic", "openai"],
    });
    expect(created.id).toBe("route-1");
    expect(created.model_ref).toBe("openrouter-main/model-a");
  });

  it("swaps a route model with PATCH", async () => {
    stubFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/gateway/routes/route-1/model");
      expect(init.method).toBe("PATCH");
      expect(JSON.parse(String(init.body))).toEqual({ model: "openrouter-main/model-b" });
      return jsonResponse({
        id: "route-1",
        provider: "openrouter-main",
        model_ref: "openrouter-main/model-b",
        formats: ["openai"],
        created_at: 42,
      });
    });
    const route = await setRouteModel("route-1", "openrouter-main/model-b");
    expect(route.model_ref).toBe("openrouter-main/model-b");
  });

  it("deletes a route", async () => {
    stubFetch((url, init) => {
      expect(url).toBe("http://127.0.0.1:8787/v1/gateway/routes/route-1");
      expect(init.method).toBe("DELETE");
      return new Response(null, { status: 204 });
    });
    await expect(deleteRoute("route-1")).resolves.toBeUndefined();
  });
});

describe("providers store", () => {
  it("hydrates providers and keeps cached catalogs", () => {
    providersStore.getState().upsertProvider({
      name: "local",
      kind: "ollama",
      api_base: "http://127.0.0.1:11434",
      state: "verified",
    });
    providersStore
      .getState()
      .setCatalog("local", [{ id: "ollama/llama3", reasoning_efforts: [], default_effort: null }]);
    providersStore.getState().hydrateProviders([
      { name: "local", kind: "ollama", api_base: "http://127.0.0.1:11434", state: "verified" },
      { name: "hosted", kind: "openai", api_base: null, state: "unverified" },
    ]);
    const state = providersStore.getState();
    expect(Object.keys(state.providers)).toEqual(["local", "hosted"]);
    expect(state.providers["local"]?.modelCatalog).toEqual([
      { id: "ollama/llama3", reasoning_efforts: [], default_effort: null },
    ]);
    expect(state.providers["hosted"]?.catalogState).toBe("idle");
    expect(state.providers["hosted"]?.state).toBe("unverified");
  });

  it("removes a provider", () => {
    providersStore
      .getState()
      .hydrateProviders([{ name: "local", kind: "ollama", api_base: null, state: "verified" }]);
    providersStore.getState().removeProvider("local");
    expect(providersStore.getState().providers["local"]).toBeUndefined();
  });

  it("updates verification state", () => {
    providersStore
      .getState()
      .hydrateProviders([{ name: "local", kind: "ollama", api_base: null, state: "unverified" }]);
    providersStore.getState().setVerification("local", "degraded");
    expect(providersStore.getState().providers["local"]?.state).toBe("degraded");
  });

  it("sets catalog loaded and unavailable states", () => {
    providersStore
      .getState()
      .hydrateProviders([{ name: "local", kind: "ollama", api_base: null, state: "verified" }]);
    providersStore
      .getState()
      .setCatalog("local", [{ id: "ollama/llama3", reasoning_efforts: [], default_effort: null }]);
    expect(providersStore.getState().providers["local"]?.catalogState).toBe("loaded");
    providersStore.getState().setCatalog("local", "unavailable");
    const view = providersStore.getState().providers["local"];
    expect(view?.catalogState).toBe("unavailable");
    expect(view?.modelCatalog).toBeUndefined();
  });

  it("sets routes from gateway info and marks them loaded", () => {
    providersStore.getState().setRoutes([
      {
        id: "route-1",
        provider: "openrouter-main",
        model_ref: "openrouter-main/model-a",
        formats: ["openai"],
        created_at: 10,
      },
    ]);
    const state = providersStore.getState();
    expect(state.routesLoaded).toBe(true);
    expect(state.routes[0]?.providerName).toBe("openrouter-main");
    expect(state.routes[0]?.modelRef).toBe("openrouter-main/model-a");
  });

  it("applies route_created, route_updated and route_deleted gateway events", () => {
    providersStore.getState().setRoutes([
      {
        id: "route-1",
        provider: "openrouter-main",
        model_ref: "openrouter-main/model-a",
        formats: ["openai"],
        created_at: 10,
      },
    ]);
    providersStore.getState().applyGatewayEvent(gatewayEvent("route_created", "route-2", "local"));
    expect(providersStore.getState().routes.map((route) => route.id)).toEqual([
      "route-1",
      "route-2",
    ]);
    providersStore.getState().applyGatewayEvent(gatewayEvent("route_updated", "route-1", "hosted"));
    expect(providersStore.getState().routes[0]?.providerName).toBe("hosted");
    providersStore.getState().applyGatewayEvent(gatewayEvent("route_deleted", "route-2"));
    expect(providersStore.getState().routes.map((route) => route.id)).toEqual(["route-1"]);
  });

  it("ignores non-gateway frames", () => {
    const before = providersStore.getState().routes;
    providersStore.getState().applyGatewayEvent({
      topic: "sessions.all" as WsTopic,
      seq: 1,
      source: "daemon",
      raw: { event: "route_deleted", route_id: "route-1" },
      ts: 1,
    });
    expect(providersStore.getState().routes).toBe(before);
  });

  it("swaps a route model optimistically", () => {
    providersStore.getState().setRoutes([
      {
        id: "route-1",
        provider: "openrouter-main",
        model_ref: "openrouter-main/model-a",
        formats: [],
        created_at: 1,
      },
    ]);
    providersStore.getState().swapRouteModel("route-1", "openrouter-main/model-b");
    expect(providersStore.getState().routes[0]?.modelRef).toBe("openrouter-main/model-b");
    providersStore.getState().swapRouteModel("missing", "x");
    expect(providersStore.getState().routes).toHaveLength(1);
  });
});
