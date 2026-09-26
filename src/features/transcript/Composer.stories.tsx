import type { Meta, StoryObj } from "@storybook/react-vite";
import i18next from "i18next";
import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { initI18n } from "@/i18n";
import { DaemonError } from "@/daemon/errors";
import { sessionsStore } from "@/stores/sessions";
import type { SessionView } from "@/stores/sessions";
import { Composer } from "./Composer";
import type { ComposerFeed } from "./Composer";

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

function SeedSession({ session }: { session: SessionView }) {
  useEffect(() => {
    sessionsStore.setState((state) => ({
      sessions: { ...state.sessions, [session.id]: session },
      order: state.order.includes(session.id) ? state.order : [...state.order, session.id],
    }));
  }, [session]);
  return null;
}

function SendOnMount({ text }: { text: string }) {
  useEffect(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (textarea === null) {
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, text);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    const button = document.querySelector<HTMLButtonElement>(".composer-send");
    button?.click();
  }, [text]);
  return null;
}

const idleSession: SessionView = {
  id: "composer-live",
  harness: "claude",
  state: "live",
  deleted: false,
  title: "Refactor the auth module",
  model: "openrouter/z-ai/glm-5.3-flash",
  reasoningEffort: "medium",
  activity: "idle",
  pendingApprovals: 0,
};

const busySession: SessionView = { ...idleSession, activity: "active" };

const queuedFeed: ComposerFeed = {
  sendPrompt: async () => ({ state: "queued", code: null }),
  interrupt: async () => true,
};

const steeredFeed: ComposerFeed = {
  sendPrompt: async () => ({ state: "steered", code: null }),
  interrupt: async () => true,
};

const failingFeed: ComposerFeed = {
  sendPrompt: async () => {
    throw new DaemonError({ code: "prompt_delivery_failed", message: "delivery failed" });
  },
  interrupt: async () => true,
};

const steerText = "Steer: focus on the auth tests first.";

function FilledWrapper() {
  useEffect(() => {
    const textarea = document.querySelector<HTMLTextAreaElement>(".composer textarea");
    if (textarea === null) {
      return;
    }
    const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set;
    setter?.call(textarea, "Refactor the auth module and add tests");
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  }, []);
  return <Composer />;
}

const meta = {
  title: "Features/Transcript/Composer",
  component: Composer,
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta<typeof Composer>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Filled: Story = {
  render: () => <FilledWrapper />,
};

export const Disabled: Story = {
  args: { disabled: true },
};

export const WithLabels: Story = {
  args: { harnessLabel: "Codex", modelLabel: "openrouter/gpt" },
};

export const WiredIdle: Story = {
  render: () => (
    <>
      <SeedSession session={idleSession} />
      <Composer sessionId={idleSession.id} />
    </>
  ),
};

export const WiredQueued: Story = {
  render: () => (
    <>
      <SeedSession session={idleSession} />
      <Composer sessionId={idleSession.id} feed={queuedFeed} />
      <SendOnMount text={steerText} />
    </>
  ),
};

export const WiredSteered: Story = {
  render: () => (
    <>
      <SeedSession session={busySession} />
      <Composer sessionId={busySession.id} feed={steeredFeed} />
      <SendOnMount text={steerText} />
    </>
  ),
};

export const WiredBusy: Story = {
  render: () => (
    <>
      <SeedSession session={busySession} />
      <Composer sessionId={busySession.id} />
    </>
  ),
};

export const WiredDeliveryError: Story = {
  render: () => (
    <>
      <SeedSession session={busySession} />
      <Composer sessionId={busySession.id} feed={failingFeed} />
      <SendOnMount text={steerText} />
    </>
  ),
};
