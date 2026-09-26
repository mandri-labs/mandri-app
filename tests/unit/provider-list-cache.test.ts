import { beforeEach, afterEach, expect, it, vi } from "vitest";

const { request, getBaseUrl } = vi.hoisted(() => ({ request: vi.fn(), getBaseUrl: vi.fn() }));
vi.mock("@/daemon/rest/client", () => ({ request, getBaseUrl }));

beforeEach(() => {
  vi.resetModules();
  request.mockReset();
  getBaseUrl.mockReturnValue("http://daemon-one");
});
afterEach(() => vi.restoreAllMocks());

it("shares concurrent loads and cached results until freshness expires", async () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1000);
  let finish!: (rows: unknown[]) => void;
  request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const { listProviders } = await import("@/daemon/rest/providers");
  const first = listProviders(), second = listProviders();
  expect(request).toHaveBeenCalledTimes(1);
  finish([]);
  await Promise.all([first, second]);
  await listProviders();
  expect(request).toHaveBeenCalledTimes(1);
  now.mockReturnValue(61_001);
  request.mockResolvedValue([]);
  await listProviders();
  expect(request).toHaveBeenCalledTimes(2);
  getBaseUrl.mockReturnValue("http://daemon-two");
  await listProviders();
  expect(request).toHaveBeenCalledTimes(3);
});

it("invalidates after provider mutations and does not cache failures", async () => {
  request.mockRejectedValueOnce(new Error("offline")).mockResolvedValue([]);
  const { listProviders, deleteProvider } = await import("@/daemon/rest/providers");
  await expect(listProviders()).rejects.toThrow("offline");
  await listProviders();
  await deleteProvider("example");
  await listProviders();
  expect(request).toHaveBeenCalledTimes(4);
});

it("does not let an old in-flight response repopulate an invalidated cache", async () => {
  let finish!: (rows: unknown[]) => void;
  request.mockReturnValueOnce(new Promise((resolve) => { finish = resolve; })).mockResolvedValue([]);
  const { listProviders, deleteProvider } = await import("@/daemon/rest/providers");
  const old = listProviders();
  await deleteProvider("example");
  finish([]);
  await old;
  await listProviders();
  expect(request).toHaveBeenCalledTimes(3);
});

it("keeps caller-owned cancellation independent of shared requests", async () => {
  request.mockResolvedValue([]);
  const { listProviders } = await import("@/daemon/rest/providers");
  await listProviders();
  const controller = new AbortController();
  await listProviders({ signal: controller.signal });
  expect(request).toHaveBeenCalledTimes(2);
  expect(request).toHaveBeenLastCalledWith("/v1/providers", { signal: controller.signal });
});
