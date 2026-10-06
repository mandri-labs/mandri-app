import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import i18next from "i18next";
import { initI18n } from "@/i18n";
import { connectionStore } from "@/stores/connection";
import type { ConnectionStatus } from "@/stores/connection";
import { DashboardPage } from "@/features/sessions/DashboardPage";
import { badgeSessions, SeedStore } from "@/features/sessions/storyHelpers";
import { Shell } from "./Shell";
import "./shell.css";

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

function StatusOverride({ status, children }: { status: ConnectionStatus; children: ReactNode }) {
  useEffect(() => {
    connectionStore.getState().setStatus(status);
    return () => {
      connectionStore.getState().setStatus("connecting");
    };
  }, [status]);
  return <>{children}</>;
}

void initI18n("en");

const meta = {
  title: "App/Shell",
  component: Shell,
  parameters: { layout: "fullscreen" },
  decorators: [(Story) => <StoryGate>{<Story />}</StoryGate>],
} satisfies Meta<typeof Shell>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseArgs = {
  route: { name: "dashboard" } as const,
  children: <DashboardPage />,
};

export const Online: Story = {
  args: { ...baseArgs },
};

export const WithSessions: Story = {
  args: { ...baseArgs },
  decorators: [
    (Story) => (
      <>
        <SeedStore sessions={badgeSessions} />
        <Story />
      </>
    ),
  ],
};

export const Connecting: Story = {
  args: { ...baseArgs },
  decorators: [
    (Story) => (
      <StatusOverride status="connecting">
        <Story />
      </StatusOverride>
    ),
  ],
};

export const Reconnecting: Story = {
  args: { ...baseArgs },
  decorators: [
    (Story) => (
      <StatusOverride status="reconnecting">
        <Story />
      </StatusOverride>
    ),
  ],
};

export const Offline: Story = {
  args: { ...baseArgs },
  decorators: [
    (Story) => (
      <StatusOverride status="offline">
        <Story />
      </StatusOverride>
    ),
  ],
};
