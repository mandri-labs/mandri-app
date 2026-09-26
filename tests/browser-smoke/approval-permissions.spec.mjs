import assert from "node:assert/strict";
/* global document, innerWidth, console */
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";

const output = resolve("../artifacts/runs/remediation-2026-09-11/frontend/browser");
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1100, height: 820 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
await page.route("**/__approval_validation", (route) =>
  route.fulfill({
    contentType: "text/html",
    body: `
  <html><body><div id="root"></div><script type="module">
  import RefreshRuntime from '/@react-refresh';
  RefreshRuntime.injectIntoGlobalHook(window);
  window.$RefreshReg$ = () => {};
  window.$RefreshSig$ = () => (type) => type;
  window.__vite_plugin_react_preamble_installed__ = true;
  const fixture = await import('/tests/browser-smoke/approval-fixture.tsx');
  await fixture.mount();
  </script></body></html>`,
  }),
);
try {
  await page.goto("http://localhost:1420/__approval_validation");
  await page.locator(".approval-actions button").first().waitFor();
  await page.locator(".transcript-item").first().waitFor();
  const oldLayer = await page.addStyleTag({
    content: ".session-approvals { position: static; z-index: auto; }",
  });
  const blockedBefore = await page
    .locator(".approval-actions button")
    .first()
    .evaluate((el) => {
      const r = el.getBoundingClientRect();
      return !el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
    });
  await oldLayer.evaluate((el) => el.remove());
  for (const width of [1100, 520]) {
    await page.setViewportSize({ width, height: 820 });
    const bounds = await page.locator(".approval-card").evaluate((el) => ({
      width: el.clientWidth,
      scroll: el.scrollWidth,
      right: el.getBoundingClientRect().right,
      viewport: innerWidth,
    }));
    assert.ok(
      bounds.scroll <= bounds.width && bounds.right <= bounds.viewport,
      JSON.stringify(bounds),
    );
    assert.equal(await page.locator(".approval-command").count(), 1);
    assert.equal(await page.locator(".approval-harness, .approval-scopes").count(), 0);
    for (let index = 0; index < 3; index++) {
      await page.evaluate(async () =>
        (await import("/tests/browser-smoke/approval-fixture.tsx")).seed(),
      );
      const button = page.locator(".approval-actions button").nth(index);
      await button.click();
      await page.locator(".approval-card").waitFor({ state: "detached" });
    }
    await page.evaluate(async () =>
      (await import("/tests/browser-smoke/approval-fixture.tsx")).seed(),
    );
    await page.screenshot({ path: resolve(output, `approval-card-${width}.png`) });
    await page.locator(".composer-permissions").click();
    await page
      .locator(".permission-option")
      .filter({ hasText: "Accepter les modifications" })
      .click();
    await page
      .locator(".composer-permissions")
      .filter({ hasText: "Accepter les modifications" })
      .waitFor();
    await page.locator(".composer-permissions").click();
    await page.screenshot({ path: resolve(output, `approval-permissions-${width}.png`) });
    await page.keyboard.press("Escape");
  }
  const answers = await page.evaluate(
    async () => (await import("/tests/browser-smoke/approval-fixture.tsx")).answers,
  );
  assert.equal(answers.length, 6);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({ blockedBefore, clicksDelivered: answers.length, widths: [1100, 520], errors }),
  );
} finally {
  await browser.close();
}
