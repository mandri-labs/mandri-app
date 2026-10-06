import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useMemo, useState } from "react";
import { initI18n } from "@/i18n";
import type { HarnessKind } from "@/daemon/types/ws";
import type { CommandInvocation } from "@/daemon/types/commands";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import { Transcript } from "@/features/transcript/Transcript";
import { SessionComposer } from "@/features/transcript/SessionComposer";
import { parseClaudeEvent } from "@/features/transcript/parse/claude";
import { commandDismissals } from "./dismissals";
import { commandsStore } from "./store";
import type { CommandTransport } from "./service";

const feed = {
  ensureSession: () => undefined,
  loadHistory: async () => undefined,
  sendPrompt: async () => ({ state: "queued" as const, code: null }),
  interrupt: async () => true,
};

function PlacementPreview({
  harness = "claude",
  running = false,
  stopped = false,
}: {
  harness?: HarnessKind;
  running?: boolean;
  stopped?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const sessionId = `command-placement-${harness}-${running}`;
  const records = useMemo<CommandInvocation[]>(() => {
    const record = (name: string, text: string): CommandInvocation => ({
      invocation_id: `${sessionId}-${name}`,
      session_id: sessionId,
      command: {
        id: name,
        name,
        description: name === "goal" ? "Say hello" : "Reload workspace skills",
        aliases: [],
        kind: "command",
      },
      arguments:
        name === "goal" ? "Say hello" : name === "review" ? "Review uncommitted changes" : "",
      state: running && name === "goal" ? "running" : "succeeded",
      cancellable: false,
      result:
        running && name === "goal"
          ? undefined
          : { kind: name === "goal" ? "transcript" : "text", text },
    });
    return harness === "claude"
      ? [
          record("goal", "Hello! I'm ready to help."),
          record("reload-skills", "Reloaded skills: 12 skills available (no changes)"),
        ]
      : harness === "opencode"
        ? [
            record("review", "Review response is shown in the conversation."),
            record("workspace-check", "Workspace check completed."),
          ]
        : [record("workspace-check", "Workspace check completed.")];
  }, [sessionId, harness, running]);
  const transport = useMemo<CommandTransport>(
    () => ({
      catalog: async () => ({ commands: records.map((record) => record.command) }),
      list: async () => records,
      invoke: async () => {
        throw new Error("This is a display-only fixture");
      },
      cancel: async () => {
        throw new Error("This fixture cannot be cancelled");
      },
    }),
    [records],
  );
  useEffect(() => {
    let active = true;
    void initI18n("en").then(() => {
      if (!active) return;
      sessionsStore.setState((state) => ({
        sessions: {
          ...state.sessions,
          [sessionId]: {
            id: sessionId,
            harness,
            state: stopped ? "stopped" : "live",
            deleted: false,
            title: "Command placement",
            activity: "idle",
            pendingApprovals: 0,
          },
        },
      }));
      commandDismissals.setState({ hidden: {} });
      commandsStore.setState((state) => ({
        sessions: { ...state.sessions, [sessionId]: records },
      }));
      transcriptStore.getState().setNodes(
        sessionId,
        harness === "claude"
          ? [
              ...parseClaudeEvent(
                {
                  type: "user",
                  uuid: "goal-input",
                  message: {
                    content:
                      "<command-name>/goal</command-name>\n<command-message>goal</command-message>\n<command-args>Say hello</command-args>",
                  },
                },
                "claude",
              ),
              { kind: "assistant", text: "Hello! I'm ready to help.", key: "reply" },
            ]
          : [{ kind: "user", text: "Check the workspace", key: "input" }],
      );
      setReady(true);
    });
    return () => {
      active = false;
    };
  }, [sessionId, harness, records, stopped]);
  return ready ? (
    <div className="session-view" style={{ height: 680, width: "min(800px, 100%)" }}>
      <div className="session-view-column">
        <Transcript sessionId={sessionId} harness={harness} feed={feed} commands={transport} />
        <SessionComposer sessionId={sessionId} commands={transport} feed={feed} />
      </div>
    </div>
  ) : null;
}

const meta = {
  title: "Features/Commands/Placement",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Production transcript and composer layout. Claude envelopes are parsed into readable text. Only the latest goal and OpenCode review are pinned; ordinary command results are measured before transcript breathing room. Other harnesses use synthetic workspace commands to exercise the shared layout, not claim native availability.",
      },
    },
  },
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;
export const ClaudeGoalAndReloadSkills: Story = { render: () => <PlacementPreview /> };
export const ClaudeRunningGoal: Story = { render: () => <PlacementPreview running /> };
export const CodexCommandResult: Story = { render: () => <PlacementPreview harness="codex" /> };
export const OpenCodeCommandResult: Story = {
  render: () => <PlacementPreview harness="opencode" />,
};
export const AgyCommandResult: Story = { render: () => <PlacementPreview harness="agy" /> };

export const StoppedSessionGoal: Story = { render: () => <PlacementPreview running stopped /> };
