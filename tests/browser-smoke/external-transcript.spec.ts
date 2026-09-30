import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  await page.route(`http://127.0.0.1:${address.port}/**`, async (route) => {
    await route.fulfill({ response: await route.fetch() });
  });
  const errors: string[] = [];
  const actions: string[] = [];
  let restHistory = 0;
  let text = "Initial external message";
  let externalActivity = "busy";
  let socket: WebSocketRoute | undefined;
  const session = {
    id: "external-test",
    harness: "opencode",
    state: "discovered",
    title: "External OpenCode",
    project_path: "/project",
    native_id: "native",
    model: "test/model",
    activity: "active",
  };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) {
      const owner = "external";
      await route.fulfill({
        json: {
          owner,
          activity: externalActivity,
          can_resume: false,
          can_release: false,
          can_restore: false,
          reason: "external_release_unsupported",
        },
      });
      return;
    }
    if (path.endsWith("/history")) restHistory += 1;
    await route.fulfill({
      json:
        path === "/v1/sessions" ? [session] : path === `/v1/sessions/${session.id}` ? session : [],
    });
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
      if (frame.action === "agent.list") {
        current.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { agents: [], parent_capabilities: {}, classified_session_ids: [session.id] },
          }),
        );
        return;
      }
      if (frame.action === "session.list") {
        current.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { sessions: [session] },
          }),
        );
        return;
      }
      if (frame.op === "subscribe") {
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
      } else if (frame.action === "session.history") {
        actions.push(frame.action);
        current.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: {
              entries: [
                JSON.stringify({
                  type: "message.part.updated",
                  properties: { part: { id: "edit-part", callID: "edit-call", type: "tool", tool: "edit",
                    state: { status: "completed", input: { filePath: "/project/config.json" },
                      metadata: { diff: "@@ -1 +1 @@\n-old\n+new" }, output: "Updated" } } },
                }),
                JSON.stringify({
                  type: "message.updated",
                  properties: { info: { id: "message", role: "assistant" } },
                }),
                JSON.stringify({
                  type: "message.part.updated",
                  properties: { part: { id: "part", messageID: "message", type: "text", text } },
                }),
              ],
              next_cursor: null,
              has_more: false,
            },
          }),
        );
      } else if (frame.action) actions.push(frame.action);
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page.getByText(text, { exact: true }).waitFor();
  await page.locator(".composer-external").waitFor();
  assert.equal(await page.locator(".tr-changed-files").count(), 0);
  await page.locator(".tr-activity-group > button").click();
  assert.equal(await page.locator(".tr-activity-group .tr-diff").count(), 1);
  assert(socket);
  text = "External content updated live";
  const event = {
    topic: `session.${session.id}`,
    seq: 1,
    source: "mandri",
    ts: 1,
    raw: { type: "history_changed", ownership: "external" },
  };
  socket.send(JSON.stringify(event));
  socket.send(JSON.stringify(event));
  await page.getByText(text, { exact: true }).waitFor();
  assert.equal(await page.getByText(text, { exact: true }).count(), 1);
  assert.equal(await page.getByText("Initial external message", { exact: true }).count(), 0);
  assert.equal(await page.locator(".tr-changed-files").count(), 0);
  await page.reload();
  await page.getByText(text, { exact: true }).waitFor();
  await page.locator(".composer-external").waitFor();
  assert.equal(await page.locator(".tr-changed-files").count(), 0);
  externalActivity = "idle";
  await page.locator(".tr-changed-files").waitFor();
  assert.equal(await page.locator(".tr-changed-files").count(), 1);
  await page.locator(".tr-changed-files > button").click();
  assert.equal(await page.locator(".tr-changed-files .tr-diff").count(), 1);
  await page.screenshot({ path: "../mandri-work-documents/external-files-idle-2026-09-19.png" });
  externalActivity = "busy";
  await page.locator(".tr-changed-files").waitFor({ state: "hidden" });
  await page.screenshot({ path: "../mandri-work-documents/external-files-active-2026-09-19.png" });
  assert.equal(restHistory, 0);
  assert(actions.length > 0 && actions.every((action) => action === "session.history"));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: external history/reload, no file summary during external activity, summary after idle, hidden again on resume, no execution request",
  );
} finally {
  await browser.close();
  await server.close();
}
