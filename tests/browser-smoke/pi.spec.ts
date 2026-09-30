import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null } });
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch();
const output = resolve(process.env.MANDRI_UI_ARTIFACTS ?? "../mandri-work-documents/pi/frontend");
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await page.addInitScript(() => localStorage.setItem("mandri.preferences", JSON.stringify({ state: { language: "en" }, version: 0 })));
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let socket: WebSocketRoute | undefined;
  let seq = 0;
  let owner = "mandri";
  const session = { id: "pi-test", harness: "pi", state: "live", title: "Pi custom workspace",
    project_path: "/workspace/pi-example", native_id: "pi-native", model: "native:pi/example/model", activity: "idle" };
  const user = { role: "user", timestamp: 1000, content: "Inspect the workspace" };
  const answer = { role: "assistant", timestamp: 2000, content: [{ type: "text", text: "Workspace ready" }], stopReason: "stop" };
  const entries = [user, answer].map((message) => JSON.stringify({ type: "message", message }));
  const commands = [{ id: "extension-audit", name: "audit", description: "Custom workspace audit", aliases: [], kind: "extension", available: true }];
  const runtimes = [{ harness: "pi", installed: true, version: "test", degraded: false,
    capabilities: { model_sources: ["native", "gateway"], permission_modes: [], input_types: ["text", "image"] } }];
  await page.route("**/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({ json: path.endsWith("/availability")
      ? { owner, activity: owner === "unknown" ? "unknown" : "idle", can_resume: false, can_release: false, can_restore: false,
        reason: owner === "external" ? "external_release_unsupported" : owner === "unknown" ? "writer_status_unavailable" : null }
      : path === "/v1/runtimes" ? runtimes
      : path === "/v1/sessions" ? [session] : path === `/v1/sessions/${session.id}` ? session : [] });
  });
  await page.routeWebSocket("**/v1/ws", (current) => {
    socket = current;
    current.onMessage((data) => {
      const frame = JSON.parse(String(data));
      const reply = (result: unknown) => current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.action === "agent.list") reply({ agents: [], parent_capabilities: {}, classified_session_ids: [session.id] });
      else if (frame.action === "session.list") reply({ sessions: [session] });
      else if (frame.action === "session.history") reply({ entries, next_cursor: null, has_more: false, turn_active: false });
      else if (frame.action === "command.catalogs") reply({ default_cwd: session.project_path, catalogs: [] });
      else if (frame.action === "command.list") reply({ invocations: [] });
      else if (frame.action === "session.commands") reply({ commands });
      else if (frame.action === "command.catalog") reply({ ...frame.params, cwd: session.project_path, state: "ready", commands, profile_id: null, execution_backend: "host", privacy_mode: "none" });
      else if (frame.op === "subscribe") {
        current.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all") current.send(JSON.stringify({ type: "snapshot", topic: "sessions.all", sessions: [session], runtimes }));
      } else if (frame.action) throw new Error(`Unexpected action: ${frame.action}`);
    });
  });
  const emit = (raw: unknown) => socket!.send(JSON.stringify({ topic: `session.${session.id}`, source: "pi", seq: ++seq, ts: Date.now(), raw }));
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page.getByText("Workspace ready", { exact: true }).waitFor();
  assert.equal(await page.locator(".shell-session-icon-slot svg").count(), 1);
  assert.equal(await page.locator(".composer-permissions").count(), 0);
  emit({ type: "agent_start" });
  emit({ type: "message_start", message: { role: "assistant", timestamp: 3000, content: [], stopReason: "pending" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_start", contentIndex: 0 } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "Check" } });
  emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", contentIndex: 0, delta: "ing" } });
  await page.getByText("Checking", { exact: true }).waitFor();
  emit({ type: "message_end", message: { role: "assistant", timestamp: 3000, content: [{ type: "text", text: "Checking complete" }], stopReason: "stop" } });
  emit({ type: "agent_settled" });
  await page.getByText("Checking complete", { exact: true }).waitFor();
  assert.equal(await page.getByText("Checking", { exact: true }).count(), 0);
  emit({ type: "extension_ui_request", id: "widget", method: "setWidget", widgetKey: "audit", widgetLines: ["Custom audit: passed"] });
  emit({ type: "extension_ui_request", id: "status", method: "setStatus", statusKey: "profile", statusText: "Workspace extension active" });
  emit({ type: "extension_ui_request", id: "editor", method: "set_editor_text", text: "/audit follow-up" });
  await page.getByText("Custom audit: passed", { exact: true }).waitFor();
  await page.getByText("Workspace extension active", { exact: true }).waitFor();
  assert.equal(await page.locator(".composer-input").inputValue(), "/audit follow-up");
  await page.getByText("Custom workspace audit", { exact: true }).waitFor();
  emit({ type: "extension_ui_request", id: "editor-plain", method: "set_editor_text", text: "Audit follow-up" });
  await page.locator(".native-command-palette").waitFor({ state: "hidden" });
  await page.screenshot({ path: resolve(output, "pi-live-extensions.png") });
  owner = "external";
  session.state = "discovered";
  await page.goto(`http://127.0.0.1:${address.port}/#/`);
  await page.reload();
  await page.getByRole("button", { name: session.title, exact: true }).click();
  await page.locator('[aria-label="Open in another application"]').waitFor();
  assert.equal(await page.locator(".shell-session-icon-slot svg").count(), 1);
  await page.locator(".composer-external").waitFor();
  assert.match(await page.locator(".composer-external").innerText(), /Pi/);
  assert.equal(await page.locator('[aria-label="Open in another application"]').count(), 1);
  assert.equal(await page.locator(".composer-input").count(), 0);
  await page.screenshot({ path: resolve(output, "pi-external-locked.png") });
  owner = "unknown";
  await page.reload();
  await page.locator(".composer-input").waitFor();
  assert.equal(await page.locator(".composer-availability-hint").count(), 0);
  assert.equal(await page.locator(".shell-session-status-slot .lucide-lock-keyhole").count(), 0);
  assert.equal(await page.getByRole("button", { name: "Send", exact: true }).isDisabled(), true);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ pi: "live transcript, custom extension UI, and external lock and silent unknown availability verified", errors }));
} finally {
  await browser.close();
  await server.close();
}
