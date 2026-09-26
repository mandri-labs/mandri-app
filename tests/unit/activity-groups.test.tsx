import { describe, expect, it } from "vitest";
import { fireEvent, render, screen, cleanup } from "@testing-library/react";
import { afterEach } from "vitest";
import { activityKinds } from "@/features/transcript/activitySummary";
import { groupActivities } from "@/features/transcript/activityGroups";
import type { TranscriptNode } from "@/features/transcript/parse/types";
import { ActivityGroup } from "@/features/transcript/renderers/ActivityGroup";
import { ChangedFiles } from "@/features/transcript/renderers/ChangedFiles";
import { TranscriptNodeRenderer } from "@/features/transcript/renderers/TranscriptNodeRenderer";
import { parseFrame } from "@/features/transcript/parse";

const command: TranscriptNode = {
  kind: "tool",
  tool: "bash",
  label: "Shell",
  target: "npm test",
  status: "done",
  key: "cmd",
};
const edit: TranscriptNode = {
  kind: "diff",
  path: "src/main.ts",
  additions: 1,
  deletions: 0,
  lines: [{ type: "add", text: "first edit", newNo: 1 }],
  key: "edit1",
};
const secondEdit: TranscriptNode = {
  ...edit,
  key: "edit2",
  lines: [{ type: "add", text: "second edit", newNo: 2 }],
};
const message: TranscriptNode = { kind: "assistant", text: "Progress", key: "message" };
afterEach(cleanup);

describe("activity groups", () => {
  it("keeps mixed activities in order and separates assistant messages", () => {
    const rows = groupActivities([command, edit, message, secondEdit], true, 0);
    expect(rows.map((row) => row.kind)).toEqual(["group", "node", "group"]);
    expect(rows[0]).toMatchObject({ nodes: [command, edit], active: false });
    expect(rows[2]).toMatchObject({ nodes: [secondEdit], active: true });
  });

  it("adds a separate file summary only once work ends", () => {
    const input = [command, edit, message, secondEdit];
    const finished = groupActivities(input, false, 0);
    expect(finished.at(-1)).toMatchObject({ kind: "files", nodes: [edit, secondEdit] });
    expect(finished[0]).toMatchObject({ nodes: [command, edit] });
    expect(groupActivities(input, true, 0).some((row) => row.kind === "files")).toBe(false);
  });

  it("hides file summaries while another turn runs", () => {
    const rows = groupActivities([edit, message, command, secondEdit], true, 2, new Set([0, 2]));
    expect(rows.map((row) => row.kind)).toEqual(["group", "node", "group"]);
  });

  it("hides the trailing file summary when an active external turn has no loaded anchor", () => {
    const input = [edit, message];
    expect(groupActivities(input, true, input.length).some((row) => row.kind === "files")).toBe(false);
    expect(groupActivities(input, false, input.length).at(-1)).toMatchObject({ kind: "files", nodes: [edit] });
  });

  it("keeps group identity when a command completes and a diff arrives", () => {
    const before = groupActivities([{ ...command, status: "running" }], true, 0);
    const after = groupActivities([command, edit], true, 0);
    expect(before[0]?.key).toBe(after[0]?.key);
  });

  it("shows chronological activities on expansion and stops shimmering on completion", () => {
    const view = render(<ActivityGroup nodes={[command, edit]} sessionId="test" active />);
    expect(screen.queryByText("npm test")).toBeNull();
    expect(view.container.querySelector(".tr-shimmer")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    const buttons = screen.getAllByRole("button");
    expect(buttons[1]?.textContent).toContain("npm test");
    expect(buttons[2]?.textContent).toContain("main.ts");
    view.rerender(<ActivityGroup nodes={[command, edit]} sessionId="test" active={false} />);
    expect(view.container.querySelector(".tr-shimmer")).toBeNull();
    expect(screen.getByText("npm test")).toBeTruthy();
  });

  it("shows the current action while active and the event summary when finished", () => {
    const running = { ...command, status: "running" as const };
    const read: TranscriptNode = {
      ...command,
      key: "read",
      tool: "read",
      target: "README.md",
      status: "running",
    };
    const view = render(<ActivityGroup nodes={[running, read]} sessionId="test" active />);
    const title = screen.getByRole("button");
    expect(title.textContent).toContain("action_read");
    expect(title.textContent).not.toContain("activities_command");
    expect(title.textContent).not.toContain("README.md");
    expect(view.container.querySelector(".tr-activity-title.tr-shimmer")).not.toBeNull();
    expect(view.container.querySelector(".lucide-book-open")).not.toBeNull();
    fireEvent.click(title);
    expect(screen.getAllByRole("button")[1]?.textContent).toContain("npm test");
    expect(screen.getAllByRole("button")[2]?.textContent).toContain("action_read");
    view.rerender(
      <ActivityGroup
        nodes={[command, { ...read, status: "done" }]}
        sessionId="test"
        active={false}
      />,
    );
    expect(screen.getAllByRole("button")[0]?.textContent).toContain("activities_read");
    expect(screen.getAllByRole("button")[0]?.textContent).toContain("activities_command");
    expect(view.container.querySelector(".tr-shimmer")).toBeNull();
  });

  it.each([
    ["claude", { type: "assistant", uuid: "thinking", message: {
      id: "message", content: [{ type: "thinking", thinking: "Considering options" }],
    } }],
    ["opencode", { type: "message.part.updated", properties: {
      part: { id: "thinking", type: "reasoning", text: "Considering options" },
    } }],
    ["codex", { method: "item/completed", params: {
      item: { id: "thinking", type: "reasoning", summary: ["Considering options"] },
    } }],
  ] as const)("shows %s thinking with one disclosure before and after completion", (harness, raw) => {
    const nodes = parseFrame(harness, raw);
    expect(nodes).toHaveLength(1);
    const rows = groupActivities(nodes, true, 0);
    expect(rows[0]).toMatchObject({ kind: "node", node: { kind: "thinking" } });
    const node = rows[0];
    if (node?.kind !== "node") throw new Error("Thinking should be a standalone row");
    const view = render(<TranscriptNodeRenderer node={node.node} thinkingActive />);
    expect(screen.getByRole("button").textContent).toContain("thinking");
    expect(screen.queryByText("Considering options")).toBeNull();
    expect(view.container.querySelector(".tr-thinking-title.tr-shimmer")).not.toBeNull();
    fireEvent.click(screen.getByRole("button"));
    expect(screen.getByText("Considering options")).toBeTruthy();
    expect(screen.getAllByRole("button")).toHaveLength(1);
    view.rerender(<TranscriptNodeRenderer node={node.node} thinkingActive={false} />);
    expect(screen.getByRole("button").textContent).toContain("reasoning");
    expect(screen.getByText("Considering options")).toBeTruthy();
    expect(view.container.querySelector(".tr-shimmer")).toBeNull();
    expect(view.container.querySelector(".tr-activity-group")).toBeNull();
    expect(view.container.querySelectorAll("svg")).toHaveLength(1);
    expect(groupActivities([command, ...nodes, command, message], false, 0).map((row) => row.kind))
      .toEqual(["group", "node", "group", "node"]);
  });

  it("summarizes every completed activity type, without repeating categories", () => {
    const read: TranscriptNode = { ...command, key: "read", tool: "read", target: "README.md" };
    expect(activityKinds([read, command, read, edit])).toEqual(["edit", "read", "command"]);
    const view = render(<ActivityGroup nodes={[read, command]} sessionId="test" active={false} />);
    const title = screen.getByRole("button").textContent;
    expect(title).toContain("activities_read");
    expect(title).toContain("activities_command");
    expect(view.container.querySelector(".lucide-book-open")).not.toBeNull();
    expect(view.container.querySelector(".tr-shimmer")).toBeNull();
  });

  it("shows one row per changed file instead of duplicating the Codex edit placeholder", () => {
    const placeholder: TranscriptNode = {
      kind: "tool",
      tool: "edit",
      label: "File change",
      target: edit.path,
      status: "done",
      key: "patch",
    };
    const diff = { ...edit, key: "patch:diff:src/main.ts" };
    const view = render(
      <ActivityGroup nodes={[placeholder, diff]} sessionId="test" active={false} />,
    );
    fireEvent.click(screen.getByRole("button"));
    expect(view.container.querySelectorAll(".tr-diff")).toHaveLength(1);
    expect(view.container.querySelectorAll(".tr-tool")).toHaveLength(0);
  });

  it("shows the combined diff once for a repeatedly edited file", () => {
    const view = render(<ChangedFiles nodes={[edit, secondEdit]} />);
    fireEvent.click(screen.getByRole("button"));
    fireEvent.click(screen.getAllByRole("button")[1]!);
    const diffs = view.container.querySelectorAll(".tr-diff > button");
    expect(diffs).toHaveLength(1);
    expect(view.container.querySelector(".tr-diff-add")?.textContent).toBe("+2");
    expect(screen.getByText("first edit")).toBeTruthy();
    expect(screen.getByText("second edit")).toBeTruthy();
  });
});
