import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";
const { turnFixture } = (await import(
  String("../unit/turn-work-fixtures.ts")
)) as typeof import("../unit/turn-work-fixtures");

// All daemon traffic is synthetic. No harness or model is started.
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch();
const output = resolve(
  process.env.MANDRI_UI_ARTIFACTS ?? "../mandri-work-documents/session-startup",
);
await mkdir(output, { recursive: true });
const results: unknown[] = [];
try {
  for (const width of [1280, 1920, 640]) {
    for (const harness of ["codex", "pi"] as const) {
      for (const backend of ["host", "docker"] as const) {
        const page = await browser.newPage({ viewport: { width, height: 900 } });
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        await page.addInitScript(
          ({ harness }) => {
            localStorage.setItem(
              "mandri.preferences",
              JSON.stringify({
                state: {
                  language: "en",
                  defaultHarness: harness,
                  defaultModel: "fixture/model",
                },
                version: 0,
              }),
            );
          },
          { harness },
        );
        const session = {
          id: "startup-test",
          harness,
          state: "live",
          title: "Hello",
          project_path: "/workspace/synthetic",
          native_id: "native",
          model: "fixture/model",
          execution_backend: backend,
          privacy_mode: "none",
          policy_revision: 1,
          activity: "idle",
        };
        const runtimes = [{ harness, installed: true, version: "test", degraded: false }];
        let releaseStart!: () => void;
        const startupGate = new Promise<void>((resolve) => {
          releaseStart = resolve;
        });
        let created = false;
        let historyRequests = 0;
        let socket: WebSocketRoute | undefined;
        let seq = 0;
        await page.route("**/v1/**", async (route) => {
          const path = new URL(route.request().url()).pathname;
          if (path === "/v1/runtime/sessions") {
            await startupGate;
            created = true;
            await route.fulfill({ json: session });
            return;
          }
          await route.fulfill({
            json:
              path === "/v1/runtimes"
                ? runtimes
                : path.endsWith("/availability")
                  ? {
                      owner: "mandri",
                      activity: "idle",
                      can_resume: false,
                      can_release: false,
                      can_restore: false,
                    }
                  : path === "/v1/sessions"
                    ? created
                      ? [session]
                      : []
                    : path === `/v1/sessions/${session.id}`
                      ? session
                      : [],
          });
        });
        await page.routeWebSocket("**/v1/ws", (current) => {
          socket = current;
          current.onMessage((data) => {
            const frame = JSON.parse(String(data));
            const reply = (result: unknown) =>
              current.send(
                JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }),
              );
            if (frame.action === "agent.list")
              reply({ agents: [], parent_capabilities: {}, classified_session_ids: [session.id] });
            else if (frame.action === "session.list") reply({ sessions: created ? [session] : [] });
            else if (frame.action === "session.history") {
              historyRequests++;
              reply({ entries: [], next_cursor: null, has_more: false, turn_active: false });
            } else if (frame.action === "session.prompt") reply({ state: "accepted" });
            else if (frame.action === "command.catalogs")
              reply({ default_cwd: session.project_path, catalogs: [] });
            else if (frame.action === "command.list") reply({ invocations: [] });
            else if (frame.action === "session.commands") reply({ commands: [] });
            else if (frame.action === "command.catalog")
              reply({
                ...frame.params,
                cwd: session.project_path,
                state: "ready",
                commands: [],
                profile_id: null,
                execution_backend: backend,
                privacy_mode: "none",
              });
            else if (frame.op === "subscribe") {
              current.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
              if (frame.topic === "sessions.all")
                current.send(
                  JSON.stringify({
                    type: "snapshot",
                    topic: "sessions.all",
                    sessions: [],
                    runtimes,
                  }),
                );
            } else if (frame.action) errors.push(`Unexpected action: ${frame.action}`);
          });
        });
        const emit = (raw: unknown, ts: number) =>
          socket!.send(
            JSON.stringify({
              topic: `session.${session.id}`,
              source: harness,
              seq: ++seq,
              ts,
              raw,
            }),
          );
        await page.goto(`http://127.0.0.1:${address.port}/#/?cwd=/workspace/synthetic`);
        await page.locator(".composer-input").fill("Same prompt");
        if (backend === "docker") {
          await page.getByRole("button", { name: "Session protection", exact: true }).click();
          await page.getByRole("button", { name: /^Docker sandbox/ }).click();
          await page.keyboard.press("Escape");
        }
        await page.evaluate(() => document.fonts.ready);
        // Sample every rendered frame from submit through the real session's first turn.
        await page.evaluate(() => {
          const state = {
            active: false,
            samples: [] as boolean[],
            historyIndicators: 0,
            bubbleTops: [] as number[],
          };
          Object.assign(window, { startupFrames: state });
          new MutationObserver((records) => {
            for (const record of records) {
              for (const node of record.addedNodes) {
                if (
                  node instanceof Element &&
                  (node.matches(".transcript-status-top") ||
                    node.querySelector(".transcript-status-top"))
                ) {
                  state.historyIndicators++;
                }
              }
            }
          }).observe(document.body, { childList: true, subtree: true });
          document.addEventListener(
            "click",
            (event) => {
              if ((event.target as Element).closest('button[aria-label="Send"]')) {
                state.active = true;
                const sample = () => {
                  if (!state.active) return;
                  state.samples.push(
                    Boolean(
                      document.querySelector(".transcript-activity, .transcript-turn-summary"),
                    ),
                  );
                  const bubble = document.querySelector(".tr-user-bubble");
                  if (bubble) state.bubbleTops.push(bubble.getBoundingClientRect().top);
                  requestAnimationFrame(sample);
                };
                requestAnimationFrame(sample);
              }
            },
            { once: true, capture: true },
          );
        });
        await page.getByRole("button", { name: "Send", exact: true }).click();
        await page
          .getByRole("status")
          .filter({ hasText: backend === "docker" ? "Preparing" : "Thinking" })
          .waitFor();
        assert.equal(await page.getByRole("button", { name: /Cancel startup/ }).count(), 0);
        const geometry = () =>
          page.evaluate(() => {
            const rect = (selector: string) => {
              const box = document.querySelector(selector)!.getBoundingClientRect();
              return { x: box.x, y: box.y, width: box.width, height: box.height };
            };
            const status = document.querySelector(
              ".transcript-turn-summary > span, .transcript-activity > span",
            )!;
            const box = status.getBoundingClientRect();
            const style = getComputedStyle(status);
            return {
              bubble: rect(".tr-user-bubble"),
              composer: rect(".composer"),
              status: { x: box.x, y: box.y },
              font: [
                style.fontFamily,
                style.fontSize,
                style.fontWeight,
                style.lineHeight,
                style.letterSpacing,
                style.fontVariantNumeric,
              ],
            };
          });
        const startup = await geometry();
        await page.waitForTimeout(550);
        releaseStart();
        await page.waitForURL(`**/#/session/${session.id}`);
        await page.getByRole("status").filter({ hasText: "Thinking" }).waitFor();
        const awaiting = await geometry();
        await page.waitForTimeout(550);
        const fixture = turnFixture(harness, "one", Date.now());
        emit(fixture.starts, fixture.start);
        await page.locator(".transcript-turn-summary").waitFor();
        const working = await geometry();
        for (const body of fixture.bodies) emit(body, fixture.start + 500);
        for (const finish of fixture.finishes) emit(finish, fixture.end);
        await page.getByText("Worked for 5s", { exact: true }).waitFor();
        const completed = await geometry();
        const frames = await page.evaluate(() => {
          const state = (
            window as unknown as {
              startupFrames: {
                active: boolean;
                samples: boolean[];
                historyIndicators: number;
                bubbleTops: number[];
              };
            }
          ).startupFrames;
          state.active = false;
          return state;
        });
        assert.ok(
          frames.samples.length > 10 && frames.samples.every(Boolean),
          `Blank startup frame: ${harness}/${backend}: ${JSON.stringify(frames)}`,
        );
        assert.equal(
          historyRequests,
          0,
          "A newly created session must use its live transcript without fetching history",
        );
        assert.equal(
          frames.historyIndicators,
          0,
          "Startup must never insert a history loading indicator",
        );
        assert.ok(
          frames.bubbleTops.every((top) => Math.abs(top - startup.bubble.y) < 1),
          `Prompt moved during startup: ${JSON.stringify(frames.bubbleTops)}`,
        );
        for (const phase of [awaiting, working, completed]) {
          for (const key of ["bubble", "composer", "status"] as const) {
            for (const [axis, expected] of Object.entries(startup[key])) {
              const actual = (phase[key] as Record<string, number>)[axis]!;
              // The virtualizer rounds measured row heights to device pixels.
              assert.ok(
                Math.abs(actual - expected) < 1,
                `${harness}/${backend}/${width}: ${key}.${axis} moved from ${expected} to ${actual}`,
              );
            }
          }
          assert.deepEqual(phase.font, startup.font, "Status typography changed");
        }
        assert.equal(await page.locator(".transcript-turn-summary .tr-shimmer").count(), 0);
        assert.deepEqual(errors, []);
        await page.screenshot({ path: resolve(output, `${harness}-${backend}-${width}.png`) });
        results.push({
          harness,
          backend,
          width,
          frames: frames.samples.length,
          startup,
          awaiting,
          working,
          completed,
        });
        await page.close();
      }
    }
  }
  console.log(JSON.stringify(results, null, 2));
} finally {
  await browser.close();
  await server.close();
}
