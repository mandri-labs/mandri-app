import { afterEach, beforeAll, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { initI18n } from "@/i18n";
import { sessionsStore, type SessionView } from "@/stores/sessions";
import { ProjectMenu } from "./ProjectMenu";

beforeAll(() => initI18n("fr"));
afterEach(cleanup);
it("counts all sidebar tasks, updates activity and dismisses the panel", () => {
  const sessions = Array.from({ length: 15 }, (_, index) => ({
    id: String(index), title: `Task ${index}`, harness: "codex", state: "live",
    activity: index === 0 ? "active" : "idle", projectPath: "D:\\Dev\\example-project",
  } as SessionView));
  sessionsStore.setState({ sessions: Object.fromEntries(sessions.map((session) => [session.id, session])), order: sessions.map((session) => session.id), filters: {} });
  render(<ProjectMenu path={"D:\\Dev\\example-project"} />);
  const button = screen.getByRole("button", { name: "Informations du projet example-project" });
  fireEvent.click(button);
  expect(screen.getByText("15 tâches · 1 actif")).toBeTruthy();
  act(() => sessionsStore.setState({ sessions: { ...sessionsStore.getState().sessions, "1": { ...sessions[1]!, activity: "active" } } }));
  expect(screen.getByText("15 tâches · 2 actifs")).toBeTruthy();
  fireEvent.keyDown(document, { key: "Escape" });
  expect(button.getAttribute("aria-expanded")).toBe("false");
  fireEvent.click(button);
  fireEvent.pointerDown(document.body);
  expect(button.getAttribute("aria-expanded")).toBe("false");
});
