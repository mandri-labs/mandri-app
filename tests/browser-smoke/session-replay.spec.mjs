import process from "node:process";
import console from "node:console";
import assert from "node:assert/strict";
import { readFile, mkdir } from "node:fs/promises";
import { chromium } from "playwright";

const base = process.env.STORYBOOK_URL ?? "http://127.0.0.1:6007";
const output = process.env.REPLAY_ARTIFACTS ?? "../artifacts/runs/session-replay";
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
try {
  for (const harness of ["claude", "codex", "opencode"]) {
    for (const scenario of ["chat", "tools-diff", "approval", "error"]) {
      if (process.env.REPLAY_SCENARIO && scenario !== process.env.REPLAY_SCENARIO) continue;
      const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
      const errors = [],
        requests = [];
      page.on("pageerror", (error) => errors.push(error.message));
      page.on("request", (request) => {
        if (request.url().includes("/v1/")) requests.push(request.url());
      });
      const fixture = JSON.parse(
        await readFile(`tests/fixtures/${harness}/${scenario}.json`, "utf8"),
      );
      await page.clock.install();
      await page.goto(
        `${base}/iframe.html?id=app-session-replay--${harness}-${scenario}&viewMode=story`,
      );
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      assert.equal(await page.locator(".shell .session-view .composer").count(), 1);
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      const controls = page.locator(".session-replay-controls > span");
      const paused = await controls.innerText();
      await page.clock.runFor(2000);
      assert.equal(await controls.innerText(), paused, "pause freezes playback");
      await page.getByRole("button", { name: "Play", exact: true }).click();
      const pending = fixture.frames.find((entry) => entry.frame.type === "approval.pending");
      if (pending) {
        const offset = pending.ts - fixture.frames[0].ts;
        await page.clock.runFor(offset);
        await page.screenshot({ path: `${output}/${harness}-${scenario}.png` });
      }
      const duration = Math.max(...fixture.frames.map((entry) => entry.ts)) - fixture.frames[0].ts;
      await page.clock.runFor(duration + 500);
      assert.match(
        await controls.innerText(),
        new RegExp(`${fixture.frames.length}/${fixture.frames.length} frames.*Recording ended`),
      );
      assert.doesNotMatch(
        await page.locator(".session-view").innerText(),
        /socket not connected|History unavailable/,
      );
      await page.screenshot({ path: `${output}/${harness}-${scenario}-finished.png` });
      await page.getByRole("button", { name: "Restart recording" }).click();
      await page.getByRole("button", { name: "Pause", exact: true }).waitFor();
      assert.doesNotMatch(await controls.innerText(), /Recording ended/);
      if (pending) {
        await page.getByRole("button", { name: "Pause", exact: true }).click();
        const pendingIndex = fixture.frames.indexOf(pending);
        const delivered = () =>
          controls.innerText().then((text) => Number(text.match(/(\d+)\/\d+ frames/)[1]));
        while ((await delivered()) <= pendingIndex) {
          await page.getByRole("button", { name: "Next event", exact: true }).click();
        }
        assert.equal(await page.locator(".session-approvals .approval-card").count(), 1);
        await page.clock.runFor(3000);
        assert.equal(
          await page.locator(".session-approvals .approval-card").count(),
          1,
          "paused approval does not expire",
        );
        await page.screenshot({ path: `${output}/${harness}-${scenario}-paused.png` });
      }
      assert.deepEqual(requests, [], "no real daemon requests");
      assert.deepEqual(errors, [], "no browser errors");
      console.log(
        `${harness}/${scenario}: ${fixture.frames.length} frames, pause, completion, restart, offline OK`,
      );
      await page.close();
    }
  }
} finally {
  await browser.close();
}
