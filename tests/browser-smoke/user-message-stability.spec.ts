import assert from "node:assert/strict";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

// All daemon traffic is synthetic. No harness or model is started.
const server = await createServer({ server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null } });
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => localStorage.setItem("mandri.preferences", JSON.stringify({ state: { language: "en" }, version: 0 })));
  const session = { id: "user-stability", harness: "codex", state: "live", title: "Stable image previews",
    project_path: "/workspace", native_id: "native", model: "fixture/model", activity: "idle" };
  const path = "/workspace/attachments/session/files/image.png";
  const png = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/l9sAAAAASUVORK5CYII=";
  const entries: string[] = [];
  let socket: WebSocketRoute | undefined;
  let seq = 0;
  let fileRequests = 0;
  let promptRequests = 0;
  let historyRequests = 0;
  let releaseUpload!: () => void;
  const uploadGate = new Promise<void>((resolve) => { releaseUpload = resolve; });
  await page.route("**/v1/**", async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith("/attachments")) {
      await uploadGate;
      await route.fulfill({ json: { id: "image", name: "image.png", media_type: "image/png",
        size: Buffer.from(png, "base64").length, reference: `[image.png](${path})` } });
    } else if (url.pathname.endsWith("/files")) {
      fileRequests++;
      await route.fulfill({ contentType: "image/png", body: Buffer.from(png, "base64") });
    } else {
      await route.fulfill({ json: url.pathname.endsWith("/availability")
        ? { owner: "mandri", activity: "idle", can_resume: false, can_release: false, can_restore: false }
        : url.pathname === "/v1/sessions" ? [session]
        : url.pathname === `/v1/sessions/${session.id}` ? session : [] });
    }
  });
  await page.routeWebSocket("**/v1/ws", (current) => {
    socket = current;
    current.onMessage((data) => {
      const frame = JSON.parse(String(data));
      const reply = (result: unknown) => current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.action === "agent.list") reply({ agents: [], parent_capabilities: {}, classified_session_ids: [session.id] });
      else if (frame.action === "session.list") reply({ sessions: [session] });
      else if (frame.action === "session.history") {
        historyRequests++;
        reply({ entries, next_cursor: null, has_more: false, turn_active: false });
      } else if (frame.action === "session.prompt") {
        promptRequests++;
        reply({ state: "accepted" });
      } else if (frame.action === "command.catalogs") reply({ default_cwd: session.project_path, catalogs: [] });
      else if (frame.action === "command.list") reply({ invocations: [] });
      else if (frame.action === "session.commands") reply({ commands: [] });
      else if (frame.action === "command.catalog") reply({ ...frame.params, cwd: session.project_path,
        state: "ready", commands: [], profile_id: null, execution_backend: "host", privacy_mode: "none" });
      else if (frame.op === "subscribe") {
        current.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all") current.send(JSON.stringify({ type: "snapshot", topic: "sessions.all", sessions: [session], runtimes: [] }));
      } else if (frame.action) errors.push(`Unexpected action: ${frame.action}`);
    });
  });
  const emit = (raw: unknown, source = "codex") => socket!.send(JSON.stringify({
    topic: `session.${session.id}`, source, seq: ++seq, ts: Date.now(), raw,
  }));
  const echo = (id: string, text: string, image = false) => emit({ method: "item/completed", params: {
    turnId: id, item: { id, type: "userMessage", content: [
      { type: "text", text }, ...(image ? [{ type: "localImage", path }] : []),
    ] },
  } });
  const persist = (id: string, text: string, image = false) => entries.push(JSON.stringify({ type: "response_item", payload: {
    type: "message", role: "user", content: [
      { type: "input_text", text }, ...(image ? [
        { type: "input_text", text: `<image name=[Image #1] path="${path}">` },
        { type: "input_image", image_url: `data:image/png;base64,${png}` },
        { type: "input_text", text: "</image>" },
      ] : []),
    ], internal_chat_message_metadata_passthrough: { turn_id: id },
  } }));
  const confirmRefresh = async () => {
    const previous = historyRequests;
    emit({ type: "history_changed" }, "mandri");
    await page.waitForFunction(async () => {
      const { transcriptStore } = await import(String("/src/stores/sessions.ts"));
      return transcriptStore.getState().transcripts["user-stability"]?.localUsers?.length === 0;
    });
    assert.ok(historyRequests > previous);
    await page.waitForTimeout(100);
  };
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page.locator(".composer-input").fill("Hello");
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.locator(".tr-user-bubble").waitFor();
  const textBubble = await page.locator(".tr-user-bubble").elementHandle();
  echo("text-message", "Hello");
  await page.waitForTimeout(100);
  assert.ok(await textBubble!.evaluate((element) => element.isConnected));
  persist("text-message", "Hello");
  await confirmRefresh();
  assert.ok(await textBubble!.evaluate((element) => element.isConnected));

  await page.locator(".composer-input").fill("Describe this");
  await page.locator('input[type="file"]').setInputFiles({ name: "image.png", mimeType: "image/png", buffer: Buffer.from(png, "base64") });
  await page.getByRole("button", { name: "Send", exact: true }).click();
  await page.waitForFunction(() => {
    const image = document.querySelector<HTMLImageElement>(".tr-user-bubble img");
    return image?.complete && image.naturalWidth > 0;
  });
  const image = await page.locator(".tr-user-bubble img").elementHandle();
  const initial = await image!.evaluate((element) => ({ source: (element as HTMLImageElement).src, height: element.closest(".tr-user-bubble")!.getBoundingClientRect().height }));
  await page.evaluate(() => {
    const thumbnail = document.querySelector(".tr-user-bubble img")!;
    const state = { removed: 0 };
    Object.assign(window, { thumbnailChanges: state });
    new MutationObserver((records) => {
      for (const record of records) for (const removed of record.removedNodes)
        if (removed === thumbnail || removed.contains(thumbnail)) state.removed++;
    }).observe(document.querySelector(".transcript-inner")!, { childList: true, subtree: true });
  });
  releaseUpload();
  await page.waitForTimeout(150);
  assert.equal(promptRequests, 2);
  const message = `Describe this\n\n[image.png](${path})`;
  echo("image-message", message, true);
  await page.waitForTimeout(100);
  persist("image-message", message, true);
  await confirmRefresh();
  await confirmRefresh();
  assert.ok(await image!.evaluate((element) => element.isConnected));
  const final = await image!.evaluate((element) => ({ source: (element as HTMLImageElement).src, height: element.closest(".tr-user-bubble")!.getBoundingClientRect().height }));
  assert.deepEqual(final, initial);
  assert.equal(await page.evaluate(() => (window as unknown as { thumbnailChanges: { removed: number } }).thumbnailChanges.removed), 0);
  assert.equal(fileRequests, 0);
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ stableTextBubble: true, stableThumbnail: true, fileRequests, promptRequests, historyRequests, errors }));
} finally {
  await browser.close();
  await server.close();
}
