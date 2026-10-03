import { afterEach, expect, it } from "vitest";
import { displayPreferencesStore } from "@/stores/displayPreferences";

afterEach(() => {
  displayPreferencesStore.setState(displayPreferencesStore.getInitialState());
  localStorage.removeItem("mandri.display");
});

it.each([null, {}, { conversationWidth: "unknown" }])(
  "restores standard width when the saved preference is absent or invalid: %j",
  async (state) => {
    displayPreferencesStore.getState().setConversationWidth("full");
    if (state === null) localStorage.removeItem("mandri.display");
    else localStorage.setItem("mandri.display", JSON.stringify({ state, version: 0 }));
    await displayPreferencesStore.persist.rehydrate();
    expect(displayPreferencesStore.getState().conversationWidth).toBe("standard");
  },
);

it.each(["standard", "wide", "full"] as const)("restores saved width %s", async (width) => {
  localStorage.setItem(
    "mandri.display",
    JSON.stringify({ state: { conversationWidth: width }, version: 0 }),
  );
  await displayPreferencesStore.persist.rehydrate();
  expect(displayPreferencesStore.getState().conversationWidth).toBe(width);
});
