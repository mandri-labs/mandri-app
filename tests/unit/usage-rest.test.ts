import { afterEach, expect, it, vi } from "vitest";
import { eraseSessionUsage, usageApi, usageParams } from "@/daemon/rest/usage";
import { usageQuery, overview } from "./usage-fixtures";
afterEach(() => vi.unstubAllGlobals());

it("uses half-open millisecond dates and independent deleted/descendant filters", () => {
  const now = new Date("2026-09-20T12:00:00Z");
  expect(usageParams(usageQuery, now)).toMatchObject({ from_ms: now.getTime() - 30 * 86400000, to_ms: now.getTime(), include_deleted: true, timezone: "Europe/Paris" });
  expect(usageParams({ ...usageQuery, scope: { kind: "session", id: "s/one" }, period: "lifetime", includeDescendants: false, includeDeleted: false }, now)).toMatchObject({ session_id: "s/one", from_ms: undefined, to_ms: undefined, include_deleted: false, include_descendants: false });
  expect(usageParams({ ...usageQuery, scope: { kind: "project", id: "/a b" } }, now).project_path).toBe("/a b");
});

it("reads one overview without triggering collection and preserves null vs zero", async () => {
  const payload = overview(); payload.summary.total_tokens = null; payload.summary.request_count = 0;
  const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify(payload))); vi.stubGlobal("fetch", fetch);
  const result = await usageApi.overview(usageQuery, new AbortController().signal);
  expect(result.summary.total_tokens).toBeNull(); expect(result.summary.request_count).toBe(0);
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(fetch.mock.calls[0]?.[0]).toContain("/v1/usage/overview?");
  expect(fetch.mock.calls[0]?.[1].method).toBe("GET");
});

it("erases only a confirmed explicit session scope", async () => {
  const fetch = vi.fn().mockResolvedValue(new Response('{"revision":4}')); vi.stubGlobal("fetch", fetch);
  await eraseSessionUsage("s/one", new AbortController().signal);
  expect(fetch.mock.calls[0]?.[0]).toContain("/v1/usage/sessions/s%2Fone/erase");
  expect(fetch.mock.calls[0]?.[1]).toMatchObject({ method: "POST", body: '{"confirmed":true}' });
});
