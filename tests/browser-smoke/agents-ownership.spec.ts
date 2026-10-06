import assert from "node:assert/strict";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { chromium } from "playwright";
import type { WebSocketRoute } from "playwright";
import { createServer } from "vite";
import type { AgentView } from "../../src/daemon/types/agents.ts";

const server = await createServer({
  server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
});
await server.listen();
const address = server.httpServer?.address();
assert(address && typeof address === "object");
const browser = await chromium.launch({ headless: true });
const output = resolve(
  process.env.MANDRI_UI_ARTIFACTS ?? "../artifacts/runs/remediation-2026-09-11/frontend/browser",
);
await mkdir(output, { recursive: true });
try {
  const page = await browser.newPage({ viewport: { width: 1024, height: 720 } });
  const errors: string[] = [];
  const commands: { action: string; params: Record<string, unknown> }[] = [];
  let current: WebSocketRoute | undefined;
  let releases = 0;
  let restores = 0;
  let owner = "mandri";
  let replyText = "Research notes from the child";
  let userMessage: string | undefined;
  const roots = Array.from({ length: 6 }, (_, index) => ({
    id: `root-${index}`,
    title: `Root ${index}`,
    harness: index === 1 ? "codex" : "opencode",
    state: index === 0 ? "live" : "discovered",
    native_id: `native-${index}`,
    model: index === 1 ? "native:codex/gpt-test" : "test/model",
    project_path: "/mock-project",
    last_activity_at: 100 - index,
  }));
  const child: AgentView = {
    id: "child",
    parent_session_id: "root-0",
    parent_agent_id: null,
    session_id: "linked-child",
    native_id: "native-child",
    harness: "opencode",
    title: "Research child",
    state: "running",
    delegation_id: "delegation",
    capabilities: { message: true, stop: true },
    created_at: 1,
    updated_at: 1,
  };
  const nested: AgentView = {
    ...child,
    id: "nested",
    parent_agent_id: child.id,
    session_id: null,
    harness: "claude",
    native_id: "claude-child",
    title: "Nested reviewer",
    capabilities: { message: false, stop: false },
  };
  const agents = [child, nested];
  const sessions = [
    { ...roots[0], id: "linked-child", title: "Native duplicate child", last_activity_at: 200 },
    ...roots,
  ];
  const availability = (id: string) => ({
    owner: id === "root-0" ? owner : "unowned",
    activity: "idle",
    can_resume: id !== "root-0" || owner === "unowned",
    can_release: id === "root-0" && owner === "mandri",
    can_restore: id === "root-1",
    reason: null,
  });
  const history = (id: string) =>
    id === "nested"
      ? [
          JSON.stringify({
            type: "assistant",
            uuid: "a",
            message: {
              role: "assistant",
              content: [{ type: "text", text: "Read-only Claude review" }],
            },
          }),
        ]
      : [
          JSON.stringify({
            type: "message.updated",
            properties: { info: { id: "message", role: "assistant" } },
          }),
          JSON.stringify({
            type: "message.part.updated",
            properties: {
              part: {
                id: "part",
                messageID: "message",
                type: "text",
                text: userMessage ? "Research notes from the child" : replyText,
              },
            },
          }),
          ...(userMessage
            ? [
                JSON.stringify({
                  type: "message.updated",
                  properties: { info: { id: "user-message", role: "user" } },
                }),
                JSON.stringify({
                  type: "message.part.updated",
                  properties: {
                    part: {
                      id: "user-part",
                      messageID: "user-message",
                      type: "text",
                      text: userMessage,
                    },
                  },
                }),
                JSON.stringify({
                  type: "message.updated",
                  properties: { info: { id: "reply-message", role: "assistant" } },
                }),
                JSON.stringify({
                  type: "message.part.updated",
                  properties: {
                    part: {
                      id: "reply-part",
                      messageID: "reply-message",
                      type: "text",
                      text: replyText,
                    },
                  },
                }),
              ]
            : []),
        ];
  page.on("pageerror", (error) => errors.push(error.message));
  await page.addInitScript(() => {
    if (location.protocol === "about:") return;
    localStorage.setItem(
      "mandri.preferences",
      JSON.stringify({ state: { language: "en" }, version: 0 }),
    );
  });
  await page.route("**/v1/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const id = path.split("/")[3] ?? "";
    if (path.endsWith("/availability")) return route.fulfill({ json: availability(id) });
    if (path.endsWith("/release")) {
      assert.equal(route.request().method(), "POST");
      assert.deepEqual(route.request().postDataJSON(), { confirmed: true });
      releases += 1;
      owner = "unowned";
      roots[0]!.state = "stopped";
      return route.fulfill({ json: availability(id) });
    }
    if (path.endsWith("/restore-native-model")) {
      assert.equal(route.request().method(), "POST");
      assert.equal(route.request().postData(), null);
      restores += 1;
      return route.fulfill({ json: availability(id) });
    }
    return route.fulfill({
      json:
        path === "/v1/sessions"
          ? sessions
          : path === `/v1/sessions/${id}`
            ? sessions.find((session) => session.id === id)
            : [],
    });
  });
  await page.routeWebSocket("**/v1/ws", (socket) => {
    current = socket;
    socket.onMessage((data) => {
      const frame = JSON.parse(String(data));
      const reply = (result: unknown) =>
        socket.send(JSON.stringify({ type: "response", op_id: frame.op_id, ok: true, result }));
      if (frame.op === "subscribe") {
        socket.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.topic === "sessions.all")
          socket.send(
            JSON.stringify({ type: "snapshot", topic: "sessions.all", sessions, runtimes: [] }),
          );
      }
      if (!frame.action) return;
      if (frame.action === "command.catalogs")
        return reply({ default_cwd: "/mock-project", catalogs: [] });
      if (frame.action === "command.catalog")
        return reply({
          ...frame.params,
          cwd: frame.params.cwd ?? "/mock-project",
          profile_id: frame.params.profile_id ?? null,
          execution_backend: frame.params.execution_backend ?? "host",
          privacy_mode: frame.params.privacy_mode ?? "none",
          state: "ready",
          commands: [],
          reason: null,
        });
      if (frame.action === "command.list") return reply({ invocations: [] });
      if (frame.action === "session.list") return reply({ sessions });
      if (frame.action === "session.history")
        return reply({ entries: [], next_cursor: null, has_more: false });
      if (frame.action === "agent.list")
        return reply({
          agents,
          parent_capabilities: { "root-0": { create: true } },
          classified_session_ids: sessions.map((session) => session.id),
        });
      if (frame.action === "agent.history")
        return reply({
          entries: history(frame.params.agent_id),
          next_cursor: null,
          has_more: false,
        });
      commands.push({ action: frame.action, params: frame.params });
      if (frame.action === "agent.message") {
        userMessage = frame.params.content;
        replyText = "Child updated after message";
        return reply({ agent_id: frame.params.agent_id, accepted: true });
      }
      if (frame.action === "agent.stop") {
        child.state = "stopped";
        child.capabilities.stop = false;
        return reply({ agent_id: child.id, stopped: true });
      }
      if (frame.action === "agent.create") {
        const created = {
          ...child,
          id: "created",
          session_id: null,
          native_id: "created-native",
          title: frame.params.title,
          state: "running" as const,
        };
        agents.push(created);
        return reply({ agent: created });
      }
      if (frame.action === "approval.answer")
        return reply({ approval_id: frame.params.approval_id, status: "answered" });
      throw new Error(`Unexpected command ${frame.action}`);
    });
  });
  await page.goto(`http://127.0.0.1:${address.port}/#/session/root-0`);
  await page.getByRole("button", { name: "Research child — Running", exact: true }).waitFor();
  assert.equal(
    await page
      .locator(".shell-session-container > .shell-session-row:not(.shell-agent-row)")
      .count(),
    5,
  );
  assert.equal(await page.getByText("Native duplicate child", { exact: true }).count(), 0);
  assert.equal(await page.locator(".shell-agent-row").count(), 2);
  await page.getByRole("button", { name: "Sub-agents (2)", exact: true }).click();
  assert.equal(await page.locator(".shell-agent-row").count(), 0);
  await page.getByRole("button", { name: "Sub-agents (2)", exact: true }).click();
  await page.getByRole("button", { name: "Research child — Running", exact: true }).click();
  await page.getByText(replyText, { exact: true }).waitFor();
  assert.match(page.url(), /#\/agent\/child$/);
  assert.equal(
    await page.evaluate(async () => {
      const modulePath = "/src/stores/sessions.ts";
      const { sessionsStore } = await import(/* @vite-ignore */ modulePath);
      return Boolean(sessionsStore.getState().sessions["agent:child"]);
    }),
    false,
  );
  await page.getByRole("button", { name: "Split view", exact: true }).click();
  await page.getByRole("dialog", { name: "Add panel", exact: true }).waitFor();
  await page.getByRole("dialog").getByRole("option", { name: "Root 0", exact: true }).click();
  assert.equal(await page.locator(".pane").count(), 2);
  assert.equal(await page.getByText(replyText, { exact: true }).count(), 1);
  await page.setViewportSize({ width: 1440, height: 900 });
  const divider = page.getByRole("separator");
  await divider.focus();
  await divider.press("ArrowRight");
  assert.equal(await divider.getAttribute("aria-valuenow"), "55");
  await page.getByRole("textbox", { name: "Message to sub-agent" }).click();
  const workspaceUrl = page.url();
  const workspaceParams = new URLSearchParams(new URL(workspaceUrl).hash.split("?")[1]);
  assert.deepEqual(workspaceParams.getAll("pane"), ["agent:child", "session:root-0"]);
  assert.equal(workspaceParams.get("split"), "55");
  await page.reload();
  await page.getByText(replyText, { exact: true }).waitFor();
  assert.equal(await page.locator(".pane").count(), 2);
  assert.equal(await divider.getAttribute("aria-valuenow"), "55");
  assert.equal(await page.locator(".pane--focused").getAttribute("aria-label"), child.title);
  assert.equal(page.url(), workspaceUrl);
  await page.getByRole("button", { name: "Root 1", exact: true }).click();
  await page.locator('.pane[aria-label="Root 1"]').waitFor();
  assert.equal(await page.locator('.pane[aria-label="Root 0"]').count(), 1);
  await page.goBack();
  await page.locator('.pane[aria-label="Research child"]').waitFor();
  assert.equal(page.url(), workspaceUrl);
  await page.goForward();
  await page.locator('.pane[aria-label="Root 1"]').waitFor();
  await page.goBack();
  await page.locator('.pane[aria-label="Research child"]').waitFor();
  await page.getByRole("button", { name: "Close Root 0 panel", exact: true }).click();
  await page.getByRole("button", { name: "Single view", exact: true }).click();
  await page.waitForURL(/#\/agent\/child$/);
  await page.reload();
  await page.getByText(replyText, { exact: true }).waitFor();
  assert.equal(await page.locator(".pane").count(), 0);
  // Open the copied link in a fresh document, with no in-memory workspace.
  await page.goto("about:blank");
  await page.goto(workspaceUrl);
  await page.getByText(replyText, { exact: true }).waitFor();
  assert.equal(await page.locator(".pane").count(), 2);
  assert.equal(await divider.getAttribute("aria-valuenow"), "55");
  assert.equal(await page.locator(".pane--focused").getAttribute("aria-label"), child.title);
  for (const title of ["Root 1", "Root 2"]) {
    await page
      .locator(".pane--focused")
      .getByRole("button", { name: "Add panel", exact: true })
      .click();
    await page.getByRole("option", { name: title, exact: true }).click();
  }
  const rows = page.getByRole("separator", { name: "Resize panel rows" });
  await rows.focus();
  await rows.press("ArrowDown");
  await rows.press("ArrowDown");
  assert.equal(await rows.getAttribute("aria-valuenow"), "60");
  const gridUrl = page.url();
  assert.equal(new URLSearchParams(new URL(gridUrl).hash.split("?")[1]).get("rows"), "60");
  await page.reload();
  await page.locator(".panes--grid").waitFor();
  assert.equal(await page.locator(".pane").count(), 4);
  assert.equal(await rows.getAttribute("aria-valuenow"), "60");
  const rowHeights = await page
    .locator(".pane")
    .evaluateAll((panes) => panes.map((pane) => pane.getBoundingClientRect().height));
  assert.ok(Math.abs(rowHeights[0]! / (rowHeights[0]! + rowHeights[2]!) - 0.6) < 0.005);
  await page.screenshot({ path: resolve(output, "resized-grid.png") });
  await page.goto("about:blank");
  await page.goto(gridUrl);
  await rows.waitFor();
  assert.equal(await rows.getAttribute("aria-valuenow"), "60");
  assert.equal(await page.locator(".pane").count(), 4);
  await page.getByRole("button", { name: "Maximize Root 2 panel", exact: true }).click();
  const zoomUrl = page.url();
  assert.equal(
    new URLSearchParams(new URL(zoomUrl).hash.split("?")[1]).get("zoom"),
    "session:root-2",
  );
  await page.reload();
  await page.getByRole("button", { name: "Restore panel layout", exact: true }).waitFor();
  assert.equal(await page.locator(".pane:not([hidden])").count(), 1);
  assert.equal(await page.locator(".pane[hidden]").count(), 3);
  assert.equal(await page.locator(".shell-header").count(), 0);
  assert.equal(page.url(), zoomUrl);
  await page.getByRole("button", { name: "Restore panel layout", exact: true }).click();
  assert.equal(await page.locator(".pane:not([hidden])").count(), 4);
  assert.equal(await rows.getAttribute("aria-valuenow"), "60");
  assert.equal(
    await page
      .getByRole("separator", { name: "Resize panel columns" })
      .getAttribute("aria-valuenow"),
    "55",
  );
  await page.goto(workspaceUrl);
  await page.getByText(replyText, { exact: true }).waitFor();
  assert.equal(await page.locator(".pane").count(), 2);
  await page.setViewportSize({ width: 1024, height: 720 });
  const input = page.getByRole("textbox", { name: "Message to sub-agent" });
  await input.fill("Investigate the cache");
  await input.press("Enter");
  await page.getByText("Child updated after message", { exact: true }).waitFor();
  assert.deepEqual(commands.at(-1), {
    action: "agent.message",
    params: { agent_id: "child", content: "Investigate the cache" },
  });
  assert(current);
  replyText = "Child history changed outside Mandri";
  current.send(
    JSON.stringify({
      topic: "agent.child",
      seq: 1,
      source: "mandri",
      ts: Date.now(),
      raw: { type: "history_changed" },
    }),
  );
  await page.getByText(replyText, { exact: true }).waitFor();
  await page.screenshot({ path: resolve(output, "agent-transcript-1024.png"), fullPage: true });
  current.send(
    JSON.stringify({
      type: "approval.pending",
      topic: "agent.child",
      source: "opencode",
      seq: 2,
      ts: Date.now(),
      approval_id: "approval-child",
      deadline: Date.now() + 60_000,
      status: "pending",
      raw: {
        type: "permission.asked",
        properties: { permission: "bash", patterns: ["echo approved"] },
      },
    }),
  );
  await page.getByRole("button", { name: "Allow once", exact: true }).waitFor();
  assert.equal(await page.getByRole("button", { name: "Allow once", exact: true }).count(), 1);
  await page.getByRole("button", { name: "Allow once", exact: true }).click();
  assert.deepEqual(commands.at(-1), {
    action: "approval.answer",
    params: { approval_id: "approval-child", decision: "once" },
  });
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await page.getByRole("button", { name: "Research child — Stopped", exact: true }).waitFor();
  assert.deepEqual(commands.at(-1), { action: "agent.stop", params: { agent_id: "child" } });
  await page.getByRole("button", { name: "Nested reviewer — Running", exact: true }).click();
  await page.getByText("Read-only Claude review", { exact: true }).waitFor();
  assert.equal(await page.getByRole("textbox", { name: "Message to sub-agent" }).count(), 0);
  assert.equal(await page.getByRole("button", { name: "Stop", exact: true }).count(), 0);
  await page.locator(".shell-sidebar").getByRole("button", { name: "Root 0", exact: true }).click();
  const rootRow = page
    .locator(".shell-session-container")
    .filter({ has: page.getByRole("button", { name: "Root 0", exact: true }) });
  await rootRow.locator(".lifecycle-trigger").click();
  await page.getByRole("menuitem", { name: "Create sub-agent", exact: true }).click();
  await page.getByLabel("Title (optional)").fill("Created child");
  await page.getByLabel("Instruction", { exact: true }).fill("Review the cache");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Create sub-agent", exact: true })
    .click();
  await page.waitForURL(/#\/agent\/created(?:\?|$)/);
  assert.deepEqual(commands.at(-1), {
    action: "agent.create",
    params: { session_id: "root-0", content: "Review the cache", title: "Created child" },
  });
  await page.locator(".shell-sidebar").getByRole("button", { name: "Root 0", exact: true }).click();
  await rootRow.locator(".lifecycle-trigger").click();
  await page.getByRole("menuitem", { name: "Release session", exact: true }).click();
  assert.equal(releases, 0);
  await page.getByRole("dialog").getByRole("button", { name: "Confirm", exact: true }).click();
  await page.getByRole("dialog").waitFor({ state: "hidden" });
  assert.equal(releases, 1);
  const nativeRow = page
    .locator(".shell-session-container")
    .filter({ has: page.getByRole("button", { name: "Root 1", exact: true }) });
  await nativeRow.locator(".lifecycle-trigger").click();
  await page.getByRole("menuitem", { name: "Restore native model", exact: true }).click();
  await page.getByRole("menu").waitFor({ state: "hidden" });
  assert.equal(restores, 1);
  assert(commands.every((command) => command.action !== "session.prompt"));
  await page.screenshot({ path: resolve(output, "agents-ownership-1024.png"), fullPage: true });
  assert.deepEqual(errors, []);
  console.log(
    "PASS: workspace URL refresh, copied link, focus/column and row ratios, resized grid restoration, back/forward, explicit single view; nested child sidebar/root count, native transcripts, supported create/message/stop, scoped approval, confirmed release, separate prompt-free native restore",
  );
} finally {
  await browser.close();
  await server.close();
}
