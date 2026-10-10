import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath, URL } from "node:url";

export default defineConfig({
  plugins: [react()],
  cacheDir: process.env.MANDRI_VITE_CACHE_DIR,
  optimizeDeps: {
    entries: ["index.html"],
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  clearScreen: false,
  envPrefix: ["VITE_", "TAURI_ENV_"],
});
