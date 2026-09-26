import { invoke } from "@tauri-apps/api/core";
import { PhysicalPosition, PhysicalSize } from "@tauri-apps/api/dpi";
import { getCurrentWebviewWindow } from "@tauri-apps/api/webviewWindow";
import { isTauri } from "./index";
import { preferencesStore } from "@/stores/preferences";
import type { WindowGeometry } from "@/stores/preferences";

const GEOMETRY_SAVE_DEBOUNCE_MS = 500;

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

async function captureGeometry(): Promise<WindowGeometry> {
  const appWindow = getCurrentWebviewWindow();
  const maximized = await appWindow.isMaximized();
  if (maximized) {
    return { maximized: true };
  }
  const size = await appWindow.innerSize();
  const position = await appWindow.outerPosition();
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
    if (typeof geometry.width === "number" && typeof geometry.height === "number") {
      await appWindow.setSize(new PhysicalSize(geometry.width, geometry.height)).catch(() => undefined);
    }
    if (typeof geometry.x === "number" && typeof geometry.y === "number") {
      await appWindow.setPosition(new PhysicalPosition(geometry.x, geometry.y)).catch(() => undefined);
    }
    if (geometry.maximized) {
      await appWindow.maximize().catch(() => undefined);
    }
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
          const current = preferencesStore.getState().windowGeometry;
          preferencesStore.getState().setWindowGeometry({ ...current, ...next });
        })
        .catch(() => undefined);
    }, GEOMETRY_SAVE_DEBOUNCE_MS);
  };
  const unlistenResized = await appWindow.onResized(() => scheduleSave());
  const unlistenMoved = await appWindow.onMoved(() => scheduleSave());
  return () => {
    unlistenResized();
    unlistenMoved();
    if (saveTimer !== null) {
      clearTimeout(saveTimer);
    }
  };
}
