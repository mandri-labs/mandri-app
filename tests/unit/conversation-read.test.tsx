import { useRef } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { cleanup, render, waitFor } from "@testing-library/react";
import { useConversationRead } from "@/features/sessions/useConversationRead";
import { readConversation } from "@/features/sessions/readConversation";
import { conversationStatusStore } from "@/stores/conversationStatus";
import { transcriptStore } from "@/stores/sessions";
import { connectionStore } from "@/stores/connection";

vi.mock("@/features/sessions/readConversation", () => ({
  readConversation: vi.fn(async () => {}),
}));
const refresh = vi.fn(async () => {});

function View({ focused = true }: { focused?: boolean }) {
  const viewport = useRef<HTMLDivElement>(null);
  useConversationRead({ sessionId: "session", viewport, latestIndex: 0, refresh });
  return (
    <div className={`pane ${focused ? "pane--focused" : ""}`}>
      <div ref={viewport}>
        <div data-index="0">Completed answer</div>
      </div>
    </div>
  );
}

beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
  vi.spyOn(document, "hasFocus").mockReturnValue(true);
  vi.spyOn(document, "hidden", "get").mockReturnValue(false);
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockReturnValue(
    new DOMRect(0, 0, 200, 100),
  );
  connectionStore.setState({ status: "online" });
  transcriptStore.getState().resetTranscripts();
  transcriptStore
    .getState()
    .setNodes("session", [{ kind: "assistant", key: "answer", text: "Completed answer" }]);
  transcriptStore.getState().setFlags("session", {
    loadedCompletionRevision: 1,
    loadedCompletionTarget: "session:session",
  });
  conversationStatusStore.setState({
    statuses: {
      "session:session": {
        target: "session:session",
        revision: 2,
        work_state: "idle",
        cycle_active: false,
        completion_revision: 1,
        read_revision: 0,
        outcome: "completed",
        completion_key: "completion",
      },
    },
  });
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

it("acknowledges the loaded completion only while its answer is visible in the focused pane", async () => {
  render(<View />);
  await waitFor(() =>
    expect(readConversation).toHaveBeenCalledWith("session:session", 1, "completion"),
  );
  expect(refresh).not.toHaveBeenCalled();
});

it.each(["hidden", "unfocused", "inactive pane", "scrolled away"])(
  "keeps unread status for a %s conversation",
  async (condition) => {
    if (condition === "hidden") vi.spyOn(document, "hidden", "get").mockReturnValue(true);
    if (condition === "unfocused") vi.spyOn(document, "hasFocus").mockReturnValue(false);
    if (condition === "scrolled away")
      vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(1000);
    render(<View focused={condition !== "inactive pane"} />);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(readConversation).not.toHaveBeenCalled();
  },
);

it.each([null, 0])(
  "refreshes without marking an unconfirmed history page as read (revision %s)",
  async (revision) => {
    transcriptStore.getState().setFlags("session", { loadedCompletionRevision: revision });
    render(<View />);
    await waitFor(() => expect(refresh).toHaveBeenCalledOnce());
    expect(readConversation).not.toHaveBeenCalled();
  },
);

it("does not acknowledge a completion with an unpersisted steering still visible", async () => {
  transcriptStore.getState().addPendingUser("session", "Continue with my correction");
  render(<View />);
  await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  expect(readConversation).not.toHaveBeenCalled();
});
