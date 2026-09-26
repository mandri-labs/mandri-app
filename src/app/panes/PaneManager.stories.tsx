import type { Meta, StoryObj } from "@storybook/react-vite";
import i18next from "i18next";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { initI18n } from "@/i18n";
import { loadFixture } from "@/daemon/fixtures";
import type { FixtureFile } from "@/daemon/fixtures";
import { fixtureToSessionSeed, validateFixtureFrames } from "@/daemon/fixtures";
import type { EventMessage } from "@/daemon/types/ws";
import type { HarnessKind } from "@/daemon/types/ws";
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

function replayFixtureIntoSession(fixture: FixtureFile, sessionId: string): void {
  const events = validateFixtureFrames(fixture)
    .frames.map(eventOf)
    .filter((event): event is EventMessage => event !== null);
  if (events.length === 0) {
    return;
  }
  const base = events.reduce((min, event) => Math.min(min, event.seq), Number.POSITIVE_INFINITY);
  for (const event of events) {
    sessionFeed.ingestSessionFrame(sessionId, fixture.harness, { ...event, seq: event.seq - (base - 1) });
  }
}

function seedSessionView(view: SessionView): void {
  sessionsStore.setState((state) => ({
    sessions: { ...state.sessions, [view.id]: view },
    order: state.order.includes(view.id) ? state.order : [...state.order, view.id],
  }));
}

function openFixturePane(fixture: FixtureFile): void {
  const seed = fixtureToSessionSeed(fixture);
  seedSessionView({
    id: seed.id,
    harness: fixture.harness,
    state: seed.state,
    deleted: false,
    title: seed.title,
    pendingApprovals: 0,
    activity: "active",
  });
  panesStore.getState().openPane(seed.id);
  sessionFeed.ensureSession(seed.id, fixture.harness);
  replayFixtureIntoSession(fixture, seed.id);
}

interface PaneSpec {
  harness: HarnessKind;
  scenario: string;
}

function SeededPanes({ specs }: { specs: readonly PaneSpec[] }) {
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      for (const spec of specs) {
        const fixture = await loadFixture(spec.harness, spec.scenario);
        if (fixture === null || cancelled) {
          continue;
        }
        openFixturePane(fixture);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [specs]);
  return <PaneManager />;
}

const meta = {
  title: "App/PaneManager",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <ResetStores />
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta;

export default meta;
type Story = StoryObj<typeof meta>;

export const Single: Story = {
  render: () => <SeededPanes specs={[{ harness: "claude", scenario: "tools-diff" }]} />,
};

export const Split: Story = {
  render: () => (
    <SeededPanes
      specs={[
        { harness: "claude", scenario: "tools-diff" },
        { harness: "opencode", scenario: "tools-diff" },
      ]}
    />
  ),
};

export const Grid: Story = {
  render: () => (
    <SeededPanes
      specs={[
        { harness: "claude", scenario: "chat" },
        { harness: "codex", scenario: "chat" },
        { harness: "claude", scenario: "tools-diff" },
        { harness: "opencode", scenario: "tools-diff" },
      ]}
    />
  ),
};
