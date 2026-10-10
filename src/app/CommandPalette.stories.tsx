import type { Meta, StoryObj } from "@storybook/react-vite";
import { useEffect } from "react";
import type { ReactNode } from "react";
import i18next from "i18next";
import { fireEvent } from "@testing-library/react";
import { StoryGate, badgeSessions, seedStore } from "@/features/sessions/storyHelpers";
import catalogEn from "@/i18n/en.json";
import catalogFr from "@/i18n/fr.json";
import { initI18n } from "@/i18n";
import { CommandPalette } from "./CommandPalette";

export function registerMergedI18n(): void {
  i18next.addResourceBundle("en", "translation", catalogEn, true, false);
  i18next.addResourceBundle("fr", "translation", catalogFr, true, false);
}

void initI18n("en");
registerMergedI18n();

const meta = {
  title: "App/CommandPalette",
  component: CommandPalette,
  parameters: { layout: "fullscreen" },
  decorators: [
    (Story: () => ReactNode) => (
      <StoryGate>
        <SeedRecentSessions />
        <Story />
      </StoryGate>
    ),
  ],
} satisfies Meta<typeof CommandPalette>;

export default meta;
type Story = StoryObj<typeof meta>;

const baseArgs = { open: true, onClose: () => undefined } as const;

function SeedRecentSessions() {
  useEffect(() => {
    seedStore(badgeSessions);
  }, []);
  return null;
}

function TypedPalette({ query }: { query: string }) {
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const input = document.body.querySelector<HTMLInputElement>(".command-palette-input");
      if (input !== null) {
        fireEvent.change(input, { target: { value: query } });
      }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [query]);
  return <CommandPalette open onClose={() => undefined} />;
}

export const Open: Story = {
  args: baseArgs,
  render: () => <CommandPalette open onClose={() => undefined} />,
};

export const FilteredCommands: Story = {
  args: baseArgs,
  render: () => <TypedPalette query="pro" />,
};

export const FilteredRecentSessions: Story = {
  args: baseArgs,
  render: () => <TypedPalette query="deploy" />,
};

export const NoMatch: Story = {
  args: baseArgs,
  render: () => <TypedPalette query="zzz" />,
};

export const EmptySessions: Story = {
  args: baseArgs,
  render: function EmptySessionsPalette() {
    useEffect(() => {
      seedStore([]);
    }, []);
    return <CommandPalette open onClose={() => undefined} />;
  },
};
