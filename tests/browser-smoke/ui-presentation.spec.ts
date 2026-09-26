import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import type { TranscriptNode } from "../../src/features/transcript/parse/types";

declare global {
  interface Window {
    uiTitle: { first: string; original: string };
    uiStress: { id: string; repeated: TranscriptNode[] };
  }
}

// Runs against an existing dev server and reads an existing session. No prompts,
// lifecycle requests, or backend writes. Stress data lives in this page only.
const output = resolve(
  process.env.MANDRI_UI_ARTIFACTS ?? "../artifacts/runs/remediation-2026-09-11/frontend/browser",
);
await mkdir(output, { recursive: true });
const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors: string[] = [];
page.on("pageerror", (error) => errors.push(error.message));
try {
  await page.goto("http://localhost:1420");
  await page.locator(".shell-session-row").first().waitFor();
  await page.evaluate(async () => {
    const { sessionsStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/sessions.ts",
      )
    );
    const state = sessionsStore.getState();
    const first = state.order[0];
    const original = state.sessions[first].title;
    window.uiTitle = { first, original };
    state.renameLocal(first, "Un titre multiligne très long\n".repeat(24));
  });
  await page.waitForTimeout(100);
  const title = await page
    .locator(".shell-session-title")
    .first()
    .evaluate((el) => ({
      whiteSpace: getComputedStyle(el).whiteSpace,
      height: el.getBoundingClientRect().height,
      row: el.parentElement!.getBoundingClientRect().height,
    }));
  assert.equal(title.whiteSpace, "nowrap");
  assert.ok(title.height <= title.row, JSON.stringify(title));
  const sessionGeometry = await page.locator(".shell-session-row").evaluateAll((rows) =>
    rows.map((row) => {
      const box = row.getBoundingClientRect();
      const logo = row.querySelector(".shell-session-icon-slot svg")!.getBoundingClientRect();
      const status = row.querySelector(".shell-session-status-slot")!.getBoundingClientRect();
      const scroller = row.closest(".shell-projects")!;
      const right = scroller.getBoundingClientRect().left + scroller.clientWidth;
      const header = row.closest(".shell-project")!.querySelector(".shell-project-row")!;
      const folder = header.querySelector("svg")!.getBoundingClientRect();
      const name = header.querySelector(".shell-project-name")!.getBoundingClientRect();
      const title = row.querySelector(".shell-session-title")!.getBoundingClientRect();
      return {
        height: box.height,
        logoWidth: logo.width,
        logoHeight: logo.height,
        iconOffset: logo.left + logo.width / 2 - (folder.left + folder.width / 2),
        textOffset: title.left - name.left,
        widthOffset: box.width - header.getBoundingClientRect().width,
        statusInset: box.right - status.right,
        gutter: right - box.right,
      };
    }),
  );
  assert.ok(
    sessionGeometry.every(
      (r) =>
        r.height === 30 &&
        r.logoWidth === 14 &&
        r.logoHeight === 14 &&
        r.statusInset >= 8 &&
        r.gutter >= 8 &&
        r.iconOffset === 0 &&
        r.textOffset === 0 &&
        r.widthOffset === 0,
    ),
    JSON.stringify(sessionGeometry),
  );
  await page.evaluate(async () => {
    const { sessionsStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/sessions.ts",
      )
    );
    const { first, original } = window.uiTitle;
    sessionsStore.getState().renameLocal(first, original);
  });
  assert.equal(await page.locator(".composer-mic").count(), 0);
  await page.screenshot({ path: resolve(output, "home.png") });
  await page.getByRole("button", { name: "Paramètres", exact: true }).click();
  await page.locator(".settings-modal h2").nth(1).waitFor();
  const headings = await page.locator(".settings-modal h2").evaluateAll((els) =>
    els.map((el) => ({
      font: getComputedStyle(el).fontFamily,
      weight: getComputedStyle(el).fontWeight,
    })),
  );
  assert.ok(headings.length >= 2);
  assert.ok(headings.every((h) => h.font.includes("Fraunces Variable") && h.weight === "300"));
  await page.evaluate(() => document.fonts.ready);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("DOM.enable");
  await cdp.send("CSS.enable");
  const doc = await cdp.send("DOM.getDocument");
  const headingNode = await cdp.send("DOM.querySelector", {
    nodeId: doc.root.nodeId,
    selector: ".settings-modal-title",
  });
  const renderedFonts = await cdp.send("CSS.getPlatformFontsForNode", {
    nodeId: headingNode.nodeId,
  });
  assert.ok(
    renderedFonts.fonts.some((font) => font.isCustomFont && font.familyName.includes("Fraunces")),
  );
  await page.screenshot({ path: resolve(output, "settings.png") });
  await page.keyboard.press("Escape");

  const model = page
    .locator(".composer-chip-anchor")
    .filter({ has: page.locator('button[aria-label="Modèle"]') });
  for (const size of [
    { width: 1920, height: 1080 },
    { width: 1280, height: 800 },
    { width: 1024, height: 640 },
    { width: 853, height: 533 },
    { width: 640, height: 800 },
  ]) {
    await page.setViewportSize(size);
    await model.locator("button").first().click();
    const panel = page.locator(".chip-popover");
    await panel.waitFor();
    await page.waitForTimeout(120);
    const rect = await panel.boundingBox();
    assert.ok(
      rect &&
        rect.x >= 0 &&
        rect.y >= 0 &&
        rect.x + rect.width <= size.width + 1 &&
        rect.y + rect.height <= size.height + 1,
      JSON.stringify({ size, rect }),
    );
    assert.ok(await panel.evaluate((el) => el.contains(document.activeElement)));
    await page.keyboard.press("Escape");
    assert.equal(await panel.count(), 0);
    assert.ok(
      await model
        .locator("button")
        .first()
        .evaluate((el) => el === document.activeElement),
    );
  }
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator(".welcome-folder-pill").click();
  await page.locator(".folder-picker").waitFor();
  const folderBounds = await page.locator(".chip-popover").boundingBox();
  assert.ok(folderBounds && folderBounds.y >= 0 && folderBounds.y + folderBounds.height <= 800);
  await page.screenshot({ path: resolve(output, "folder-menu.png") });
  await page.keyboard.press("Escape");
  await page.locator(".shell-session-row").filter({ hasText: "git --version" }).first().click();
  await page.locator(".tr-tool").first().waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator(".tr-tool--running").count(), 0);
  const tool = page.locator(".tr-tool").first();
  await tool.locator("button").click();
  assert.ok((await tool.locator(".tr-tool-detail").innerText()).length > 0);
  await page.screenshot({ path: resolve(output, "tool-open.png") });

  // Real parsed nodes, repeated only to exercise virtualized layout/scroll.
  await page.evaluate(async () => {
    const { transcriptStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/sessions.ts",
      )
    );
    const id = decodeURIComponent(location.hash.split("/").at(-1)!);
    const original = transcriptStore.getState().transcripts[id].nodes;
    const repeated = Array.from({ length: 50 }, (_, group) =>
      original.map((node: TranscriptNode, i: number) => ({ ...node, key: `stress-${group}-${i}` })),
    ).flat();
    window.uiStress = { id, repeated };
    transcriptStore.getState().setFlags(id, { historyExhausted: true });
    transcriptStore.getState().setNodes(id, repeated);
  });
  const viewport = page.locator(".transcript-viewport");
  await page.waitForTimeout(300);
  await viewport.evaluate((el) => {
    el.scrollTop = 600;
  });
  await page.waitForTimeout(300);
  const before = await viewport.evaluate((el) => el.scrollTop);
  await page.evaluate(async () => {
    const { transcriptStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/sessions.ts",
      )
    );
    const { id, repeated } = window.uiStress;
    transcriptStore.getState().setNodes(id, [
      ...repeated,
      {
        kind: "assistant",
        key: "stream-proof",
        text: "A new streamed response.",
        streaming: true,
      },
    ]);
  });
  await page.waitForTimeout(200);
  const after = await viewport.evaluate((el) => el.scrollTop);
  assert.ok(Math.abs(after - before) < 3, JSON.stringify({ before, after }));
  const openedIndex = await page.locator(".tr-tool").evaluateAll((els) => {
    const viewport = document.querySelector(".transcript-viewport")!.getBoundingClientRect();
    const el = els.find(
      (el) =>
        el.getBoundingClientRect().top > viewport.top &&
        el.getBoundingClientRect().bottom < viewport.bottom,
    );
    return el!.closest(".transcript-item")!.getAttribute("data-index");
  });
  const row = page.locator(`.transcript-item[data-index="${openedIndex}"] .tr-tool`);
  await row.locator("button").click();
  await page.waitForTimeout(150);
  const boxes = await page.locator(".transcript-item").evaluateAll((els) =>
    els
      .map((el) => el.getBoundingClientRect())
      .sort((a, b) => a.top - b.top)
      .map((r) => ({ top: r.top, bottom: r.bottom })),
  );
  for (let i = 1; i < boxes.length; i++)
    assert.ok(boxes[i]!.top >= boxes[i - 1]!.bottom - 1, "Rows overlap after expansion");
  const openedScroll = await viewport.evaluate((el) => el.scrollTop);
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(200);
  await viewport.evaluate((el, top) => {
    el.scrollTop = top;
  }, openedScroll);
  await page.waitForTimeout(200);
  assert.equal(
    await page
      .locator(`.transcript-item[data-index="${openedIndex}"] .tr-tool button`)
      .getAttribute("aria-expanded"),
    "true",
  );

  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.locator(".tr-diagnostics button").click();
  await page.locator(".tr-diagnostics .tr-raw-payload").waitFor();
  await page.waitForTimeout(150);
  await viewport.evaluate((el) => {
    el.scrollTop = el.scrollHeight;
  });
  await page.waitForTimeout(150);
  const scrollGeometry = await page.locator(".tr-diagnostics .tr-raw-payload").evaluate((el) => {
    const outer = el.closest(".transcript-viewport")!;
    return {
      gap:
        outer.getBoundingClientRect().left + outer.clientWidth - el.getBoundingClientRect().right,
      innerScrolls: el.scrollHeight > el.clientHeight,
      outerScrolls: outer.scrollHeight > outer.clientHeight,
    };
  });
  assert.ok(
    scrollGeometry.gap >= 12 && scrollGeometry.innerScrolls && scrollGeometry.outerScrolls,
    JSON.stringify(scrollGeometry),
  );
  await page.screenshot({ path: resolve(output, "scroll-gutters.png") });

  await page.evaluate(async () => {
    const { transcriptStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/sessions.ts",
      )
    );
    const { parseOpenCodeEvent } = await import(
      String("/src/features/transcript/parse/opencode.ts")
    );
    const fixture = await fetch("/tests/fixtures/opencode/tools-diff.json").then((r) => r.json());
    const nodes = fixture.frames.flatMap((f: { frame: { raw: unknown } }) =>
      parseOpenCodeEvent(f.frame.raw, "opencode"),
    );
    const diff = nodes.find(
      (n: TranscriptNode) => n.kind === "diff" && n.lines && n.lines.length > 0,
    );
    if (!diff) throw Error("Recorded fixture has no populated diff");
    transcriptStore.getState().setNodes(window.uiStress.id, [
      {
        kind: "assistant",
        text: "La modification est prête.\n\n- **Vérification** terminée\n- Le résultat est dans `calc.ts`.\n\n```ts\nconst result = add(2, 3);\n```",
        key: "markdown-layout",
      },
      { ...diff, key: "recorded-diff" },
    ]);
  });
  await viewport.evaluate((el) => {
    el.scrollTop = 0;
  });
  await page.locator(".tr-markdown strong").waitFor();
  assert.equal(await page.locator(".tr-markdown pre code").count(), 1);
  await page.locator(".transcript-item .tr-diff button").click();
  await page.locator(".transcript-item .tr-diff-body").waitFor();
  await page.screenshot({ path: resolve(output, "markdown-diff.png") });
  await page.evaluate(async () => {
    const { changeLocale } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/i18n\/index\.ts(?:\?|$)/.test(r.name))?.name ?? "/src/i18n/index.ts",
      )
    );
    await changeLocale("en");
  });
  await page.getByRole("button", { name: "Settings", exact: true }).waitFor();
  await page.getByRole("button", { name: "1 file changed", exact: false }).waitFor();
  await page.evaluate(async () => {
    const { sessionsStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/sessions.ts",
      )
    );
    const { panesStore } = await import(
      String(
        performance
          .getEntriesByType("resource")
          .find((r) => /\/src\/stores\/panes\.ts(?:\?|$)/.test(r.name))?.name ??
          "/src/stores/panes.ts",
      )
    );
    const current = window.uiStress.id;
    const other = Object.values(sessionsStore.getState().sessions).find((s: unknown) => {
      const row = s as { id: string; title: string };
      return row.id !== current && row.title.includes("git --version");
    }) as { id: string };
    panesStore.getState().openPane(current);
    panesStore.getState().openPane(other.id);
  });
  await page.locator(".pane").nth(1).waitFor();
  await page.waitForTimeout(200);
  const composers = await page.locator(".pane .composer").evaluateAll((els) =>
    els.map((el) => {
      const box = el.getBoundingClientRect(),
        parent = el.closest(".pane")!.getBoundingClientRect();
      return box.left >= parent.left && box.right <= parent.right;
    }),
  );
  assert.equal(composers.length, 2);
  assert.ok(composers.every(Boolean));
  await page.screenshot({ path: resolve(output, "split-view.png") });
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      sidebar: title,
      headings,
      renderedFonts,
      streamedScroll: { before, after },
      screenshots: output,
      errors,
    }),
  );
} finally {
  await browser.close();
}
