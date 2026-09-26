import { afterEach, expect, it, vi } from "vitest";
import { request, setBaseUrl } from "@/daemon/rest/client";
import {
  loadNativeModels,
  invalidateNativeModels,
  nativeModelsStore,
} from "@/features/providers/nativeModels";
import { providersStore } from "@/stores/providers";

afterEach(() => {
  vi.unstubAllGlobals();
  setBaseUrl("http://127.0.0.1:8787");
  invalidateNativeModels();
});

it("discards an old daemon response even when its transport ignores cancellation", async () => {
  let finish!: (response: Response) => void;
  vi.stubGlobal(
    "fetch",
    vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    ),
  );
  const pending = request("/v1/providers").catch((error: unknown) => error);
  setBaseUrl("http://second:8787");
  finish(new Response("[]"));
  expect(await pending).toMatchObject({
    code: "service_unavailable",
    detail: { cause: "daemon_changed" },
  });
});

it("invalidates catalog data and isolates overlapping native requests on daemon changes", async () => {
  let finishOld!: (response: Response) => void;
  const fetchMock = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise<Response>((resolve) => {
          finishOld = resolve;
        }),
    )
    .mockResolvedValue(
      new Response(
        JSON.stringify([{ id: "new-model", reasoning_efforts: [], default_effort: null }]),
      ),
    );
  vi.stubGlobal("fetch", fetchMock);
  providersStore.setState({
    providers: {
      same: {
        name: "same",
        kind: "custom",
        state: "verified",
        catalogState: "loaded",
        modelCatalog: [],
      },
    },
  });
  const old = loadNativeModels("codex", "/work");
  setBaseUrl("http://second:8787");
  expect(providersStore.getState().providers).toEqual({});
  await loadNativeModels("codex", "/work");
  finishOld(new Response(JSON.stringify([{ id: "old-model" }])));
  await old;
  expect(
    nativeModelsStore.getState().catalogs["codex:/work"]?.models.map((model) => model.id),
  ).toEqual(["new-model"]);
});
