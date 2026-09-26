export type DebugLevel = "trace" | "debug" | "info" | "warn" | "error";

export const DEBUG_FLAG_KEY = "mandri.debug";

let forced: boolean | null = null;

function readForcedFlag(): boolean | null {
  try {
    if (typeof window === "undefined") {
      return null;
    }
    const params = new URLSearchParams(window.location.search);
    if (params.has("debug")) {
      return params.get("debug") !== "0" && params.get("debug") !== "false";
    }
    const stored = window.localStorage.getItem(DEBUG_FLAG_KEY);
    if (stored === "1" || stored === "true") {
      return true;
    }
    if (stored === "0" || stored === "false") {
      return false;
    }
    return null;
  } catch {
    return null;
  }
}

export function isDebugLoggingEnabled(): boolean {
  if (forced === null) {
    forced = readForcedFlag();
  }
  if (forced !== null) {
    return forced;
  }
  try {
    return import.meta.env.DEV === true;
  } catch {
    return false;
  }
}

export function setDebugLoggingEnabled(value: boolean): void {
  forced = value;
  try {
    window.localStorage.setItem(DEBUG_FLAG_KEY, value ? "1" : "0");
  } catch {
    return;
  }
}

const LEVEL_METHOD: Record<DebugLevel, "debug" | "info" | "warn" | "error"> = {
  trace: "debug",
  debug: "debug",
  info: "info",
  warn: "warn",
  error: "error",
};

const MAX_DETAIL_LENGTH = 600;

function truncate(value: string): string {
  return value.length > MAX_DETAIL_LENGTH
    ? `${value.slice(0, MAX_DETAIL_LENGTH)}…(+${value.length - MAX_DETAIL_LENGTH} chars)`
    : value;
}

function serializeDetail(detail: unknown): string {
  if (detail === undefined) {
    return "";
  }
  if (typeof detail === "string") {
    return ` ${truncate(detail)}`;
  }
  try {
    return ` ${truncate(JSON.stringify(detail) ?? "")}`;
  } catch {
    return " [unserializable]";
  }
}

export interface DebugLogger {
  trace: (event: string, detail?: unknown) => void;
  debug: (event: string, detail?: unknown) => void;
  info: (event: string, detail?: unknown) => void;
  warn: (event: string, detail?: unknown) => void;
  error: (event: string, detail?: unknown) => void;
  isEnabled: () => boolean;
}

export function createDebugLogger(scope: string): DebugLogger {
  const prefix = `[mandri:${scope}]`;
  const write = (level: DebugLevel, event: string, detail?: unknown): void => {
    if (!isDebugLoggingEnabled()) {
      return;
    }
    const line = `${prefix} ${event}${serializeDetail(detail)}`;
    const method = LEVEL_METHOD[level];
    if (level === "error") {
      console.error(line);
      return;
    }
    console[method](line);
  };
  return {
    trace: (event, detail) => write("trace", event, detail),
    debug: (event, detail) => write("debug", event, detail),
    info: (event, detail) => write("info", event, detail),
    warn: (event, detail) => write("warn", event, detail),
    error: (event, detail) => write("error", event, detail),
    isEnabled: () => isDebugLoggingEnabled(),
  };
}
