import type { Meta, StoryObj } from "@storybook/react-vite";
import type { ReactNode } from "react";
import { StoryGate } from "@/features/sessions/storyHelpers";
import { registerMergedI18n } from "./CommandPalette.stories";
import { ErrorBoundary } from "./ErrorBoundary";

registerMergedI18n();

function ThrowingChild(): never {
  throw new Error("Simulated render failure for the error boundary story");
}

const meta = {
  title: "App/ErrorBoundary",
  component: ErrorBoundary,
  parameters: { layout: "fullscreen" },
  decorators: [(Story: () => ReactNode) => <StoryGate>{<Story />}</StoryGate>],
} satisfies Meta<typeof ErrorBoundary>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Fallback: Story = {
  args: { children: null },
  render: () => (
    <ErrorBoundary>
      <ThrowingChild />
    </ErrorBoundary>
  ),
};
