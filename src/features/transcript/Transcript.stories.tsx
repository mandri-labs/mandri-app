import type { Meta, StoryObj } from "@storybook/react-vite";
import i18next from "i18next";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { initI18n } from "@/i18n";
import { loadFixture } from "@/daemon/fixtures";
import type { FixtureFile } from "@/daemon/fixtures";
import { fixtureToSessionSeed, validateFixtureFrames } from "@/daemon/fixtures";
import { installReplaySocket } from "@/storybook/replayConnection";
import type { ActionResultMap, RequestAction } from "@/daemon/types/ws";
import type { EventMessage, HarnessKind } from "@/daemon/types/ws";
import type { ServerMessage } from "@/daemon/types/ws";
import { sessionFeed } from "@/daemon/ws/sessionFeed";
import { PaneManager } from "@/app/panes/PaneManager";
import { panesStore } from "@/stores/panes";
import { sessionsStore, transcriptStore } from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";

void initI18n("en");

function StoryGate({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(() => i18next.isInitialized);
  useEffect(() => {
    const onReady = (): void => {
      setReady(true);
    };
    if (i18next.isInitialized) {
      setReady(true);
      return;
    }
    i18next.on("initialized", onReady);
    return () => {
      i18next.off("initialized", onReady);
    };
  }, []);
  return ready ? <>{children}</> : null;
}

function ResetStores() {
  useEffect(() => {
    panesStore.getState().closeAll();
    sessionsStore.setState({ sessions: {}, order: [] });
    transcriptStore.getState().resetTranscripts();
    return installReplaySocket({
      request: async <A extends RequestAction>(action: A): Promise<ActionResultMap[A]> => {
        if (action === "session.history")
          return {
            entries: [],
            next_cursor: null,
            has_more: false,
          } as unknown as ActionResultMap[A];
        throw new Error("This offline story only replays recorded events.");
      },
      subscribe: () => undefined,
      unsubscribe: () => undefined,
    });
  }, []);
  return null;
}

function eventOf(frame: ServerMessage): EventMessage | null {
  if ("type" in frame) {
    return null;
  }
  if (!("raw" in frame) || !("seq" in frame)) {
    return null;
  }
  return frame;
}

function replayFixtureIntoSession(fixture: FixtureFile, sessionId: string, repeats: number): void {
  const events = validateFixtureFrames(fixture)
    .frames.map(eventOf)
    .filter((event): event is EventMessage => event !== null);
  if (events.length === 0) {
    return;
  }
  const base = events.reduce((min, event) => Math.min(min, event.seq), Number.POSITIVE_INFINITY);
  const span = events.reduce((max, event) => Math.max(max, event.seq), base) - base + 1;
  for (let pass = 0; pass < repeats; pass += 1) {
    const shift = pass * span - (base - 1);
    for (const event of events) {
      sessionFeed.ingestSessionFrame(sessionId, fixture.harness, {
        ...event,
        seq: event.seq + shift,
      });
    }
  }
}

function seedSessionView(view: SessionView): void {
  sessionsStore.setState((state) => ({
    sessions: { ...state.sessions, [view.id]: view },
    order: state.order.includes(view.id) ? state.order : [...state.order, view.id],
  }));
}

function openFixturePane(
  fixture: FixtureFile,
  options: { repeats?: number; activity?: "active" | "idle" } = {},
): string {
  const seed = fixtureToSessionSeed(fixture);
  const sessionId = seed.id;
  seedSessionView({
    id: sessionId,
    harness: fixture.harness,
    state: seed.state,
    deleted: false,
    title: seed.title,
    pendingApprovals: 0,
    activity: options.activity ?? "active",
  });
  panesStore.getState().openPane(sessionId);
  sessionFeed.ensureSession(sessionId, fixture.harness);
  replayFixtureIntoSession(fixture, sessionId, options.repeats ?? 1);
  return sessionId;
}

interface FixtureSpec {
  harness: HarnessKind;
  scenario: string;
  repeats?: number;
  activity?: "active" | "idle";
}

function FixturePanes({ specs }: { specs: readonly FixtureSpec[] }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const spec of specs) {
        const fixture = await loadFixture(spec.harness, spec.scenario);
        if (fixture === null || cancelled) {
          continue;
        }
        openFixturePane(fixture, { repeats: spec.repeats, activity: spec.activity });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [specs]);
  return <PaneManager />;
}

const meta = {
  title: "Features/Transcript/Transcript",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <ResetStores />
        <div style={{ height: "100dvh", display: "flex", flexDirection: "column" }}>
          <Story />
        </div>
      </StoryGate>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const ClaudeToolsDiff: Story = {
  render: () => <FixturePanes specs={[{ harness: "claude", scenario: "tools-diff" }]} />,
};

export const OpencodeToolsDiff: Story = {
  render: () => <FixturePanes specs={[{ harness: "opencode", scenario: "tools-diff" }]} />,
};

export const ClaudeChat: Story = {
  render: () => <FixturePanes specs={[{ harness: "claude", scenario: "chat" }]} />,
};

export const CodexChat429: Story = {
  render: () => <FixturePanes specs={[{ harness: "codex", scenario: "chat" }]} />,
};

export const LongSessionPartial: Story = {
  render: () => (
    <FixturePanes
      specs={[{ harness: "claude", scenario: "tools-diff", repeats: 30, activity: "idle" }]}
    />
  ),
};

export const CodexToolsDiff: Story = {
  render: () => <FixturePanes specs={[{ harness: "codex", scenario: "tools-diff" }]} />,
};

// Protocol regression for literal Codex file contents; the captured Codex
// fixture above ended in a provider rate limit before any file was changed.
function CodexFileChangesExample() {
  useEffect(() => {
    const sessionId = "codex-file-changes";
    seedSessionView({
      id: sessionId,
      harness: "codex",
      state: "live",
      deleted: false,
      title: "Codex file changes",
      pendingApprovals: 0,
      activity: "idle",
    });
    panesStore.getState().openPane(sessionId);
    sessionFeed.ensureSession(sessionId, "codex");
    const rawEvents = [
      {
        method: "item/completed",
        params: {
          item: {
            type: "userMessage",
            id: "user",
            content: [{ text: "Add prompt attachments and update the runtime." }],
          },
        },
      },
      {
        method: "item/completed",
        params: {
          item: {
            type: "agentMessage",
            id: "message",
            text: "I added the attachment type and updated the runtime.",
          },
        },
      },
      {
        method: "item/completed",
        params: {
          item: {
            type: "fileChange",
            id: "edit",
            status: "completed",
            changes: [
              {
                path: "/home/developer/Mandri/mandri/mandri_core/src/mandri/core/types/prompt.py",
                kind: { type: "add" },
                diff: "import dataclasses\n\n@dataclasses.dataclass(frozen=True)\nclass PromptAttachment:\n    path: str\n    media_type: str\n    data: bytes\n",
              },
              {
                path: "C:\\Users\\developer\\Mandri\\mandri\\mandri_runtime\\src\\mandri\\runtime\\control\\prompt.py",
                kind: { type: "update" },
                diff: "@@ -20,2 +20,2 @@\n-def prompt(text):\n+def prompt(text, attachments):\n     return text\n",
              },
              {
                path: "/home/developer/Mandri/mandri/mandri_runtime/src/mandri/runtime/obsolete.py",
                kind: { type: "delete" },
                diff: "# obsolete\n",
              },
            ],
          },
        },
      },
    ];
    rawEvents.forEach((raw, index) =>
      sessionFeed.ingestSessionFrame(sessionId, "codex", {
        topic: `session.${sessionId}`,
        source: "codex",
        seq: index + 1,
        ts: Date.now(),
        raw,
      }),
    );
    return () => sessionFeed.closeSession(sessionId);
  }, []);
  return <PaneManager />;
}

export const CodexFileChanges: Story = { render: () => <CodexFileChangesExample /> };
