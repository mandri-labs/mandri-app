import { beforeEach, describe, expect, it, vi } from "vitest";
import { DaemonError } from "@/daemon/errors";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import type { NativeCommand } from "@/daemon/types/commands";
import { commandsStore } from "@/features/commands/store";
import { commandTransport } from "@/features/commands/service";
import { startNewSession } from "@/features/sessions/lifecycle";
import { startCommandSession } from "@/features/sessions/startCommandSession";
import { sessionsStore } from "@/stores/sessions";

vi.mock("@/features/sessions/lifecycle", () => ({ startNewSession: vi.fn() }));
vi.mock("@/daemon/ws/sessionFeed", () => ({ sessionFeed: { ensureSession: vi.fn(), subscribeSession: vi.fn(), sendPrompt: vi.fn() } }));
vi.mock("@/features/commands/service", () => ({ commandTransport: { invoke: vi.fn() } }));

const command: NativeCommand = { id: "discovered:test", name: "check", description: "Check", aliases: [], kind: "command" };
const record = { invocation_id: "invoke-1", session_id: "created-1", command, state: "running" as const, cancellable: false };
const input = { harness: "claude", model: "", cwd: "/workspace", operation_id: "start-1" };

beforeEach(() => {
  vi.clearAllMocks();
  window.location.hash = "";
  commandsStore.setState({ sessions: {} });
  sessionsStore.setState({ sessions: {}, order: [], drafts: {} });
  vi.mocked(startNewSession).mockResolvedValue({ id: "created-1", harness: "claude", state: "live", gateway_route_id: null });
  vi.mocked(commandTransport.invoke).mockResolvedValue(record);
});

describe("first native command", () => {
  it("creates a session and executes the native command without sending a prompt", async () => {
    const onCreated = vi.fn();
    const result = await startCommandSession({ input, command, args: " exact\nargs ", invocationId: "invoke-1", acceptResult: () => true, onCreated });
    expect(startNewSession).toHaveBeenCalledWith(input, expect.any(Function));
    expect(onCreated).toHaveBeenCalledWith("created-1");
    expect(commandTransport.invoke).toHaveBeenCalledExactlyOnceWith("created-1", "invoke-1", "discovered:test", " exact\nargs ");
    expect(sessionFeed.sendPrompt).not.toHaveBeenCalled();
    expect(result).toEqual(record);
    expect(commandsStore.getState().sessions["created-1"]).toEqual([record]);
    expect(window.location.hash).toBe("#/session/created-1");
  });

  it("retains an uncertain delivery in the created session without retrying", async () => {
    vi.mocked(commandTransport.invoke).mockRejectedValue(new DaemonError({ code: "delivery_unknown", message: "Connection lost" }));
    const result = await startCommandSession({ input, command, args: "", invocationId: "invoke-1", acceptResult: () => true, onCreated: vi.fn() });
    expect(result.state).toBe("unknown");
    expect(commandTransport.invoke).toHaveBeenCalledTimes(1);
    expect(sessionsStore.getState().drafts["created-1"]).toBeUndefined();
    expect(window.location.hash).toBe("#/session/created-1");
  });

  it("keeps a rejected command as a readable failure and restores its draft", async () => {
    vi.mocked(commandTransport.invoke).mockRejectedValue(new DaemonError({ code: "invalid_params", message: "Command no longer available" }));
    const result = await startCommandSession({ input, command, args: "workspace", invocationId: "invoke-1", acceptResult: () => true, onCreated: vi.fn() });
    expect(result.state).toBe("failed");
    expect(sessionsStore.getState().drafts["created-1"]).toBe("/check workspace");
    expect(sessionFeed.sendPrompt).not.toHaveBeenCalled();
  });

  it("does not execute a command after cancelled startup", async () => {
    await expect(startCommandSession({ input, command, args: "", invocationId: "invoke-1", acceptResult: () => false, onCreated: vi.fn() })).rejects.toThrow("cancelled");
    expect(commandTransport.invoke).not.toHaveBeenCalled();
    expect(window.location.hash).toBe("");
  });
});
