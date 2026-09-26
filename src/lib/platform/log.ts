import { isTauri } from "./index";

export type LogLevel = "trace" | "debug" | "info" | "warn" | "error";

async function tauriLog(level: LogLevel, message: string): Promise<void> {
  const log = await import("@tauri-apps/plugin-log");
  switch (level) {
    case "trace":
      await log.trace(message);
      break;
    case "debug":
      await log.debug(message);
      break;
    case "info":
      await log.info(message);
      break;
    case "warn":
      await log.warn(message);
      break;
    case "error":
      await log.error(message);
      break;
  }
}

function consoleLog(level: LogLevel, message: string): void {
  switch (level) {
    case "trace":
    case "debug":
      console.debug(message);
      break;
    case "info":
      console.info(message);
      break;
    case "warn":
      console.warn(message);
      break;
    case "error":
      console.error(message);
      break;
  }
}

export async function appLog(level: LogLevel, message: string): Promise<void> {
  if (isTauri()) {
    try {
      await tauriLog(level, message);
      return;
    } catch {
      return;
    }
  }
  consoleLog(level, message);
}
