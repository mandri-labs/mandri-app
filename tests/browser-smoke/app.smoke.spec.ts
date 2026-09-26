import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { chromium } from "playwright";
import type { Browser, ConsoleMessage, Page } from "playwright";

const BASE_URL = "http://127.0.0.1:1420";
const ROUTES = ["#/", "#/settings", "#/providers", "#/routes"];
const FIRST_DWELL_MS = 10_000;
const ROUTE_DWELL_MS = 5_000;
const SERVER_TIMEOUT_MS = 60_000;
const SERVER_POLL_MS = 500;

const FORBIDDEN_PATTERNS: readonly RegExp[] = [
  /Maximum update depth/i,
  /getSnapshot should be cached/i,
  /error occurred in/i,
];

const TOLERATED_PATTERNS: readonly RegExp[] = [
  /net::ERR_/i,
  /Failed to load resource/i,
  /Access-Control-Allow-Origin/i,
  /CORS/i,
  /cross-origin/i,
  /WebSocket connection/i,
];

interface Finding {
  route: string;
  kind: "pageerror" | "console";
  text: string;
}

function isForbidden(text: string): boolean {
  return FORBIDDEN_PATTERNS.some((pattern) => pattern.test(text));
}

function isTolerated(text: string): boolean {
  return TOLERATED_PATTERNS.some((pattern) => pattern.test(text));
}

async function isServerUp(): Promise<boolean> {
  try {
    const response = await fetch(BASE_URL, { signal: AbortSignal.timeout(2_000) });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(deadline: number): Promise<void> {
  while (Date.now() < deadline) {
    if (await isServerUp()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, SERVER_POLL_MS));
  }
  throw new Error(`dev server did not become ready at ${BASE_URL}`);
}

function startDevServer(): ChildProcess {
  const child = spawn(
    process.execPath,
    ["node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "1420", "--strictPort"],
    {
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true,
    },
  );
  child.stdout?.on("data", () => undefined);
  child.stderr?.on("data", (chunk: Buffer) => {
    process.stderr.write(`[vite] ${chunk.toString()}`);
  });
  return child;
}

function stopDevServer(child: ChildProcess | null): void {
  if (child === null || child.exitCode !== null) {
    return;
  }
  child.kill();
}

async function collectForRoute(page: Page, route: string, dwellMs: number): Promise<Finding[]> {
  const findings: Finding[] = [];
  const onConsole = (message: ConsoleMessage): void => {
    if (message.type() !== "error") {
      return;
    }
    const text = message.text();
    if (isTolerated(text)) {
      console.log(`[tolerated] ${route}: ${text}`);
      return;
    }
    findings.push({ route, kind: "console", text });
  };
  const onPageError = (error: Error): void => {
    findings.push({ route, kind: "pageerror", text: error.message });
  };
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  try {
    await page.goto(`${BASE_URL}/${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(dwellMs);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  return findings;
}

async function main(): Promise<void> {
  let server: ChildProcess | null = null;
  if (await isServerUp()) {
    console.log(`[smoke] reusing dev server already running at ${BASE_URL}`);
  } else {
    console.log(`[smoke] starting dev server at ${BASE_URL}`);
    server = startDevServer();
    await waitForServer(Date.now() + SERVER_TIMEOUT_MS);
  }

  let browser: Browser | null = null;
  const findings: Finding[] = [];
  try {
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext();
    const page = await context.newPage();
    await context.route("**/v1/**", (route) =>
      route.fulfill({
        json:
          new URL(route.request().url()).pathname === "/v1/gateway/info"
            ? { providers: [], routes: [] }
            : [],
      }),
    );
    await page.routeWebSocket("**/v1/ws", (socket) => {
      socket.onMessage((data) => {
        const frame = JSON.parse(String(data));
        if (frame.action === "agent.list") {
          socket.send(
            JSON.stringify({
              type: "response",
              op_id: frame.op_id,
              ok: true,
              result: { agents: [], parent_capabilities: {}, classified_session_ids: [] },
            }),
          );
          return;
        }
        if (frame.op === "subscribe")
          socket.send(JSON.stringify({ op: "subscribed", topic: frame.topic, from_seq: 1 }));
        if (frame.action === "session.list")
          socket.send(
            JSON.stringify({
              type: "response",
              op_id: frame.op_id,
              ok: true,
              result: { sessions: [] },
            }),
          );
      });
    });
    for (const [index, route] of ROUTES.entries()) {
      const dwell = index === 0 ? FIRST_DWELL_MS : ROUTE_DWELL_MS;
      console.log(`[smoke] checking ${route} (dwelling ${dwell}ms)`);
      findings.push(...(await collectForRoute(page, route, dwell)));
    }
  } finally {
    await browser?.close();
    stopDevServer(server);
    if (server !== null) {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  const blocking = findings.filter(
    (finding) => finding.kind === "pageerror" || isForbidden(finding.text),
  );
  if (blocking.length > 0) {
    console.error(`[smoke] FAILED: ${blocking.length} blocking issue(s)`);
    for (const finding of blocking) {
      console.error(`[${finding.kind}] ${finding.route}: ${finding.text}`);
    }
    process.exitCode = 1;
    return;
  }
  console.log("[smoke] PASSED: no page errors, no blocking console errors on all routes");
}

main().catch((error: unknown) => {
  console.error("[smoke] crashed:", error);
  process.exitCode = 1;
});
