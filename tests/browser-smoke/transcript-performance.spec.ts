import assert from "node:assert/strict";
import { chromium, type Page, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

// Real app/React/virtualizer, mocked daemon. Never sends a prompt to a real session.
const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch();

function line(index: number, extra = ""): string {
  return JSON.stringify({
    type: "assistant",
    uuid: `message-${index}`,
    message: {
      role: "assistant",
      content: [
        {
          type: "text",
          text: `Message ${index}\n\n${"A paragraph with **markdown** and `code`. ".repeat(1 + (index % 8))}${extra}`,
        },
      ],
    },
  });
}

async function anchor(page: Page, text?: string) {
  return page.locator(".transcript-viewport").evaluate(async (viewport, text) => {
    const deadline = performance.now() + 5000;
    let previous = "";
    let unchangedSince = performance.now();
    while (performance.now() < deadline) {
      await new Promise(requestAnimationFrame);
      const bounds = viewport.getBoundingClientRect();
      const rows = [...viewport.querySelectorAll(".transcript-item")];
      const row = rows.find((row) => {
        if (text) return row.querySelector("p")?.textContent === text;
        const rect = row.getBoundingClientRect();
        return rect.bottom > bounds.top && rect.top < bounds.bottom;
      });
      const layout = JSON.stringify({
        scrollTop: viewport.scrollTop,
        scrollHeight: viewport.scrollHeight,
        bounds: bounds.toJSON(),
        rows: rows.map((row) => [
          row.getAttribute("data-index"),
          row.getBoundingClientRect().toJSON(),
        ]),
      });
      if (!row || document.fonts.status !== "loaded" || layout !== previous) {
        previous = layout;
        unchangedSince = performance.now();
        continue;
      }
      if (performance.now() - unchangedSince < 200) continue;
      return {
        text: row.querySelector("p")!.textContent!,
        offset: row.getBoundingClientRect().top - bounds.top,
        screenTop: row.getBoundingClientRect().top,
        scrollTop: viewport.scrollTop,
      };
    }
    throw Error(
      `Transcript layout did not settle for anchor ${text ?? "at the viewport top"}: ${previous}`,
    );
  }, text);
}

async function waitFor(check: () => boolean, message: string) {
  const deadline = performance.now() + 30_000;
  while (!check()) {
    assert.ok(performance.now() < deadline, message);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

async function refreshed(page: Page, entry: string) {
  const text: string = JSON.parse(entry).message.content[0].text;
  await page.waitForFunction(async (text) => {
    const { transcriptStore } = await import(String("/src/stores/sessions.ts"));
    return transcriptStore
      .getState()
      .transcripts["perf-0"]?.nodes.some(
        (node: { kind: string; text?: string }) => node.kind === "assistant" && node.text === text,
      );
  }, text);
}

async function atEnd(page: Page) {
  await page
    .waitForFunction(
      () => {
        const el = document.querySelector(".transcript-viewport")!;
        return Math.abs(el.scrollHeight - el.clientHeight - el.scrollTop) < 3;
      },
      undefined,
      { timeout: 5000 },
    )
    .catch(async (error) => {
      console.log(
        "End position",
        await page.locator(".transcript-viewport").evaluate((el) => ({
          top: el.scrollTop,
          height: el.scrollHeight,
          client: el.clientHeight,
          padding: getComputedStyle(el).paddingBottom,
          innerHeight: (el.firstElementChild as HTMLElement).style.height,
          rows: [...el.querySelectorAll(".transcript-item")].map((row) => ({
            index: row.getAttribute("data-index"),
            top: row.getBoundingClientRect().top,
            height: row.getBoundingClientRect().height,
          })),
        })),
      );
      throw error;
    });
}

try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const sessions = Array.from({ length: 1500 }, (_, i) => ({
    id: `perf-${i}`,
    harness: "claude",
    state: "live",
    title: `Performance session ${i}`,
    project_path: `/project/${Math.floor(i / 100)}`,
    native_id: `native-${i}`,
    model: "test/model",
    activity: "active",
    last_activity_at: 1500 - i,
  }));
  const recent = Array.from({ length: 200 }, (_, i) => line(1000 + i));
  let current: WebSocketRoute | undefined;
  const pending: (() => void)[] = [];
  const cursors: (string | null)[] = [];
  let pongs = 0;
  let seq = 0;
  await page.route("**/v1/**", async (route) => {
    assert.equal(route.request().method(), "GET", "Unexpected backend mutation");
    const path = new URL(route.request().url()).pathname;
    if (path.endsWith("/availability")) {
      const owner = "unowned";
      await route.fulfill({
        json: {
          owner,
          activity: "idle",
          can_resume: true,
          can_release: false,
          can_restore: false,
          reason: null,
        },
      });
      return;
    }
    await route.fulfill({ json: path === "/v1/sessions" ? sessions : [] });
  });
  await page.routeWebSocket("**/v1/ws", (socket) => {
    current = socket;
    socket.onMessage((data) => {
      const frame = JSON.parse(String(data));
      if (
        frame.action === "command.catalogs" ||
        frame.action === "command.catalog" ||
        frame.action === "command.list"
      ) {
        const result =
          frame.action === "command.list"
            ? { invocations: [] }
            : frame.action === "command.catalogs"
              ? { default_cwd: "/mock-project", catalogs: [] }
              : {
                  ...frame.params,
                  cwd: frame.params.cwd ?? "/mock-project",
                  profile_id: null,
                  execution_backend: frame.params.execution_backend ?? "host",
                  privacy_mode: frame.params.privacy_mode ?? "none",
                  state: "ready",
                  commands: [],
                  reason: null,
                };
        socket.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
        return;
      }
      if (frame.action === "agent.list") {
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: {
              agents: [],
              parent_capabilities: {},
              classified_session_ids: sessions.map((session) => session.id),
            },
          }),
        );
        return;
      }
      const reply = (result: unknown) =>
        socket.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.type === "pong") pongs++;
      if (frame.op === "subscribe") {
        socket.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all")
          socket.send(
            JSON.stringify({ type: "snapshot", topic: "sessions.all", sessions, runtimes: [] }),
          );
      }
      if (frame.action === "session.list") reply({ sessions });
      else if (frame.action === "session.history") {
        const cursor = frame.params.cursor ?? null;
        if (frame.params.session_id !== "perf-0") {
          reply({ entries: [line(9000)], next_cursor: null, has_more: false });
        } else if (cursor === null) {
          cursors.push(null);
          reply({ entries: recent, next_cursor: "older-1", has_more: true });
        } else {
          cursors.push(cursor);
          const first = cursor === "older-1";
          pending.push(() =>
            reply({
              entries: Array.from({ length: 50 }, (_, i) => line((first ? 950 : 900) + i)),
              next_cursor: first ? "older-2" : null,
              has_more: first,
            }),
          );
        }
      } else if (frame.action) throw Error(`Unexpected WS action: ${frame.action}`);
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}/#/session/perf-0`);
  await page.locator(".composer-input").waitFor();
  await page.getByText("Message 1199", { exact: true }).waitFor();
  await page.evaluate(() => document.fonts.ready);
  await atEnd(page);
  await page.locator(".transcript-status-top").waitFor({ state: "hidden" });
  assert.equal(
    await page.locator(".shell-session-row").count(),
    75,
    "Each of the 15 projects initially shows five sessions",
  );
  assert.equal(
    await page.evaluate(
      async () =>
        Object.keys(
          (await import(String("/src/stores/sessions.ts"))).sessionsStore.getState().sessions,
        ).length,
    ),
    1500,
  );

  const probe = await page.evaluate(async () => {
    const { sessionsStore } = await import(String("/src/stores/sessions.ts"));
    let changes = 0;
    const longTasks: number[] = [];
    const unsubscribe = sessionsStore.subscribe(
      (state: { sessions: unknown }, previous: { sessions: unknown }) => {
        if (state.sessions !== previous.sessions) changes++;
      },
    );
    const observer = new PerformanceObserver((list) =>
      longTasks.push(...list.getEntries().map((entry) => entry.duration)),
    );
    observer.observe({ type: "longtask" });
    // Exposed only in this isolated test page; no application instrumentation.
    const probe = {
      finish: () => {
        unsubscribe();
        observer.disconnect();
        return { changes, longTasks };
      },
    };
    Object.assign(window, { composerProbe: probe });
    return performance.now();
  });
  const phrase = "Test de réactivité du composer, sans envoi.";
  await page.locator(".composer-input").pressSequentially(phrase, { delay: 20 });
  const typing = await page.evaluate(
    (start) => ({
      ...(
        window as unknown as {
          composerProbe: { finish: () => { changes: number; longTasks: number[] } };
        }
      ).composerProbe.finish(),
      duration: performance.now() - start,
    }),
    probe,
  );
  assert.equal(typing.changes, 0, "Typing invalidated session metadata and the sidebar");
  assert.equal(await page.locator(".composer-input").inputValue(), phrase);

  const viewport = page.locator(".transcript-viewport");
  const viewportBeforeHistory = await viewport.boundingBox();
  await viewport.evaluate((el) => {
    el.scrollTop = 700;
  });
  await page.locator(".transcript-status-top").waitFor();
  assert.deepEqual(
    await viewport.boundingBox(),
    viewportBeforeHistory,
    "Loading history must not move or resize the viewport",
  );
  assert.equal(cursors.at(-1), "older-1", "History must prefetch before reaching the top");
  assert.equal(pending.length, 1, "Only one older page may be in flight");
  // Continue moving while the page is deliberately held in the mocked socket.
  await viewport.evaluate((el) => {
    el.scrollTop = 220;
  });
  const before = await anchor(page);
  pending.shift()!();
  await page.locator(".transcript-status-top").waitFor({ state: "hidden" });
  const after = await anchor(page, before.text);
  assert.ok(Math.abs(after.offset - before.offset) < 2, JSON.stringify({ before, after }));
  assert.ok(
    Math.abs(after.screenTop - before.screenTop) < 2,
    "Removing the loading indicator moved the visible message on screen",
  );
  assert.deepEqual(
    await viewport.boundingBox(),
    viewportBeforeHistory,
    "Finishing history must not move or resize the viewport",
  );

  // Capture every painted frame, not just the final scroll position. Periodic
  // pings, history refreshes and content growth must not drag a reader around.
  await page.evaluate(({ text, offset }) => {
    const offsets: number[] = [];
    let animation: number;
    const sample = () => {
      const viewport = document.querySelector(".transcript-viewport")!;
      const row = [...viewport.querySelectorAll(".transcript-item")].find(
        (el) => el.querySelector("p")?.textContent === text,
      );
      offsets.push(
        row
          ? row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - offset
          : 100000,
      );
      animation = requestAnimationFrame(sample);
    };
    animation = requestAnimationFrame(sample);
    Object.assign(window, {
      readingProbe: {
        finish: () => {
          cancelAnimationFrame(animation);
          return { frames: offsets.length, maxDrift: Math.max(...offsets.map(Math.abs)) };
        },
      },
    });
  }, before);
  for (let i = 0; i < 5; i++) {
    current!.send(JSON.stringify({ type: "ping" }));
    recent[199] = line(1199, "\n\n" + "Streamed text. ".repeat((i + 1) * 50));
    current!.send(
      JSON.stringify({
        topic: "session.perf-0",
        seq: ++seq,
        source: "mandri",
        ts: seq,
        raw: { type: "history_changed" },
      }),
    );
    await refreshed(page, recent[199]!);
    await waitFor(() => pongs === i + 1, `Ping ${i + 1} was not acknowledged`);
    await anchor(page, before.text);
  }
  const reading = await page.evaluate(() =>
    (
      window as unknown as {
        readingProbe: { finish: () => { frames: number; maxDrift: number } };
      }
    ).readingProbe.finish(),
  );
  assert.ok(reading.frames > 0, "No rendered frames were observed during history refresh");
  const maxReadingDrift = reading.maxDrift;
  assert.ok(maxReadingDrift < 2, `Reading position moved ${maxReadingDrift}px during refresh/ping`);
  assert.equal(pongs, 5);

  await viewport.evaluate((el) => {
    el.scrollTop = 100;
  });
  await page.locator(".transcript-status-top").waitFor();
  assert.equal(cursors.at(-1), "older-2", "Refresh must preserve the pagination cursor");
  const secondBefore = await anchor(page);
  pending.shift()!();
  await page.locator(".transcript-status-top").waitFor({ state: "hidden" });
  const secondAfter = await anchor(page, secondBefore.text);
  assert.ok(
    Math.abs(secondBefore.offset - secondAfter.offset) < 2,
    JSON.stringify({ secondBefore, secondAfter }),
  );

  // Jump, then grow the last message while pinned to the bottom.
  await page.locator(".transcript-jump").click();
  await atEnd(page);
  recent[199] = line(1199, "\n\n" + "More streamed text. ".repeat(500));
  current!.send(
    JSON.stringify({
      topic: "session.perf-0",
      seq: ++seq,
      source: "mandri",
      ts: seq,
      raw: { type: "history_changed" },
    }),
  );
  await refreshed(page, recent[199]!);
  await atEnd(page);
  // A small deliberate movement must detach immediately, even inside the old
  // 80px threshold. Growth after that must preserve the reading position.
  await viewport.hover();
  await page.mouse.wheel(0, -30);
  const pausedTop = (await anchor(page)).scrollTop;
  recent[199] = line(1199, "\n\n" + "More streamed text. ".repeat(650));
  current!.send(
    JSON.stringify({
      topic: "session.perf-0",
      seq: ++seq,
      source: "mandri",
      ts: seq,
      raw: { type: "history_changed" },
    }),
  );
  await refreshed(page, recent[199]!);
  await anchor(page);
  assert.ok(
    Math.abs((await viewport.evaluate((el) => el.scrollTop)) - pausedTop) < 2,
    "Small upward scroll was overridden by streaming",
  );
  await page.mouse.wheel(0, 10000);
  await atEnd(page);
  assert.equal(await page.locator(".transcript-jump").count(), 0);
  current!.send(
    JSON.stringify({
      topic: "session.perf-0",
      seq: ++seq,
      source: "claude",
      ts: seq,
      raw: {
        type: "assistant",
        message: {
          content: [
            {
              type: "tool_use",
              id: "expand-at-end",
              name: "Inspect",
              input: { output: Array.from({ length: 30 }, (_, i) => `Detail ${i}`) },
            },
          ],
        },
      },
    }),
  );
  const group = page.locator(".tr-activity-group > button").last();
  await group.waitFor();
  await atEnd(page);
  const groupTop = await group.evaluate((el) => el.getBoundingClientRect().top);
  await group.click();
  const tool = page.locator(".tr-tool").last();
  await tool.waitFor();
  assert.ok(
    Math.abs((await group.evaluate((el) => el.getBoundingClientRect().top)) - groupTop) < 2,
  );
  const toolTop = await tool.evaluate((el) => el.getBoundingClientRect().top);
  await tool.locator("button").click();
  await anchor(page);
  const expandedToolTop = await tool.evaluate((el) => el.getBoundingClientRect().top);
  assert.ok(
    Math.abs(expandedToolTop - toolTop) < 2,
    `Opening the tool moved its heading by ${expandedToolTop - toolTop}px`,
  );
  // Fast upward wheel gestures must stay under user control.
  await viewport.hover();
  for (let i = 0; i < 8; i++) {
    await page.mouse.wheel(0, -650);
    await page.waitForTimeout(30);
  }
  await page.locator(".transcript-jump").waitFor();
  assert.ok(await page.locator(".transcript-jump").isVisible());
  const resting = await anchor(page);
  const settled = await anchor(page, resting.text);
  assert.ok(Math.abs(resting.offset - settled.offset) < 2);

  await page.evaluate(() => {
    location.hash = "/session/perf-1";
  });
  await page.getByText("Message 9000", { exact: true }).waitFor();
  await atEnd(page);
  assert.equal(await page.locator(".composer-input").inputValue(), "");
  await page.evaluate(() => {
    location.hash = "/session/perf-0";
  });
  await page.getByText("Message 1199", { exact: true }).waitFor();
  await atEnd(page);
  assert.equal(await page.locator(".composer-input").inputValue(), phrase);
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      typing,
      paginationDrift: after.offset - before.offset,
      secondPageDrift: secondAfter.offset - secondBefore.offset,
      maxReadingDrift,
      readingFrames: reading.frames,
      pongs,
      cursors,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
