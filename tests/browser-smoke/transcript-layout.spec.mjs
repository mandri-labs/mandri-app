/* global process, console, performance, window, document, innerHeight */
import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
const output = resolve(process.env.MANDRI_UI_ARTIFACTS ?? "../artifacts/runs/transcript-layout");
await mkdir(output, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE,
});
const page = await browser.newPage({ viewport: { width: 1280, height: 720 } });
page.setDefaultTimeout(5000);
page.on("pageerror", (error) => console.error(error.message));
try {
  await page.route("**/v1/**", (route) =>
    route.fulfill({ status: 200, contentType: "application/json", body: "[]" }),
  );
  await page.routeWebSocket("**", (ws) => ws.close());
  await page.goto(process.env.MANDRI_UI_URL ?? "http://127.0.0.1:1440");
  await page.getByText("New chat", { exact: true }).waitFor();
  await page.evaluate(async () => {
    const { default: React } = await import(
      performance.getEntriesByType("resource").find((r) => /\/react\.js(?:\?|$)/.test(r.name)).name
    );
    const {
      default: { createRoot },
    } = await import(
      performance
        .getEntriesByType("resource")
        .find((r) => /\/react-dom_client\.js(?:\?|$)/.test(r.name)).name
    );
    const { Transcript } = await import("/src/features/transcript/Transcript.tsx");
    const { SessionApprovals } = await import("/src/features/approvals/SessionApprovals.tsx");
    const { SessionProtection } = await import("/src/features/sessions/SessionProtection.tsx");
    const { sessionsStore, transcriptStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((r) => /\/src\/stores\/sessions\.ts(?:\?|$)/.test(r.name)).name
    );
    const { approvalsStore } = await import(
      performance
        .getEntriesByType("resource")
        .findLast((r) => /\/src\/stores\/approvals\.ts(?:\?|$)/.test(r.name)).name
    );
    await import("/src/features/transcript/session-view.css");
    const { initI18n } = await import("/src/i18n/index.ts");
    await initI18n("en");
    const session = {
      id: "layout",
      harness: "claude",
      state: "live",
      title: "Long task",
      deleted: false,
      pendingApprovals: 0,
      executionBackend: "docker",
      privacyMode: "surrogate",
    };
    sessionsStore.setState({ sessions: { layout: session }, order: ["layout"] });
    const nodes = Array.from({ length: 160 }, (_, i) => ({
      kind: "tool",
      key: `tool-${i}`,
      tool: "Read",
      label: "Read",
      target: `/workspace/api/src/module-${i}.ts`,
      status: "done",
      detailText: "Synthetic output\n".repeat(12),
    }));
    transcriptStore.setState({
      transcripts: {
        layout: { nodes, gapFlag: false, historyUnavailable: false, historyExhausted: true },
      },
    });
    document.getElementById("root").style.display = "none";
    const mount = document.createElement("main");
    mount.className = "pane-body";
    mount.style = "position:fixed;inset:40px 0 0 260px;display:flex;padding:20px 40px";
    document.body.append(mount);
    const e = React.createElement;
    createRoot(mount).render(
      e(
        "div",
        { className: "session-view" },
        e(
          "div",
          { className: "session-view-column" },
          e(Transcript, {
            sessionId: "layout",
            harness: "claude",
            feed: { ensureSession: () => {}, loadHistory: async () => undefined },
          }),
          e(SessionApprovals, { sessionId: "layout" }),
          e(
            "div",
            { className: "session-view-composer" },
            e(SessionProtection, { session }),
            e(
              "div",
              {
                style: {
                  height: 102,
                  border: "1px solid var(--color-border-subtle)",
                  borderRadius: 16,
                  padding: 16,
                },
              },
              "Describe the task to run…",
            ),
          ),
        ),
      ),
    );
    window.layoutApprovals = (count) =>
      approvalsStore.setState({
        pending: Object.fromEntries(
          Array.from({ length: count }, (_, i) => [
            `approval-${i}`,
            {
              approvalId: `approval-${i}`,
              sessionId: "layout",
              harness: "claude",
              kind: "command_execution",
              status: "pending",
              deadline: Date.now() + 600000,
              raw: {
                request: {
                  tool_name: "Bash",
                  input: { command: `cat /workspace/api/src/module-${i}.ts` },
                },
              },
            },
          ]),
        ),
      });
  });
  await page.locator(".transcript-item").first().waitFor();
  for (const count of [0, 1, 8, 0, 5, 0]) {
    await page.evaluate((count) => window.layoutApprovals(count), count);
    await page.waitForTimeout(120);
    await page.locator(".transcript-viewport").evaluate((el) => {
      el.scrollTop = Math.floor(el.scrollHeight / 2);
    });
    await page.waitForTimeout(120);
    const geometry = await page.evaluate(() => {
      const viewport = document.querySelector(".transcript-viewport").getBoundingClientRect();
      const transcript = document.querySelector(".transcript").getBoundingClientRect();
      const composer = document.querySelector(".session-view-composer").getBoundingClientRect();
      const approvals = document.querySelector(".session-approvals")?.getBoundingClientRect();
      return {
        viewportBottom: viewport.bottom,
        transcriptBottom: transcript.bottom,
        composerTop: composer.top,
        composerBottom: composer.bottom,
        approvalsTop: approvals?.top,
        windowHeight: innerHeight,
      };
    });
    await page.screenshot({ path: `${output}/approvals-${count}.png` });
    assert.ok(geometry.viewportBottom <= geometry.transcriptBottom + 1, JSON.stringify(geometry));
    assert.ok(
      geometry.transcriptBottom <= (geometry.approvalsTop ?? geometry.composerTop) + 1,
      JSON.stringify(geometry),
    );
    assert.ok(geometry.composerBottom <= geometry.windowHeight + 1, JSON.stringify(geometry));
  }
  console.log(
    JSON.stringify({
      output,
      longTranscriptRows: 160,
      approvalTransitions: [0, 1, 8, 0, 5, 0],
      bounded: true,
    }),
  );
} catch (error) {
  await page.screenshot({ path: `${output}/failure.png` });
  throw error;
} finally {
  await browser.close();
}
