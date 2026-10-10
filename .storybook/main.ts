import { fileURLToPath } from "node:url";
import { normalizePath } from "vite";
import type { StorybookConfig } from "@storybook/react-vite";

const config: StorybookConfig = {
  framework: "@storybook/react-vite",
  stories: ["../src/**/*.stories.@(ts|tsx)"],
  addons: ["@storybook/addon-a11y"],
  staticDirs: [],
  async viteFinal(config) {
    // Resolve before the general @ alias. Production builds keep the real connection.
    const replayConnection = normalizePath(
      fileURLToPath(new URL("../src/storybook/replayConnection.ts", import.meta.url)),
    );
    const aliases = config.resolve?.alias ?? [];
    config.resolve = {
      ...config.resolve,
      alias: [
        { find: "@/app/connection", replacement: replayConnection },
        ...(Array.isArray(aliases)
          ? aliases
          : Object.entries(aliases).map(([find, replacement]) => ({ find, replacement }))),
      ],
    };
    config.plugins = [
      ...(config.plugins ?? []),
      {
        name: "storybook-offline-relative-connection",
        enforce: "pre",
        resolveId(source, importer) {
          if (source === "./connection" && importer?.includes("/src/app/")) return replayConnection;
        },
      },
    ];
    return config;
  },
};

export default config;
