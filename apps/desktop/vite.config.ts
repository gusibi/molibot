import { svelte } from "@sveltejs/vite-plugin-svelte";
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

const host = process.env.TAURI_DEV_HOST;
const previewTarget = process.env.MOLIBOT_DESKTOP_PREVIEW_TARGET;

export default defineConfig({
  plugins: [svelte()],
  resolve: {
    alias: {
      "@molibot/desktop-contract": fileURLToPath(
        new URL("../../src/lib/shared/desktop.ts", import.meta.url)
      )
    }
  },
  clearScreen: false,
  server: {
    host: host || "127.0.0.1",
    port: 1420,
    strictPort: true,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421
        }
      : undefined,
    proxy: previewTarget
      ? {
          "/molibot-api": {
            target: previewTarget,
            changeOrigin: false,
            rewrite: (path) => path.replace(/^\/molibot-api/, "")
          }
        }
      : undefined
  }
});
