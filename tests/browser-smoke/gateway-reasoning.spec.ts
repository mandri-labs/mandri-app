import assert from "node:assert/strict";
import { chromium } from "playwright";
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
  const errors: string[] = [];
  const patches: unknown[] = [];
  let reject = false;
  const session = {
    id: "reasoning-test",
    harness: "opencode",
    state: "live",
    title: "Gateway reasoning",
    project_path: "/project",
    native_id: "native",
    model: "my-provider/vendor/model",
    reasoning_effort: "low" as string | null,
  };
  const provider = { name: "my-provider", kind: "openrouter", state: "verified" };
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) {
      const owner = "unowned";
      await route.fulfill({
        json: {
          owner,
          activity: "idle",
          can_resume: true,
          can_release: false,
          can_restore: false,
          reason: null,
        },
      });
      return;
    }
    if (route.request().method() === "PATCH") {
      assert.equal(path, `/v1/runtime/sessions/${session.id}/effort`);
      const body = route.request().postDataJSON();
      patches.push(body);
      if (reject) {
        await route.fulfill({
          status: 400,
          json: { error: { code: "invalid_effort", message: "Rejected effort" } },
        });
        return;
      }
      session.reasoning_effort = body.effort;
      await route.fulfill({ json: session });
      return;
    }
    await route.fulfill({
      json:
        path === "/v1/providers"
          ? [provider]
          : path.endsWith("/models")
            ? [
                {
                  id: "vendor/model",
                  reasoning_efforts: ["low", "medium", "high"],
                  default_effort: null,
                },
              ]
            : path === "/v1/sessions"
              ? [session]
              : path === `/v1/sessions/${session.id}`
                ? session
                : [],
    });
  });
  await page.routeWebSocket("**/v1/ws", (socket) => {
    socket.onMessage((data) => {
      const frame = JSON.parse(String(data));
      if (frame.action === "agent.list") {
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { agents: [], parent_capabilities: {}, classified_session_ids: [session.id] },
          }),
        );
        return;
      }
      if (frame.op === "subscribe")
        socket.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
      if (frame.op === "subscribe" && frame.topic === "sessions.all")
        socket.send(
          JSON.stringify({
            type: "snapshot",
            topic: "sessions.all",
            sessions: [session],
            runtimes: [],
          }),
        );
      if (frame.action === "session.list")
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { sessions: [session] },
          }),
        );
      if (frame.action === "session.history")
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { entries: [], next_cursor: null, has_more: false },
          }),
        );
    });
  });
  const openMenu = async () => {
    await page
      .locator('button.composer-chip[aria-haspopup="dialog"]')
      .filter({ hasText: "model" })
      .click();
    await page.getByRole("slider").waitFor();
  };
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await openMenu();
  assert.equal(await page.getByRole("slider").inputValue(), "0");
  const saved = page.waitForResponse((r) => r.request().method() === "PATCH");
  await page.getByRole("slider").press("End");
  await saved;
  assert.equal(session.reasoning_effort, "high");
  await page.reload();
  await openMenu();
  assert.equal(await page.getByRole("slider").inputValue(), "2");
  reject = true;
  const failed = page.waitForResponse((r) => r.status() === 400);
  await page.getByRole("slider").press("Home");
  await failed;
  await page.waitForFunction(
    () => document.querySelector<HTMLInputElement>(".model-settings-slider")?.value === "2",
  );
  reject = false;
  const retry = page.waitForResponse((r) => r.request().method() === "PATCH");
  await page.getByRole("slider").press("Home");
  await retry;
  assert.equal(session.reasoning_effort, "low");
  const cleared = page.waitForResponse((r) => r.request().method() === "PATCH");
  await page.locator(".model-settings-reset").click();
  await cleared;
  assert.equal(session.reasoning_effort, null);
  assert.deepEqual(patches, [
    { effort: "high" },
    { effort: "low" },
    { effort: "low" },
    { effort: null },
  ]);
  assert.deepEqual(errors, []);
  console.log("PASS: gateway reasoning menu, namespaced model, save, reload, rollback, default");
} finally {
  await browser.close();
  await server.close();
}
