import { afterEach, expect, it, vi } from "vitest";
import { resumeSession, startSession } from "@/daemon/rest/runtime";

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

it.each(["start", "resume"])("does not abort a silent %s request", async (action) => {
  vi.useFakeTimers();
  let complete!: (response: Response) => void;
  let signal!: AbortSignal;
  vi.stubGlobal(
    "fetch",
    vi.fn((_url: string, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((resolve) => {
        complete = resolve;
      });
    }),
  );
  const request =
    action === "resume"
      ? resumeSession("slow")
      : startSession({ harness: "opencode", cwd: "/workspace", model: "provider/model" });
  await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
  expect(signal.aborted).toBe(false);
  complete(new Response(JSON.stringify({ id: "slow", harness: "opencode", state: "live" })));
  await expect(request).resolves.toMatchObject({ id: "slow" });
});
