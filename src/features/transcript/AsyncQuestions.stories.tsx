import type { Meta, StoryObj } from "@storybook/react-vite";
import { useState } from "react";
import { initI18n } from "@/i18n";
import { AsyncQuestions } from "./AsyncQuestions";

const choices = [{
  title: "How should completed tasks appear?",
  options: ["Keep them in the list", "Move them to a separate section", "Hide them by default"],
}];

const meta = {
  title: "Features/Transcript/AsyncQuestions",
  component: AsyncQuestions,
  parameters: { layout: "centered" },
  loaders: [async () => { await initI18n("en"); return {}; }],
  args: { questions: choices, disabled: false, onAnswer: () => {} },
  argTypes: {
    questions: { control: "object" },
    disabled: { control: "boolean" },
    onAnswer: { control: false },
  },
  decorators: [(Story) => <div style={{ width: "min(800px, calc(100vw - 48px))" }}><Story /></div>],
  render: function InteractiveQuestion(args) {
    const [answer, setAnswer] = useState("");
    return <>
      <AsyncQuestions {...args} onAnswer={(value) => { setAnswer(value); args.onAnswer(value); }} />
      {answer && <output aria-live="polite" style={{ display: "block", marginTop: 16, whiteSpace: "pre-wrap" }}>
        {answer}
      </output>}
    </>;
  },
} satisfies Meta<typeof AsyncQuestions>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Choices: Story = {};

export const SelectedChoice: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLInputElement>('input[type="radio"]')?.click();
  },
};

export const CustomAnswer: Story = {
  play: ({ canvasElement }) => {
    canvasElement.querySelector<HTMLInputElement>(".async-question-other input")?.click();
  },
};

export const FreeAnswer: Story = {
  args: { questions: [{ title: "What should the release notes emphasize?", options: [] }] },
};

export const MultipleQuestions: Story = {
  args: { questions: [
    ...choices,
    { title: "Which order should the remaining tasks use?", options: ["Priority", "Creation date", "Due date"] },
    { title: "Any additional requirements?", options: [] },
  ] },
};

export const Disabled: Story = { args: { disabled: true } };

export const NarrowWithLongOptions: Story = {
  decorators: [(Story) => <div style={{ width: "min(342px, 100%)" }}><Story /></div>],
  args: { questions: [{
    title: "How should the task list behave when several completed tasks belong to the same project?",
    options: [
      "Keep completed tasks next to the remaining tasks so that the full project history stays visible.",
      "Group completed tasks in a collapsible section at the bottom of each project, ordered by completion date.",
      "Show only unfinished tasks and make completed tasks available through a separate filter.",
    ],
  }] },
};
