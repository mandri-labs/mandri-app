import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { RawNode } from "@/features/transcript/renderers/RawNode";
import { presentTranscript } from "@/features/transcript/presentation";
import { debugPreferencesStore } from "@/stores/debugPreferences";

beforeAll(() => initI18n("en"));
afterEach(cleanup);

describe("technical events", () => {
  it("hides every technical event when disabled while preserving conversation warnings", () => {
    const nodes = ["usage", "error", "approval", "session_context", "permission-mode"].map((type) => ({
      kind: "raw" as const,
      harness: "codex",
      payload: { type },
    }));
    const warning = { kind: "system" as const, level: "warning" as const, text: "Connection interrupted" };
    expect(presentTranscript([...nodes, warning])).toEqual([warning]);
    expect(presentTranscript([...nodes, warning], false)).toEqual([warning]);
    expect(presentTranscript([...nodes, warning], true)).toEqual([
      ...nodes.slice(1),
      warning,
      { kind: "raw", harness: "", key: "diagnostics", payload: [{ type: "usage" }] },
    ]);
  });

  it("bounds pages and formats only expanded event payloads", () => {
    const serialize = vi.fn(() => ({ detail: "lazy payload" }));
    const events = Array.from({ length: 55 }, (_, index) => ({
      type: `event-${index}`,
      toJSON: serialize,
    }));
    const { container } = render(<RawNode harness="codex" payload={events} />);
    const disclosure = screen.getByRole("button", { name: "Technical events (55)" });
    expect(serialize).not.toHaveBeenCalled();
    fireEvent.click(disclosure);
    expect(container.querySelectorAll(".tr-debug-event")).toHaveLength(20);
    expect(serialize).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "event-54" }));
    expect(serialize).toHaveBeenCalledTimes(1);
    expect(container.querySelectorAll("pre")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(container.querySelectorAll(".tr-debug-event")).toHaveLength(20);
    expect(container.querySelectorAll("pre")).toHaveLength(0);
    fireEvent.click(screen.getByRole("button", { name: "Older" }));
    expect(container.querySelectorAll(".tr-debug-event")).toHaveLength(15);
    fireEvent.click(disclosure);
    fireEvent.click(disclosure);
    expect(container.querySelectorAll(".tr-debug-event")).toHaveLength(20);
    expect(screen.getByRole("button", { name: "event-54" })).toBeTruthy();
    expect(serialize).toHaveBeenCalledTimes(1);
  });

  it("hydrates only an explicit true from local storage", async () => {
    localStorage.removeItem("mandri.debug");
    debugPreferencesStore.setState({ showTechnicalEvents: false });
    expect(debugPreferencesStore.getState().showTechnicalEvents).toBe(false);
    debugPreferencesStore.getState().setShowTechnicalEvents(true);
    const saved = localStorage.getItem("mandri.debug");
    expect(JSON.parse(saved!).state).toEqual({ showTechnicalEvents: true });
    debugPreferencesStore.getState().setShowTechnicalEvents(false);
    localStorage.setItem("mandri.debug", saved!);
    await debugPreferencesStore.persist.rehydrate();
    expect(debugPreferencesStore.getState().showTechnicalEvents).toBe(true);
    for (const state of [{}, { showTechnicalEvents: "true" }, { showTechnicalEvents: false }]) {
      localStorage.setItem("mandri.debug", JSON.stringify({ state, version: 0 }));
      await debugPreferencesStore.persist.rehydrate();
      expect(debugPreferencesStore.getState().showTechnicalEvents).toBe(false);
    }
  });
});
