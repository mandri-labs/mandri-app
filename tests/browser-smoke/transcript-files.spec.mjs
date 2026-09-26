/* global console, process, getComputedStyle */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { chromium } from "playwright";
const output = process.env.MANDRI_UI_ARTIFACTS ?? "../artifacts/runs/transcript-files";
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const errors = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.route("**/v1/**", (route) => route.fulfill({ status: 200, contentType: "application/json", body: route.request().url().includes("/history") ? JSON.stringify({ entries: [], has_more: false, next_cursor: null }) : "[]" }));
  await page.routeWebSocket("**/v1/**", () => {});
  for (const story of ["claude-tools-diff", "opencode-tools-diff", "codex-file-changes"]) {
    await page.goto(`http://localhost:6006/iframe.html?id=features-transcript-transcript--${story}&viewMode=story`);
    const summary = page.locator(".tr-changed-files");
    await summary.waitFor();
    await page.waitForTimeout(400);
    await summary.locator(":scope > button").click();
    const cards = summary.locator(".tr-diff");
    assert.equal(await cards.count(), story === "claude-tools-diff" ? 2 : story === "opencode-tools-diff" ? 1 : 3);
    assert.equal(await page.locator(".tr-diff").count(), await cards.count());
    await cards.first().locator(":scope > button").click();
    await page.waitForTimeout(200);
    assert.ok(await cards.first().locator(".tr-diff-row-add").count() > 0);
    assert.equal(await page.locator(".tr-diff-no").filter({ hasText: /^0$/ }).count(), 0);
    assert.equal(await page.locator(".tr-tool-duration").filter({ hasText: /^0(?:\.\d+)? s$/ }).count(), 0);
    for (const width of [1280, 700, 420]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(180);
      const geometry = await summary.evaluate((el) => {
        const viewport = el.closest(".transcript-viewport");
        const button = el.querySelector(".tr-diff > button").getBoundingClientRect();
        const bounds = viewport.getBoundingClientRect();
        const row = el.closest(".transcript-item").getBoundingClientRect();
        return { left: el.getBoundingClientRect().left, rowLeft: row.left,
          right: button.right, viewportRight: bounds.right, viewportWidth: viewport.clientWidth,
          scrollWidth: viewport.scrollWidth, padding: parseFloat(getComputedStyle(el.closest(".transcript-item")).paddingLeft) };
      });
      assert.ok(Math.abs(geometry.left - geometry.rowLeft - geometry.padding) < 2, JSON.stringify(geometry));
      assert.ok(geometry.right <= geometry.viewportRight + 1, JSON.stringify(geometry));
      assert.ok(geometry.scrollWidth <= geometry.viewportWidth + 1, JSON.stringify(geometry));
      await page.screenshot({ path: `${output}/${story}-${width}.png` });
    }
    await page.setViewportSize({ width: 1280, height: 900 });
    // Opening a small disclosure while all content remains visible must not
    // advertise a jump just because following was paused.
    if (story === "codex-file-changes") {
      await page.locator(".transcript-viewport").evaluate((el) => { el.scrollTop = el.scrollHeight; });
      await page.waitForTimeout(150);
      assert.equal(await page.locator(".transcript-jump").count(), 0);
      await page.locator(".transcript-viewport").hover();
      await page.mouse.wheel(0, -20);
      await page.waitForTimeout(150);
      assert.equal(await page.locator(".transcript-jump").count(), 0);
    }
  }
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ output, providers: 3, widths: [1280, 700, 420], errors }));
} finally { await browser.close(); }
