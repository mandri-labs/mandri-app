import { spawnSync } from "node:child_process";

// Each scenario starts its own Vite server and intercepts every daemon request.
// Presentation and legacy capture scripts that read an existing daemon are excluded.
for (const name of [
  "composer-storage",
  "connection-overlay",
  "app.smoke",
  "remediation",
  "agents-ownership",
  "external-transcript",
  "gateway-reasoning",
  "native-resume",
  "session-lifecycle",
  "session-startup",
  "transcript-performance",
  "claude-message-dedup",
  "codex-file-reload",
  "user-message-stability",
  "native-activity-events",
  "codex-streaming-history",
  "pi",
]) {
  const started = performance.now();
  console.log(`[smoke] ${name}: starting`);
  const result = spawnSync(process.execPath, [`tests/browser-smoke/${name}.spec.ts`], {
    stdio: "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    console.error(`[smoke] ${name}: failed`);
    process.exit(result.status ?? 1);
  }
  console.log(`[smoke] ${name}: passed in ${Math.round(performance.now() - started)}ms`);
}
