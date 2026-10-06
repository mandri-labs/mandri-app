import { beforeEach, expect, it, vi } from "vitest";
import { connectDaemon } from "@/app/connection";
import { ensureDesktopDaemon } from "@/lib/platform/daemon";
import { preferencesStore } from "@/stores/preferences";
import { connectionStore } from "@/stores/connection";
import { getBaseUrl } from "@/daemon/rest/client";

vi.mock("@/lib/platform", () => ({ isTauri: () => true }));
vi.mock("@/lib/platform/daemon", () => ({ ensureDesktopDaemon: vi.fn() }));
vi.mock("@/lib/platform/log", () => ({ appLog: vi.fn() }));
vi.mock("@/daemon/ws/socket", () => ({
  MandriSocket: class {
    close() {}
    onFrame() {}
    connect() {}
  },
}));
vi.mock("@/app/framePipeline", () => ({ dispatchFrame: vi.fn() }));
vi.mock("@/app/sessionSync", () => ({ invalidateSessionMetadata: vi.fn() }));
vi.mock("@/daemon/ws/keepAlive", () => ({ keepAlive: { forget: vi.fn() } }));
vi.mock("@/daemon/ws/sessionFeed", () => ({ sessionFeed: { closeSession: vi.fn() } }));

beforeEach(() => {
  vi.clearAllMocks();
  preferencesStore.getState().setDaemonBaseUrl("http://127.0.0.1:8787");
  connectionStore.setState({ startupError: null, status: "connecting" });
});

it("keeps the chosen remote endpoint when local desktop startup finishes later", async () => {
  let finish!: (url: string) => void;
  const startup = new Promise<string>((resolve) => {
    finish = resolve;
  });
  vi.mocked(ensureDesktopDaemon).mockReturnValue(startup);
  connectDaemon();
  preferencesStore.getState().setDaemonBaseUrl("https://studio.example");
  connectDaemon();
  finish("http://127.0.0.1:8787");
  await startup.catch(() => undefined);
  await Promise.resolve();
  expect(getBaseUrl()).toBe("https://studio.example");
  expect(connectionStore.getState().endpoint).toBe("wss://studio.example/v1/ws");
});

it("ignores an obsolete local startup failure after switching to a remote endpoint", async () => {
  let fail!: (reason: Error) => void;
  const startup = new Promise<string>((_, reject) => {
    fail = reject;
  });
  vi.mocked(ensureDesktopDaemon).mockReturnValue(startup);
  connectDaemon();
  connectionStore.getState().setStartupError("Previous startup error");
  preferencesStore.getState().setDaemonBaseUrl("https://studio.example");
  connectDaemon();
  connectionStore.getState().setStatus("online");
  fail(new Error("Local startup failed"));
  await startup.catch(() => undefined);
  await Promise.resolve();
  expect(connectionStore.getState().startupError).toBeNull();
  expect(connectionStore.getState().status).toBe("online");
});
