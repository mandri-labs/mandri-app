import assert from "node:assert/strict";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0, hmr: false, watch: null } });
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
  const session = { id: "codex-reload", harness: "codex", state: "live", title: "File changes during an active turn",
    project_path: "/workspace", native_id: "native-test", model: "test/model", activity: "active" };
  const entries = [
    JSON.stringify({ timestamp: new Date().toISOString(), type: "event_msg", payload: { type: "task_started", turn_id: "turn" } }),
    JSON.stringify({ type: "response_item", payload: { type: "message", role: "user", id: "user",
      content: [{ type: "input_text", text: "Update these files." }],
      internal_chat_message_metadata_passthrough: { turn_id: "turn" } } }),
  ];
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
  const publishChange = (id: string, path: string, content: string) => {
    entries.push(JSON.stringify({ type: "event_msg", payload: { type: "item_completed", turn_id: "turn", item: {
      type: "FileChange", id, status: "completed", stdout: "Success", stderr: "", changes: { [path]: { type: "add", content } },
    } } }));
    socket!.send(JSON.stringify({ topic: `session.${session.id}`, source: "codex", seq: ++seq, ts: Date.now(), raw: {
      method: "item/completed", params: { turnId: "turn", item: {
        type: "fileChange", id, status: "completed", changes: [{ path, kind: { type: "add" }, diff: content }],
      } },
    } }));
  };
  const inspectFiles = async (count: number) => {
    const summary = page.locator(".tr-activity-group");
    assert.equal(await page.locator(".tr-changed-files").count(), 0);
    await summary.waitFor();
    const toggle = summary.locator(":scope > button");
    if (await toggle.getAttribute("aria-expanded") !== "true") await toggle.click();
    await page.waitForFunction((count) => document.querySelectorAll(".tr-activity-group .tr-diff").length === count, count);
    assert.equal(await summary.count(), 1);
    const first = summary.locator(".tr-diff").first();
    if (await first.locator(":scope > button").getAttribute("aria-expanded") !== "true") await first.locator(":scope > button").click();
    assert.equal(await first.locator(".tr-diff-row-add").count(), 2);
    assert.equal(await first.locator(".tr-diff-add").textContent(), "+2");
  };
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page.getByText("Update these files.", { exact: true }).waitFor();
  publishChange("edit-one", "/workspace/src/first.ts", "export const one = 1;\nexport const two = 2;\n");
  await inspectFiles(1);
  const beforeReload = historyRequests;
  await page.reload();
  await inspectFiles(1);
  assert.ok(historyRequests > beforeReload);
  publishChange("edit-two", "C:\\workspace\\src\\second.ts", "export const next = true;\n");
  await inspectFiles(2);
  socket!.send(JSON.stringify({ topic: `session.${session.id}`, source: "mandri", seq: ++seq, ts: Date.now(), raw: { type: "history_changed" } }));
  await page.waitForTimeout(300);
  await inspectFiles(2);
  await page.reload();
  await inspectFiles(2);
  socket!.send(JSON.stringify({ topic: `session.${session.id}`, source: "codex", seq: ++seq, ts: Date.now(), raw: {
    method: "turn/completed", params: { turn: { id: "turn", status: "completed" } },
  } }));
  await page.locator(".tr-changed-files").waitFor();
  assert.equal(await page.locator(".tr-activity-group .tr-diff").count(), 2);
  await page.screenshot({ path: "../mandri-work-documents/activity-groups-desktop.png" });
  await page.setViewportSize({ width: 420, height: 900 });
  await page.screenshot({ path: "../mandri-work-documents/activity-groups-mobile.png" });
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ activeTurn: true, reloads: 2, changedFiles: 2, historyRequests, errors }));
} finally {
  await browser.close();
  await server.close();
}
