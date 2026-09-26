import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { SessionFeedService } from "@/daemon/ws/sessionFeed";
import { parseStoredLine } from "@/daemon/ws/storedLine";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { TranscriptNodeRenderer } from "@/features/transcript/renderers/TranscriptNodeRenderer";
import { presentTranscript } from "@/features/transcript/presentation";
import { parseFrame } from "@/features/transcript/parse";

beforeAll(() => initI18n("en"));
afterEach(() => { cleanup(); transcriptStore.getState().resetTranscripts(); });

it.each([false, true])("renders a known large compaction with its icon (formatted JSON: %s)", (formatted) => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const marker = JSON.stringify({ type: "mandri.transcript_record", byte_length: 2.1 * 1024 ** 2,
    record_token: "reference", original_type: "compacted" }, null, formatted ? 2 : undefined);
  const nodes = parseStoredLine("codex", marker, { sessionId: "session" });
  expect(presentTranscript(nodes, false)).toEqual(nodes);
  const { container } = render(<TranscriptNodeRenderer node={nodes[0]!} />);
  expect(screen.getByText("Conversation context compacted")).toBeTruthy();
  expect(container.querySelector("svg.lucide-minimize-2")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  expect(screen.queryByText(/Large event/)).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});

it("renders inline and live Codex compactions consistently", () => {
  const history = parseStoredLine("codex", JSON.stringify({ type: "compacted", payload: { message: "summary" } }));
  const live = parseFrame("codex", { method: "item/completed", params: { item: { type: "contextCompaction", id: "compact" } } });
  for (const nodes of [history, live]) {
    expect(nodes).toMatchObject([{ kind: "system", messageKey: "commands.compacted" }]);
    expect(presentTranscript(nodes, false)).toEqual(nodes);
    const { container, unmount } = render(<TranscriptNodeRenderer node={nodes[0]!} />);
    expect(screen.getByText("Conversation context compacted")).toBeTruthy();
    expect(container.querySelector("svg.lucide-minimize-2")).toBeTruthy();
    unmount();
  }
  expect(parseFrame("codex", { method: "item/started", params: { item: { type: "contextCompaction" } } })).toEqual([]);
});

it.each([
  ["CommandExecution", "Command execution", "terminal"],
  ["ContextCompaction", "Conversation context compacted", "minimize-2"],
  ["FileChange", "File change", "pencil"],
])("identifies large nested Codex %s events", (type, label, icon) => {
  const marker = JSON.stringify({ type: "mandri.transcript_record", byte_length: 2190042,
    record_token: "reference", original_type: "event_msg", original_event_type: "item_completed", original_item_type: type });
  const nodes = parseStoredLine("codex", marker, { sessionId: "session" });
  const { container } = render(<TranscriptNodeRenderer node={nodes[0]!} />);
  expect(screen.getByText(label)).toBeTruthy();
  expect(container.querySelector(`svg.lucide-${icon}`)).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
});

it("shows the backend preview without a download or extra fetch", () => {
  const fetch = vi.spyOn(globalThis, "fetch");
  const marker = JSON.stringify({ type: "mandri.transcript_record", byte_length: 9 * 1024 * 1024, record_token: "reference", preview: "Command output\nfirst lines" });
  const nodes = parseStoredLine("codex", marker, { sessionId: "session" });
  expect(nodes).toHaveLength(1);
  expect(presentTranscript(nodes)).toEqual(nodes);
  render(<TranscriptNodeRenderer node={nodes[0]!} />);
  expect(screen.getByText("Large event (9.0 MiB).")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  expect(screen.getByText(/Command output/).textContent).toBe("Command output\nfirst lines");
  expect(fetch).not.toHaveBeenCalled();
  fetch.mockRestore();
});

it("keeps history available when external activity becomes unknown", async () => {
  sessionsStore.setState({ sessions: { one: {
    id: "one", harness: "codex", title: "One", state: "discovered", deleted: false,
    pendingApprovals: 0, externalBusy: false,
  } } });
  const feed = new SessionFeedService({ getSocket: () => null, fetchHistoryPage: async () => ({
    entries: [JSON.stringify({ type: "response_item", payload: { type: "message", role: "assistant", content: [{ text: "Readable history" }] } })],
    next_cursor: null, has_more: false, external_busy: null, turn_active: null,
  }) });
  feed.ensureSession("one", "codex");
  await feed.loadHistory("one");
  expect(feed.getNodes("one")).toEqual([expect.objectContaining({ text: "Readable history" })]);
  expect(sessionsStore.getState().sessions.one?.externalBusy).toBeUndefined();
  expect(sessionsStore.getState().sessions.one?.externalUnavailable).toBe(true);
  expect(transcriptStore.getState().transcripts.one?.historyUnavailable).toBe(false);
});

it.each(["codex", "claude", "pi", "opencode", "agy"] as const)("shows a backend preview for %s without a download token", (harness) => {
  const nodes = parseStoredLine(harness, JSON.stringify({ type: "mandri.transcript_record",
    byte_length: 2000000, preview: "First line\n<script>visible text</script>", preview_truncated: true }));
  expect(nodes).toHaveLength(1);
  expect(presentTranscript(nodes, false)).toEqual(nodes);
  const { container } = render(<TranscriptNodeRenderer node={nodes[0]!} />);
  expect(screen.getByText("Truncated preview")).toBeTruthy();
  expect(screen.queryByRole("link")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  expect(container.querySelector("pre")?.textContent).toBe("First line\n<script>visible text</script>");
  expect(container.querySelector("script")).toBeNull();
  fireEvent.click(screen.getByRole("button"));
  expect(container.querySelector("pre")).toBeNull();
});
