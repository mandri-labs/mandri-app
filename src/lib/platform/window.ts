import { invoke } from "@tauri-apps/api/core";
import { LogicalSize, PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { availableMonitors } from "@tauri-apps/api/window";
import { isTauri } from "./index";
import { preferencesStore } from "@/stores/preferences";
import type { WindowGeometry } from "@/stores/preferences";

const GEOMETRY_SAVE_DEBOUNCE_MS = 500;
const DEFAULT_WIDTH = 1280;
const DEFAULT_HEIGHT = 800;
const MIN_WIDTH = 1024;
const MIN_HEIGHT = 720;

function usableSize(width: number | undefined, height: number | undefined): boolean {
  return (
    Number.isFinite(width) &&
    Number.isFinite(height) &&
    width! >= MIN_WIDTH &&
    height! >= MIN_HEIGHT
  );
}

export function setCloseToTray(enabled: boolean): void {
  if (!isTauri()) {
    return;
  }
  void invoke("set_close_to_tray", { enabled }).catch(() => undefined);
}

export async function minimizeToTray(): Promise<void> {
  if (!isTauri()) {
    return;
  }
  const appWindow = getCurrentWebviewWindow();
  await appWindow.hide();
}

async function captureGeometry(): Promise<WindowGeometry | undefined> {
  const appWindow = getCurrentWebviewWindow();
  if ((await appWindow.isMinimized()) || !(await appWindow.isVisible())) {
    return undefined;
  }
  const maximized = await appWindow.isMaximized();
  if (maximized) {
    return { maximized: true };
  }
  const size = await appWindow.innerSize();
  const position = await appWindow.outerPosition();
  // Minimizing can happen while the native size/position requests are in flight.
  if (
    (await appWindow.isMinimized()) ||
    !(await appWindow.isVisible()) ||
    !usableSize(size.width, size.height) ||
    !Number.isFinite(position.x) ||
    !Number.isFinite(position.y)
  ) {
    return undefined;
  }
  return {
    x: position.x,
    y: position.y,
    width: size.width,
    height: size.height,
    maximized: false,
  };
}

export async function initWindowGeometry(): Promise<() => void> {
  if (!isTauri()) {
    return () => undefined;
  }
  const appWindow = getCurrentWebviewWindow();
  const geometry = preferencesStore.getState().windowGeometry;
  if (geometry) {
    const defaultSize = new LogicalSize(DEFAULT_WIDTH, DEFAULT_HEIGHT);
    const size = usableSize(geometry.width, geometry.height)
      ? new PhysicalSize(geometry.width!, geometry.height!)
      : defaultSize;
    await appWindow
      .setSize(size)
      .catch(() => appWindow.setSize(defaultSize).catch(() => undefined));
    const monitors = await availableMonitors().catch(() => []);
    // Keep the title bar reachable, including on monitors with negative coordinates.
    const reachable =
      Number.isFinite(geometry.x) &&
      Number.isFinite(geometry.y) &&
      monitors.some(({ workArea }) => {
        const { position, size: area } = workArea;
        return (
          geometry.x! >= position.x &&
          geometry.x! + 64 <= position.x + area.width &&
          geometry.y! >= position.y &&
          geometry.y! + 32 <= position.y + area.height
        );
      });
    const center = () => appWindow.center().catch(() => undefined);
    if (reachable) {
      await appWindow.setPosition(new PhysicalPosition(geometry.x!, geometry.y!)).catch(center);
    } else {
      await center();
    }
    // Replace corrupt preferences immediately rather than waiting for a user resize.
    const restored = await captureGeometry().catch(() => undefined);
    if (geometry.maximized) {
      await appWindow.maximize().catch(() => undefined);
    }
    preferencesStore
      .getState()
      .setWindowGeometry(
        restored
          ? { ...restored, maximized: geometry.maximized === true }
          : { maximized: geometry.maximized === true },
      );
  }
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  const scheduleSave = (): void => {
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void captureGeometry()
        .then((next) => {
          if (!next) {
            return;
          }
          const current = preferencesStore.getState().windowGeometry;
          preferencesStore.getState().setWindowGeometry({ ...current, ...next });
        })
        .catch(() => undefined);
    }, GEOMETRY_SAVE_DEBOUNCE_MS);
  };
  const unlistenResized = await appWindow
    .onResized(() => scheduleSave())
    .catch(() => () => undefined);
  const unlistenMoved = await appWindow.onMoved(() => scheduleSave()).catch(() => () => undefined);
  return () => {
    unlistenResized();
    unlistenMoved();
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
  };
}
