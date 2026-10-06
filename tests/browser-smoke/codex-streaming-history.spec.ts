import assert from "node:assert/strict";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let socket: WebSocketRoute | undefined;
  let historyRequests = 0;
  let seq = 0;
  const session = {
    id: "codex-streaming",
    harness: "codex",
    state: "live",
    title: "Codex streaming with delayed history",
    project_path: "/workspace",
    native_id: "native-test",
    model: "test/model",
    activity: "active",
  };
  let entries = [
    JSON.stringify({
      timestamp: new Date().toISOString(),
      type: "event_msg",
      payload: { type: "task_started", turn_id: "turn" },
    }),
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        id: "user",
        content: [{ type: "input_text", text: "Update these files." }],
        internal_chat_message_metadata_passthrough: { turn_id: "turn" },
      },
    }),
  ];
  await page.route("**/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/availability")
        ? {
            owner: "mandri",
            activity: "active",
            can_resume: false,
            can_release: false,
            can_restore: false,
            reason: null,
          }
        : path === "/v1/sessions"
          ? [session]
          : path === `/v1/sessions/${session.id}`
            ? session
            : [],
    });
  });
  await page.routeWebSocket("**/v1/ws", (current) => {
    socket = current;
    current.onMessage((data) => {
      const frame = JSON.parse(String(data));
      if (
        frame.action === "command.catalogs" ||
        frame.action === "command.catalog" ||
        frame.action === "command.list"
      ) {
        const result =
          frame.action === "command.list"
            ? { invocations: [] }
            : frame.action === "command.catalogs"
              ? { default_cwd: "/mock-project", catalogs: [] }
              : {
                  ...frame.params,
                  cwd: frame.params.cwd ?? "/mock-project",
                  profile_id: null,
                  execution_backend: frame.params.execution_backend ?? "host",
                  privacy_mode: frame.params.privacy_mode ?? "none",
                  state: "ready",
                  commands: [],
                  reason: null,
                };
        current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
        return;
      }
      const reply = (result: unknown) =>
        current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.action === "agent.list")
        reply({ agents: [], parent_capabilities: {}, classified_session_ids: [session.id] });
      else if (frame.action === "session.list") reply({ sessions: [session] });
      else if (frame.action === "session.history") {
        historyRequests++;
        reply({ entries, next_cursor: null, has_more: false, turn_active: true });
      } else if (frame.op === "subscribe") {
        current.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all")
          current.send(
            JSON.stringify({
              type: "snapshot",
              topic: "sessions.all",
              sessions: [session],
              runtimes: [],
            }),
          );
      } else if (frame.action) throw new Error(`Unexpected action: ${frame.action}`);
    });
  });
  const storedAnswer = (text: string) =>
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        id: "answer",
        content: [{ type: "output_text", text }],
      },
    });
  const prefix = [...entries];
  entries.push(storedAnswer("First"));
  const emit = (raw: unknown, source = "codex") =>
    socket!.send(
      JSON.stringify({
        topic: `session.${session.id}`,
        source,
        seq: ++seq,
        ts: Date.now(),
        raw,
      }),
    );
  const delta = (text: string) =>
    emit({ method: "item/agentMessage/delta", params: { itemId: "answer", delta: text } });
  const check = async (text: string) => {
    await page.getByText(text, { exact: true }).waitFor();
    assert.equal(await page.locator(".tr-assistant").count(), 1);
  };
  const refresh = async () => {
    const before = historyRequests;
    emit({ type: "history_changed" }, "mandri");
    for (let tries = 0; historyRequests <= before && tries < 100; tries++)
      await page.waitForTimeout(20);
    assert.ok(historyRequests > before);
    await page.waitForTimeout(150);
  };
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await check("First");
  delta(" second");
  await check("First second");
  await refresh();
  await check("First second");
  entries = [...prefix];
  socket!.send(
    JSON.stringify({ type: "gap", topic: `session.${session.id}`, reason: "history_lost" }),
  );
  await page.waitForTimeout(250);
  await check("First second");
  delta(" third");
  await check("First second third");
  emit({
    method: "item/completed",
    params: { item: { type: "agentMessage", id: "answer", text: "First second third" } },
  });
  await refresh();
  await check("First second third");
  entries.push(storedAnswer("First second third"));
  await refresh();
  await check("First second third");
  await page.reload();
  await check("First second third");
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      staleHistory: "preserved",
      historyGap: "preserved",
      completion: "preserved",
      reload: "preserved",
      historyRequests,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
