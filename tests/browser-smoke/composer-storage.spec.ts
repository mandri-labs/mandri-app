import assert from "node:assert/strict";
import { createServer } from "vite";
import { chromium } from "playwright";

// Synthetic UI only: no daemon, user profile, or model requests.
const server = await createServer({ server: { port: 0, strictPort: false } });
await server.listen();
const browser = await chromium.launch({
  headless: true,
  executablePath: process.env.PLAYWRIGHT_EXECUTABLE_PATH,
});
const html = await server.transformIndexHtml("/storage-check", '<div id="root"></div>');
try {
  const page = await browser.newPage();
  const origin = server.resolvedUrls!.local[0]!;
  await page
    .context()
    .grantPermissions(["local-network-access"], { origin: new URL(origin).origin });
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== new URL(origin).origin) return route.abort();
    if (url.pathname === "/storage-check")
      return route.fulfill({ contentType: "text/html", body: html });
    return route.continue();
  });
  await page.goto(`${origin}storage-check`);
  const result = await page.evaluate(async () => {
    const load = (path: string) => import(/* @vite-ignore */ path);
    const { sessionsStore, transcriptStore } = await load("/src/stores/sessions.ts");
    const { initI18n } = await load("/src/i18n/index.ts");
    const { Composer } = await load("/src/features/transcript/Composer.tsx");
    const { React, ReactDOM } = await load("/tests/browser-smoke/react-runtime.ts");
    await initI18n("en");
    let quotaError = "";
    let storedCharacters = 0;
    try {
      for (let index = 0; index < 100; index += 1) {
        localStorage.setItem(`synthetic:${index}`, "x".repeat(256 * 1024));
        storedCharacters += 256 * 1024;
      }
    } catch (error) {
      quotaError = (error as Error).name;
    }
    // Exhaust the remainder so even a short recovery entry cannot be written.
    try {
      for (let index = 0; index < 300; index += 1)
        localStorage.setItem(`remainder:${index}`, "x".repeat(1024));
    } catch {
      /* Expected native quota failure. */
    }
    try {
      for (let index = 0; index < 1100; index += 1) localStorage.setItem(`tail:${index}`, "x");
    } catch {
      /* Expected native quota failure. */
    }
    sessionsStore.setState({
      sessions: {
        synthetic: {
          id: "synthetic",
          harness: "codex",
          title: "Synthetic",
          state: "live",
          deleted: false,
          pendingApprovals: 0,
        },
      },
      drafts: { synthetic: "Send with full storage" },
      order: ["synthetic"],
    });
    const calls: unknown[][] = [];
    const feed = {
      sendPrompt: async (...args: unknown[]) => {
        calls.push(args);
        return { state: "queued", code: null };
      },
      interrupt: async () => {},
    };
    const root = ReactDOM.createRoot(document.getElementById("root")!);
    root.render(React.createElement(Composer, { sessionId: "synthetic", feed }));
    const waitUntil = async (check: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!check()) {
        if (Date.now() > deadline) throw new Error("Timed out waiting for composer");
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
    };
    await waitUntil(() => !!document.querySelector('button[aria-label="Send"]'));
    (document.querySelector('button[aria-label="Send"]') as HTMLButtonElement).click();
    await waitUntil(
      () =>
        transcriptStore.getState().transcripts.synthetic?.localUsers?.[0]?.delivery?.state ===
        "accepted",
    );
    const draft = sessionsStore.getState().drafts.synthetic;
    root.unmount();
    localStorage.clear();
    return { quotaError, storedCharacters, calls, draft };
  });
  assert.equal(result.quotaError, "QuotaExceededError");
  assert.deepEqual(result.calls, [["synthetic", "Send with full storage"]]);
  assert.equal(result.draft, "");
  console.log(
    "Native Chromium quota exhausted; composer sent exactly once and recorded acceptance.",
  );
} finally {
  await browser.close();
  await server.close();
}
