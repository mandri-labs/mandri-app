import { beforeEach, describe, expect, it } from "vitest";
import { LOCAL_ENDPOINT, normalizeEndpointUrl, restoreEndpoints } from "@/stores/endpoints";
import { preferencesStore } from "@/stores/preferences";

beforeEach(() =>
  preferencesStore.setState({
    ...restoreEndpoints({}),
    defaultModel: undefined,
    defaultEffort: null,
  }),
);

describe("device endpoint preferences", () => {
  it("uses Local without localStorage even when a desktop backup contains another address", () => {
    localStorage.removeItem("mandri.preferences");
    const merge = preferencesStore.persist.getOptions().merge!;
    const restored = merge({ daemonBaseUrl: "https://backup.example" }, preferencesStore.getState());
    expect(restored.selectedEndpointId).toBe("local");
    expect(restored.daemonBaseUrl).toBe(LOCAL_ENDPOINT.url);
  });

  it("starts with Local and preserves the legacy third-party address", () => {
    expect(restoreEndpoints({})).toEqual({
      endpoints: [LOCAL_ENDPOINT],
      selectedEndpointId: "local",
      daemonBaseUrl: LOCAL_ENDPOINT.url,
    });
    const migrated = restoreEndpoints({ daemonBaseUrl: "https://desktop.example/mandri/" });
    expect(migrated.endpoints).toHaveLength(2);
    expect(migrated.daemonBaseUrl).toBe("https://desktop.example/mandri");
    expect(migrated.selectedEndpointId).toBe("imported");
  });

  it("keeps a saved selection across hydration and falls back when it is missing", async () => {
    const state = preferencesStore.getState();
    state.saveEndpoint({ id: "desktop", name: "Studio", url: "https://desktop.example/" });
    state.selectEndpoint("desktop");
    await preferencesStore.persist.rehydrate();
    expect(preferencesStore.getState().selectedEndpointId).toBe("desktop");
    expect(preferencesStore.getState().daemonBaseUrl).toBe("https://desktop.example");
    expect(
      restoreEndpoints({ selectedEndpointId: "missing", daemonBaseUrl: "https://old.example" })
        .selectedEndpointId,
    ).toBe("local");
  });

  it("protects Local, rejects duplicate URLs and falls back on active endpoint removal", () => {
    const state = preferencesStore.getState();
    state.removeEndpoint("local");
    state.saveEndpoint({ id: "local", name: "Changed", url: "https://wrong.example" });
    state.saveEndpoint({ id: "duplicate", name: "Duplicate", url: LOCAL_ENDPOINT.url + "/" });
    expect(preferencesStore.getState().endpoints).toEqual([LOCAL_ENDPOINT]);
    state.saveEndpoint({ id: "desktop", name: "Studio", url: "https://desktop.example" });
    state.selectEndpoint("desktop");
    state.removeEndpoint("desktop");
    expect(preferencesStore.getState().selectedEndpointId).toBe("local");
    expect(preferencesStore.getState().daemonBaseUrl).toBe(LOCAL_ENDPOINT.url);
  });

  it("ignores malformed persisted entries", () => {
    expect(
      restoreEndpoints({
        endpoints: [
          null,
          { id: "local", name: "Hijacked", url: "https://wrong.example" },
          { id: "bad", name: "Bad", url: "file:///tmp" },
        ] as never,
      }).endpoints,
    ).toEqual([LOCAL_ENDPOINT]);
    expect(normalizeEndpointUrl("https://host.test/path?ignored=true")).toBeNull();
  });

  it("clears reasoning on model changes and incompatible native models on harness changes", () => {
    const state = preferencesStore.getState();
    state.setDefaultModel("native:codex/gpt-5");
    state.setDefaultEffort("high");
    state.setDefaultHarness("claude");
    expect(preferencesStore.getState().defaultModel).toBeUndefined();
    expect(preferencesStore.getState().defaultEffort).toBeNull();
  });
});
