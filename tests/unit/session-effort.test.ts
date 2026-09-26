import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonError } from "@/daemon/errors";
import { errorKey } from "@/features/sessions/lifecycle";
import { swapSessionEffort } from "@/features/providers/swapSessionEffort";
import { sessionsStore } from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";

type FetchHandler = (
  url: string,
  method: string,
  body: unknown,
) => {
  status: number;
  body?: unknown;
};

function fakeResponse(status: number, body: unknown): Response {
  const text = body === undefined ? "" : JSON.stringify(body);
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => text,
  } as unknown as Response;
}

function stubFetch(handler: FetchHandler): Array<{ url: string; method: string; body: unknown }> {
  const calls: Array<{ url: string; method: string; body: unknown }> = [];
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    calls.push({ url, method, body });
    const outcome = handler(url, method, body);
    return fakeResponse(outcome.status, outcome.body);
  });
  vi.stubGlobal("fetch", fetchMock);
  return calls;
}

function seedSession(partial: Partial<SessionView> & { id: string }): void {
  const view: SessionView = {
    harness: "claude",
    state: "live",
    deleted: false,
    title: partial.id,
    pendingApprovals: 0,
    ...partial,
  };
  const state = sessionsStore.getState();
  sessionsStore.setState({
    sessions: { ...state.sessions, [partial.id]: view },
    order: state.order.includes(partial.id) ? state.order : [...state.order, partial.id],
  });
}

function viewOf(id: string): SessionView {
  const session = sessionsStore.getState().sessions[id];
  if (session === undefined) {
    throw new Error(`session missing: ${id}`);
  }
  return session;
}

const SESSION_PAYLOAD = {
  id: "s1",
  harness: "claude",
  native_id: null,
  title: "s1",
  project_path: "",
  created_at: 0,
  updated_at: 0,
  state: "live",
  model: "openai/gpt-5",
};

beforeEach(() => {
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("swapSessionEffort", () => {
  it("applies the effort optimistically and PATCHes the daemon", async () => {
    seedSession({ id: "s1", reasoningEffort: null });
    const calls = stubFetch((url, method) => {
      if (url.endsWith("/v1/runtime/sessions/s1/effort") && method === "PATCH") {
        return { status: 200, body: SESSION_PAYLOAD };
      }
      return { status: 404 };
    });
    await swapSessionEffort("s1", "high");
    expect(calls[0]?.body).toEqual({ effort: "high" });
    expect(viewOf("s1").reasoningEffort).toBe("high");
  });

  it("clears the effort with a null PATCH body", async () => {
    seedSession({ id: "s1", reasoningEffort: "high" });
    const calls = stubFetch(() => ({ status: 200, body: SESSION_PAYLOAD }));
    await swapSessionEffort("s1", null);
    expect(calls[0]?.body).toEqual({ effort: null });
    expect(viewOf("s1").reasoningEffort).toBeNull();
  });

  it("rolls back and maps invalid_effort when the daemon refuses", async () => {
    seedSession({ id: "s1", reasoningEffort: "low" });
    const calls = stubFetch(() => ({
      status: 400,
      body: {
        error: {
          code: "invalid_effort",
          message: "unknown level",
          detail: { effort: "turbo", allowed: ["low", "high"] },
        },
      },
    }));
    const error = await swapSessionEffort("s1", "turbo").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(calls[0]?.body).toEqual({ effort: "turbo" });
    expect(viewOf("s1").reasoningEffort).toBe("low");
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("invalid_effort");
    expect((error as DaemonError).detail["allowed"]).toEqual(["low", "high"]);
    expect(errorKey(error)).toBe("error.invalid_effort");
  });

  it("patches the daemon even when the store has no view", async () => {
    const calls = stubFetch(() => ({ status: 200, body: SESSION_PAYLOAD }));
    await expect(swapSessionEffort("missing", "high")).resolves.toBeUndefined();
    expect(calls[0]?.body).toEqual({ effort: "high" });
    expect(sessionsStore.getState().sessions["missing"]).toBeUndefined();
  });
});
