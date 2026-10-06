import type { HarnessKind } from "@/daemon/types/ws";

const iso = (at: number) => new Date(at).toISOString();
export function turnFixture(harness: HarnessKind, suffix = "one", start = 1000) {
  const end = start + 5000;
  const user = `user-${suffix}`;
  const answer = `answer-${suffix}`;
  const turn = `turn-${suffix}`;
  const text = "Same answer";
  const userMessage = { id: user, sessionID: "native", role: "user", time: { created: start } };
  const assistantMessage = {
    id: answer,
    sessionID: "native",
    role: "assistant",
    parentID: user,
    time: { created: start + 500, completed: end },
    finish: "stop",
  };
  const update = (info: object) => ({ type: "message.updated", properties: { info } });
  const part = (id: string, messageID: string, text: string) => ({
    type: "message.part.updated",
    properties: {
      part: { id, messageID, sessionID: "native", type: "text", text },
    },
  });
  const index = suffix === "one" ? 0 : 10;
  const step = (offset: number, fields: object) => ({
    event: "step_update",
    step_update: {
      conversation_id: "native",
      step_index: index + offset,
      ...fields,
    },
  });
  const piUser = { role: "user", timestamp: start, content: "Same prompt" };
  const piAssistant = {
    role: "assistant",
    timestamp: end,
    content: [{ type: "text", text }],
    stopReason: "stop",
  };
  const starts: Record<HarnessKind, unknown> = {
    pi: { type: "agent_start" },
    codex: { method: "turn/started", params: { threadId: "native", turn: { id: turn } } },
    claude: {
      type: "stream_event",
      session_id: "native",
      event: { type: "message_start", message: { id: answer } },
    },
    opencode: {
      type: "session.status",
      properties: { sessionID: "native", status: { type: "busy" } },
    },
    agy: { event: "hook", hook: "PreInvocation", data: { conversationId: "native" } },
  };
  const bodies: Record<HarnessKind, unknown[]> = {
    pi: [
      { type: "message_end", message: piUser },
      { type: "message_end", message: piAssistant },
    ],
    codex: [
      {
        method: "item/completed",
        params: { threadId: "native", item: { id: answer, type: "agentMessage", text } },
      },
    ],
    claude: [
      {
        type: "assistant",
        session_id: "native",
        message: {
          id: answer,
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
        },
      },
    ],
    opencode: [
      update(userMessage),
      part(`part-${user}`, user, "Same prompt"),
      update({ ...assistantMessage, time: { created: start + 500 }, finish: undefined }),
      part(`part-${answer}`, answer, text),
    ],
    agy: [
      step(0, { step_type: "user_input", state: "DONE", text: "Same prompt" }),
      step(1, { step_type: "agent_response", state: "ACTIVE", text }),
      step(1, { step_type: "agent_response", state: "DONE" }),
    ],
  };
  const finishes: Record<HarnessKind, unknown[]> = {
    pi: [{ type: "agent_settled" }],
    codex: [
      {
        method: "turn/completed",
        params: { threadId: "native", turn: { id: turn, status: "completed" } },
      },
    ],
    claude: [
      { type: "result", session_id: "native", subtype: "success", duration_ms: end - start },
    ],
    opencode: [
      update(assistantMessage),
      { type: "session.idle", properties: { sessionID: "native" } },
    ],
    agy: [{ event: "hook", hook: "Stop", data: { conversationId: "native", fullyIdle: true } }],
  };
  const history: Record<HarnessKind, unknown[]> = {
    pi: [
      { type: "message", timestamp: iso(start), message: piUser },
      { type: "message", timestamp: iso(end), message: piAssistant },
    ],
    codex: [
      {
        timestamp: iso(start),
        type: "event_msg",
        payload: { type: "task_started", turn_id: turn },
      },
      {
        timestamp: iso(start),
        type: "response_item",
        payload: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Same prompt" }],
        },
      },
      {
        timestamp: iso(end),
        type: "response_item",
        payload: { type: "message", role: "assistant", content: [{ type: "output_text", text }] },
      },
      { timestamp: iso(end), type: "event_msg", payload: { type: "task_complete", turn_id: turn } },
    ],
    claude: [
      {
        timestamp: iso(start),
        type: "user",
        uuid: user,
        message: { role: "user", content: "Same prompt" },
      },
      {
        timestamp: iso(end),
        type: "assistant",
        uuid: `uuid-${answer}`,
        message: {
          id: answer,
          role: "assistant",
          content: [{ type: "text", text }],
          stop_reason: "end_turn",
        },
      },
    ],
    opencode: [
      update(userMessage),
      part(`part-${user}`, user, "Same prompt"),
      update(assistantMessage),
      part(`part-${answer}`, answer, text),
    ],
    agy: [
      {
        created_at: iso(start),
        type: "USER_INPUT",
        step_index: index,
        status: "DONE",
        content: "Same prompt",
        source: "USER_EXPLICIT",
      },
      {
        created_at: iso(start + 500),
        type: "PLANNER_RESPONSE",
        step_index: index + 1,
        status: "DONE",
        content: text,
        source: "MODEL",
      },
    ],
  };
  return {
    start,
    end,
    starts: starts[harness],
    bodies: bodies[harness],
    finishes: finishes[harness],
    history: history[harness].map((value) => JSON.stringify(value)),
  };
}
