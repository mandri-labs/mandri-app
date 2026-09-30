import { createServer } from "vite";
import { chromium } from "playwright";
import type { Browser, ConsoleMessage, Page } from "playwright";

const ROUTES = ["#/", "#/settings", "#/providers", "#/routes"];
const FIRST_DWELL_MS = 10_000;
const ROUTE_DWELL_MS = 5_000;

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

async function collectForRoute(
  page: Page,
  baseUrl: string,
  route: string,
  dwellMs: number,
): Promise<Finding[]> {
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
    await page.goto(`${baseUrl}/${route}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(dwellMs);
  } finally {
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
  }
  return findings;
}

async function main(): Promise<void> {
  const server = await createServer({
    server: { host: "127.0.0.1", port: 0, strictPort: false, hmr: false, watch: null },
  });
  let browser: Browser | null = null;
  const findings: Finding[] = [];
  try {
    await server.listen();
    const address = server.httpServer?.address();
    if (!address || typeof address === "string") throw new Error("missing server address");
    const baseUrl = `http://127.0.0.1:${address.port}`;
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
      findings.push(...(await collectForRoute(page, baseUrl, route, dwell)));
    }
  } finally {
    await browser?.close();
    await server.close();
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
