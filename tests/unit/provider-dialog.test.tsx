import { useRef, useState } from "react";
import { afterEach, beforeAll, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { ProviderFormDialog } from "@/features/providers/ProviderForm";
import { useOverlayFocus } from "@/app/dialogFocus";
import { initI18n } from "@/i18n";
import type { ProviderView } from "@/stores/providers";

beforeAll(async () => {
  await initI18n("en");
});
afterEach(cleanup);
const provider: ProviderView = {
  name: "Local development",
  kind: "custom",
  apiBase: "http://localhost:9999",
  state: "verified",
  catalogState: "idle",
};

it("hydrates each newly opened edit and keeps an active draft through catalog updates", () => {
  const props = { onClose: vi.fn(), onSaved: vi.fn() };
  const view = render(<ProviderFormDialog {...props} open={false} />);
  view.rerender(<ProviderFormDialog {...props} open provider={provider} />);
  expect((screen.getByDisplayValue(provider.name) as HTMLInputElement).disabled).toBe(true);
  fireEvent.change(screen.getByDisplayValue(provider.apiBase!), {
    target: { value: "http://localhost:8000" },
  });
  view.rerender(
    <ProviderFormDialog {...props} open provider={{ ...provider, catalogState: "loaded" }} />,
  );
  expect(screen.getByDisplayValue("http://localhost:8000")).toBeTruthy();
  view.rerender(<ProviderFormDialog {...props} open={false} provider={provider} />);
  view.rerender(
    <ProviderFormDialog
      {...props}
      open
      provider={{ ...provider, name: "Other", apiBase: "http://localhost:9000" }}
    />,
  );
  expect(screen.getByDisplayValue("Other")).toBeTruthy();
  expect(screen.getByDisplayValue("http://localhost:9000")).toBeTruthy();
});

function NestedDialogs() {
  const [parentOpen, setParentOpen] = useState(false);
  const [childOpen, setChildOpen] = useState(false);
  const parent = useRef<HTMLDivElement>(null);
  useOverlayFocus(parent, parentOpen, () => setParentOpen(false));
  return (
    <>
      <button onClick={() => setParentOpen(true)}>Settings trigger</button>
      {parentOpen && (
        <div ref={parent} role="dialog" aria-label="Parent">
          <button onClick={() => setChildOpen(true)}>Add provider</button>
          <ProviderFormDialog
            open={childOpen}
            onClose={() => setChildOpen(false)}
            onSaved={() => setChildOpen(false)}
          />
        </div>
      )}
    </>
  );
}

it("closes only the top overlay and restores focus to its own trigger", () => {
  render(<NestedDialogs />);
  const settings = screen.getByRole("button", { name: "Settings trigger" });
  settings.focus();
  fireEvent.click(settings);
  const add = screen.getByRole("button", { name: "Add provider" });
  add.focus();
  fireEvent.click(add);
  expect(screen.getAllByRole("dialog")).toHaveLength(2);
  fireEvent.keyDown(document.activeElement!, { key: "Escape" });
  expect(screen.getAllByRole("dialog")).toHaveLength(1);
  expect(document.activeElement).toBe(add);
  fireEvent.keyDown(add, { key: "Escape" });
  expect(screen.queryByRole("dialog")).toBeNull();
  expect(document.activeElement).toBe(settings);
});
