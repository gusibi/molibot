import { sveltekit } from "@sveltejs/kit/vite";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [
    sveltekit(),
    {
      name: "molibot-runtime-bootstrap",
      configureServer(server) {
        server.httpServer?.once("listening", () => {
          setTimeout(() => {
            void server
              .ssrLoadModule("/src/lib/server/runtime.ts")
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
