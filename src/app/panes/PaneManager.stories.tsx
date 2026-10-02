import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import { Shell } from "@/app/Shell";
import { navigate, useHashRoute } from "@/app/useHashRoute";
import { SessionView } from "@/features/transcript/SessionView";
import { AgentView } from "@/features/agents/AgentView";
import { StoryGate } from "@/features/sessions/storyHelpers";
import { initI18n } from "@/i18n";
import { panesStore, type PaneTarget } from "@/stores/panes";
import { PaneManager } from "./PaneManager";
import { openTargetPane } from "./targets";
import { installTeamStory } from "./storyEnvironment";
import { canvasStore, openCanvas, updateCanvas } from "@/features/canvas/store";

void initI18n("en");

function TeamWorkspace({
  targets,
  waiting = false,
  failed = false,
  initial = { kind: "session", id: "team" },
  width,
  closedCanvas = false,
}: {
  targets: PaneTarget[];
  waiting?: boolean;
  failed?: boolean;
  initial?: PaneTarget;
  width?: number;
  closedCanvas?: boolean;
}) {
  const [ready, setReady] = useState(false);
  const route = useHashRoute();
  useEffect(() => {
    const cleanup = installTeamStory(waiting, failed);
    const canvasBefore = canvasStore.getState();
    if (closedCanvas) {
      openCanvas(initial.id, {
        kind: "excerpt",
        id: "header-preview",
        title: "Preview",
        text: "const preview = true;",
        language: "typescript",
      });
      updateCanvas(initial.id, (state) => ({ ...state, open: false }));
    }
    for (const target of targets) openTargetPane(target);
    if (targets[0])
      panesStore
        .getState()
        .focusPane(targets[0].kind === "agent" ? `agent:${targets[0].id}` : targets[0].id);
    navigate({ name: initial.kind, id: initial.id });
    setReady(true);
    return () => {
      cleanup();
      canvasStore.setState(canvasBefore);
    };
  }, [targets, waiting, failed, initial, closedCanvas]);
  if (!ready || (route.name !== "session" && route.name !== "agent")) return null;
  return (
    <div
      style={{
        height: "100dvh",
        width: width ? `${width}px` : "100%",
        maxWidth: "100%",
        display: "flex",
        margin: "0 auto",
      }}
    >
      <Shell route={route}>
        <PaneManager
          target={{ kind: route.name, id: route.id }}
          workspace={route.workspace ?? null}
          onActivate={(target) => navigate({ name: target.kind, id: target.id })}
        >
          {route.name === "session" ? (
            <SessionView sessionId={route.id} />
          ) : (
            <AgentView agentId={route.id} />
          )}
        </PaneManager>
      </Shell>
    </div>
  );
}

const meta = {
  title: "App/PaneManager",
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story) => (
      <StoryGate>
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta;
export default meta;
type Story = StoryObj<typeof meta>;

const none: PaneTarget[] = [];
const split: PaneTarget[] = [
  { kind: "session", id: "team" },
  { kind: "session", id: "tests" },
];
const family: PaneTarget[] = [
  { kind: "session", id: "team" },
  { kind: "agent", id: "implementation" },
];
const grid: PaneTarget[] = [
  ...family,
  { kind: "agent", id: "review" },
  { kind: "agent", id: "migration" },
];
const approval: PaneTarget[] = [
  { kind: "agent", id: "implementation" },
  { kind: "agent", id: "migration" },
];
const root: PaneTarget = { kind: "session", id: "team" };
const reviewer: PaneTarget = { kind: "agent", id: "review" };
const failedReview: PaneTarget[] = [root, reviewer];

export const Single: Story = { render: () => <TeamWorkspace targets={none} initial={root} /> };
export const SingleWithClosedCanvas: Story = {
  render: () => <TeamWorkspace targets={none} initial={root} closedCanvas />,
};
export const Split: Story = { render: () => <TeamWorkspace targets={split} initial={root} /> };
export const ParentAndAgent: Story = {
  render: () => <TeamWorkspace targets={family} initial={root} />,
};
export const Grid: Story = {
  render: () => <TeamWorkspace targets={grid} initial={root} waiting />,
};
export const WaitingForApproval: Story = {
  render: () => <TeamWorkspace targets={approval} initial={approval[0]} waiting />,
};
export const ReadOnlyAgent: Story = {
  render: () => <TeamWorkspace targets={none} initial={reviewer} />,
};
export const FailedAgent: Story = {
  render: () => <TeamWorkspace targets={failedReview} initial={root} failed />,
};
export const Narrow: Story = {
  render: () => <TeamWorkspace targets={family} initial={root} width={860} />,
};
