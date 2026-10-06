import { describe, expect, it } from "vitest";
import type { CommandInvocation } from "@/daemon/types/commands";
import { commandsForPlacement } from "./placement";

const record = (name: string, id = name, kind = "command"): CommandInvocation => ({
  invocation_id: id,
  session_id: "s",
  command: { id, name, kind, description: "", aliases: [] },
  state: "succeeded",
  cancellable: false,
});

describe("native command placement", () => {
  it("pins only the latest goal and keeps reload-skills in the transcript", () => {
    const old = record("goal", "old");
    const goal = record("/goal");
    const reload = record("reload-skills");
    expect(commandsForPlacement([old, goal, reload], "composer")).toEqual([goal]);
    expect(commandsForPlacement([old, goal, reload], "transcript")).toEqual([reload]);
  });
  it("leaves arbitrary commands and skills in the transcript across harnesses", () => {
    const records = [
      record("custom"),
      record("goal", "goal-skill", "skill"),
      record("usage"),
      record("my-goal"),
    ];
    expect(commandsForPlacement(records, "composer")).toEqual([]);
    expect(commandsForPlacement(records, "transcript")).toEqual(records);
  });
});

it("pins OpenCode review once without moving ordinary commands or another harness's review", () => {
  const old = record("review", "old-review");
  const latest = record("review", "new-review");
  const reload = record("reload-skills");
  expect(commandsForPlacement([old, latest, reload], "composer", "opencode")).toEqual([latest]);
  expect(commandsForPlacement([old, latest, reload], "transcript", "opencode")).toEqual([reload]);
  expect(commandsForPlacement([latest], "transcript", "claude")).toEqual([latest]);
});
