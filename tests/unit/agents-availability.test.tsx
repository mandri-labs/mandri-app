import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import {
  agentsStore,
  refreshAgents,
  setAgentDraft,
  upsertAgent,
  ingestAgentFrame,
} from "@/stores/agents";
import { daemonIdentity } from "@/daemon/identity";
import { refreshAvailability, applyAvailability } from "@/features/sessions/availability";
import { getSessionAvailability, type SessionAvailability } from "@/daemon/rest/availability";
import { sessionsStore } from "@/stores/sessions";
import { approvalsStore, setApprovalTransport } from "@/stores/approvals";
import { SessionApprovals } from "@/features/approvals/SessionApprovals";
import { useAgentsSync } from "@/features/agents/useAgentsSync";
import { Shell } from "@/app/Shell";
import { AgentSidebar } from "@/features/agents/AgentSidebar";
import type { AgentView } from "@/daemon/types/agents";
import { initI18n } from "@/i18n";
import { CreateAgentDialog } from "@/features/agents/CreateAgentDialog";
import { DaemonError } from "@/daemon/errors";
import { AgentView as AgentPanel } from "@/features/agents/AgentView";
import { connectionStore } from "@/stores/connection";

const request = vi.hoisted(() => vi.fn());
const unsubscribeTopic = vi.hoisted(() => vi.fn());
vi.mock("@/app/connection", () => ({
  getDaemonSocket: () => ({
    request,
    onFrame: () => () => undefined,
    subscribe: vi.fn(),
    unsubscribe: unsubscribeTopic,
  }),
}));
vi.mock("@/features/transcript/Transcript", () => ({ Transcript: () => <div /> }));
vi.mock("@/daemon/rest/availability", () => ({ getSessionAvailability: vi.fn() }));
const child: AgentView = {
  id: "child",
  parent_session_id: "parent",
  parent_agent_id: null,
  session_id: null,
  native_id: "native-child",
  harness: "opencode",
  title: "Child",
  state: "running",
  delegation_id: null,
  capabilities: { message: true, stop: true },
  created_at: 1,
  updated_at: 1,
};
const free: SessionAvailability = {
  owner: "unowned",
  activity: "idle",
  can_resume: true,
  can_release: false,
  can_restore: false,
  reason: null,
};
beforeAll(async () => {
  await initI18n("en");
});
beforeEach(() => {
  daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
  request.mockReset();
  unsubscribeTopic.mockReset();
  vi.mocked(getSessionAvailability).mockReset().mockResolvedValue(free);
  sessionsStore.setState({
    sessions: {
      parent: {
        id: "parent",
        title: "Parent",
        harness: "opencode",
        state: "discovered",
        deleted: false,
        pendingApprovals: 0,
      },
    },
    order: ["parent"],
  });
  approvalsStore.setState({ pending: {}, recent: [], errors: {}, submitting: {} });
});
afterEach(() => {
  cleanup();
  setApprovalTransport(null);
});

it("does not overwrite a newer live child update with an in-flight list", async () => {
  let finish!: (result: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = refreshAgents();
  upsertAgent({ ...child, state: "completed", updated_at: 2 });
  finish({ agents: [child], parent_capabilities: { parent: { create: true } } });
  await loading;
  expect(agentsStore.getState().agents.child?.state).toBe("completed");
  expect(agentsStore.getState().parentCapabilities.parent?.create).toBe(true);
});

it("reconciles uncertain child creation without leaving a duplicate instruction ready to send", async () => {
  request.mockRejectedValue(
    new DaemonError({ code: "delivery_unknown", message: "lost acknowledgement" }),
  );
  render(<CreateAgentDialog sessionId="parent" onClose={vi.fn()} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Instruction" }), {
    target: { value: "Review the cache" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sub-agent" }));
  await waitFor(() => expect(screen.getByRole("alert")).toBeTruthy());
  expect((screen.getByRole("textbox", { name: "Instruction" }) as HTMLTextAreaElement).value).toBe(
    "",
  );
  expect(
    (screen.getByRole("button", { name: "Create sub-agent" }) as HTMLButtonElement).disabled,
  ).toBe(true);
  expect(request.mock.calls.filter(([action]) => action === "agent.create")).toHaveLength(1);
  expect(request.mock.calls.some(([action]) => action === "agent.list")).toBe(true);
});

it("discards old daemon children, capabilities and drafts including late list results", async () => {
  let finish!: (result: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  upsertAgent(child);
  setAgentDraft(child.id, "Private draft");
  const loading = refreshAgents();
  daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
  finish({ agents: [child], parent_capabilities: { parent: { create: true } } });
  await loading;
  expect(agentsStore.getState()).toMatchObject({
    agents: {},
    drafts: {},
    parentCapabilities: {},
    loaded: false,
  });
});

it("merges only children changed during a list and keeps list-derived capabilities", async () => {
  upsertAgent(child);
  upsertAgent({ ...child, id: "other" });
  upsertAgent({ ...child, id: "removed" });
  let finish!: (result: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = refreshAgents();
  ingestAgentFrame({
    topic: "agents.all",
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: {
      type: "agent_changed",
      agent: { ...child, state: "completed", capabilities: { message: false, stop: false } },
    },
  });
  expect(agentsStore.getState().agents.child?.capabilities.message).toBe(true);
  finish({
    agents: [
      child,
      { ...child, id: "other", state: "stopped", capabilities: { message: false, stop: false } },
    ],
    parent_capabilities: {},
  });
  await loading;
  expect(agentsStore.getState().agents.child).toMatchObject({
    state: "completed",
    capabilities: { message: true, stop: true },
  });
  expect(agentsStore.getState().agents.other).toMatchObject({
    state: "stopped",
    capabilities: { message: false, stop: false },
  });
  expect(agentsStore.getState().agents.removed).toBeUndefined();
});

it.each(["send", "stop"] as const)(
  "does not let a late %s completion populate a new daemon's agents or drafts",
  async (control) => {
    let finish!: (value: unknown) => void;
    let reject!: (reason: unknown) => void;
    request.mockImplementation(
      () =>
        new Promise((resolve, fail) => {
          finish = resolve;
          reject = fail;
        }),
    );
    upsertAgent(child);
    setAgentDraft(child.id, "Private instruction");
    connectionStore.setState({ status: "online" });
    render(<AgentPanel agentId={child.id} />);
    if (control === "send")
      fireEvent.keyDown(screen.getByRole("textbox", { name: "Message to sub-agent" }), {
        key: "Enter",
      });
    else fireEvent.click(screen.getByRole("button", { name: "Stop" }));
    await act(async () => {
      daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
      if (control === "send")
        reject(new DaemonError({ code: "service_unavailable", message: "old daemon" }));
      else finish({ agent_id: child.id, stopped: true });
    });
    expect(agentsStore.getState()).toMatchObject({ agents: {}, drafts: {} });
    expect(request).toHaveBeenCalledTimes(1);
  },
);

it("does not navigate to a child created on a previous daemon", async () => {
  let finish!: (result: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const onClose = vi.fn();
  window.location.hash = "#/session/parent";
  render(<CreateAgentDialog sessionId="parent" onClose={onClose} />);
  fireEvent.change(screen.getByRole("textbox", { name: "Instruction" }), {
    target: { value: "Private instruction" },
  });
  fireEvent.click(screen.getByRole("button", { name: "Create sub-agent" }));
  await act(async () => {
    daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
    finish({ agent: child });
  });
  expect(agentsStore.getState().agents).toEqual({});
  expect(window.location.hash).toBe("#/session/parent");
  expect(onClose).not.toHaveBeenCalled();
});

it.each([undefined, "mandri", "external", "unowned"] as const)(
  "preserves %s availability during pending, failed and inconclusive refreshes",
  async (owner) => {
    const previous: SessionAvailability | undefined = owner === undefined ? undefined : {
      ...free,
      owner,
      can_resume: owner === "unowned",
      can_release: owner === "mandri",
    };
    sessionsStore.getState().applySessionPatch("parent", { availability: previous });
    const session = sessionsStore.getState().sessions.parent;
    let fail!: (error: Error) => void;
    vi.mocked(getSessionAvailability).mockImplementationOnce(() => new Promise((_resolve, reject) => {
      fail = reject;
    }));
    const loading = refreshAvailability("parent");
    expect(refreshAvailability("parent")).toBe(loading);
    expect(sessionsStore.getState().sessions.parent).toBe(session);
    fail(new Error("Registry unavailable"));
    await loading;
    expect(sessionsStore.getState().sessions.parent).toBe(session);

    vi.mocked(getSessionAvailability).mockResolvedValueOnce({
      ...free,
      owner: "unknown",
      activity: "unknown",
      can_resume: false,
      reason: "writer_status_unavailable",
    });
    await refreshAvailability("parent");
    expect(sessionsStore.getState().sessions.parent).toBe(session);

    vi.mocked(getSessionAvailability).mockResolvedValueOnce(null as unknown as SessionAvailability);
    await refreshAvailability("parent");
    expect(sessionsStore.getState().sessions.parent).toBe(session);

    let finish!: (result: SessionAvailability) => void;
    vi.mocked(getSessionAvailability).mockImplementationOnce(() => new Promise((resolve) => {
      finish = resolve;
    }));
    const retry = refreshAvailability("parent");
    expect(sessionsStore.getState().sessions.parent).toBe(session);
    finish(free);
    await retry;
    expect(sessionsStore.getState().sessions.parent?.availability).toBe(free);
  },
);

it("does not apply an ownership response from a previous daemon", async () => {
  let finish!: (result: SessionAvailability) => void;
  vi.mocked(getSessionAvailability).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = refreshAvailability("parent");
  daemonIdentity.setState((state) => ({ generation: state.generation + 1 }));
  finish(free);
  await loading;
  expect(sessionsStore.getState().sessions.parent?.availability).toBeUndefined();
});

it("does not undo a confirmed release with an older ownership lookup", async () => {
  let finish!: (result: SessionAvailability) => void;
  vi.mocked(getSessionAvailability).mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const loading = refreshAvailability("parent");
  applyAvailability("parent", free);
  finish({ ...free, owner: "mandri", can_release: true, can_resume: false });
  await loading;
  expect(sessionsStore.getState().sessions.parent?.availability).toEqual(free);
});

it("renders nested and orphan child relationships once even for malformed cycles", () => {
  const nested = { ...child, id: "nested", title: "Nested", parent_agent_id: child.id };
  const orphan = { ...child, id: "orphan", title: "Orphan", parent_agent_id: "missing" };
  const cycle = { ...child, id: "cycle", title: "Cycle", parent_agent_id: "cycle" };
  render(<AgentSidebar agents={[nested, child, orphan, cycle]} activeId="nested" />);
  const buttons = screen
    .getAllByRole("button")
    .filter((button) => button.classList.contains("shell-agent-row"));
  expect(buttons.map((button) => button.textContent)).toEqual([
    "Child",
    "Nested",
    "Orphan",
    "Cycle",
  ]);
  expect(buttons[1]?.getAttribute("aria-current")).toBe("page");
  fireEvent.click(buttons[1]!);
  expect(window.location.hash).toBe("#/agent/nested");
  fireEvent.click(screen.getByRole("button", { name: "Sub-agents (4)" }));
  expect(screen.queryByRole("button", { name: "Nested — Running" })).toBeNull();
});

it("scopes a child's approval and answers through the existing approval id", async () => {
  upsertAgent(child);
  const answer = vi.fn(async () => ({
    approval_id: "approval-child",
    status: "answered" as const,
  }));
  setApprovalTransport({ answer, cancel: vi.fn() });
  approvalsStore.getState().ingestFrame({
    type: "approval.pending",
    topic: "agent.child",
    source: "opencode",
    seq: 1,
    ts: Date.now(),
    approval_id: "approval-child",
    deadline: Date.now() + 60_000,
    status: "pending",
    raw: {
      type: "permission.asked",
      properties: { permission: "bash", patterns: ["echo approved"] },
    },
  });
  const view = render(<SessionApprovals sessionId="parent" agentId="other-child" />);
  expect(screen.queryByRole("button")).toBeNull();
  view.rerender(<SessionApprovals sessionId="parent" agentId="child" />);
  fireEvent.click(screen.getByRole("button", { name: "Allow once" }));
  expect(answer).toHaveBeenCalledWith({ approval_id: "approval-child", decision: "once" });
});

it("enriches a child-first replay with its parent mirror without duplicating the approval", () => {
  const frame = {
    type: "approval.pending",
    topic: "agent.child",
    source: "opencode",
    seq: 1,
    ts: Date.now(),
    approval_id: "replayed",
    deadline: Date.now() + 60_000,
    status: "pending",
    raw: {},
  } as const;
  approvalsStore.getState().ingestFrame(frame);
  expect(approvalsStore.getState().pending.replayed).toMatchObject({
    agentId: "child",
    sessionId: "replayed",
  });
  approvalsStore.getState().ingestFrame({ ...frame, topic: "session.parent", agent_id: "child" });
  expect(Object.keys(approvalsStore.getState().pending)).toEqual(["replayed"]);
  expect(approvalsStore.getState().pending.replayed).toMatchObject({
    agentId: "child",
    sessionId: "parent",
  });
});

it("keeps unclassified sessions out of root rows until hierarchy and coverage arrive together", () => {
  const parent = sessionsStore.getState().sessions.parent!;
  sessionsStore.setState({
    sessions: { parent, nativeChild: { ...parent, id: "nativeChild", title: "Native child" } },
    order: ["parent", "nativeChild"],
  });
  const view = render(<Shell route={{ name: "session", id: "parent" }}>Conversation</Shell>);
  expect(view.container.querySelectorAll(".shell-session-row:not(.shell-agent-row)")).toHaveLength(
    0,
  );
  expect(screen.getByRole("status").textContent).toMatch(/^Loading sessions/);
  act(() => {
    agentsStore.setState({
      agents: { child: { ...child, session_id: "nativeChild" } },
      loaded: true,
      classifiedSessionIds: ["parent", "nativeChild"],
    });
  });
  expect(
    Array.from(
      view.container.querySelectorAll(
        ".shell-session-row:not(.shell-agent-row) .shell-session-title",
      ),
      (row) => row.textContent,
    ),
  ).toEqual(["Parent"]);
  expect(screen.queryByRole("status")).toBeNull();
  expect(view.container.querySelectorAll(".shell-agent-row")).toHaveLength(1);
  act(() => {
    sessionsStore.setState({
      sessions: {
        ...sessionsStore.getState().sessions,
        unknown: { ...parent, id: "unknown", title: "Not classified yet" },
      },
      order: ["parent", "nativeChild", "unknown"],
    });
  });
  expect(view.container.querySelectorAll(".shell-session-row:not(.shell-agent-row)")).toHaveLength(
    1,
  );
  expect(screen.queryByRole("status")).toBeNull();
  expect(screen.queryByText(/Loading sub-agents/)).toBeNull();
  expect(screen.queryByText(/unclassified session/)).toBeNull();
  expect(view.container.querySelectorAll(".shell-agent-row")).toHaveLength(1);
  act(() => agentsStore.setState({ classifiedSessionIds: ["parent", "nativeChild", "unknown"] }));
  expect(screen.queryByText("1 unclassified session")).toBeNull();
  expect(view.container.querySelectorAll(".shell-session-row:not(.shell-agent-row)")).toHaveLength(
    2,
  );
});

it("shows only the selected family, keeps it expanded for descendant routes, and hides families on the dashboard", () => {
  const parent = sessionsStore.getState().sessions.parent!;
  sessionsStore.setState({
    sessions: { parent, other: { ...parent, id: "other", title: "Other parent" } },
    order: ["parent", "other"],
  });
  agentsStore.setState({
    agents: {
      child,
      second: { ...child, id: "second", parent_session_id: "other", title: "Other child" },
    },
    loaded: true,
    classifiedSessionIds: ["parent", "other"],
  });
  const view = render(<Shell route={{ name: "session", id: "parent" }}>Conversation</Shell>);
  const titles = () =>
    Array.from(view.container.querySelectorAll(".shell-agent-row"), (row) => row.textContent);
  expect(titles()).toEqual(["Child"]);
  view.rerender(<Shell route={{ name: "session", id: "other" }}>Conversation</Shell>);
  expect(titles()).toEqual(["Other child"]);
  view.rerender(<Shell route={{ name: "agent", id: "child" }}>Conversation</Shell>);
  expect(titles()).toEqual(["Child"]);
  view.rerender(<Shell route={{ name: "dashboard" }}>Dashboard</Shell>);
  expect(titles()).toEqual([]);
  expect(view.container.querySelectorAll(".shell-session-row:not(.shell-agent-row)")).toHaveLength(
    2,
  );
});

it("prioritizes the selected family without replacing other cached families and releases its subscription", async () => {
  const second = { ...child, id: "second", parent_session_id: "other" };
  request.mockImplementation((_action, params) =>
    Promise.resolve({
      agents: params.session_id ? [] : [child, second],
      parent_capabilities: {},
      classified_session_ids: ["parent", "other"],
    }),
  );
  connectionStore.setState({ status: "online" });
  function Sync({ selected }: { selected: string | null }) {
    useAgentsSync(selected);
    return null;
  }
  const view = render(<Sync selected="parent" />);
  await waitFor(() => expect(agentsStore.getState().loaded).toBe(true));
  expect(request).toHaveBeenCalledWith("agent.list", { session_id: "parent" });
  expect(Object.keys(agentsStore.getState().agents)).toEqual(["child", "second"]);
  view.rerender(<Sync selected="other" />);
  await waitFor(() => expect(request).toHaveBeenCalledWith("agent.list", { session_id: "other" }));
  expect(Object.keys(agentsStore.getState().agents)).toEqual(["child", "second"]);
  view.unmount();
  expect(unsubscribeTopic).toHaveBeenCalledWith("agents.all");
});

it("never renders a newly announced child as a root when its event races with an older list", async () => {
  const parent = sessionsStore.getState().sessions.parent!;
  sessionsStore.setState({
    sessions: { parent, nativeChild: { ...parent, id: "nativeChild", title: "Native child" } },
    order: ["parent", "nativeChild"],
  });
  let finish!: (result: unknown) => void;
  request.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  const view = render(<Shell route={{ name: "agent", id: "child" }}>Child history</Shell>);
  const loading = refreshAgents();
  await act(async () => {
    ingestAgentFrame({
      topic: "agents.all",
      seq: 1,
      source: "mandri",
      ts: 1,
      raw: { type: "agent_changed", agent: { ...child, session_id: "nativeChild" } },
    });
    finish({
      agents: [],
      parent_capabilities: {},
      classified_session_ids: ["parent", "nativeChild"],
    });
    await loading;
  });
  expect(
    Array.from(
      view.container.querySelectorAll(
        ".shell-session-row:not(.shell-agent-row) .shell-session-title",
      ),
      (row) => row.textContent,
    ),
  ).toEqual(["Parent"]);
  expect(view.container.querySelectorAll(".shell-agent-row")).toHaveLength(1);
  expect(view.container.querySelector(".shell-agent-row")?.getAttribute("aria-current")).toBe(
    "page",
  );
});

it("retries a classification invalidation received during an in-flight cache response", async () => {
  let finish!: (result: unknown) => void;
  request.mockImplementationOnce(
    () =>
      new Promise((resolve) => {
        finish = resolve;
      }),
  );
  request.mockResolvedValue({
    agents: [child],
    parent_capabilities: {},
    classified_session_ids: ["parent"],
  });
  const loading = refreshAgents();
  ingestAgentFrame({
    topic: "agents.all",
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: { type: "agents_changed" },
  });
  finish({ agents: [], parent_capabilities: {}, classified_session_ids: [] });
  await loading;
  await waitFor(() => expect(agentsStore.getState().classifiedSessionIds).toEqual(["parent"]));
  expect(request).toHaveBeenCalledTimes(2);
  expect(agentsStore.getState().agents.child).toBeTruthy();
});
