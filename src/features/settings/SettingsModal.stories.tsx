import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import { StoryGate } from "@/features/sessions/storyHelpers";
import { preferencesStore } from "@/stores/preferences";
import type { ThemeSetting } from "@/stores/preferences";
import { SettingsModal } from "./SettingsModal";

interface SeedProps {
  theme?: ThemeSetting;
  daemonBaseUrl?: string;
}

function SeedPreferences({ theme, daemonBaseUrl }: SeedProps) {
  useEffect(() => {
    const restore = preferencesStore.getState();
    const restoreTheme = document.documentElement.dataset.theme;
    preferencesStore.getState().patch({
      ...(theme !== undefined ? { theme } : {}),
      ...(daemonBaseUrl !== undefined ? { daemonBaseUrl } : {}),
    });
    if (theme !== undefined) {
      document.documentElement.dataset.theme = theme;
    }
    return () => {
      preferencesStore.setState({
        theme: restore.theme,
        daemonBaseUrl: restore.daemonBaseUrl,
      });
      if (restoreTheme === undefined) {
        delete document.documentElement.dataset.theme;
      } else {
        document.documentElement.dataset.theme = restoreTheme;
      }
    };
  }, [theme, daemonBaseUrl]);
  return null;
}

function withTauriMock(): () => void {
  const original = window.__TAURI_INTERNALS__;
  window.__TAURI_INTERNALS__ = {};
  return () => {
    if (original === undefined) {
      delete window.__TAURI_INTERNALS__;
    } else {
      window.__TAURI_INTERNALS__ = original;
    }
  };
}

function UnmountCleanup({ cleanup }: { cleanup: () => void }) {
  useEffect(() => cleanup, [cleanup]);
  return null;
}

const meta = {
  title: "Features/Settings/SettingsModal",
  component: SettingsModal,
  parameters: { layout: "fullscreen" },
  args: { open: true, onClose: () => undefined },
  decorators: [
    (Story: () => React.ReactNode) => (
      <StoryGate>
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta<typeof SettingsModal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Overview: Story = {
  decorators: [
    (Story: () => React.ReactNode) => (
      <>
        <SeedPreferences theme="dark" daemonBaseUrl="http://127.0.0.1:8787" />
        <Story />
      </>
    ),
  ],
};

export const Providers: Story = {
  decorators: [
    (Story: () => React.ReactNode) => (
      <>
        <SeedPreferences theme="dark" />
        <Story />
      </>
    ),
  ],
  args: { initialSection: "providers" },
};

export const Appearance: Story = {
  decorators: [
    (Story: () => React.ReactNode) => (
      <>
        <SeedPreferences theme="dark" />
        <Story />
      </>
    ),
  ],
  args: { initialSection: "appearance" },
};

export const LightTheme: Story = {
  decorators: [
    (Story: () => React.ReactNode) => (
      <>
        <SeedPreferences theme="light" />
        <Story />
      </>
    ),
  ],
  args: { initialSection: "appearance" },
};

export const NonLoopbackWarning: Story = {
  decorators: [
    (Story: () => React.ReactNode) => (
      <>
        <SeedPreferences daemonBaseUrl="http://192.168.1.42:8787" />
        <Story />
      </>
    ),
  ],
  args: { initialSection: "connection" },
};

export const DesktopToggles: Story = {
  decorators: [
    (Story: () => React.ReactNode) => {
      const cleanup = withTauriMock();
      return (
        <>
          <UnmountCleanup cleanup={cleanup} />
          <Story />
        </>
      );
    },
  ],
  args: { initialSection: "notifications" },
};

export const SessionDefaults: Story = {
  decorators: [
    (Story: () => React.ReactNode) => (
      <>
        <SeedPreferences theme="dark" />
        <Story />
      </>
    ),
  ],
  args: { initialSection: "defaults" },
};
