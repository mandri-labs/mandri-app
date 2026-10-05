import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import type { WindowGeometry } from "@/stores/preferences";

const mocks = vi.hoisted(() => ({
  geometry: undefined as WindowGeometry | undefined,
  save: vi.fn(),
  monitors: vi.fn(),
  resized: undefined as (() => void) | undefined,
  moved: undefined as (() => void) | undefined,
  appWindow: {
    isMinimized: vi.fn(), isVisible: vi.fn(), isMaximized: vi.fn(),
    innerSize: vi.fn(), outerPosition: vi.fn(), setSize: vi.fn(),
    setPosition: vi.fn(), center: vi.fn(), maximize: vi.fn(),
    onResized: vi.fn(), onMoved: vi.fn(),
  },
}));

vi.mock("@tauri-apps/api/webviewWindow", () => ({ getCurrentWebviewWindow: () => mocks.appWindow }));
vi.mock("@tauri-apps/api/window", () => ({ availableMonitors: mocks.monitors }));
vi.mock("./index", () => ({ isTauri: () => true }));
vi.mock("@/stores/preferences", () => ({
  preferencesStore: { getState: () => ({ windowGeometry: mocks.geometry, setWindowGeometry: mocks.save }) },
}));

import { initWindowGeometry } from "./window";

beforeEach(() => {
  vi.resetAllMocks();
  vi.useFakeTimers();
  mocks.geometry = undefined;
  mocks.appWindow.isMinimized.mockResolvedValue(false);
  mocks.appWindow.isVisible.mockResolvedValue(true);
  mocks.appWindow.isMaximized.mockResolvedValue(false);
  mocks.appWindow.innerSize.mockResolvedValue({ width: 1280, height: 800 });
  mocks.appWindow.outerPosition.mockResolvedValue({ x: 100, y: 100 });
  mocks.appWindow.setSize.mockResolvedValue(undefined);
  mocks.appWindow.setPosition.mockResolvedValue(undefined);
  mocks.appWindow.center.mockResolvedValue(undefined);
  mocks.appWindow.maximize.mockResolvedValue(undefined);
  mocks.monitors.mockResolvedValue([
    { workArea: { position: { x: 0, y: 0 }, size: { width: 1920, height: 1080 } } },
    { workArea: { position: { x: -1920, y: 0 }, size: { width: 1920, height: 1080 } } },
  ]);
  mocks.appWindow.onResized.mockImplementation(async (callback) => {
    mocks.resized = callback;
    return vi.fn();
  });
  mocks.appWindow.onMoved.mockImplementation(async (callback) => {
    mocks.moved = callback;
    return vi.fn();
  });
});

afterEach(() => vi.useRealTimers());

describe("desktop window geometry", () => {
  it.each([
    { x: -32000, y: -32000, width: 0, height: 0 },
    { x: 100, y: 100, width: NaN, height: Infinity },
  ])("recovers corrupt dimensions with a default size and persists the repair", async (geometry) => {
    mocks.geometry = geometry;
    const cleanup = await initWindowGeometry();
    expect(mocks.appWindow.setSize).toHaveBeenCalledWith(new LogicalSize(1280, 800));
    expect(mocks.save).toHaveBeenCalledWith({ x: 100, y: 100, width: 1280, height: 800, maximized: false });
    if (geometry.x === -32000) {
      expect(mocks.appWindow.center).toHaveBeenCalledOnce();
      expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
    }
    cleanup();
  });

  it("preserves a valid position on a monitor left of the primary display", async () => {
    mocks.geometry = { x: -1800, y: 100, width: 1400, height: 900 };
    const cleanup = await initWindowGeometry();
    expect(mocks.appWindow.setSize).toHaveBeenCalledWith(new PhysicalSize(1400, 900));
    expect(mocks.appWindow.setPosition).toHaveBeenCalledWith(new PhysicalPosition(-1800, 100));
    expect(mocks.appWindow.center).not.toHaveBeenCalled();
    cleanup();
  });

  it("centers a saved window after its monitor is disconnected", async () => {
    mocks.geometry = { x: 5000, y: 100, width: 1280, height: 800 };
    const cleanup = await initWindowGeometry();
    expect(mocks.appWindow.center).toHaveBeenCalledOnce();
    expect(mocks.appWindow.setPosition).not.toHaveBeenCalled();
    cleanup();
  });

  it("retains usable normal bounds when restoring a maximized window", async () => {
    mocks.geometry = { x: -32000, y: -32000, width: 0, height: 0, maximized: true };
    mocks.appWindow.maximize.mockImplementation(async () => {
      mocks.appWindow.isMaximized.mockResolvedValue(true);
    });
    const cleanup = await initWindowGeometry();
    expect(mocks.appWindow.maximize).toHaveBeenCalledOnce();
    expect(mocks.save).toHaveBeenCalledWith({ x: 100, y: 100, width: 1280, height: 800, maximized: true });
    cleanup();
  });

  it.each(["minimized", "hidden", "minimized during capture", "zero size"])(
    "keeps the last usable geometry when the window is %s", async (state) => {
      const cleanup = await initWindowGeometry();
      if (state === "minimized") mocks.appWindow.isMinimized.mockResolvedValue(true);
      if (state === "hidden") mocks.appWindow.isVisible.mockResolvedValue(false);
      if (state === "minimized during capture") {
        mocks.appWindow.isMinimized.mockResolvedValueOnce(false).mockResolvedValue(true);
        mocks.appWindow.innerSize.mockResolvedValue({ width: 0, height: 0 });
        mocks.appWindow.outerPosition.mockResolvedValue({ x: -32000, y: -32000 });
      }
      if (state === "zero size") mocks.appWindow.innerSize.mockResolvedValue({ width: 0, height: 0 });
      mocks.resized!();
      mocks.moved!();
      await vi.advanceTimersByTimeAsync(500);
      expect(mocks.save).not.toHaveBeenCalled();
      cleanup();
    },
  );

  it("saves normal changes and preserves normal bounds when maximized", async () => {
    mocks.geometry = { x: 100, y: 100, width: 1280, height: 800 };
    const cleanup = await initWindowGeometry();
    mocks.save.mockClear();
    mocks.appWindow.outerPosition.mockResolvedValue({ x: 200, y: 150 });
    mocks.moved!();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.save).toHaveBeenLastCalledWith({ x: 200, y: 150, width: 1280, height: 800, maximized: false });
    mocks.appWindow.isMaximized.mockResolvedValue(true);
    mocks.resized!();
    await vi.advanceTimersByTimeAsync(500);
    expect(mocks.save).toHaveBeenLastCalledWith({ ...mocks.geometry, maximized: true });
    cleanup();
  });

  it("falls back without rejecting when native restoration requests fail", async () => {
    mocks.geometry = { x: 100, y: 100, width: 1400, height: 900 };
    mocks.appWindow.setSize.mockRejectedValueOnce(new Error("size unavailable"));
    mocks.monitors.mockRejectedValue(new Error("monitors unavailable"));
    const cleanup = await initWindowGeometry();
    expect(mocks.appWindow.setSize).toHaveBeenLastCalledWith(new LogicalSize(1280, 800));
    expect(mocks.appWindow.center).toHaveBeenCalledOnce();
    cleanup();
  });
});
