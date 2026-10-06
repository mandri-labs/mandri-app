import type { Meta, StoryObj } from "@storybook/react-vite";
import i18next from "i18next";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { CommandInvocation, CommandResult, NativeCommand } from "@/daemon/types/commands";
import { Composer, type ComposerFeed } from "@/features/transcript/Composer";
import { initI18n } from "@/i18n";
import { sessionsStore, type SessionView } from "@/stores/sessions";
import { CommandCard } from "./CommandCard";
import { CommandHistory } from "./CommandHistory";
import type { CommandTransport } from "./service";

void initI18n("en");

function StoryGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(i18next.isInitialized);
  useEffect(() => {
    const initialized = () => setReady(true);
    if (i18next.isInitialized) initialized();
    i18next.on("initialized", initialized);
    return () => {
      i18next.off("initialized", initialized);
    };
  }, []);
  return ready ? children : null;
}

function command(
  name: string,
  description: string,
  extra: Partial<NativeCommand> = {},
): NativeCommand {
  return {
    id: name,
    name,
    description,
    aliases: [],
    kind: "inspection",
    accepts_arguments: false,
    ...extra,
  };
}

const syntheticCatalog = [
  command("goal", "Set an objective for this example"),
  command("inspect", "Inspect the current workspace"),
  command("init", "Prepare project guidance"),
  command("custom-check", "A command discovered from a workspace extension", {
    aliases: ["check"],
    kind: "prompt",
    accepts_arguments: true,
    argument_hint: "Area to inspect",
  }),
];

const feed: ComposerFeed = {
  sendPrompt: async () => ({ state: "queued", code: null }),
  interrupt: async () => true,
};

type CatalogMode = "ready" | "loading" | "error" | "empty";

function Playground({
  initial = "/",
  mode = "ready",
  busy = false,
}: {
  initial?: string;
  mode?: CatalogMode;
  busy?: boolean;
}) {
  const root = useRef<HTMLDivElement>(null);
  const sessionId = `command-story-${mode}-${initial}-${busy}`;
  const transport = useMemo<CommandTransport>(() => {
    const records: CommandInvocation[] = [];
    return {
      catalog: async () => {
        if (mode === "loading") return new Promise(() => {});
        if (mode === "error") throw new Error("The native catalog is temporarily unavailable");
        return { commands: mode === "empty" ? [] : syntheticCatalog };
      },
      invoke: async (id, invocationId, commandId, args) => {
        const selected = syntheticCatalog.find((row) => row.id === commandId)!;
        const invocation: CommandInvocation = {
          invocation_id: invocationId,
          session_id: id,
          command: selected,
          state: "succeeded",
          cancellable: false,
          result: {
            kind: "text",
            title: selected.name === "goal" ? "Objective selected" : "Command complete",
            text: args || "The synthetic native command completed. No daemon or model was called.",
          },
        };
        records.push(invocation);
        return invocation;
      },
      list: async () => [...records],
      cancel: async (_id, invocationId) =>
        records.find((row) => row.invocation_id === invocationId)!,
    };
  }, [mode]);
  useEffect(() => {
    const session: SessionView = {
      id: sessionId,
      harness: "claude",
      state: "live",
      deleted: false,
      title: "Native commands preview",
      model: "default",
      activity: busy ? "active" : "idle",
      pendingApprovals: 0,
    };
    sessionsStore.setState((state) => ({
      sessions: { ...state.sessions, [sessionId]: session },
      order: state.order.includes(sessionId) ? state.order : [...state.order, sessionId],
    }));
    const textarea = root.current?.querySelector("textarea");
    if (textarea) {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(
        textarea,
        initial,
      );
      textarea.dispatchEvent(new Event("input", { bubbles: true }));
    }
  }, [sessionId, initial, busy]);
  return (
    <div ref={root} style={{ minHeight: 570, display: "flex", flexDirection: "column", gap: 16 }}>
      <p style={{ color: "var(--color-text-muted)", fontSize: 13, lineHeight: 1.6 }}>
        Synthetic interaction fixture. Try /go or /ol, then Enter. With /i, Enter waits for a unique
        match. Select /custom-check, then type arguments directly in the composer. The goal command
        is a search example, not a claimed Codex capability.
      </p>
      <CommandHistory sessionId={sessionId} transport={transport} />
      <div style={{ marginTop: "auto", paddingTop: 320 }}>
        <Composer
          sessionId={sessionId}
          commands={transport}
          feed={feed}
          harnessLabel="Preview"
          modelLabel="Synthetic model"
        />
      </div>
    </div>
  );
}

const meta = {
  title: "Features/Commands",
  parameters: {
    layout: "padded",
    docs: {
      description: {
        component:
          "Production command components with deterministic, sanitized fixtures. Catalogs in these stories are examples only; runtime catalogs are discovered from each harness.",
      },
    },
  },
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <div style={{ maxWidth: 780, margin: "0 auto" }}>
          <Story />
        </div>
      </StoryGate>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

export const InteractiveSlashSearch: Story = { render: () => <Playground /> };
export const UniquePrefixGo: Story = { render: () => <Playground initial="/go" /> };
export const UniqueSubsequenceOl: Story = { render: () => <Playground initial="/ol" /> };
export const MultipleMatchesDoNotExecute: Story = { render: () => <Playground initial="/i" /> };
export const CustomCommandArguments: Story = { render: () => <Playground initial="/custom" /> };
export const NoSearchMatches: Story = { render: () => <Playground initial="/missing" /> };
export const CatalogLoading: Story = { render: () => <Playground mode="loading" /> };
export const CatalogUnavailable: Story = { render: () => <Playground mode="error" /> };
export const EmptyCatalog: Story = { render: () => <Playground mode="empty" /> };
export const SessionBusy: Story = { render: () => <Playground initial="/go" busy /> };
export const NarrowComposer: Story = {
  render: () => (
    <div style={{ maxWidth: 360 }}>
      <Playground />
    </div>
  ),
};

function record(
  name: string,
  result: CommandResult,
  state: CommandInvocation["state"] = "succeeded",
): CommandInvocation {
  return {
    invocation_id: `fixture-${name}`,
    session_id: "native-command-fixtures",
    command: command(name, "Native command preview"),
    state,
    result,
    cancellable: false,
  };
}

function resultStory(name: string, result: CommandResult): Story {
  return { render: () => <CommandCard invocation={record(name, result)} /> };
}

export const AgyHelp = resultStory("help", {
  kind: "list",
  title: "Help",
  items: [
    { title: "model", description: "Set a model, or run a single prompt on another model" },
    { title: "skills", description: "List available skills" },
    { title: "usage", description: "View model quota usage (alias: /quota)" },
  ],
});
export const AgyAgents = resultStory("agents", {
  kind: "list",
  title: "Agents",
  items: [],
  empty_message: "No agents available.",
});
export const AgySkills = resultStory("skills", {
  kind: "list",
  title: "Skills",
  items: [
    {
      title: "workspace-guide",
      description:
        "A synthetic workspace skill for this preview, located at skills/workspace-guide/SKILL.md. Available from the workspace or installation. The model can invoke it.",
    },
  ],
});
export const AgyHooks = resultStory("hooks", {
  kind: "list",
  title: "Hooks",
  items: [],
  empty_message: "No hooks available.",
});
export const AgyModel = resultStory("model", {
  kind: "fields",
  title: "Model",
  fields: [
    { label: "Id", value: "example-model" },
    { label: "Label", value: "Example model" },
    { label: "Is default", value: true },
  ],
});
export const AgyEffort = resultStory("effort", {
  kind: "fields",
  title: "Effort",
  fields: [{ label: "Adjustable", value: false }],
});
export const AgyConfig = resultStory("config", {
  kind: "fields",
  title: "Config",
  fields: [
    { label: "Model", value: "example-model" },
    { label: "Tool permission", value: "request-review" },
    { label: "Notifications", value: false },
    { label: "Custom model example", value: "example-route" },
    { label: "Gcp", value: null },
  ],
});
export const AgyPermissions = resultStory("permissions", {
  kind: "list",
  title: "Permissions",
  items: [{ title: "project" }, { title: "shared" }, { title: "global" }],
});
export const AgyUsage = resultStory("usage", {
  kind: "list",
  title: "Usage",
  items: [],
  empty_message: "No groups available.",
});
export const AgyCredits = resultStory("credits", {
  kind: "fields",
  title: "Credits",
  fields: [{ label: "Remaining credits", value: 0 }],
});
export const AgyChangelog = resultStory("changelog", {
  kind: "text",
  title: "Changelog",
  text: "## Example release\n\nSynthetic release notes for visual review.\n\n- Improved native command discovery.\n- Preserved command results when reconnecting.",
});

export const OpenCodeInit = resultStory("init", {
  kind: "transcript",
  text: "The native command was submitted. Follow its progress in the conversation.",
});
export const OpenCodeReview = resultStory("review", {
  kind: "text",
  title: "Review",
  text: "### Review complete\n\nNo blocking findings in the synthetic change.\n\nThe existing conversation contains the detailed tool activity.",
});
export const OpenCodeCustomize = resultStory("customize-opencode", {
  kind: "transcript",
  text: "The customization command continues in the conversation.",
});
export const ClaudeCompact = resultStory("compact", {
  kind: "text",
  title: "Conversation compacted",
  text: "Earlier context has been summarized. You can continue working in this conversation.",
});
export const ClaudeContext = resultStory("context", {
  kind: "fields",
  title: "Context",
  fields: [
    { label: "Used tokens", value: 24000 },
    { label: "Capacity", value: 200000 },
  ],
});
export const ClaudeCustomSkill = resultStory("workspace-check", {
  kind: "transcript",
  text: "The discovered workspace command continues in the conversation.",
});
export const CodexDiscoveredSkill = resultStory("workspace-guide", {
  kind: "transcript",
  title: "Skill started",
  text: "The dynamically discovered skill was submitted as a native skill input. Follow its progress in the conversation.",
});

export const ConfirmedFailure: Story = {
  render: () => (
    <CommandCard
      invocation={{
        ...record(
          "usage",
          { kind: "notice", text: "Native account information could not be retrieved." },
          "failed",
        ),
        error: "Check native sign-in, then try again.",
      }}
    />
  ),
};
export const OutcomeUnknownAfterDisconnect: Story = {
  render: () => (
    <CommandCard
      invocation={{
        ...record(
          "workspace-check",
          { kind: "notice", text: "The connection closed before the native result arrived." },
          "unknown",
        ),
        error: "The command may have been applied. It has not been sent again.",
      }}
    />
  ),
};
export const InterruptedCommand: Story = {
  render: () => (
    <CommandCard
      invocation={record(
        "review",
        { kind: "notice", text: "The native command was interrupted." },
        "interrupted",
      )}
    />
  ),
};

function CancelPreview() {
  const [cancelled, setCancelled] = useState(false);
  return (
    <CommandCard
      invocation={{
        ...record(
          "review",
          {
            kind: "notice",
            text: cancelled
              ? "The native command was interrupted."
              : "Reviewing the synthetic workspace.",
          },
          cancelled ? "interrupted" : "running",
        ),
        cancellable: !cancelled,
      }}
      onCancel={() => setCancelled(true)}
    />
  );
}
export const RunningAndCancel: Story = { render: () => <CancelPreview /> };

export const InlineCommandArguments: Story = {
  render: () => <Playground initial="/custom-check Authentication and session recovery" />,
};

export const AgyUnrecognizedNativeResult = resultStory("usage", {
  kind: "notice",
  title: "Usage",
  text: "The native command returned entries that are not supported yet.",
});

function FrenchPreview() {
  useEffect(() => {
    void initI18n("fr");
    return () => {
      void initI18n("en");
    };
  }, []);
  return <Playground initial="/ol" />;
}
export const FrenchSearch: Story = { render: () => <FrenchPreview /> };
