import assert from "node:assert/strict";
import { EventEmitter, once } from "node:events";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import type { WebSocketRoute } from "playwright";
import { chromium } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
const output = resolve(
  process.env.MANDRI_UI_ARTIFACTS ?? "../artifacts/runs/remediation-2026-09-11/frontend/browser",
);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage();
  await page.addInitScript(() =>
    localStorage.setItem(
      "mandri.preferences",
      JSON.stringify({ state: { language: "en" }, version: 0 }),
    ),
  );
  const errors: string[] = [];
  const patches: unknown[] = [];
  let current: WebSocketRoute | undefined;
  let externalBusy = true;
  let externalModel: string | null = "native/active-model";
  let resumes = 0;
  let prompts = 0;
  const received = new EventEmitter();
  const session = {
    id: "reasoning-test",
    harness: "opencode",
    state: "discovered",
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
      const owner = session.state === "live" ? "mandri" : externalBusy ? "external" : "unowned";
      await route.fulfill({
        json: {
          owner,
          activity: "idle",
          can_resume: owner === "unowned",
          can_release: owner === "mandri",
          can_restore: false,
          reason: owner === "external" ? "external_release_unsupported" : null,
        },
      });
      return;
    }
    if (path.endsWith("/resume")) {
      resumes += 1;
      session.state = "live";
      await route.fulfill({ json: { ...session, gateway_route_id: "route" } });
      return;
    }
    if (route.request().method() === "PATCH") {
      assert.equal(path, `/v1/runtime/sessions/${session.id}/effort`);
      const body = route.request().postDataJSON();
      patches.push(body);
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
    current = socket;
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
      if (frame.action === "session.prompt") {
        prompts += 1;
        received.emit("prompt");
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: session.state === "live",
            ...(session.state === "live"
              ? { result: { state: "queued" } }
              : { error: { code: "session_not_running", message: "Not running" } }),
          }),
        );
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
            result: {
              entries: [],
              next_cursor: null,
              has_more: false,
              external_busy: externalBusy,
              external_model: externalModel,
            },
          }),
        );
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  const composer = page.locator("textarea.composer-input");
  await page.locator(".composer-external").waitFor();
  assert.equal(await composer.count(), 0);
  assert.equal(await page.locator(".composer-external button").count(), 0);
  assert(current);
  const activity = (busy: boolean, seq: number) => {
    externalBusy = busy;
    current!.send(
      JSON.stringify({
        topic: `session.${session.id}`,
        seq,
        source: "mandri",
        ts: seq,
        raw: {
          type: "history_changed",
          ownership: "external",
          external_busy: busy,
          external_model: externalModel,
        },
      }),
    );
  };
  activity(true, 1);
  await page.getByText("native/active-model", { exact: true }).waitFor();
  assert.equal(await composer.count(), 0);
  for (const [index, model] of [
    "gpt-6-astra",
    "claude-fable",
    "claude-opus-custom",
    "claude-sonnet-custom",
    "claude-haiku-custom",
    "custom/vendor/model",
  ].entries()) {
    externalModel = model;
    activity(true, index + 2);
    await page.getByText(model, { exact: true }).waitFor();
    assert.equal(await composer.count(), 0);
  }
  for (const [harness, model] of [
    ["codex", "gpt-6-astra"],
    ["claude", "claude-fable"],
    ["opencode", "custom/vendor/model"],
  ] as const) {
    session.harness = harness;
    externalModel = model;
    await page.reload();
    await page.getByText(model, { exact: true }).waitFor();
    assert.equal(await composer.count(), 0);
    assert.equal(await page.locator(".composer-external button").count(), 0);
  }
  externalModel = null;
  activity(true, 8);
  await page.waitForFunction(
    () => document.querySelector(".composer-external-model")?.textContent === "—",
  );
  await page.reload();
  await page.locator(".composer-external").waitFor();
  assert.equal(await page.locator(".composer-external-model").textContent(), "—");
  assert.equal(
    await page
      .locator(".composer-external")
      .getByText("my-provider/vendor/model", { exact: true })
      .count(),
    0,
  );
  await page.screenshot({ path: resolve(output, "external-wait.png"), fullPage: true });
  const row = page.locator(".shell-session-container");
  const status = row.locator(".shell-session-status-slot");
  const before = await status.boundingBox();
  await row.hover();
  await page.waitForTimeout(180);
  const hovered = await status.boundingBox();
  assert(before && hovered && before.x - hovered.x >= 20);
  await row.locator(".lifecycle-trigger").hover();
  assert.equal(
    await row.locator(".shell-session-icon-slot").evaluate((el) => getComputedStyle(el).opacity),
    "1",
  );
  await row.locator(".lifecycle-trigger").click();
  assert.equal(await page.getByRole("menuitem").count(), 4);
  assert.equal(await page.getByRole("menuitem", { name: "Release session" }).isDisabled(), true);
  assert.equal(
    await page
      .locator(".session-view .lifecycle-trigger, .composer-stop, .lifecycle-resume-affordance")
      .count(),
    0,
  );
  await page.keyboard.press("Escape");
  await row.locator(".lifecycle-trigger").evaluate((el: HTMLElement) => el.blur());
  await page.mouse.move(900, 50);
  await page.waitForTimeout(180);
  const restored = await status.boundingBox();
  assert(restored && Math.abs(restored.x - before.x) < 1);
  activity(false, 9);
  await composer.waitFor();
  await page.waitForFunction(
    () => !document.querySelector<HTMLTextAreaElement>("textarea.composer-input")?.disabled,
  );
  assert.equal(
    await page
      .locator(".composer-chip-label")
      .filter({ hasText: "my-provider/vendor/model" })
      .count(),
    1,
  );
  await page.reload();
  await composer.waitFor();
  assert.equal(await composer.isDisabled(), false);
  await composer.fill("Continue this session");
  await Promise.all([
    once(received, "prompt", { signal: AbortSignal.timeout(5000) }),
    composer.press("Enter"),
  ]);
  await page.waitForFunction(
    () => document.querySelector<HTMLTextAreaElement>("textarea.composer-input")?.value === "",
  );
  assert.equal(resumes, 1);
  assert.equal(prompts, 1);
  await composer.fill("Next managed message");
  await Promise.all([
    once(received, "prompt", { signal: AbortSignal.timeout(5000) }),
    composer.press("Enter"),
  ]);
  await page.waitForFunction(
    () => document.querySelector<HTMLTextAreaElement>("textarea.composer-input")?.value === "",
  );
  assert.equal(resumes, 1);
  assert.equal(prompts, 2);
  await page.screenshot({ path: resolve(output, "native-resume.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: external activity guard, automatic resume, managed continuation, hover status and menu",
  );
} finally {
  await browser.close();
  await server.close();
}
