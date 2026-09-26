import assert from "node:assert/strict";
import { chromium } from "playwright";
import type { WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage();
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  const session = {
    id: "session-test",
    harness: "claude",
    state: "live",
    title: "Lifecycle regression",
    project_path: "/workspace",
    native_id: "native-test",
    model: "test/model",
    activity: "idle",
    last_activity_at: 1,
  };
  const raw = (id: string, text: string) => ({
    type: "user",
    uuid: id,
    message: { role: "user", content: [{ type: "text", text }] },
  });
  const events = [
    {
      topic: `session.${session.id}`,
      seq: 1,
      source: "claude",
      ts: 1,
      raw: raw("first", "First event delivered"),
    },
  ];
  let current: WebSocketRoute | undefined;
  const cursors: unknown[] = [];
  const protocolErrors: string[] = [];
  let connectionCount = 0;
  let subscribed!: () => void;
  const firstSubscription = new Promise<void>((resolve) => {
    subscribed = resolve;
  });

  await page.addInitScript(() => {
    localStorage.setItem(
      "mandri.preferences",
      JSON.stringify({ state: { language: "en" }, version: 0 }),
    );
  });
  await page.route("**/v1/**", async (route) => {
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
    let body: unknown = [];
    if (path === "/v1/sessions") body = [session];
    else if (path.endsWith("/history")) {
      await firstSubscription;
      body = {
        entries: events.map((event) => JSON.stringify(event.raw)),
        next_cursor: null,
        has_more: false,
      };
    } else if (path === `/v1/sessions/${session.id}`) body = session;
    await route.fulfill({ json: body });
  });
  await page.routeWebSocket("**/v1/ws", (socket) => {
    current = socket;
    connectionCount += 1;
    const topics = new Set<string>();
    socket.onMessage((data) => {
      const frame = JSON.parse(String(data));
      if (frame.action === "agent.list") {
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { agents: [], parent_capabilities: {}, classified_session_ids: [session.id] },
          }),
        );
        return;
      }
      if (frame.action === "session.list") {
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: { sessions: [session] },
          }),
        );
        return;
      }
      if (frame.action === "session.history") {
        socket.send(
          JSON.stringify({
            type: "response",
            op_id: frame.op_id,
            ok: true,
            result: {
              entries: events.map((event) => JSON.stringify(event.raw)),
              next_cursor: null,
              has_more: false,
            },
          }),
        );
        return;
      }
      if (frame.op === "subscribe") {
        if (topics.has(frame.topic)) protocolErrors.push(`duplicate subscription: ${frame.topic}`);
        topics.add(frame.topic);
        const sessionTopic = frame.topic === `session.${session.id}`;
        const replay =
          sessionTopic && frame.since !== undefined
            ? events.filter((event) => event.seq > frame.since)
            : [];
        socket.send(
          JSON.stringify({
            op: "subscribed",
            topic: frame.topic,
            from_seq:
              replay[0]?.seq ??
              (connectionCount === 1 ? 1 : (sessionTopic ? events.length : 0) + 1),
          }),
        );
        if (frame.topic === "sessions.all")
          socket.send(
            JSON.stringify({
              type: "snapshot",
              topic: "sessions.all",
              sessions: [session],
              runtimes: [],
            }),
          );
        if (sessionTopic) {
          cursors.push(frame.since);
          if (connectionCount === 1 && frame.since === undefined) {
            socket.send(JSON.stringify(events[0]));
          }
          for (const event of replay) socket.send(JSON.stringify(event));
          subscribed();
        }
      } else if (frame.op === "unsubscribe") {
        if (!topics.delete(frame.topic))
          protocolErrors.push(`duplicate unsubscribe: ${frame.topic}`);
        socket.send(JSON.stringify({ op: "unsubscribed", topic: frame.topic }));
      }
    });
  });

  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page.getByRole("textbox").waitFor();
  await page.getByText("First event delivered", { exact: true }).waitFor();
  assert.equal(await page.getByText("First event delivered", { exact: true }).count(), 1);

  events.push({
    topic: `session.${session.id}`,
    seq: 2,
    source: "claude",
    ts: 2,
    raw: raw("offline", "Recovered after reconnect"),
  });
  assert(current);
  current.close({ code: 1012, reason: "test reconnect" });
  await page.getByText("Recovered after reconnect", { exact: true }).waitFor();
  assert(cursors.includes(1), `Expected last received cursor 1, got ${JSON.stringify(cursors)}`);

  session.state = "stopped";
  current.send(
    JSON.stringify({
      topic: "sessions.all",
      seq: 1,
      source: "mandri",
      ts: 3,
      raw: { type: "session_stopped", session_id: session.id, cause: "viewer_stop" },
    }),
  );
  await page.waitForFunction(
    async (id) =>
      (await import(String("/src/stores/sessions.ts"))).sessionsStore.getState().sessions[id]
        ?.state === "stopped",
    session.id,
  );
  assert.equal(await page.locator(".composer-input").count(), 1);
  assert.deepEqual(protocolErrors, []);
  assert.deepEqual(errors, []);
  console.log(
    "PASS: direct session link, history overlap, reconnect replay, lifecycle outside dashboard",
  );
} finally {
  await browser.close();
  await server.close();
}
