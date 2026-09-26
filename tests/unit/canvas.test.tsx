import { beforeAll, beforeEach, afterEach, it, expect, vi } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import { fileTarget } from "@/features/canvas/targets";
import { canvasStore, openCanvas } from "@/features/canvas/store";
import { CanvasLayout } from "@/features/canvas/CanvasLayout";
import { request } from "@/daemon/rest/client";
import { initI18n } from "@/i18n";
vi.mock("@/daemon/rest/client", () => ({ request: vi.fn() }));
beforeAll(() => initI18n("en"));
beforeEach(() => {
  canvasStore.setState({ sessions: {} });
  vi.mocked(request).mockReset();
});
afterEach(cleanup);
it("resolves document-relative native and Docker paths while retaining positions", () => {
  expect(fileTarget("../src/main.ts#L2-L5", "/workspace/docs/guide.md")).toMatchObject({
    path: "/workspace/src/main.ts",
    line: 2,
    endLine: 5,
  });
  expect(fileTarget("../src/main.ts:3:8", "/home/example/project/docs/guide.md")).toMatchObject({
    path: "/home/example/project/src/main.ts",
    line: 3,
    column: 8,
  });
  expect(fileTarget("#hello", "/workspace/guide.md")).toMatchObject({
    path: "/workspace/guide.md",
    anchor: "hello",
  });
  expect(fileTarget("main.ts:3:8")).toMatchObject({ path: "main.ts", line: 3, column: 8 });
  expect(() => fileTarget("javascript:alert(1)")).toThrow();
});
it("reuses file tabs and isolates sessions", () => {
  openCanvas("one", fileTarget("/workspace/a.py:2"));
  openCanvas("one", fileTarget("/workspace/a.py#L3-L4"));
  openCanvas("two", fileTarget("/workspace/a.py"));
  expect(canvasStore.getState().sessions.one!.tabs).toHaveLength(1);
  expect(canvasStore.getState().sessions.one!.tabs[0]!.target).toMatchObject({
    line: 3,
    endLine: 4,
  });
  expect(canvasStore.getState().sessions.two!.tabs[0]!.target).not.toHaveProperty("line", 3);
});
it("renders Markdown, resolves relative code links and highlights the requested range", async () => {
  vi.mocked(request).mockImplementation(
    async (_url, options) =>
      new Blob([
        options?.query?.path === "/workspace/docs/guide.md"
          ? "# Guide\n\n[Code](../main.ts#L2-L3)"
          : "const a = 1;\nconst b = 2;\nconst c = 3;",
      ]) as never,
  );
  openCanvas("one", fileTarget("/workspace/docs/guide.md"));
  render(
    <CanvasLayout sessionId="one">
      <div>Chat</div>
    </CanvasLayout>,
  );
  await screen.findByRole("heading", { name: "Guide" });
  fireEvent.click(screen.getByRole("link", { name: "Code" }));
  await screen.findByRole("tab", { name: "main.ts" });
  await vi.waitFor(() =>
    expect(document.querySelectorAll(".canvas-selected-line")).toHaveLength(2),
  );
  expect(request).toHaveBeenCalledWith(
    "/v1/sessions/one/files",
    expect.objectContaining({ query: { path: "/workspace/main.ts" } }),
  );
  fireEvent.click(screen.getByRole("button", { name: "Close canvas" }));
  expect(screen.queryByRole("complementary")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Open in canvas" }));
  expect(screen.getByRole("tab", { name: "main.ts" })).toBeTruthy();
});
it("reports unavailable files and never substitutes generated contents", async () => {
  vi.mocked(request).mockRejectedValue(new Error("404"));
  render(<CanvasLayout sessionId="one">Chat</CanvasLayout>);
  act(() => openCanvas("one", fileTarget("/workspace/missing.md")));
  await screen.findByText("File unavailable in this session context.");
  expect(document.querySelector(".canvas-document")).toBeNull();
});
