import { StrictMode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { useComposerAutosize } from "@/features/transcript/useComposerAutosize";

function Editor({ text = "", mounted = true, label = "Prompt" }) {
  const ref = useComposerAutosize();
  return mounted ? (
    <textarea
      ref={ref}
      aria-label={label}
      value={text}
      readOnly
      style={{ boxSizing: "border-box", padding: "2px 6px", border: "0px solid", width: "400px" }}
    />
  ) : null;
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

it("uses native sizing without measuring or observing the field", () => {
  vi.stubGlobal("CSS", { supports: () => true });
  const observer = vi.fn();
  vi.stubGlobal("ResizeObserver", observer);
  const measure = vi.spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get");
  const view = render(<Editor />);
  view.rerender(<Editor text={"Many lines\n".repeat(20)} />);
  expect(observer).not.toHaveBeenCalled();
  expect(measure).not.toHaveBeenCalled();
  expect(screen.getByRole("textbox").style.height).toBe("");
});

it("grows and shrinks the fallback without collapsing the live input or recreating observers", () => {
  vi.stubGlobal("CSS", { supports: () => false });
  const disconnect = vi.fn();
  const observe = vi.fn();
  const observer = vi.fn(
    class {
      disconnect = disconnect;
      observe = observe;
    },
  );
  vi.stubGlobal("ResizeObserver", observer);
  vi.spyOn(HTMLTextAreaElement.prototype, "clientWidth", "get").mockReturnValue(400);
  const measure = vi
    .spyOn(HTMLTextAreaElement.prototype, "scrollHeight", "get")
    .mockImplementation(function (this: HTMLTextAreaElement) {
      // Layout is browser-tested; emulate line metrics to check resizing lifecycle.
      expect(this.style.height).not.toBe("auto");
      return this.value.split("\n").length * 21 + 4;
    });
  const view = render(<Editor />);
  const input = screen.getByRole("textbox") as HTMLTextAreaElement;
  expect(input.style.height).toBe("25px");
  view.rerender(<Editor text={"Line\n".repeat(10)} />);
  expect(input.style.height).toBe("235px");
  view.rerender(<Editor text="Short" />);
  expect(input.style.height).toBe("25px");
  expect(observer).toHaveBeenCalledTimes(1);
  expect(disconnect).not.toHaveBeenCalled();
  measure.mockClear();
  view.rerender(<Editor text="Short" label="Unrelated update" />);
  expect(measure).not.toHaveBeenCalled();
  fireEvent(window, new Event("resize"));
  expect(measure).toHaveBeenCalledTimes(1);
  view.rerender(<Editor mounted={false} />);
  expect(disconnect).toHaveBeenCalledTimes(1);
  expect(document.querySelector('[aria-hidden="true"]')).toBeNull();
  view.rerender(<Editor text="Restored draft" />);
  expect(screen.getByRole("textbox").style.height).toBe("25px");
  expect(observer).toHaveBeenCalledTimes(2);
  view.unmount();
  expect(disconnect).toHaveBeenCalledTimes(2);
});

it("cleans up fallback mirrors and listeners in StrictMode", () => {
  vi.stubGlobal("CSS", { supports: () => false });
  const view = render(
    <StrictMode>
      <Editor text="Draft" />
    </StrictMode>,
  );
  expect(document.querySelectorAll('textarea[aria-hidden="true"]')).toHaveLength(1);
  view.unmount();
  expect(document.querySelectorAll("textarea")).toHaveLength(0);
});
