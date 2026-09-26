import type { Preview } from "@storybook/react-vite";
import "../src/design/fonts";
import "../src/design/tokens.css";
import "../src/design/theme.css";

const preview: Preview = {
  parameters: {
    layout: "centered",
    backgrounds: {
      default: "mandri-base",
      values: [
        { name: "mandri-base", value: "#16140f" },
        { name: "mandri-raised", value: "#1e1b15" },
      ],
    },
  },
  globalTypes: {
    theme: {
      name: "Theme",
      defaultValue: "dark",
      toolbar: {
        items: ["dark", "light"],
        showName: true,
      },
    },
  },
  decorators: [
    (Story, context) => {
      document.documentElement.dataset.theme = context.globals.theme === "light" ? "light" : "dark";
      return <Story />;
    },
  ],
};

export default preview;
