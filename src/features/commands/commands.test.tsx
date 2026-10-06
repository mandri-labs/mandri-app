import { fireEvent, render, screen, waitFor, cleanup } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { initI18n } from "@/i18n";
import type { CommandInvocation, NativeCommand } from "@/daemon/types/commands";
import { commandInput, searchCommands } from "./search";
import { useCommands } from "./useCommands";
import type { CommandTransport } from "./service";
import { commandsStore } from "./store";
import { CommandCard } from "./CommandCard";

const goal: NativeCommand = {
  id: "goal",
  name: "goal",
  aliases: ["objective"],
  kind: "command",
  description: "Set a goal",
};
const catalog = [goal, { ...goal, id: "goals", name: "goals", aliases: [] }];
function Harness({
  transport,
  initial = "/",
  cwd,
}: {
  transport: CommandTransport;
  initial?: string;
  cwd?: string;
}) {
  const [text, setText] = useState(initial);
  const commands = useCommands({
    sessionId: "test",
    harness: "claude",
    cwd,
    text,
    setText,
    enabled: true,
    busy: false,
    transport,
  });
  return (
    <>
      <textarea
        {...commands.inputProps}
        aria-label="Input"
        value={text}
        onChange={(event) => setText(event.target.value)}
        onKeyDown={commands.onKeyDown}
      />
      {commands.panel}
    </>
  );
}
function transportFor(commands: NativeCommand[]): CommandTransport {
  return {
    catalog: vi.fn(async () => ({ commands })),
    invoke: vi.fn(
      async (
        sessionId: string,
        invocationId: string,
        commandId: string,
      ): Promise<CommandInvocation> => ({
        invocation_id: invocationId,
        session_id: sessionId,
        command: commands.find((row) => row.id === commandId)!,
        state: "succeeded",
        cancellable: false,
      }),
    ),
    list: vi.fn(async () => []),
    cancel: vi.fn(),
  };
}
beforeAll(async () => {
  await initI18n("en");
});
afterEach(() => {
  cleanup();
  commandsStore.setState({ sessions: {} });
});

describe("native command search", () => {
  it("matches subsequences and deduplicates aliases", () => {
    expect(searchCommands([goal, goal], "ol")).toEqual([goal]);
    expect(searchCommands([goal], "ob")).toEqual([goal]);
    expect(commandInput("please /goal")).toBeNull();
    expect(commandInput("/goal  exact arguments\nsecond line")).toEqual({
      query: "goal",
      arguments: " exact arguments\nsecond line",
    });
  });
  it.each(["/go", "/ol"])("executes a unique match for %s", async (query) => {
    const transport = transportFor([goal]);
    render(<Harness transport={transport} />);
    await screen.findByRole("option");
    const input = screen.getByLabelText("Input");
    fireEvent.change(input, { target: { value: query } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());
    expect(transport.invoke).toHaveBeenCalledWith("test", expect.any(String), "goal", "");
  });
  it("does not execute the highlighted result among several matches", async () => {
    const transport = transportFor(catalog);
    render(<Harness transport={transport} />);
    await screen.findAllByRole("option");
    const input = screen.getByLabelText("Input");
    fireEvent.change(input, { target: { value: "/go" } });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(transport.invoke).not.toHaveBeenCalled();
    fireEvent.click(screen.getAllByRole("option")[0]!);
    await waitFor(() => expect(transport.invoke).toHaveBeenCalledOnce());
  });
  it("does not execute unknown commands or composing input", async () => {
    const transport = transportFor([goal]);
    render(<Harness transport={transport} />);
    await screen.findByRole("option");
    const input = screen.getByLabelText("Input");
    fireEvent.change(input, { target: { value: "/missing" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(transport.invoke).not.toHaveBeenCalled();
    fireEvent.change(input, { target: { value: "/go" } });
    fireEvent.keyDown(input, { key: "Enter", isComposing: true });
    expect(transport.invoke).not.toHaveBeenCalled();
  });
  it("preserves a new draft written during command delivery", async () => {
    const transport = transportFor([goal]);
    let finish!: () => void;
    transport.invoke = vi.fn(
      (sessionId: string, invocationId: string) =>
        new Promise<CommandInvocation>((resolve) => {
          finish = () =>
            resolve({
              session_id: sessionId,
              invocation_id: invocationId,
              command: goal,
              state: "running",
              cancellable: false,
            });
        }),
    );
    render(<Harness transport={transport} />);
    await screen.findByRole("option");
    const input = screen.getByLabelText("Input");
    fireEvent.change(input, { target: { value: "/go" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.change(input, { target: { value: "Next message" } });
    finish();
    await waitFor(() => expect((input as HTMLTextAreaElement).value).toBe("Next message"));
  });
  it("prepares commands before typing and reopens the palette without another catalog request", async () => {
    const transport = transportFor([goal]);
    render(<Harness transport={transport} initial="" />);
    await waitFor(() => expect(transport.catalog).toHaveBeenCalledOnce());
    const input = screen.getByLabelText("Input");
    fireEvent.change(input, { target: { value: "/" } });
    await screen.findByRole("option");
    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.change(input, { target: { value: "draft" } });
    fireEvent.change(input, { target: { value: "/ol" } });
    await screen.findByRole("option");
    expect(transport.catalog).toHaveBeenCalledOnce();
  });
  it("completes an argument command inline, keeps focus, and accepts optional empty arguments on the next Enter", async () => {
    const transport = transportFor([{ ...goal, argument_hint: "Objective" }]);
    render(<Harness transport={transport} initial="/go" />);
    await screen.findByRole("option");
    const input = screen.getByLabelText("Input");
    input.focus();
    fireEvent.keyDown(input, { key: "Enter" });
    expect((input as HTMLTextAreaElement).value).toBe("/goal ");
    expect(document.activeElement).toBe(input);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(transport.invoke).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(transport.invoke).toHaveBeenCalledWith("test", expect.any(String), "goal", ""),
    );
  });
  it("keeps clicked command arguments in the composer and sends them unchanged", async () => {
    const transport = transportFor([{ ...goal, argument_hint: "Objective" }]);
    render(<Harness transport={transport} />);
    const input = screen.getByLabelText("Input");
    input.focus();
    fireEvent.click(await screen.findByRole("option"));
    expect((input as HTMLTextAreaElement).value).toBe("/goal ");
    fireEvent.change(input, { target: { value: '/goal  "two words"\nnext line' } });
    fireEvent.keyDown(input, { key: "Enter" });
    await waitFor(() =>
      expect(transport.invoke).toHaveBeenCalledWith(
        "test",
        expect.any(String),
        "goal",
        ' "two words"\nnext line',
      ),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("does not carry an explicitly chosen command across workspace changes", async () => {
    const transport = transportFor([
      { ...goal, argument_hint: "Objective" },
      { ...goal, id: "goals", name: "goals" },
    ]);
    const { rerender } = render(<Harness transport={transport} cwd="/first" />);
    fireEvent.click((await screen.findAllByRole("option"))[0]!);
    expect((screen.getByLabelText("Input") as HTMLTextAreaElement).value).toBe("/goal ");
    rerender(<Harness transport={transport} cwd="/second" />);
    await screen.findAllByRole("option");
    fireEvent.keyDown(screen.getByLabelText("Input"), { key: "Enter" });
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog")).toBeNull();
  });
  it("renders readable native fields with no raw object fallback", () => {
    render(
      <CommandCard
        invocation={{
          invocation_id: "i",
          session_id: "s",
          command: goal,
          state: "succeeded",
          cancellable: false,
          result: {
            kind: "fields",
            title: "Usage",
            fields: [{ label: "Remaining", value: "50%" }],
          },
        }}
      />,
    );
    expect(screen.getByText("50%")).toBeTruthy();
    expect(screen.queryByText(/JSON/)).toBeNull();
  });
});
