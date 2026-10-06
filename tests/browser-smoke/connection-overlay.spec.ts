import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
import { createServer } from "vite";

// Synthetic daemon only; opening each WebSocket is controlled by the test.
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
const output = process.env.MANDRI_OVERLAY_SCREENSHOTS;
if (output) await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1200, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.clock.install();
  await page.clock.pauseAt(new Date(Date.now() + 1000));
  await page.addInitScript(() => {
    const sockets: TestSocket[] = [];
    class TestSocket {
      static CONNECTING = 0;
      static OPEN = 1;
      static CLOSING = 2;
      static CLOSED = 3;
      readyState = 0;
      onopen: (() => void) | null = null;
      onclose: ((event: { code: number; reason: string; wasClean: boolean }) => void) | null = null;
      constructor() {
        sockets.push(this);
      }
      send() {}
      open() {
        this.readyState = 1;
        this.onopen?.();
      }
      close() {
        this.readyState = 3;
        this.onclose?.({ code: 1006, reason: "Synthetic outage", wasClean: false });
      }
    }
    Object.assign(window, {
      WebSocket: TestSocket,
      openTestSocket: () => sockets.at(-1)?.open(),
      closeTestSocket: () => sockets.at(-1)?.close(),
    });
  });
  await page.route("**/v1/**", (route) => route.fulfill({ json: [] }));
  await page.goto(`http://127.0.0.1:${address.port}`);
  const overlay = page.getByRole("dialog", { name: "Connecting to Mandri" });
  await overlay.waitFor();
  assert.equal(await overlay.getByRole("status").textContent(), "Starting Mandri…");
  const bounds = await overlay.boundingBox();
  assert.deepEqual(bounds, { x: 0, y: 0, width: 1200, height: 800 });
  await page.evaluate(() => document.fonts.ready);
  if (output) await page.screenshot({ path: `${output}/startup.png` });
  await page.evaluate("window.openTestSocket()");
  await page.clock.runFor(200);
  await overlay.waitFor({ state: "hidden" });
  const draft = page.getByRole("textbox", { name: "Describe the task to run…" });
  await draft.fill("Keep this draft through the outage");
  await page.evaluate("window.closeTestSocket()");
  await page.clock.runFor(19_999);
  assert.equal(await overlay.count(), 0);
  assert.equal(await page.locator(".status-dot--reconnecting").count(), 1);
  assert.equal(await draft.inputValue(), "Keep this draft through the outage");
  await page.clock.runFor(1);
  await overlay.waitFor();
  assert.equal(await overlay.getByRole("status").textContent(), "Reconnecting…");
  assert(await page.evaluate(() => !!document.activeElement?.closest(".connection-overlay")));
  await page.keyboard.press("Control+k");
  assert.equal(await page.locator(".command-palette").count(), 0);
  if (output) await page.screenshot({ path: `${output}/reconnecting.png` });
  await page.evaluate(async () => {
    const { connectionStore } = await import(String("/src/stores/connection.ts"));
    connectionStore.getState().setStartupError("Synthetic daemon startup failure");
    connectionStore.getState().setStatus("offline");
  });
  await overlay.getByRole("alert").waitFor();
  await overlay.getByText("Error details").click();
  if (output) await page.screenshot({ path: `${output}/error.png` });
  await overlay.getByRole("button", { name: "Connection settings" }).click();
  await overlay.getByRole("region", { name: "Connection settings" }).waitFor();
  await page.setViewportSize({ width: 390, height: 700 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => {
    document.documentElement.dataset.theme = "light";
  });
  assert(await overlay.evaluate((el) => el.scrollWidth <= el.clientWidth));
  assert.equal(await overlay.locator(".tr-shimmer").count(), 0);
  if (output) await page.screenshot({ path: `${output}/recovery-mobile-light.png` });
  await page.evaluate("window.openTestSocket()");
  await page.clock.runFor(200);
  await overlay.waitFor({ state: "hidden" });
  assert.equal(await draft.inputValue(), "Keep this draft through the outage");
  assert(await draft.evaluate((el) => el === document.activeElement));
  assert.deepEqual(errors, []);
  console.log(
    "PASS: startup, full-window overlay, 20-second reconnect grace, draft/focus preservation, recovery, narrow light layout",
  );
} finally {
  await browser.close();
  await server.close();
}
