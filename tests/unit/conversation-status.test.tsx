import { afterEach, beforeAll, beforeEach, expect, it } from "vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { parseServerMessage } from "@/daemon/ws/protocol";
import type { ConversationStatus } from "@/daemon/types/conversationStatus";
import { ConversationIndicator } from "@/features/sessions/ConversationIndicator";
import { conversationStatusStore, ingestConversationFrame } from "@/stores/conversationStatus";
import { initI18n } from "@/i18n";

const working: ConversationStatus = {
  target: "session:session",
  revision: 1,
  work_state: "working",
  completion_revision: 0,
  read_revision: 0,
  outcome: null,
  completion_key: null,
  cycle_active: true,
};

function receive(status: unknown, topic = "conversations.all") {
  const frame = parseServerMessage({
    topic,
    seq: 1,
    source: "daemon",
    ts: 1,
    raw: { type: "conversation_status", status },
  });
  expect(frame).not.toBeNull();
  ingestConversationFrame(frame!);
}

beforeAll(() => initI18n("en"));
beforeEach(() => conversationStatusStore.setState({ statuses: {} }));
afterEach(cleanup);

it("updates the indicator from the daemon's enveloped status events without reconnecting", () => {
  render(<ConversationIndicator target="session:session" />);
  act(() => receive(working));
  expect(screen.getByRole("img").className).toContain("--working");
  act(() =>
    receive({
      ...working,
      revision: 2,
      work_state: "idle",
      cycle_active: false,
      completion_revision: 1,
      completion_key: "completion",
      outcome: "completed",
    }),
  );
  expect(screen.getByRole("img").className).toContain("--unread");
  act(() =>
    receive({
      ...working,
      revision: 3,
      work_state: "idle",
      cycle_active: false,
      completion_revision: 1,
      read_revision: 1,
      completion_key: "completion",
      outcome: "completed",
    }),
  );
  expect(screen.queryByRole("img")).toBeNull();
  act(() => receive(working));
  expect(screen.queryByRole("img")).toBeNull();
});

it("rejects malformed statuses and status-shaped harness events", () => {
  receive(working, "session:session");
  receive(null);
  receive({ ...working, read_revision: 3 });
  expect(conversationStatusStore.getState().statuses).toEqual({});
});

it("loads statuses from the initial snapshot", () => {
  ingestConversationFrame({
    type: "snapshot",
    topic: "sessions.all",
    sessions: [],
    runtimes: [],
    statuses: [working],
  });
  expect(conversationStatusStore.getState().statuses[working.target]).toEqual(working);
});
