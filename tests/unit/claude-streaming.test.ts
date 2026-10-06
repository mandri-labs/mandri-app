import { expect, it } from "vitest";
import { createClaudeStreamState, parseFrame, parseHistoryLine } from "@/features/transcript/parse";
import { appendTranscriptNodes, mergeHistoryAndLive } from "@/daemon/ws/transcriptMerge";
import type { TranscriptNode } from "@/features/transcript/parse";

it("renders Claude text and thinking deltas before the full assistant message without duplicates", () => {
  const context = { claudeStream: createClaudeStreamState() };
  let nodes: TranscriptNode[] = [];
  const send = (event: unknown) => {
    nodes = appendTranscriptNodes(
      nodes,
      parseFrame("claude", { type: "stream_event", event }, context),
    );
  };
  send({ type: "message_start", message: { id: "msg-1" } });
  send({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "" },
  });
  send({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: "Let me" },
  });
  expect(nodes[0]).toMatchObject({ kind: "thinking", text: "Let me", streaming: true });
  send({
    type: "content_block_delta",
    index: 0,
    delta: { type: "thinking_delta", thinking: " think" },
  });
  send({ type: "content_block_stop", index: 0 });
  send({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  send({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: "Hello" } });
  expect(nodes[1]).toMatchObject({ kind: "assistant", text: "Hello", streaming: true });
  send({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: " world" } });
  send({ type: "message_stop" });
  expect(nodes).toHaveLength(2);
  expect(nodes[1]).toMatchObject({ text: "Hello world", streaming: false });
  const final = {
    type: "assistant",
    uuid: "envelope-1",
    message: {
      id: "msg-1",
      content: [
        { type: "thinking", thinking: "Let me think" },
        { type: "text", text: "Hello world" },
      ],
    },
  };
  const streamKeys = nodes.map((node) => node.key);
  nodes = appendTranscriptNodes(nodes, parseFrame("claude", final, context));
  expect(nodes.map((node) => node.key)).toEqual(streamKeys);
  const merged = mergeHistoryAndLive(parseHistoryLine("claude", JSON.stringify(final)), nodes);
  expect(merged.map((node) => node.key)).toEqual(streamKeys);
  expect(merged).toMatchObject([
    { kind: "thinking", text: "Let me think", claude: { blockId: "envelope-1:0" } },
    { kind: "assistant", text: "Hello world", claude: { blockId: "envelope-1:1" } },
  ]);
  expect(nodes).toHaveLength(2);
});

it("isolates interleaved Claude subagent streams and preserves native block indices", () => {
  const context = { claudeStream: createClaudeStreamState() };
  const send = (parent: string | null, event: unknown) =>
    parseFrame(
      "claude",
      {
        type: "stream_event",
        parent_tool_use_id: parent,
        event,
      },
      context,
    );
  send(null, { type: "message_start", message: { id: "main" } });
  send("task-1", { type: "message_start", message: { id: "child" } });
  send(null, {
    type: "content_block_start",
    index: 0,
    content_block: { type: "redacted_thinking" },
  });
  send(null, {
    type: "content_block_start",
    index: 1,
    content_block: { type: "text", text: "Main" },
  });
  expect(
    send("task-1", {
      type: "content_block_start",
      index: 0,
      content_block: { type: "text", text: "Child" },
    })[0],
  ).toMatchObject({ key: "child:assistant:0", text: "Child" });
  const delta = send(null, {
    type: "content_block_delta",
    index: 1,
    delta: { type: "text_delta", text: " reply" },
  });
  const final = parseFrame("claude", {
    type: "assistant",
    message: {
      id: "main",
      content: [{ type: "redacted_thinking" }, { type: "text", text: "Main reply" }],
    },
  });
  expect(delta[0]).toMatchObject({ key: final[0]?.key, text: "Main reply" });
});

it("updates streamed Claude tool arguments and keeps the same tool through its result", () => {
  const context = { claudeStream: createClaudeStreamState() };
  let nodes: TranscriptNode[] = [];
  const send = (event: unknown) => {
    nodes = appendTranscriptNodes(
      nodes,
      parseFrame("claude", { type: "stream_event", event }, context),
    );
  };
  send({ type: "message_start", message: { id: "msg-tool" } });
  send({
    type: "content_block_start",
    index: 0,
    content_block: { type: "tool_use", id: "tool-1", name: "Bash", input: {} },
  });
  send({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '{"command":' },
  });
  send({
    type: "content_block_delta",
    index: 0,
    delta: { type: "input_json_delta", partial_json: '"pwd"}' },
  });
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({ kind: "tool", key: "tool-1", target: "pwd", status: "pending" });
  nodes = appendTranscriptNodes(
    nodes,
    parseFrame("claude", {
      type: "user",
      message: { content: [{ type: "tool_result", tool_use_id: "tool-1", content: "/workspace" }] },
    }),
  );
  expect(nodes).toHaveLength(1);
  expect(nodes[0]).toMatchObject({
    kind: "tool",
    tool: "Bash",
    status: "done",
    detailText: "/workspace",
  });
});

function fragment(
  uuid: string,
  type: "text" | "thinking",
  text: string,
  messageId = "split-message",
) {
  return { type: "assistant", uuid, message: { id: messageId, content: [{ type, [type]: text }] } };
}

it("merges Claude SDK fragments with native stream indices and history in either arrival order", () => {
  for (const historyFirst of [false, true]) {
    const context = { claudeStream: createClaudeStreamState() };
    const thought = fragment("thought-uuid", "thinking", "Considering the image.");
    const answer = fragment("answer-uuid", "text", "The image shows a browser logo.");
    const history = [thought, answer].flatMap((raw) =>
      parseHistoryLine("claude", JSON.stringify(raw)),
    );
    let nodes: TranscriptNode[] = historyFirst ? history : [];
    const send = (event: unknown) => {
      nodes = appendTranscriptNodes(
        nodes,
        parseFrame("claude", { type: "stream_event", event }, context),
      );
    };
    send({ type: "message_start", message: { id: "split-message" } });
    for (const [index, type, text] of [
      [0, "thinking", "Considering the image."],
      [1, "text", "The image shows a browser logo."],
    ] as const) {
      send({ type: "content_block_start", index, content_block: { type, [type]: "" } });
      send({
        type: "content_block_delta",
        index,
        delta: { type: `${type === "text" ? "text" : "thinking"}_delta`, [type]: text },
      });
      const raw = index === 0 ? thought : answer;
      nodes = appendTranscriptNodes(nodes, parseFrame("claude", raw, context));
      send({ type: "content_block_stop", index });
    }
    send({ type: "message_stop" });
    const visibleKeys = nodes.map((node) => node.key);
    nodes = mergeHistoryAndLive(history, nodes);
    expect(nodes).toHaveLength(2);
    expect(nodes.map((node) => node.key)).toEqual(visibleKeys);
    expect(nodes.filter((node) => node.kind === "assistant")).toMatchObject([
      { text: "The image shows a browser logo." },
    ]);
    expect(nodes.filter((node) => node.kind === "thinking")).toMatchObject([
      { text: "Considering the image." },
    ]);
  }
});

it("preserves distinct Claude fragments even when they repeat exactly the same text", () => {
  const context = { claudeStream: createClaudeStreamState() };
  const first = fragment("first", "text", "Repeated text");
  const second = fragment("second", "text", "Repeated text");
  let nodes = [first, second].flatMap((raw) => parseHistoryLine("claude", JSON.stringify(raw)));
  expect(nodes).toHaveLength(2);
  const send = (event: unknown) => {
    nodes = appendTranscriptNodes(
      nodes,
      parseFrame("claude", { type: "stream_event", event }, context),
    );
  };
  send({ type: "message_start", message: { id: "split-message" } });
  for (const index of [0, 1]) {
    send({ type: "content_block_start", index, content_block: { type: "text", text: "" } });
    send({
      type: "content_block_delta",
      index,
      delta: { type: "text_delta", text: "Repeated text" },
    });
    send({ type: "content_block_stop", index });
  }
  send({ type: "message_stop" });
  nodes = appendTranscriptNodes(
    nodes,
    [first, second].flatMap((raw) => parseFrame("claude", raw, context)),
  );
  expect(nodes).toHaveLength(2);
  nodes = appendTranscriptNodes(
    nodes,
    parseFrame("claude", fragment("third", "text", "Repeated text", "other-message"), context),
  );
  expect(nodes).toHaveLength(3);
});

it("retires unfinished blocks when another message starts without stopping a child stream", () => {
  const context = { claudeStream: createClaudeStreamState() };
  let nodes: TranscriptNode[] = [];
  const send = (event: unknown, parent_tool_use_id: string | null = null) => {
    nodes = appendTranscriptNodes(
      nodes,
      parseFrame("claude", { type: "stream_event", event, parent_tool_use_id }, context),
    );
  };
  send({ type: "message_start", message: { id: "parent" } });
  send({
    type: "content_block_start",
    index: 0,
    content_block: { type: "text", text: "Unfinished reply" },
  });
  send({ type: "message_start", message: { id: "child" } }, "task");
  send(
    { type: "content_block_start", index: 0, content_block: { type: "text", text: "Child reply" } },
    "task",
  );
  send({ type: "message_start", message: { id: "replacement" } });
  expect(nodes).toMatchObject([
    { text: "Unfinished reply", streaming: false },
    { text: "Child reply", streaming: true },
  ]);
  send({
    type: "content_block_start",
    index: 0,
    content_block: { type: "thinking", thinking: "Next thought" },
  });
  expect(nodes.at(-1)).toMatchObject({ text: "Next thought", streaming: true });
});
