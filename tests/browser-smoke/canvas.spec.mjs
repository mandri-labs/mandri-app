import { chromium } from "playwright";
import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
const output = fileURLToPath(new URL("../../../artifacts/canvas-v1/", import.meta.url));
await mkdir(output, { recursive: true });
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).searchParams.get("path");
    if (path === "/workspace/diagram.png")
      return route.fulfill({
        status: 200,
        contentType: "application/octet-stream",
        body: await readFile(`${output}/markdown.png`),
      });
    const content =
      path === "/workspace/docs/guide.md"
        ? "# Canvas guide\n\nA Markdown document with **formatted text**.\n\n[Source](../main.ts#L2-L3)\n\n[Section](#details)\n\n## Details\n\nRelative links resolve in the session workspace."
        : path === "/workspace/main.ts"
          ? "// Synthetic fixture\nconst answer = 42;\nconsole.log(answer);"
          : undefined;
    return route.fulfill({
      status: content ? 200 : 404,
      contentType: "application/octet-stream",
      body: content ?? "missing",
    });
  });
  await page.goto("http://localhost:6017/iframe.html?id=features-canvas--files&viewMode=story");
  await page.getByRole("link", { name: "Guide", exact: true }).click();
  await page.getByRole("heading", { name: "Canvas guide" }).waitFor();
  assert.equal(await page.locator(".shell-content-scroll .canvas-panel").count(), 0);
  const bounds = await page.locator(".canvas-panel").boundingBox();
  assert.equal(bounds.y, 0);
  assert.equal(bounds.height, 900);
  await page.screenshot({ path: `${output}/markdown.png` });
  await page.getByRole("link", { name: "Source", exact: true }).click();
  await page.locator(".canvas-selected-line").first().waitFor();
  assert.equal(await page.locator(".canvas-selected-line").count(), 2);
  const divider = page.getByRole("separator");
  await divider.focus();
  await page.keyboard.press("ArrowLeft");
  assert.equal(await divider.getAttribute("aria-valuenow"), "52");
  await page.getByRole("button", { name: "Expand", exact: true }).click();
  assert.equal(await page.locator(".canvas-chat").isVisible(), false);
  await page.getByRole("button", { name: "Restore split view" }).click();
  await page.screenshot({ path: `${output}/code.png` });
  await page.setViewportSize({ width: 420, height: 850 });
  assert.equal(await page.locator(".canvas-chat").isVisible(), false);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.screenshot({ path: `${output}/mobile.png` });
  await page.getByRole("button", { name: "Close canvas" }).click();
  await page.getByRole("link", { name: "Missing", exact: true }).click();
  await page.getByText("File unavailable in this session context.").waitFor();
  await page.getByRole("button", { name: "Close canvas" }).click();
  await page.getByRole("button", { name: "Open in canvas", exact: true }).first().click();
  await page.getByText("Message excerpt — this content does not represent a saved file.").waitFor();
  await page.getByRole("button", { name: "Close canvas" }).click();
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole("button", { name: "Diagram", exact: true }).click();
  await page.locator(".canvas-image-stage img").waitFor();
  for (const theme of ["dark", "light"]) {
    await page.evaluate((theme) => (document.documentElement.dataset.theme = theme), theme);
    const colors = await page.locator(".canvas-panel").evaluate((el) => ({
      bg: getComputedStyle(el).backgroundColor,
      fg: getComputedStyle(el).color,
    }));
    assert.equal(colors.bg, theme === "dark" ? "rgb(22, 20, 15)" : "rgb(246, 241, 231)");
    assert.equal(colors.fg, theme === "dark" ? "rgb(236, 231, 221)" : "rgb(26, 23, 18)");
    for (const button of await page.locator(".canvas-panel button").all()) {
      if (!(await button.isVisible())) continue;
      assert.equal(
        await button.evaluate((el) => {
          const r = el.getBoundingClientRect();
          return el.contains(document.elementFromPoint(r.x + r.width / 2, r.y + r.height / 2));
        }),
        true,
      );
    }
    await page.getByRole("button", { name: "Zoom in" }).click();
    assert.equal(
      await page
        .locator(".canvas-image-stage img")
        .evaluate((el) => Math.round(el.getBoundingClientRect().width)),
      1800,
    );
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.getByRole("button", { name: "Expand", exact: true }).click();
    await page.getByRole("button", { name: "Restore split view" }).click();
    await page.screenshot({ path: `${output}/image-${theme}.png` });
  }
  assert.deepEqual(errors, []);
  console.log(
    "Canvas smoke passed: Markdown, code ranges, resize, expand, mobile, missing files, excerpts.",
  );
} finally {
  await browser.close();
}
