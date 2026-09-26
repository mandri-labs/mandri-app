import { DaemonError, parseErrorResponse } from "../errors";
import { createDebugLogger } from "@/lib/debug";
import { daemonIdentity, selectDaemon } from "../identity";
import { daemonToken } from "../auth";

const log = createDebugLogger("rest");

const DEFAULT_BASE_URL = "http://127.0.0.1:8787";
const RETRYABLE_METHOD = "GET";
const MAX_GET_RETRIES = 2;
const RETRY_BACKOFF_MS = 500;

export const DEFAULT_TIMEOUT_MS = 10_000;

export type QueryValue = string | number | boolean | null | undefined;

export interface RequestOptions {
  method?: "GET" | "POST" | "PATCH" | "DELETE";
  body?: unknown;
  rawBody?: Blob;
  responseType?: "blob";
  query?: Record<string, QueryValue>;
  signal?: AbortSignal;
  timeoutMs?: number | null;
  shouldRetry?: () => boolean;
}

export type GetOptions = Pick<RequestOptions, "signal" | "shouldRetry">;
export type CallOptions = Pick<RequestOptions, "signal">;

let baseUrl = DEFAULT_BASE_URL;

export function getBaseUrl(): string {
  return baseUrl;
}

export function setBaseUrl(url: string): void {
  baseUrl = url.trim().replace(/\/+$/, "");
  selectDaemon(baseUrl);
}

export function isNetworkError(error: unknown): boolean {
  if (!(error instanceof DaemonError)) {
    return false;
  }
  return error.detail["cause"] === "network" || error.detail["cause"] === "timeout";
}

export async function request<T>(path: string, init: RequestOptions = {}): Promise<T> {
  const generation = daemonIdentity.getState().generation;
  const method = init.method ?? "GET";
  const retryable = method === RETRYABLE_METHOD && init.shouldRetry !== undefined;
  let attempts = 0;
  for (;;) {
    try {
      return await requestOnce<T>(path, init, method);
    } catch (error) {
      const retry =
        generation === daemonIdentity.getState().generation &&
        retryable &&
        attempts < MAX_GET_RETRIES &&
        isRetryWorthy(error) &&
        (init.shouldRetry?.() ?? false);
      if (!retry) {
        throw error;
      }
      attempts += 1;
      await delay(RETRY_BACKOFF_MS);
      if (generation !== daemonIdentity.getState().generation) throw error;
    }
  }
}

async function requestOnce<T>(path: string, init: RequestOptions, method: string): Promise<T> {
  const controller = new AbortController();
  const generation = daemonIdentity.getState().generation;
  const unsubscribeDaemon = daemonIdentity.subscribe((identity) => {
    if (identity.generation !== generation) controller.abort();
  });
  const timeoutMs = init.timeoutMs === null ? null : (init.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  let timedOut = false;
  const startedAt = Date.now();
  const onAbort = (): void => {
    controller.abort();
  };
  const timer =
    timeoutMs === null
      ? undefined
      : setTimeout(() => {
          timedOut = true;
          controller.abort();
        }, timeoutMs);
  init.signal?.addEventListener("abort", onAbort);
  const url = buildUrl(path, init.query);
  log.debug("request started", { method, url, hasBody: init.body !== undefined });
  try {
    const response = await fetch(url, {
      method,
      headers: {
        ...(init.rawBody
          ? { "Content-Type": "application/octet-stream" }
          : init.body === undefined
            ? {}
            : { "Content-Type": "application/json" }),
        ...(daemonToken(url) ? { Authorization: `Bearer ${daemonToken(url)}` } : {}),
      },
      redirect: "error",
      body: init.rawBody ?? (init.body === undefined ? undefined : JSON.stringify(init.body)),
      signal: controller.signal,
    });
    if (response.ok && init.responseType === "blob") {
      const blob = await response.blob();
      if (generation !== daemonIdentity.getState().generation) throw new Error("daemon changed");
      return blob as T;
    }
    const text = await response.text();
    if (generation !== daemonIdentity.getState().generation) throw new Error("daemon changed");
    log.debug("response received", {
      method,
      url,
      status: response.status,
      durationMs: Date.now() - startedAt,
    });
    if (!response.ok) {
      const error = parseErrorResponse(response.status, parseBody(text));
      log.warn("request failed with http error", {
        method,
        url,
        status: response.status,
        body: text.slice(0, 300) || null,
        code: error instanceof DaemonError ? error.code : null,
      });
      throw error;
    }
    if (response.status === 204 || text.length === 0) {
      return undefined as T;
    }
    return JSON.parse(text) as T;
  } catch (error) {
    if (generation !== daemonIdentity.getState().generation) {
      throw new DaemonError({
        code: method === "GET" ? "service_unavailable" : "delivery_unknown",
        message: "Daemon changed during request",
        detail: { cause: "daemon_changed" },
      });
    }
    if (!(error instanceof DaemonError) || !("httpStatus" in error)) {
      log.error("request failed", {
        method,
        url,
        durationMs: Date.now() - startedAt,
        cause:
          error instanceof TypeError ? "network" : error instanceof Error ? error.name : "unknown",
        message: error instanceof Error ? error.message : String(error),
      });
    }
    throw mapFailure(error, init.signal, timedOut);
  } finally {
    unsubscribeDaemon();
    clearTimeout(timer);
    init.signal?.removeEventListener("abort", onAbort);
  }
}

function mapFailure(error: unknown, signal: AbortSignal | undefined, timedOut: boolean): unknown {
  if (error instanceof DaemonError) {
    return error;
  }
  if (signal?.aborted) {
    return error;
  }
  if (timedOut || error instanceof TypeError) {
    return new DaemonError({
      code: "unknown",
      message: timedOut ? "Request timed out" : "Network request failed",
      detail: { cause: timedOut ? "timeout" : "network" },
    });
  }
  if (error instanceof SyntaxError) {
    return new DaemonError({
      code: "unknown",
      message: "Malformed JSON response",
      detail: { cause: "invalid_response" },
    });
  }
  return error;
}

function isRetryWorthy(error: unknown): boolean {
  if (isNetworkError(error)) {
    return true;
  }
  return (
    error instanceof DaemonError && typeof error.httpStatus === "number" && error.httpStatus >= 500
  );
}

function parseBody(text: string): unknown {
  if (text.length === 0) {
    return undefined;
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}

function buildUrl(path: string, query: Record<string, QueryValue> | undefined): string {
  const base = baseUrl.endsWith("/") ? baseUrl.slice(0, -1) : baseUrl;
  let url = path.startsWith("/") ? `${base}${path}` : `${base}/${path}`;
  if (query) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined && value !== null) {
        params.set(key, String(value));
      }
    }
    const encoded = params.toString();
    if (encoded.length > 0) {
      url = `${url}?${encoded}`;
    }
  }
  return url;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
