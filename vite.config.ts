import path from "node:path";
import { sveltekit } from "@sveltejs/kit/vite";
import tailwindcss from "@tailwindcss/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    tailwindcss(),
    sveltekit(),
    {
      name: "molibot-runtime-bootstrap",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          setTimeout(() => {
            void server
              .ssrLoadModule("/src/lib/server/app/runtime.ts")
              .then((mod) => {
                if (typeof mod.getRuntime === "function") {
                  mod.getRuntime();
                  console.log("[dev-bootstrap] runtime initialized via ssrLoadModule");
                  return;
                }
                throw new Error("getRuntime export not found");
              })
              .catch((error) => {
                console.warn(
                  `[dev-bootstrap] runtime init failed: ${error instanceof Error ? error.message : String(error)}`
                );
              });
          }, 200);
        });
      }
    }
  ],
  resolve: {
    alias: {
      "@pinixai/weixin-bot/src/index": path.resolve("node_modules/@pinixai/weixin-bot/src/index.ts"),
      "@pinixai/weixin-bot/src/auth": path.resolve("node_modules/@pinixai/weixin-bot/src/auth.ts"),
      "@pinixai/weixin-bot/src/api": path.resolve("node_modules/@pinixai/weixin-bot/src/api.ts"),
      "@pinixai/weixin-bot/src/types": path.resolve("node_modules/@pinixai/weixin-bot/src/types.ts")
    },
    // Avoid package "development" export condition in dev server for lit-based deps.
    conditions: ["browser", "module", "import", "default"]
  },
  server: {
    port: 3000,
    fs: {
      allow: [".."]
    }
  },
  optimizeDeps: {
    include: [
      "@mariozechner/pi-web-ui",
      "@mariozechner/pi-agent-core",
      "@mariozechner/pi-ai",
      "@mariozechner/mini-lit",
      "lit"
    ]
  }
});
