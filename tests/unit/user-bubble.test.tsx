import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { UserBubble } from "@/features/transcript/renderers/UserBubble";
import {
  Disclosure,
  DisclosureContext,
  DisclosureKeyContext,
} from "@/features/transcript/renderers/Disclosure";

beforeAll(async () => {
  await initI18n("en");
});
afterEach(cleanup);

describe("user message disclosure", () => {
  it.each([
    ["long text", "Synthetic message. ".repeat(50)],
    ["many lines", Array.from({ length: 9 }, (_, index) => `Line ${index}`).join("\n")],
  ])("replaces the %s preview with the full message when expanded", (_, text) => {
    const view = render(<UserBubble text={text} />);
    const preview = `${text.slice(0, 220)}…`;
    const toggle = screen.getByRole("button");
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain(preview);
    expect(view.container.querySelector(".tr-user-full")).toBeNull();

    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Collapse message" })).toBe(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    expect(view.container.querySelector(".tr-user-preview")).toBeNull();
    expect(view.container.querySelector(".tr-user-full")?.textContent).toBe(text);

    fireEvent.click(toggle);
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(toggle.textContent).toContain(preview);
    expect(view.container.querySelector(".tr-user-full")).toBeNull();
  });

  it("restores the expanded state without restoring the duplicate preview", () => {
    const cache = new Map<string, boolean>();
    const text = "Synthetic message. ".repeat(50);
    const bubble = (
      <DisclosureContext.Provider value={cache}>
        <DisclosureKeyContext.Provider value="user-message">
          <UserBubble text={text} />
        </DisclosureKeyContext.Provider>
      </DisclosureContext.Provider>
    );
    const first = render(bubble);
    fireEvent.click(screen.getByRole("button"));
    first.unmount();

    const restored = render(bubble);
    expect(
      screen.getByRole("button", { name: "Collapse message" }).getAttribute("aria-expanded"),
    ).toBe("true");
    expect(restored.container.querySelector(".tr-user-preview")).toBeNull();
    expect(restored.container.querySelector(".tr-user-full")?.textContent).toBe(text);
  });

  it("leaves short messages without a disclosure", () => {
    render(<UserBubble text="Short message" />);
    expect(screen.getByText("Short message")).toBeTruthy();
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("keeps other disclosure titles unchanged when no expanded title is supplied", () => {
    render(<Disclosure title="Tool activity">Details</Disclosure>);
    const toggle = screen.getByRole("button", { name: "Tool activity" });
    fireEvent.click(toggle);
    expect(screen.getByRole("button", { name: "Tool activity" })).toBe(toggle);
    expect(screen.getByText("Details")).toBeTruthy();
  });
});
