import { Shell } from "@/app/Shell";
import "@/app/shell.css";
import "@/features/transcript/renderers/renderers.css";
import type { Meta, StoryObj } from "@storybook/react-vite";
import { CanvasLayout } from "./CanvasLayout";
import { MarkdownText } from "@/features/transcript/renderers/MarkdownText";
import { initI18n } from "@/i18n";
void initI18n("en");
const meta = {
  title: "Features/Canvas",
  component: CanvasLayout,
  parameters: { layout: "fullscreen" },
} satisfies Meta<typeof CanvasLayout>;
export default meta;
type Story = StoryObj<typeof meta>;
export const Files: Story = {
  render: (args) => <Shell route={{ name: "session", id: args.sessionId! }}>{args.children}</Shell>,
  args: {
    sessionId: "canvas-fixture",
    children: (
      <div style={{ padding: 24, overflow: "auto", width: "100%" }}>
        <MarkdownText
          sessionId="canvas-fixture"
          text={
            "# Review files\n\n[Guide](/workspace/docs/guide.md)\n\n[Missing](/workspace/missing.md)\n\n![Diagram](/workspace/diagram.png)\n\n```typescript\nconst answer = 42;\nconsole.log(answer);\n```"
          }
        />
      </div>
    ),
  },
  decorators: [
    (Story) => (
      <div style={{ height: "100vh", display: "flex" }}>
        <Story />
      </div>
    ),
  ],
};
