import { fileURLToPath, URL } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

const perfRun = process.argv.includes("tests/perf");

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: perfRun
    ? {
        environment: "happy-dom",
        include: ["tests/perf/**/*.bench.ts"],
        exclude: ["node_modules/**"],
      }
    : {
        environment: "happy-dom",
        include: ["src/**/*.test.{ts,tsx}", "tests/unit/**/*.test.{ts,tsx}"],
        exclude: ["tests/perf/**", "node_modules/**"],
      },
});
