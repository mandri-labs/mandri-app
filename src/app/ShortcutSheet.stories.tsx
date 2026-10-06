import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { StoryGate } from "@/features/sessions/storyHelpers";
import { registerMergedI18n } from "./CommandPalette.stories";
import { ShortcutSheet } from "./ShortcutSheet";

registerMergedI18n();

const meta = {
  title: "App/ShortcutSheet",
  component: ShortcutSheet,
  parameters: { layout: "fullscreen" },
  decorators: [(Story: () => ReactNode) => <StoryGate>{<Story />}</StoryGate>],
} satisfies Meta<typeof ShortcutSheet>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {
  args: { open: true, onClose: () => undefined },
  render: () => <ShortcutSheet open onClose={() => undefined} />,
};
