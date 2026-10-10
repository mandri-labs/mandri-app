import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const cacheDir = mkdtempSync(join(tmpdir(), "mandri-browser-smoke-"));
let exitCode = 0;

// Each scenario starts its own Vite server and intercepts every daemon request.
// Presentation and legacy capture scripts that read an existing daemon are excluded.
try {
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
      env: { ...process.env, MANDRI_VITE_CACHE_DIR: cacheDir },
    });
    if (result.error) throw result.error;
    if (result.status !== 0) {
      console.error(`[smoke] ${name}: failed`);
      exitCode = result.status ?? 1;
      break;
    }
    console.log(`[smoke] ${name}: passed in ${Math.round(performance.now() - started)}ms`);
  }
} finally {
  rmSync(cacheDir, { recursive: true, force: true });
}
process.exitCode = exitCode;
