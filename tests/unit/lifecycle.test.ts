import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonError } from "@/daemon/errors";
import { KeepAliveManager } from "@/daemon/ws/keepAlive";
import { listFsDir, listFsRoots, listFsProjects } from "@/daemon/rest/fs";
import { listRuntimes, resumeSession, startSession, stopSession } from "@/daemon/rest/runtime";
import { deleteSession, renameSession } from "@/daemon/rest/sessions";
import {
  deleteSessionAction,
  isSessionResumable,
  renameSessionAction,
  resumeSessionAction,
  startNewSession,
} from "@/features/sessions/lifecycle";
import { sessionsStore } from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";

type FetchHandler = (url: string, method: string, body: unknown) => {
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

function stubFetch(handler: FetchHandler): void {
  const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? "GET";
    const body = typeof init?.body === "string" ? (JSON.parse(init.body) as unknown) : undefined;
    const outcome = handler(url, method, body);
    return fakeResponse(outcome.status, outcome.body);
  });
  vi.stubGlobal("fetch", fetchMock);
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

const START_PAYLOAD = {
  id: "11111111-2222-3333-4444-555555555555",
  harness: "claude",
  gateway_route_id: "route-1",
  state: "live",
  project_path: "D:/Dev/alpha",
};

beforeEach(() => {
  sessionsStore.setState({ sessions: {}, order: [], filters: {}, syncState: "idle" });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("runtime REST router", () => {
  it("starts a session and posts the full payload", async () => {
    const bodies: unknown[] = [];
    stubFetch((url, method, body) => {
      if (url.endsWith("/v1/runtime/sessions") && method === "POST") {
        bodies.push(body);
        return { status: 200, body: START_PAYLOAD };
      }
      return { status: 404 };
    });
    const result = await startSession({
      harness: "claude",
      model: "openrouter/free",
      cwd: "D:/Dev/alpha",
      mode: "plan",
    });
    expect(bodies[0]).toEqual({
      harness: "claude",
      model: "openrouter/free",
      cwd: "D:/Dev/alpha",
      mode: "plan",
    });
    expect(result.id).toBe(START_PAYLOAD.id);
    expect(result.harness).toBe("claude");
    expect(result.gateway_route_id).toBe("route-1");
    expect(result.state).toBe("live");
    expect(result.project_path).toBe("D:/Dev/alpha");
  });

  it("starts a session without a mode", async () => {
    const bodies: unknown[] = [];
    stubFetch((_url, _method, body) => {
      bodies.push(body);
      return { status: 200, body: START_PAYLOAD };
    });
    await startSession({ harness: "codex", model: "openai/gpt", cwd: "D:/Dev" });
    expect(bodies[0]).toEqual({ harness: "codex", model: "openai/gpt", cwd: "D:/Dev" });
  });

  it("surfaces harness_not_installed as a typed error", async () => {
    stubFetch(() => ({
      status: 409,
      body: {
        error: {
          code: "harness_not_installed",
          message: "codex is not installed",
          detail: {},
        },
      },
    }));
    const error = await startSession({ harness: "codex", model: "openai/gpt", cwd: "D:/Dev" }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("harness_not_installed");
    expect((error as DaemonError).message).toBe("codex is not installed");
    expect((error as DaemonError).httpStatus).toBe(409);
  });

  it("surfaces provider_not_found as a typed error", async () => {
    stubFetch(() => ({
      status: 404,
      body: {
        error: {
          code: "provider_not_found",
          message: "provider gone",
          detail: {},
        },
      },
    }));
    const error = await startSession({ harness: "claude", model: "x/y", cwd: "D:/Dev" }).then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("provider_not_found");
  });

  it("stops a session with an empty response", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/v1/sessions/s1/stop") && method === "POST") {
        return { status: 204 };
      }
      return { status: 404 };
    });
    await expect(stopSession("s1")).resolves.toBeUndefined();
  });

  it("resumes a session and returns the runtime payload", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/v1/sessions/s1/resume") && method === "POST") {
        return { status: 200, body: { ...START_PAYLOAD, id: "s1", state: "live" } };
      }
      return { status: 404 };
    });
    const result = await resumeSession("s1");
    expect(result.id).toBe("s1");
    expect(result.state).toBe("live");
  });

  it("surfaces session_not_resumable and session_conflict on resume", async () => {
    stubFetch(() => ({
      status: 409,
      body: {
        error: {
          code: "session_not_resumable",
          message: "no stored conversation",
          detail: {},
        },
      },
    }));
    const notResumable = await resumeSession("s1").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(notResumable).toBeInstanceOf(DaemonError);
    expect((notResumable as DaemonError).code).toBe("session_not_resumable");

    stubFetch(() => ({
      status: 409,
      body: {
        error: { code: "session_conflict", message: "open elsewhere", detail: {} },
      },
    }));
    const conflict = await resumeSession("s1").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(conflict).toBeInstanceOf(DaemonError);
    expect((conflict as DaemonError).code).toBe("session_conflict");
  });

  it("lists runtimes tolerating null versions", async () => {
    stubFetch((url) => {
      if (url.endsWith("/v1/runtimes")) {
        return {
          status: 200,
          body: [
            { harness: "claude", installed: true, version: null, degraded: false },
            { harness: "codex", installed: false, version: null, degraded: false },
          ],
        };
      }
      return { status: 404 };
    });
    const runtimes = await listRuntimes();
    expect(runtimes).toHaveLength(2);
    expect(runtimes[0]?.version ?? null).toBeNull();
    expect(runtimes[1]?.installed).toBe(false);
  });
});

describe("sessions REST router", () => {
  it("renames a session via PATCH with a title body", async () => {
    const bodies: unknown[] = [];
    stubFetch((url, method, body) => {
      if (url.endsWith("/v1/sessions/s1") && method === "PATCH") {
        bodies.push(body);
        return {
          status: 200,
          body: {
            id: "s1",
            harness: "claude",
            native_id: null,
            title: "Renamed",
            project_path: "",
            created_at: 0,
            updated_at: 0,
            state: "live",
            model: null,
          },
        };
      }
      return { status: 404 };
    });
    const result = await renameSession("s1", "Renamed");
    expect(bodies[0]).toEqual({ title: "Renamed" });
    expect(result.title).toBe("Renamed");
  });

  it("deletes a session with the purge flag in the query", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/v1/sessions/s1?purge=true") && method === "DELETE") {
        return { status: 204 };
      }
      return { status: 404 };
    });
    await expect(deleteSession("s1", true)).resolves.toBeUndefined();
  });

  it("blocks deleting a live session with session_running", async () => {
    stubFetch(() => ({
      status: 409,
      body: {
        error: {
          code: "session_running",
          message: "stop the session first",
          detail: {},
        },
      },
    }));
    const error = await deleteSession("s1").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("session_running");
    expect((error as DaemonError).httpStatus).toBe(409);
  });
});

describe("fs REST router", () => {
  it("lists roots, directories, and known projects", async () => {
    stubFetch((url) => {
      if (url.endsWith("/v1/fs/roots")) {
        return {
          status: 200,
          body: [{ name: "Dev", path: "D:/Dev", is_dir: true, size: null, modified_at: null }],
        };
      }
      if (url.includes("/v1/fs/list?path=")) {
        return {
          status: 200,
          body: [{ name: "alpha", path: "D:/Dev/alpha", is_dir: true, size: null, modified_at: null }],
        };
      }
      if (url.endsWith("/v1/fs/projects")) {
        return { status: 200, body: ["D:/Dev/alpha"] };
      }
      return { status: 404 };
    });
    const roots = await listFsRoots();
    const entries = await listFsDir("D:/Dev");
    const projects = await listFsProjects();
    expect(roots[0]?.path).toBe("D:/Dev");
    expect(entries[0]?.name).toBe("alpha");
    expect(projects).toEqual(["D:/Dev/alpha"]);
  });

  it("surfaces fs errors as typed errors", async () => {
    stubFetch(() => ({
      status: 404,
      body: { error: { code: "fs_not_found", message: "gone", detail: {} } },
    }));
    const error = await listFsDir("D:/gone").then(
      () => null,
      (caught: unknown) => caught,
    );
    expect(error).toBeInstanceOf(DaemonError);
    expect((error as DaemonError).code).toBe("fs_not_found");
  });
});

describe("lifecycle actions", () => {
  it("startNewSession seeds the store as a daemon-origin live session", async () => {
    stubFetch((url, method) => {
      if (url.endsWith("/v1/runtime/sessions") && method === "POST") {
        return { status: 200, body: START_PAYLOAD };
      }
      return { status: 404 };
    });
    const result = await startNewSession({
      harness: "claude",
      model: "openrouter/free",
      cwd: "D:/Dev/alpha",
    });
    const view = viewOf(result.id);
    expect(view.state).toBe("live");
    expect(view.daemonOrigin).toBe(true);
    expect(view.gatewayRouteId).toBe("route-1");
    expect(view.projectPath).toBe("D:/Dev/alpha");
    expect(view.nativeId ?? null).toBeNull();
  });

  it("resumeSessionAction flips the session back to live and clears attention", async () => {
    seedSession({ id: "s1", state: "stopped", needsAttention: true, nativeId: "native-1" });
    stubFetch((url, method) => {
      if (url.endsWith("/v1/sessions/s1/resume") && method === "POST") {
        return { status: 200, body: { ...START_PAYLOAD, id: "s1", state: "live" } };
      }
      return { status: 404 };
    });
    await resumeSessionAction("s1");
    const view = viewOf("s1");
    expect(view.state).toBe("live");
    expect(view.needsAttention).toBe(false);
  });

  it("renameSessionAction updates the local title", async () => {
    seedSession({ id: "s1", title: "Old" });
    stubFetch((url, method) => {
      if (url.endsWith("/v1/sessions/s1") && method === "PATCH") {
        return {
          status: 200,
          body: {
            id: "s1",
            harness: "claude",
            native_id: null,
            title: "New title",
            project_path: "",
            created_at: 0,
            updated_at: 0,
            state: "live",
            model: null,
          },
        };
      }
      return { status: 404 };
    });
    await renameSessionAction("s1", "New title");
    expect(viewOf("s1").title).toBe("New title");
  });

  it("deleteSessionAction tombstones the session", async () => {
    seedSession({ id: "s1" });
    stubFetch((url, method) => {
      if (url.split("?")[0] === `${"http://127.0.0.1:8787"}/v1/sessions/s1` && method === "DELETE") {
        return { status: 204 };
      }
      return { status: 404 };
    });
    await deleteSessionAction("s1", false);
    expect(viewOf("s1").deleted).toBe(true);
  });

  it("deleteSessionAction leaves the store untouched when the daemon refuses", async () => {
    seedSession({ id: "s1", state: "live" });
    stubFetch(() => ({
      status: 409,
      body: { error: { code: "session_running", message: "stop first", detail: {} } },
    }));
    await expect(deleteSessionAction("s1")).rejects.toBeInstanceOf(DaemonError);
    expect(viewOf("s1").deleted).toBe(false);
  });
});

describe("resumability", () => {
  it("rejects a live state", () => {
    expect(isSessionResumable({ ...baseView(), state: "live" })).toEqual({
      resumable: false,
      reason: "state",
    });
  });

  it("requires a native conversation id", () => {
    expect(isSessionResumable({ ...baseView(), state: "discovered", nativeId: "n1" })).toEqual({
      resumable: true,
      reason: null,
    });
    expect(isSessionResumable({ ...baseView(), state: "stopped", nativeId: null })).toEqual({
      resumable: false,
      reason: "origin",
    });
    expect(isSessionResumable({ ...baseView(), state: "stopped", nativeId: "n1" })).toEqual({
      resumable: true,
      reason: null,
    });
  });
});

function baseView(): SessionView {
  return {
    id: "s1",
    harness: "claude",
    state: "stopped",
    deleted: false,
    title: "s1",
    pendingApprovals: 0,
  };
}

describe("KeepAliveManager", () => {
  interface Harness {
    manager: KeepAliveManager;
    subscribed: string[];
    unsubscribed: string[];
    busy: Set<string>;
    finalReleased: string[];
  }

  function createHarness(): Harness {
    const subscribed: string[] = [];
    const unsubscribed: string[] = [];
    const busy = new Set<string>();
    const finalReleased: string[] = [];
    const manager = new KeepAliveManager({
      subscribe: (sessionId) => {
        subscribed.push(sessionId);
      },
      unsubscribe: (sessionId) => {
        unsubscribed.push(sessionId);
      },
      isBusy: (sessionId) => busy.has(sessionId),
      onFinalRelease: (sessionId) => {
        finalReleased.push(sessionId);
      },
    });
    return { manager, subscribed, unsubscribed, busy, finalReleased };
  }

  it("subscribes on first acquire and unsubscribes after the last release", () => {
    const h = createHarness();
    h.manager.acquire("s1", "pane");
    expect(h.subscribed).toEqual(["s1"]);
    h.manager.acquire("s1", "pin");
    expect(h.subscribed).toEqual(["s1"]);
    h.manager.release("s1", "pane");
    expect(h.unsubscribed).toEqual([]);
    h.manager.release("s1", "pin");
    expect(h.unsubscribed).toEqual(["s1"]);
    expect(h.manager.isHeld("s1")).toBe(false);
  });

  it("keeps the subscription while the session is busy, then releases when idle", () => {
    const h = createHarness();
    h.manager.acquire("s1", "pane");
    h.busy.add("s1");
    h.manager.release("s1", "pane");
    expect(h.unsubscribed).toEqual([]);
    expect(h.manager.isHeld("s1")).toBe(true);
    h.busy.delete("s1");
    sessionsStore.setState({});
    expect(h.unsubscribed).toEqual(["s1"]);
    expect(h.finalReleased).toEqual(["s1"]);
    expect(h.manager.isHeld("s1")).toBe(false);
  });

  it("keeps the subscription while the session is pinned", () => {
    const h = createHarness();
    h.manager.pin("s1");
    expect(h.subscribed).toEqual(["s1"]);
    h.manager.acquire("s1", "pane");
    h.manager.release("s1", "pane");
    expect(h.unsubscribed).toEqual([]);
    h.manager.unpin("s1");
    expect(h.unsubscribed).toEqual(["s1"]);
  });

  it("cancels a pending release when the session is re-acquired", () => {
    const h = createHarness();
    h.manager.acquire("s1", "pane");
    h.busy.add("s1");
    h.manager.release("s1", "pane");
    h.manager.acquire("s1", "pane");
    h.busy.delete("s1");
    sessionsStore.setState({});
    expect(h.unsubscribed).toEqual([]);
    expect(h.finalReleased).toEqual([]);
  });

  it("forgets a session without unsubscribing", () => {
    const h = createHarness();
    h.manager.acquire("s1", "pane");
    h.manager.forget("s1");
    expect(h.unsubscribed).toEqual([]);
    expect(h.manager.isHeld("s1")).toBe(false);
  });

  it("releases only the closed reason and keeps other reasons subscribed", () => {
    const h = createHarness();
    h.manager.acquire("s1", "pane");
    h.manager.release("s1", "pin");
    expect(h.unsubscribed).toEqual([]);
    expect(h.manager.isHeld("s1")).toBe(true);
  });
});

it("retains the chosen permissions when resume fails", async () => {
  seedSession({ id: "permission-failure", state: "stopped", interactionMode: "default", resumeMode: "acceptEdits" });
  stubFetch(() => ({ status: 400, body: { error: { code: "validation_error", message: "invalid" } } }));
  await expect(resumeSessionAction("permission-failure")).rejects.toBeDefined();
  expect(viewOf("permission-failure").interactionMode).toBe("default");
  expect(viewOf("permission-failure").resumeMode).toBe("acceptEdits");
  expect(viewOf("permission-failure").state).toBe("stopped");
});
