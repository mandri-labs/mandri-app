import assert from "node:assert/strict";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import { createServer } from "vite";

const output = resolve(
  process.env.MANDRI_UI_ARTIFACTS ?? "../artifacts/runs/remediation-2026-09-11/frontend/browser",
);
await mkdir(output, { recursive: true });
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const base = `http://127.0.0.1:${address.port}`;
const browser = await chromium.launch({ headless: true });
const context = await browser.newContext({
  locale: "fr-FR",
  viewport: { width: 1280, height: 800 },
});
const page = await context.newPage();
const pageErrors: string[] = [];
let connections = 0;
page.on("pageerror", (error) => pageErrors.push(error.message));
await context.route("**/v1/**", (route) => {
  const url = new URL(route.request().url());
  const providers = [
    { name: "openrouter-main", kind: "openrouter", state: "verified", api_base: null },
  ];
  const runtimes = ["claude", "codex", "opencode"].map((harness) => ({
    harness,
    installed: true,
    version: "fixture",
    degraded: false,
  }));
  const routes = [
    {
      id: "3f9c2a10-77b1-4c8e-9a21-5f0d2b6c8e41",
      provider: "openrouter-main",
      model_ref: "openrouter-main/anthropic/claude-sonnet-4",
      formats: ["anthropic", "openai"],
      created_at: 1757083200,
    },
  ];
  return route.fulfill({
    json:
      url.pathname === "/v1/providers"
        ? providers
        : url.pathname === "/v1/runtimes"
          ? runtimes
          : url.pathname === "/v1/gateway/info"
            ? { providers, routes }
            : url.pathname.includes("/models")
              ? [{ id: "anthropic/claude-sonnet-4", reasoning_efforts: [], default_effort: null }]
              : [],
  });
});
await page.routeWebSocket("**/v1/ws", (ws) => {
  connections += 1;
  ws.onMessage((message) => {
    const frame = JSON.parse(String(message));
    if (frame.action === "agent.list") {
      ws.send(
        JSON.stringify({
          type: "response",
          op_id: frame.op_id,
          ok: true,
          result: { agents: [], parent_capabilities: {}, classified_session_ids: [] },
        }),
      );
      return;
    }
    if (frame.op === "subscribe")
      ws.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
    if (frame.action === "session.list")
      ws.send(
        JSON.stringify({
          type: "response",
          op_id: frame.op_id,
          ok: true,
          result: { sessions: [] },
        }),
      );
  });
});
const measurements: Record<string, unknown> = {};
try {
  await page.goto(base);
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  await page.getByRole("button", { name: "Fournisseurs", exact: true }).click();
  await page.getByRole("button", { name: "Modifier", exact: true }).click();
  assert.equal(
    await page.locator('.providers-dialog input[name="name"]').inputValue(),
    "openrouter-main",
  );
  await page.screenshot({ path: resolve(output, "provider-edit.png") });
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.locator(":focus").innerText(), "Modifier");
  await page.setViewportSize({ width: 640, height: 800 });
  const name = await page.locator(".providers-item-name").boundingBox();
  assert(name && name.width >= 80);
  const providerBounds = await page.locator(".providers-item").evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    right: el.getBoundingClientRect().right,
  }));
  assert(
    providerBounds.scroll <= providerBounds.width && providerBounds.right <= 640,
    JSON.stringify(providerBounds),
  );
  measurements.provider640 = providerBounds;
  await page.screenshot({ path: resolve(output, "providers-640.png") });
  await page.getByRole("button", { name: "Ajouter un fournisseur", exact: true }).click();
  await page.keyboard.press("Escape");
  assert.equal(await page.getByRole("dialog").count(), 1);
  assert.equal(await page.locator(":focus").innerText(), "Ajouter un fournisseur");
  await page.goto(base + "/#/routes");
  await page.locator(".providers-route-row").waitFor();
  await page.setViewportSize({ width: 1024, height: 720 });
  const routeBounds = await page.locator(".providers-route-head").evaluate((el) => ({
    width: el.clientWidth,
    scroll: el.scrollWidth,
    right: el.getBoundingClientRect().right,
  }));
  assert(
    routeBounds.scroll <= routeBounds.width && routeBounds.right <= 1024,
    JSON.stringify(routeBounds),
  );
  measurements.routes1024 = routeBounds;
  await page.screenshot({ path: resolve(output, "routes-1024.png") });
  await page.goto(base);
  await page.waitForFunction(
    async () =>
      (await import(String("/src/stores/connection.ts"))).connectionStore.getState().status ===
      "online",
  );
  await page.clock.install();
  await page.evaluate(async () => {
    const { getDaemonSocket } = await import(String("/src/app/connection.ts"));
    getDaemonSocket()?.close();
  });
  await page.clock.fastForward(20_000);
  await page.getByRole("button", { name: "Réessayer", exact: true }).waitFor();
  await page.getByRole("button", { name: "Paramètres de connexion", exact: true }).click();
  await page.getByRole("region", { name: "Paramètres de connexion", exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "offline-settings.png") });
  await page.getByRole("button", { name: "Paramètres de connexion", exact: true }).click();
  const beforeRetry = connections;
  await page.getByRole("button", { name: "Réessayer", exact: true }).click();
  await page.waitForFunction(
    async () =>
      (await import(String("/src/stores/connection.ts"))).connectionStore.getState().status ===
      "online",
  );
  assert.equal(connections, beforeRetry + 1);
  assert.deepEqual(pageErrors, []);
  measurements.connections = connections;
  await writeFile(
    resolve(output, "remediation-measurements.json"),
    JSON.stringify(measurements, null, 2),
  );
  console.log(JSON.stringify(measurements));
} finally {
  await browser.close();
  await server.close();
}
