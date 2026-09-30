import assert from "node:assert/strict";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null } });
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
  const session = { id: "claude-dedup", harness: "claude", state: "live", title: "Claude split message fragments",
    project_path: "/workspace", native_id: "native-test", model: "test/model", activity: "active" };
  const entries = [JSON.stringify({ type: "user", uuid: "user", message: {
    role: "user", content: [{ type: "text", text: "What is in this image?" }],
  } })];
  await page.route("**/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/availability")
      ? { owner: "mandri", activity: "active", can_resume: false, can_release: false, can_restore: false, reason: null }
      : path === "/v1/sessions" ? [session] : path === `/v1/sessions/${session.id}` ? session : [] });
  });
  await page.routeWebSocket("**/v1/ws", (current) => {
    socket = current;
    current.onMessage((data) => {
      const frame = JSON.parse(String(data));
      if (frame.action === "command.catalogs" || frame.action === "command.catalog" || frame.action === "command.list") {
        const result = frame.action === "command.list" ? { invocations: [] } : frame.action === "command.catalogs"
          ? { default_cwd: "/mock-project", catalogs: [] }
          : { ...frame.params, cwd: frame.params.cwd ?? "/mock-project", profile_id: null,
              execution_backend: frame.params.execution_backend ?? "host", privacy_mode: frame.params.privacy_mode ?? "none",
              state: "ready", commands: [], reason: null };
        current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
        return;
      }
      const reply = (result: unknown) => current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.action === "agent.list") reply({ agents: [], parent_capabilities: {}, classified_session_ids: [session.id] });
      else if (frame.action === "session.list") reply({ sessions: [session] });
      else if (frame.action === "session.history") {
        historyRequests++;
        reply({ entries, next_cursor: null, has_more: false, turn_active: true });
      } else if (frame.op === "subscribe") {
        current.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all") current.send(JSON.stringify({ type: "snapshot", topic: "sessions.all", sessions: [session], runtimes: [] }));
      } else if (frame.action) throw new Error(`Unexpected action: ${frame.action}`);
    });
  });
  const emit = (raw: unknown, source = "claude") => socket!.send(JSON.stringify({
    topic: `session.${session.id}`, source, seq: ++seq, ts: Date.now(), raw,
  }));
  const stream = (event: unknown) => emit({ type: "stream_event", parent_tool_use_id: null, event });
  const answer = "The image shows a browser logo.";
  const complete = (uuid: string, type: "text" | "thinking", text: string, id: string) => {
    const raw = { type: "assistant", uuid, message: { id, role: "assistant", content: [{ type, [type]: text }] } };
    entries.push(JSON.stringify(raw));
    emit(raw);
  };
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page.getByText("What is in this image?", { exact: true }).waitFor();
  stream({ type: "message_start", message: { id: "msg-one" } });
  stream({ type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } });
  stream({ type: "content_block_delta", index: 0, delta: { type: "thinking_delta", thinking: "Inspecting the image." } });
  await page.locator(".tr-thinking > button").click();
  await page.getByText("Inspecting the image.", { exact: true }).waitFor();
  assert.equal(await page.locator(".tr-activity-group .tr-thinking").count(), 0);
  complete("thinking-fragment", "thinking", "Inspecting the image.", "msg-one");
  stream({ type: "content_block_stop", index: 0 });
  stream({ type: "content_block_start", index: 1, content_block: { type: "text", text: "" } });
  stream({ type: "content_block_delta", index: 1, delta: { type: "text_delta", text: answer } });
  await page.getByText(answer, { exact: true }).waitFor();
  complete("answer-fragment", "text", answer, "msg-one");
  stream({ type: "content_block_stop", index: 1 });
  stream({ type: "message_stop" });
  await page.waitForTimeout(150);
  assert.equal(await page.getByText(answer, { exact: true }).count(), 1);
  assert.equal(await page.locator(".tr-thinking").count(), 1);
  assert.equal(await page.locator(".tr-thinking > button").getAttribute("aria-expanded"), "true");
  emit({ type: "history_changed" }, "mandri");
  await page.waitForTimeout(250);
  assert.equal(await page.getByText(answer, { exact: true }).count(), 1);
  await page.reload();
  await page.getByText(answer, { exact: true }).waitFor();
  assert.equal(await page.getByText(answer, { exact: true }).count(), 1);
  // A separate API message is not a duplicate, even with identical wording.
  complete("another-answer", "text", answer, "msg-two");
  await page.waitForFunction((text) => [...document.querySelectorAll("p")].filter((p) => p.textContent === text).length === 2, answer);
  await page.reload();
  await page.waitForFunction((text) => [...document.querySelectorAll("p")].filter((p) => p.textContent === text).length === 2, answer);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ streamingFinalHistoryCopies: 1, distinctMessagesPreserved: 2, reloads: 2, historyRequests, errors }));
} finally {
  await browser.close();
  await server.close();
}
