import { invoke } from "@tauri-apps/api/core";
import { setDaemonCredentials } from "@/daemon/auth";

let pending: Promise<string> | null = null;

export function openDesktopLogs(): Promise<void> {
  return invoke("open_logs");
}

export function ensureDesktopDaemon(): Promise<string> {
  pending ??= invoke<{ baseUrl: string; token: string }>("ensure_daemon")
    .then(({ baseUrl, token }) => {
      setDaemonCredentials(baseUrl, token);
      return baseUrl;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
