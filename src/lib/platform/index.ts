export type Platform = "tauri" | "web";

declare global {
  interface Window {
    __TAURI_INTERNALS__?: unknown;
  }
}

export function getPlatform(): Platform {
  return typeof window !== "undefined" && window.__TAURI_INTERNALS__ ? "tauri" : "web";
}

export function isTauri(): boolean {
  return getPlatform() === "tauri";
}
