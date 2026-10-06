import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import type { ReactNode } from "react";
import { fireEvent, getByLabelText } from "@testing-library/react";
import { StoryGate } from "./storyHelpers";
import { LifecycleMenu, NeedsAttentionBadge, SessionResumeAffordance } from "./LifecycleMenu";
import { sessionsStore } from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";

function seedSession(partial: Partial<SessionView> & { id: string }): SessionView {
  return {
    harness: "claude",
    state: "live",
    deleted: false,
    title: partial.id,
    pendingApprovals: 0,
    ...partial,
  };
}

function seed(sessions: SessionView[]): void {
  sessionsStore.setState({
    sessions: Object.fromEntries(sessions.map((session) => [session.id, session])),
    order: sessions.map((session) => session.id),
    filters: {},
    syncState: "idle",
  });
}

function Wrapper({ children }: { children: ReactNode }) {
  return <StoryGate>{children}</StoryGate>;
}

const LIVE_SESSION = seedSession({
  id: "11111111-1111-4111-8111-111111111111",
  title: "Refactor auth middleware",
  state: "live",
  activity: "active",
  model: "openrouter/free",
  projectPath: "D:/Dev/alpha",
  nativeId: "native-1",
  daemonOrigin: true,
});

const STOPPED_RESUMABLE = seedSession({
  id: "22222222-2222-4222-8222-222222222222",
  title: "Migrate database",
  state: "stopped",
  lastStopCause: "viewer_stop",
  model: "openrouter/free",
  projectPath: "D:/Dev/beta",
  nativeId: "native-2",
  daemonOrigin: true,
});

const STOPPED_NOT_RESUMABLE = seedSession({
  id: "33333333-3333-4333-8333-333333333333",
  title: "One-off CLI run",
  state: "stopped",
  lastStopCause: "crash",
  projectPath: "D:/Dev/gamma",
  nativeId: null,
});

function PaneHeaderFrame({ children }: { children: ReactNode }) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        width: 420,
        padding: "6px 10px",
        background: "var(--color-raised)",
        border: "1px solid var(--color-border-subtle)",
        borderRadius: "var(--radius-md)",
      }}
    >
      {children}
    </div>
  );
}

function useClickFlow(actions: string[]): void {
  useEffect(() => {
    const timers = actions.map((label, index) => {
      return window.setTimeout(() => {
        const trigger = getByLabelText(document.body, "Session actions");
        if (index === 0) {
          fireEvent.click(trigger);
          return;
        }
        const item = getByLabelText(document.body, label);
        fireEvent.click(item);
      }, index * 60);
    });
    return () => {
      for (const timer of timers) {
        window.clearTimeout(timer);
      }
    };
  }, [actions]);
}

const meta = {
  title: "Sessions/LifecycleMenu",
  component: LifecycleMenu,
  parameters: { layout: "centered" },
  decorators: [(Story: () => React.ReactElement) => <Wrapper>{<Story />}</Wrapper>],
} satisfies Meta<typeof LifecycleMenu>;

export default meta;
type Story = StoryObj<typeof meta>;

export const MenuOnLiveSession: Story = {
  args: { session: LIVE_SESSION },
  render: () => {
    function Story() {
      useClickFlow(["open"]);
      return <LifecycleMenu session={LIVE_SESSION} />;
    }
    return <Story />;
  },
};

export const ResumeDisabledWithoutConversation: Story = {
  args: { session: STOPPED_NOT_RESUMABLE },
  render: () => <LifecycleMenu session={STOPPED_NOT_RESUMABLE} />,
};

export const ResumeEnabledOnStopped: Story = {
  args: { session: STOPPED_RESUMABLE },
  render: () => <LifecycleMenu session={STOPPED_RESUMABLE} />,
};

export const RenameOverlay: Story = {
  args: { session: LIVE_SESSION },
  render: () => {
    function Story() {
      useClickFlow(["Rename"]);
      return <LifecycleMenu session={LIVE_SESSION} />;
    }
    return <Story />;
  },
};

export const DeleteConfirmOverlay: Story = {
  args: { session: STOPPED_RESUMABLE },
  render: () => {
    function Story() {
      useClickFlow(["Delete"]);
      return <LifecycleMenu session={STOPPED_RESUMABLE} />;
    }
    return <Story />;
  },
};

export const ViewerStopResumeAffordance: Story = {
  args: { session: STOPPED_RESUMABLE },
  render: () => (
    <PaneHeaderFrame>
      <span className="pane-title">{STOPPED_RESUMABLE.title}</span>
      <SessionResumeAffordance sessionId={STOPPED_RESUMABLE.id} />
      <LifecycleMenu session={STOPPED_RESUMABLE} />
    </PaneHeaderFrame>
  ),
};

export const NeedsAttentionBadgeStory: Story = {
  args: { session: LIVE_SESSION },
  render: () => {
    function Story() {
      useEffect(() => {
        seed([LIVE_SESSION]);
        sessionsStore.getState().applySessionPatch(LIVE_SESSION.id, { needsAttention: true });
      }, []);
      return (
        <PaneHeaderFrame>
          <span className="pane-title">{LIVE_SESSION.title}</span>
          <NeedsAttentionBadge sessionId={LIVE_SESSION.id} />
          <LifecycleMenu session={LIVE_SESSION} />
        </PaneHeaderFrame>
      );
    }
    return <Story />;
  },
};
