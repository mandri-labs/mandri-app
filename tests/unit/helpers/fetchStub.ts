import { vi } from "vitest";

export type FetchHandler = (url: string, init: RequestInit) => Response | Promise<Response>;

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

export function errorResponse(
  status: number,
  code: string,
  message: string,
  detail: Record<string, unknown> = {},
): Response {
  return jsonResponse({ error: { code, message, detail } }, status);
}

export function stubFetch(handler: FetchHandler): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) =>
    handler(String(input), init ?? new Request("http://localhost", { method: "GET" })),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}
