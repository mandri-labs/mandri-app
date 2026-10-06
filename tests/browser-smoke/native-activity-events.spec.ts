import assert from "node:assert/strict";
import { chromium, type WebSocketRoute } from "playwright";
import { createServer } from "vite";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ locale: "fr-FR", viewport: { width: 1440, height: 1000 } });
  // Proxy local assets through Playwright to avoid host network-change notifications
  // cancelling Chromium module loads while other workspaces start containers.
  await page.route(`http://127.0.0.1:${address.port}/**`, async (route) => {
    await route.fulfill({ response: await route.fetch() });
  });
  const errors: string[] = [];
  page.on("pageerror", (error) => errors.push(error.message));
  let socket: WebSocketRoute | undefined;
  let seq = 0;
  let active = true;
  let historyRequests = 0;
  const session = {
    id: "native-actions",
    harness: "codex",
    state: "live",
    title: "Vérifier la configuration",
    project_path: "/workspace",
    native_id: "native-actions",
    model: "test/model",
    activity: "active",
  };
  const entries = [
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "user",
        id: "user",
        content: [
          { type: "input_text", text: "Vérifie la configuration, puis ajuste le fichier." },
        ],
      },
    }),
  ];
  await page.route("**/v1/**", (route) => {
    const path = new URL(route.request().url()).pathname;
    return route.fulfill({
      json: path.endsWith("/availability")
        ? {
            owner: "mandri",
            activity: active ? "active" : "idle",
            can_resume: false,
            can_release: false,
            can_restore: false,
            reason: null,
          }
        : path === "/v1/sessions"
          ? [session]
          : path === `/v1/sessions/${session.id}`
            ? session
            : [],
    });
  });
  await page.routeWebSocket("**/v1/ws", (current) => {
    socket = current;
    current.onMessage((data) => {
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
        current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
        return;
      }
      const reply = (result: unknown) =>
        current.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.action === "agent.list")
        reply({ agents: [], parent_capabilities: {}, classified_session_ids: [session.id] });
      else if (frame.action === "session.list") reply({ sessions: [session] });
      else if (frame.action === "session.history") {
        historyRequests++;
        reply({ entries, next_cursor: null, has_more: false, turn_active: active });
      } else if (frame.op === "subscribe") {
        current.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all")
          current.send(
            JSON.stringify({
              type: "snapshot",
              topic: "sessions.all",
              sessions: [session],
              runtimes: [],
            }),
          );
      } else if (frame.action) throw new Error(`Unexpected action: ${frame.action}`);
    });
  });
  const send = (
    raw: {
      method?: string;
      params?: { item?: Record<string, unknown>; [key: string]: unknown };
      type?: string;
    },
    persist = true,
    source = "codex",
  ) => {
    const native = raw.params?.item;
    if (persist && native?.type === "commandExecution")
      entries.push(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: raw.method === "item/started" ? "exec_command_begin" : "exec_command_end",
            call_id: native.id,
            command: native.command,
            parsed_cmd: native.commandActions,
            exit_code: native.exitCode,
            aggregated_output: native.aggregatedOutput,
          },
        }),
      );
    else if (persist && native?.type === "fileChange")
      entries.push(
        JSON.stringify({
          type: "event_msg",
          payload: {
            type: "item_completed",
            item: {
              ...native,
              type: "FileChange",
              changes: Object.fromEntries(
                (native.changes as { path: string; diff: string }[]).map((change) => [
                  change.path,
                  { type: "update", unified_diff: change.diff },
                ]),
              ),
            },
          },
        }),
      );
    else if (persist && native?.type === "agentMessage")
      entries.push(
        JSON.stringify({
          type: "response_item",
          payload: {
            type: "message",
            role: "assistant",
            id: native.id,
            content: [{ type: "output_text", text: native.text }],
          },
        }),
      );
    socket!.send(
      JSON.stringify({ topic: `session.${session.id}`, source, seq: ++seq, ts: Date.now(), raw }),
    );
  };
  const item = (phase: string, value: Record<string, unknown>) =>
    send({ method: `item/${phase}`, params: { turnId: "turn", item: value } });
  const read = (id: string) => ({
    type: "commandExecution",
    id,
    command: "cat config.json",
    commandActions: [{ type: "read", path: "config.json", name: "config.json" }],
  });
  const group = (index: number) => page.locator(".tr-activity-group").nth(index);
  const title = (index: number) => group(index).locator(":scope > button .tr-activity-title");
  const waitTitle = async (index: number, text: string) => {
    await page.waitForFunction(
      ({ index, text }) =>
        document.querySelectorAll(".tr-activity-title")[index]?.textContent?.includes(text),
      { index, text },
    );
  };
  const refresh = async () => {
    const before = historyRequests;
    send({ type: "history_changed" }, false, "mandri");
    for (let attempt = 0; historyRequests === before && attempt < 50; attempt++)
      await page.waitForTimeout(20);
    assert(historyRequests > before);
    await page.waitForTimeout(100);
  };
  await page.goto(`http://127.0.0.1:${address.port}/#/session/${session.id}`);
  await page
    .getByText("Vérifie la configuration, puis ajuste le fichier.", { exact: true })
    .waitFor();
  item("started", read("before"));
  await waitTitle(0, "config.json");
  assert.equal(await group(0).locator(":scope > button .lucide-book-open").count(), 1);
  assert.equal(
    await title(0).evaluate((element) => getComputedStyle(element).animationName),
    "transcript-shimmer",
  );
  send(
    {
      method: "item/completed",
      params: {
        item: {
          type: "agentMessage",
          id: "message",
          text: "La configuration est lisible. Je vérifie la suite.",
        },
      },
    },
    false,
  );
  item("started", read("after"));
  await waitTitle(1, "config.json");
  await refresh();
  const boundary = await page
    .locator(".tr-activity-group, .tr-assistant")
    .evaluateAll((elements) => elements.map((element) => element.textContent));
  assert(boundary.some((text) => text?.includes("La configuration est lisible")));
  assert.equal(await page.locator(".tr-activity-group").count(), 2);
  const boxes = await Promise.all([
    group(0).boundingBox(),
    page
      .getByText("La configuration est lisible. Je vérifie la suite.", { exact: true })
      .boundingBox(),
    group(1).boundingBox(),
  ]);
  assert(boxes[0] && boxes[1] && boxes[2] && boxes[0].y < boxes[1].y && boxes[1].y < boxes[2].y);
  item("completed", { ...read("before"), exitCode: 0, aggregatedOutput: "{}" });
  await waitTitle(0, "lus");
  assert.equal(
    await title(0).evaluate((element) => getComputedStyle(element).animationName),
    "none",
  );
  item("completed", { ...read("after"), exitCode: 0, aggregatedOutput: "{}" });
  await waitTitle(1, "Réflexion");
  assert.equal(await group(1).locator(":scope > button svg:not(.lucide-chevron-down)").count(), 0);
  const command = {
    type: "commandExecution",
    id: "test",
    command: "npm test",
    commandActions: [{ type: "unknown", command: "npm test" }],
  };
  item("started", command);
  await waitTitle(1, "npm test");
  assert.equal(await group(1).locator(":scope > button .lucide-terminal").count(), 1);
  await page.screenshot({ path: "../mandri-work-documents/native-activity-active.png" });
  item("completed", { ...command, exitCode: 0 });
  for (const [id, patch] of [
    ["edit-one", "@@ -1 +1 @@\n-original\n+temporary"],
    ["edit-two", "@@ -1 +1 @@\n-temporary\n+final"],
  ]) {
    item("completed", {
      type: "fileChange",
      id,
      status: "completed",
      changes: [{ path: "config.json", kind: { type: "update" }, diff: patch }],
    });
  }
  item("completed", {
    type: "agentMessage",
    id: "final",
    text: "La configuration est mise à jour et vérifiée.",
  });
  active = false;
  session.activity = "idle";
  send({ method: "turn/completed", params: { turn: { id: "turn", status: "completed" } } });
  await waitTitle(1, "modifiés");
  assert((await title(1).textContent())?.includes("lus"));
  assert((await title(1).textContent())?.includes("commandes"));
  const files = page.locator(".tr-changed-files");
  await files.locator(":scope > button").click();
  assert.equal(await files.locator(".tr-diff").count(), 1);
  assert.equal(await files.locator(".tr-diff-add").textContent(), "+1");
  assert.equal(await files.locator(".tr-diff-del").textContent(), "−1");
  assert.equal(await files.locator(".tr-shimmer").count(), 0);
  await files.locator(".tr-diff > button").click();
  assert((await files.textContent())?.includes("original"));
  assert((await files.textContent())?.includes("final"));
  assert(!(await files.textContent())?.includes("temporary"));
  await group(1).locator(":scope > button").click();
  assert.equal(await group(1).locator(".tr-tool, .tr-diff").count(), 4);
  await page.screenshot({ path: "../mandri-work-documents/native-activity-completed.png" });
  await page.setViewportSize({ width: 420, height: 900 });
  await page.screenshot({ path: "../mandri-work-documents/native-activity-mobile.png" });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), false);
  await page.setViewportSize({ width: 1440, height: 1000 });
  entries.splice(
    2,
    0,
    JSON.stringify({
      type: "response_item",
      payload: {
        type: "message",
        role: "assistant",
        content: [
          { type: "output_text", text: "La configuration est lisible. Je vérifie la suite." },
        ],
      },
    }),
  );
  await page.reload();
  await files.waitFor();
  assert.equal(await page.locator(".tr-activity-group").count(), 2);
  await waitTitle(1, "modifiés");
  assert.equal(await page.locator(".tr-activity-title.tr-shimmer").count(), 0);
  const providers = [
    {
      harness: "claude",
      user: {
        type: "user",
        message: { role: "user", content: [{ type: "text", text: "Inspect configuration" }] },
      },
      started: {
        type: "assistant",
        message: {
          id: "claude-message",
          content: [
            {
              type: "tool_use",
              id: "claude-call",
              name: "Bash",
              input: { command: "npm test", description: "Vérifier la configuration" },
            },
          ],
        },
      },
      completed: {
        type: "user",
        message: {
          content: [{ type: "tool_result", tool_use_id: "claude-call", content: "passed" }],
        },
      },
      title: "Vérifier la configuration",
      icon: "terminal",
      summary: "Commandes exécutées",
    },
    {
      harness: "opencode",
      user: {
        type: "message.part.updated",
        properties: { part: { type: "text", id: "prompt", text: "Inspect configuration" } },
      },
      started: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: "oc-part",
            callID: "oc-call",
            tool: "read",
            state: { status: "running", input: { filePath: "config.json" } },
          },
        },
      },
      completed: {
        type: "message.part.updated",
        properties: {
          part: {
            type: "tool",
            id: "oc-part",
            callID: "oc-call",
            tool: "read",
            state: { status: "completed", input: { filePath: "config.json" }, output: "{}" },
          },
        },
      },
      title: "Lecture de config.json",
      icon: "book-open",
      summary: "Fichiers lus",
    },
    {
      harness: "agy",
      user: {
        event: "step_update",
        step_update: {
          step_type: "user_input",
          step_index: 0,
          state: "DONE",
          text: "Inspect configuration",
        },
      },
      started: {
        event: "step_update",
        step_update: {
          step_type: "tool",
          step_index: 1,
          state: "ACTIVE",
          tool_info: {
            name: "view_file",
            parameters: { AbsolutePath: "config.json", toolSummary: "Inspecter la configuration" },
          },
        },
      },
      completed: {
        event: "step_update",
        step_update: {
          step_type: "tool",
          step_index: 1,
          state: "DONE",
          duration_seconds: 2.5,
          tool_info: {
            name: "view_file",
            parameters: { AbsolutePath: "config.json", toolSummary: "Inspecter la configuration" },
            output: "{}",
          },
        },
      },
      title: "Inspecter la configuration",
      icon: "book-open",
      summary: "Fichiers lus",
    },
  ];
  for (const provider of providers) {
    console.log(`Checking ${provider.harness}`);
    session.harness = provider.harness;
    session.id = `${provider.harness}-native-actions`;
    session.native_id = session.id;
    active = true;
    session.activity = "active";
    entries.splice(0, entries.length, JSON.stringify(provider.user));
    await page.goto(
      `http://127.0.0.1:${address.port}/?scenario=${provider.harness}#/session/${session.id}`,
    );
    await page.getByText("Inspect configuration", { exact: true }).waitFor();
    const publish = (raw: object) => {
      entries.push(JSON.stringify(raw));
      socket!.send(
        JSON.stringify({
          topic: `session.${session.id}`,
          source: provider.harness,
          seq: ++seq,
          ts: Date.now(),
          raw,
        }),
      );
    };
    publish(provider.started);
    await waitTitle(0, provider.title);
    assert.equal(await group(0).locator(`:scope > button .lucide-${provider.icon}`).count(), 1);
    assert.equal(
      await title(0).evaluate((element) => getComputedStyle(element).animationName),
      "transcript-shimmer",
    );
    publish(provider.completed);
    await waitTitle(0, "Réflexion");
    active = false;
    session.activity = "idle";
    await refresh();
    await waitTitle(0, provider.summary);
    await group(0).locator(":scope > button").click();
    assert.equal(await group(0).locator(".tr-tool").count(), 1);
    await page.screenshot({
      path: `../mandri-work-documents/native-activity-${provider.harness}.png`,
    });
    await page.reload();
    await waitTitle(0, provider.summary);
    assert.equal(await page.locator(".tr-activity-title.tr-shimmer").count(), 0);
  }
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify({
      chronology: "A, message, B",
      nativeRead: true,
      netFileDiff: "+1 −1",
      harnesses: ["codex", ...providers.map((provider) => provider.harness)],
      reload: true,
      errors,
    }),
  );
} finally {
  await browser.close();
  await server.close();
}
