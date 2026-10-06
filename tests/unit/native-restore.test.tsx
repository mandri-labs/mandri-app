import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useStore } from "@/app/useStore";
import { request } from "@/daemon/rest/client";
import { daemonIdentity } from "@/daemon/identity";
import { LifecycleMenu } from "@/features/sessions/LifecycleMenu";
import { restoreNativeModelAction } from "@/features/sessions/lifecycle";
import { Composer } from "@/features/transcript/Composer";
import { sessionsStore } from "@/stores/sessions";
import { initI18n } from "@/i18n";
import { refreshSessionMetadata } from "@/app/sessionSync";

vi.mock("@/daemon/rest/client", () => ({ request: vi.fn() }));
const socketRequest = vi.hoisted(() => vi.fn());
vi.mock("@/app/connection", () => ({ getDaemonSocket: () => ({ request: socketRequest }) }));

const availability = {
  owner: "unowned",
  activity: "idle",
  can_resume: true,
  can_release: false,
  can_restore: true,
  reason: null,
} as const;

function Panel() {
  const session = useStore(sessionsStore, (state) => state.sessions.s1!);
  return (
    <>
      <LifecycleMenu session={session} />
      <Composer sessionId="s1" />
    </>
  );
}

beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  vi.mocked(request).mockReset();
});
afterEach(cleanup);

function seed(harness: "claude" | "codex") {
  sessionsStore.setState({
    sessions: {
      s1: {
        id: "s1",
        harness,
        state: "stopped",
        title: "Synthetic session",
        deleted: false,
        pendingApprovals: 0,
        nativeId: "native-s1",
        model: "fixture/gateway",
        gatewayRouteId: "route",
        reasoningEffort: "high",
        availability,
      },
    },
    order: ["s1"],
    drafts: {},
  });
}

it.each(["codex", "claude"] as const)(
  "refreshes the %s model displayed after clicking Restore",
  async (harness) => {
    seed(harness);
    const model = harness === "codex" ? "gpt-5.6-luna" : "default";
    vi.mocked(request).mockImplementation(async (path) => {
      if (path.endsWith("/restore-native-model")) return availability;
      if (path === "/v1/sessions/s1")
        return {
          id: "s1",
          harness,
          native_id: "native-s1",
          state: "stopped",
          title: "Synthetic session",
          project_path: "/workspace",
          model,
          model_source: "native",
          reasoning_effort: null,
        };
      if (path.endsWith("/models"))
        return [{ id: model, display_name: "Native model", reasoning_efforts: [] }];
      return [];
    });
    render(<Panel />);
    expect(screen.getByRole("button", { name: "Model" }).textContent).toContain("fixture/gateway");
    fireEvent.click(screen.getByRole("button", { name: "Session actions" }));
    fireEvent.click(screen.getByRole("menuitem", { name: "Restore native model" }));
    await waitFor(() =>
      expect(sessionsStore.getState().sessions.s1?.model).toBe(`native:${harness}/${model}`),
    );
    expect(sessionsStore.getState().sessions.s1?.gatewayRouteId).toBeUndefined();
    expect(sessionsStore.getState().sessions.s1?.reasoningEffort).toBeNull();
    expect(screen.getByRole("button", { name: "Model" }).textContent).not.toContain(
      "fixture/gateway",
    );
    expect(request).toHaveBeenCalledWith("/v1/sessions/s1/restore-native-model", {
      method: "POST",
      timeoutMs: null,
    });
    expect(request).toHaveBeenCalledWith("/v1/sessions/s1", {});
  },
);

it("preserves the current selection when native restoration fails", async () => {
  seed("codex");
  vi.mocked(request).mockRejectedValue(new Error("Native restore failed"));
  await expect(restoreNativeModelAction("s1")).rejects.toThrow("Native restore failed");
  expect(sessionsStore.getState().sessions.s1?.model).toBe("fixture/gateway");
  expect(request).toHaveBeenCalledTimes(1);
});

it("discards a stale session list that arrives after native restoration", async () => {
  seed("codex");
  const restored = {
    id: "s1",
    harness: "codex",
    native_id: "native-s1",
    state: "stopped",
    title: "Synthetic session",
    project_path: "/workspace",
    model: "gpt-5.6-luna",
    model_source: "native",
    reasoning_effort: null,
  };
  let finish!: (value: unknown) => void;
  socketRequest.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = refreshSessionMetadata();
  vi.mocked(request).mockImplementation(async (path) =>
    path.endsWith("/restore-native-model") ? availability : restored,
  );
  await restoreNativeModelAction("s1");
  finish({ sessions: [{ ...restored, model: "fixture/gateway", model_source: "gateway" }] });
  await loading;
  expect(sessionsStore.getState().sessions.s1?.model).toBe("native:codex/gpt-5.6-luna");
  expect(sessionsStore.getState().syncState).toBe("idle");
});

it("does not apply the old daemon's restored model after reconnecting elsewhere", async () => {
  seed("codex");
  vi.mocked(request).mockImplementation(async (path) => {
    if (path.endsWith("/restore-native-model")) return availability;
    daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
    seed("claude");
    return { id: "s1", harness: "codex", model: "native", model_source: "native" };
  });
  await restoreNativeModelAction("s1");
  expect(sessionsStore.getState().sessions.s1?.harness).toBe("claude");
  expect(sessionsStore.getState().sessions.s1?.model).toBe("fixture/gateway");
});
