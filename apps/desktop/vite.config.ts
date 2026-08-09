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
      ),
      "@molibot/shared": fileURLToPath(
        new URL("../../src/lib/shared", import.meta.url)
      )
    }
  },
  clearScreen: false,
  // The viewer ships real WASM assets next to its lazy browser entry. Vite 7's
  // dependency optimizer rewrites those asset URLs in dev, so leave the entry
  // external and let the normal module graph preserve the package-relative WASM.
  optimizeDeps: {
    exclude: ["@silurus/ooxml"]
  },
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
